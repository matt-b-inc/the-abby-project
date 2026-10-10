"""Grade capture validates marks, preserves history, and rewards participation once."""
from datetime import timedelta
from unittest import mock
from uuid import uuid4

from django.utils import timezone
from rest_framework.test import APITestCase

from apps.achievements.models import Skill, SkillCategory, SkillProgress
from apps.chronicle.models import ChronicleComment, ChronicleEntry, GradeDailyCounter
from apps.chronicle.tests.test_journal import _make_language_arts_skills
from apps.mcp_server.context import override_user
from apps.mcp_server.errors import MCPNotFoundError
from apps.mcp_server.schemas import GetChronicleSummaryIn, ListChronicleEntriesIn, MarkChronicleViewedIn
from apps.mcp_server.tools.chronicle import get_chronicle_summary, list_chronicle_entries, mark_chronicle_viewed
from apps.notifications.models import Notification, NotificationType
from apps.rewards.models import CoinLedger
from config.tests.factories import make_family


class GradeAPITests(APITestCase):
    def setUp(self):
        family = make_family(
            parents=[{"username": "mom"}], children=[{"username": "abby"}, {"username": "sibling"}],
        )
        other = make_family("Other", parents=[{"username": "outside-parent"}], children=[{"username": "other-child"}])
        self.child, self.sibling = family.children
        self.parent = family.parents[0]
        self.outside_parent, self.outside_child = other.parents[0], other.children[0]
        category = SkillCategory.objects.create(name="Life Skills")
        self.skill = Skill.objects.create(category=category, name="Time Management")
        self.client.force_authenticate(self.child)
        self.payload = {
            "subject": "Math", "assessment": "Fractions quiz", "grade_format": "percentage",
            "score": "82.5", "reflection": "I tried a new way to study.",
            "client_entry_id": str(uuid4()),
        }

    def post(self, payload=None):
        return self.client.post("/api/chronicle/grades/", self.payload if payload is None else payload, format="json")

    def patch_entry(self, entry_id, data):
        return self.client.patch(f"/api/chronicle/{entry_id}/grade/", data, format="json")

    def test_percentage_capture_and_verified_reward(self):
        with mock.patch("apps.chronicle.services.GameLoopService.on_task_completed") as game_loop:
            response = self.post()
        self.assertEqual(response.status_code, 201)
        row = response.json()
        self.assertEqual(row["kind"], "grade")
        self.assertTrue(row["is_private"])
        self.assertEqual(row["title"], "Math · Fractions quiz")
        self.assertEqual(row["summary"], self.payload["reflection"])
        self.assertEqual(row["occurred_on"], timezone.localdate().isoformat())
        self.assertEqual(row["metadata"]["grade"], {
            "subject": "Math", "assessment": "Fractions quiz", "grade_format": "percentage", "score": "82.5",
        })
        self.assertEqual(row["reward_receipt"]["status"], "awarded")
        self.assertEqual(row["reward_receipt"]["xp_awarded"], 10)
        self.assertEqual(row["reward_receipt"]["skills"][0]["name"], "Time Management")
        self.assertEqual(SkillProgress.objects.get(user=self.child, skill=self.skill).xp_points, 10)
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 1)
        self.assertFalse(CoinLedger.objects.filter(user=self.child).exists())
        game_loop.assert_not_called()

    def test_points_format_allows_extra_credit_and_normalizes_decimals(self):
        response = self.post({**self.payload, "grade_format": "points", "score": "11.250000", "possible": "10.000"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["metadata"]["grade"]["score"], "11.25")
        self.assertEqual(response.json()["metadata"]["grade"]["possible"], "10")

    def test_letter_format_supports_letter_and_nonletter_marks(self):
        for letter in ("A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "NP", "I"):
            payload = {**self.payload, "grade_format": "letter", "letter": letter, "client_entry_id": str(uuid4())}
            del payload["score"]
            with self.subTest(letter=letter):
                response = self.post(payload)
                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json()["metadata"]["grade"]["letter"], letter)
                self.assertNotIn("score", response.json()["metadata"]["grade"])

    def test_invalid_inputs_never_consume_eligibility(self):
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        invalid = [
            {"subject": " "}, {"subject": "x" * 81}, {"assessment": ""}, {"assessment": "x" * 81},
            {"grade_format": "unknown"}, {"score": "-1"}, {"score": "100.01"}, {"score": None},
            {"score": "NaN"}, {"score": "Infinity"}, {"score": "1E999999"},
            {"grade_format": "points", "possible": "0"}, {"grade_format": "points", "possible": "-4"},
            {"grade_format": "points"}, {"possible": "100"}, {"letter": "A"},
            {"grade_format": "letter", "score": None, "letter": "E"},
            {"grade_format": "letter", "score": None},
            {"grade_format": "letter", "letter": "A"},
            {"reflection": "x" * 4001}, {"occurred_on": tomorrow}, {"occurred_on": "not-a-date"},
            {"client_entry_id": "not-a-uuid"},
        ]
        for changes in invalid:
            with self.subTest(changes=changes):
                response = self.post({**self.payload, **changes})
                self.assertEqual(response.status_code, 400)
        missing_id = {key: value for key, value in self.payload.items() if key != "client_entry_id"}
        self.assertEqual(self.post(missing_id).status_code, 400)
        self.assertEqual(self.post({}).status_code, 400)
        self.assertFalse(ChronicleEntry.objects.filter(kind="grade").exists())
        self.assertFalse(GradeDailyCounter.objects.exists())

    def test_inactive_empty_fields_are_discarded(self):
        response = self.post({**self.payload, "possible": None, "letter": ""})
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("possible", response.json()["metadata"]["grade"])
        self.assertNotIn("letter", response.json()["metadata"]["grade"])

    def test_parent_cannot_create_or_correct_grades(self):
        entry_id = self.post().json()["id"]
        self.client.force_authenticate(self.parent)
        self.assertEqual(self.post().status_code, 403)
        self.assertEqual(self.patch_entry(entry_id, {"score": "95"}).status_code, 403)
        self.assertEqual(self.patch_entry(entry_id, {"is_private": False}).status_code, 403)

    def test_client_cannot_target_another_child(self):
        response = self.post({**self.payload, "user_id": self.sibling.pk})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"], self.child.pk)

    def test_unlimited_capture_after_first_daily_reward(self):
        first = self.post()
        self.assertEqual(first.json()["reward_receipt"]["xp_awarded"], 10)
        for i in range(4):
            response = self.post({**self.payload, "assessment": f"Another {i}", "client_entry_id": str(uuid4())})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["reward_receipt"]["status"], "daily_limit")
            self.assertEqual(response.json()["reward_receipt"]["xp_awarded"], 0)
        self.assertEqual(ChronicleEntry.objects.filter(kind="grade").count(), 5)
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 5)
        self.assertEqual(SkillProgress.objects.get(user=self.child, skill=self.skill).xp_points, 10)

    def test_marks_do_not_change_recognition_amount(self):
        for child, score in ((self.child, "0"), (self.sibling, "100")):
            self.client.force_authenticate(child)
            response = self.post({**self.payload, "score": score})
            self.assertEqual(response.json()["reward_receipt"]["xp_awarded"], 10)

    def test_historical_result_uses_save_day_eligibility(self):
        day = timezone.localdate() - timedelta(days=90)
        response = self.post({**self.payload, "occurred_on": day.isoformat()})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["occurred_on"], day.isoformat())
        self.assertEqual(response.json()["reward_receipt"]["reward_day"], timezone.localdate().isoformat())
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).occurred_on, timezone.localdate())
        second = self.post({**self.payload, "occurred_on": (day - timedelta(days=1)).isoformat(), "client_entry_id": str(uuid4())})
        self.assertEqual(second.json()["reward_receipt"]["status"], "daily_limit")

    def test_a_new_save_day_gets_new_eligibility(self):
        first = self.post()
        tomorrow = timezone.localdate() + timedelta(days=1)
        with mock.patch("apps.chronicle.grade_services.timezone.localdate", return_value=tomorrow):
            second = self.post({**self.payload, "client_entry_id": str(uuid4())})
        self.assertEqual(first.json()["reward_receipt"]["xp_awarded"], 10)
        self.assertEqual(second.json()["reward_receipt"]["xp_awarded"], 10)
        self.assertEqual(second.json()["occurred_on"], tomorrow.isoformat())
        self.assertEqual(GradeDailyCounter.objects.filter(user=self.child).count(), 2)

    def test_counter_survives_entry_removal(self):
        entry = self.post().json()
        ChronicleEntry.objects.get(pk=entry["id"]).delete()
        response = self.post({**self.payload, "client_entry_id": str(uuid4())})
        self.assertEqual(response.json()["reward_receipt"]["status"], "daily_limit")
        self.assertEqual(SkillProgress.objects.get(user=self.child, skill=self.skill).xp_points, 10)

    def test_receipt_reflects_boost(self):
        with mock.patch("apps.rpg.services.xp_boost_multiplier", return_value=2):
            response = self.post()
        self.assertEqual(response.json()["reward_receipt"]["xp_awarded"], 20)
        self.assertEqual(SkillProgress.objects.get(user=self.child, skill=self.skill).xp_points, 20)

    def test_unavailable_catalog_keeps_grade_but_consumes_daily_attempt(self):
        self.skill.delete()
        first = self.post()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.json()["reward_receipt"]["status"], "unavailable")
        self.assertEqual(first.json()["reward_receipt"]["xp_awarded"], 0)
        second = self.post({**self.payload, "client_entry_id": str(uuid4())})
        self.assertEqual(second.json()["reward_receipt"]["status"], "daily_limit")
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 2)

    def test_award_failure_rolls_back_xp_and_preserves_grade_and_cap(self):
        def interrupted_award(user, **kwargs):
            SkillProgress.objects.create(user=user, skill=self.skill, xp_points=10)
            raise RuntimeError("interrupted grade award")

        with mock.patch("apps.achievements.services.AwardService.grant", side_effect=interrupted_award):
            with self.assertLogs("apps.chronicle.services", level="ERROR"):
                first = self.post()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.json()["reward_receipt"]["status"], "unavailable")
        self.assertFalse(SkillProgress.objects.filter(user=self.child).exists())
        self.assertEqual(ChronicleEntry.objects.filter(kind="grade").count(), 1)
        replay = self.post()
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["reward_receipt"], first.json()["reward_receipt"])
        second = self.post({**self.payload, "client_entry_id": str(uuid4())})
        self.assertEqual(second.json()["reward_receipt"]["status"], "daily_limit")
        self.assertFalse(SkillProgress.objects.filter(user=self.child).exists())

    def test_locked_progress_does_not_claim_xp(self):
        SkillProgress.objects.create(user=self.child, skill=self.skill, unlocked=False)
        first = self.post()
        self.assertEqual(first.json()["reward_receipt"]["status"], "not_eligible")
        self.assertEqual(first.json()["reward_receipt"]["xp_awarded"], 0)
        self.assertEqual(first.json()["reward_receipt"]["skills"], [])

    def test_replay_keeps_one_grade_one_counter_and_one_reward(self):
        first = self.post()
        second = self.post()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["id"], first.json()["id"])
        self.assertEqual(second.json()["reward_receipt"], first.json()["reward_receipt"])
        self.assertEqual(ChronicleEntry.objects.filter(kind="grade").count(), 1)
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 1)
        self.assertEqual(SkillProgress.objects.get(user=self.child, skill=self.skill).xp_points, 10)

    def test_normalized_numeric_and_text_replay_is_identical(self):
        first = self.post({**self.payload, "subject": " Math ", "score": "82.500000"})
        replay = self.post({**self.payload, "score": 82.5})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(first.json()["id"], replay.json()["id"])

    def test_replay_after_midnight_preserves_default_date(self):
        first = self.post()
        tomorrow = timezone.localdate() + timedelta(days=1)
        with mock.patch("apps.chronicle.grade_services.timezone.localdate", return_value=tomorrow):
            replay = self.post()
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["id"], first.json()["id"])
        self.assertEqual(replay.json()["occurred_on"], first.json()["occurred_on"])
        self.assertEqual(GradeDailyCounter.objects.filter(user=self.child).count(), 1)

    def test_original_request_replays_after_corrections_and_sharing(self):
        first = self.post().json()
        corrected_day = timezone.localdate() - timedelta(days=70)
        changed = self.patch_entry(first["id"], {
            "subject": "Science", "score": "95", "reflection": "Correction", "is_private": False,
            "occurred_on": corrected_day.isoformat(),
        })
        self.assertEqual(changed.status_code, 200)
        replay = self.post()
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["id"], first["id"])
        self.assertEqual(replay.json()["metadata"]["grade"]["subject"], "Science")
        self.assertEqual(replay.json()["occurred_on"], corrected_day.isoformat())
        self.assertEqual(replay.json()["reward_receipt"], first["reward_receipt"])
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 1)

    def test_reusing_request_id_for_different_content_conflicts_without_overwrite(self):
        first = self.post().json()
        for change in ({"score": "99"}, {"reflection": "Different"}, {"is_private": False}):
            with self.subTest(change=change):
                response = self.post({**self.payload, **change})
                self.assertEqual(response.status_code, 409)
                self.assertNotIn("existing", response.json())
        row = ChronicleEntry.objects.get(pk=first["id"])
        self.assertEqual(row.metadata["grade"]["score"], "82.5")
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 1)

    def test_same_uuid_belongs_to_each_authenticated_child(self):
        first = self.post()
        self.client.force_authenticate(self.sibling)
        second = self.post()
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(second.json()["user"], self.sibling.pk)

    def test_uuid_cannot_cross_grade_and_journal_kinds(self):
        _make_language_arts_skills()
        first = self.post()
        journal = self.client.post("/api/chronicle/journal/", {
            "summary": "Another kind", "client_entry_id": self.payload["client_entry_id"],
        }, format="json")
        self.assertEqual(journal.status_code, 409)
        journal_id = str(uuid4())
        with mock.patch("apps.chronicle.services.GameLoopService.on_task_completed", return_value={}):
            journal = self.client.post("/api/chronicle/journal/", {
                "summary": "A new journal", "client_entry_id": journal_id,
            }, format="json")
        self.assertEqual(journal.status_code, 201)
        grade = self.post({**self.payload, "client_entry_id": journal_id})
        self.assertEqual(grade.status_code, 409)
        self.assertEqual(ChronicleEntry.objects.filter(kind="grade").count(), 1)
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 1)
        self.assertEqual(first.json()["reward_receipt"]["xp_awarded"], 10)

    def test_any_date_corrections_preserve_receipt_and_unspecified_fields(self):
        old_day = timezone.localdate() - timedelta(days=300)
        first = self.post({**self.payload, "occurred_on": old_day.isoformat()}).json()
        corrected = self.patch_entry(first["id"], {"score": "90"})
        self.assertEqual(corrected.status_code, 200)
        row = corrected.json()
        self.assertEqual(row["summary"], self.payload["reflection"])
        self.assertEqual(row["occurred_on"], old_day.isoformat())
        self.assertEqual(row["metadata"]["grade"]["assessment"], "Fractions quiz")
        self.assertEqual(row["metadata"]["grade"]["score"], "90")
        self.assertEqual(row["reward_receipt"], first["reward_receipt"])
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 1)

    def test_corrections_on_later_day_do_not_consume_that_day_eligibility(self):
        first = self.post().json()
        tomorrow = timezone.localdate() + timedelta(days=1)
        with mock.patch("apps.chronicle.grade_services.timezone.localdate", return_value=tomorrow):
            self.assertEqual(self.patch_entry(first["id"], {"score": "87"}).status_code, 200)
            second = self.post({**self.payload, "client_entry_id": str(uuid4())})
        self.assertEqual(second.json()["reward_receipt"]["xp_awarded"], 10)
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child, occurred_on=tomorrow).count, 1)

    def test_format_corrections_discard_old_value_fields(self):
        first = self.post({**self.payload, "grade_format": "points", "score": "8", "possible": "10"}).json()
        letter = self.patch_entry(first["id"], {"grade_format": "letter", "letter": "B"})
        self.assertEqual(letter.status_code, 200)
        self.assertEqual(letter.json()["metadata"]["grade"], {
            "subject": "Math", "assessment": "Fractions quiz", "grade_format": "letter", "letter": "B",
        })
        percentage = self.patch_entry(first["id"], {"grade_format": "percentage", "score": "84"})
        self.assertEqual(percentage.status_code, 200)
        self.assertNotIn("letter", percentage.json()["metadata"]["grade"])
        self.assertEqual(percentage.json()["metadata"]["grade"]["score"], "84")

    def test_format_correction_needs_complete_new_values(self):
        first = self.post().json()
        self.assertEqual(self.patch_entry(first["id"], {"grade_format": "points"}).status_code, 400)
        self.assertEqual(self.patch_entry(first["id"], {"grade_format": "letter"}).status_code, 400)
        self.assertEqual(self.patch_entry(first["id"], {"possible": "100"}).status_code, 400)
        self.assertEqual(self.patch_entry(first["id"], {"grade_format": "letter", "letter": "A", "score": "90"}).status_code, 400)
        self.assertEqual(ChronicleEntry.objects.get(pk=first["id"]).metadata["grade"]["grade_format"], "percentage")

    def test_owner_can_change_sharing_without_changing_result(self):
        first = self.post().json()
        response = self.patch_entry(first["id"], {"is_private": False})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["is_private"])
        self.assertEqual(response.json()["metadata"]["grade"], first["metadata"]["grade"])
        self.assertEqual(response.json()["reward_receipt"], first["reward_receipt"])

    def test_original_request_id_cannot_be_corrected(self):
        first = self.post().json()
        self.assertEqual(self.patch_entry(first["id"], {"client_entry_id": str(uuid4())}).status_code, 400)
        self.assertEqual(str(ChronicleEntry.objects.get(pk=first["id"]).client_entry_id), self.payload["client_entry_id"])

    def test_nonowner_children_cannot_correct_grade(self):
        first = self.post({**self.payload, "is_private": False}).json()
        for child in (self.sibling, self.outside_child):
            self.client.force_authenticate(child)
            self.assertEqual(self.patch_entry(first["id"], {"score": "99"}).status_code, 404)

    def test_general_parent_crud_cannot_change_or_delete_grade(self):
        first = self.post({**self.payload, "is_private": False}).json()
        self.client.force_authenticate(self.parent)
        self.assertEqual(self.client.patch(f"/api/chronicle/{first['id']}/", {"title": "Overwrite"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/chronicle/{first['id']}/").status_code, 403)
        self.assertTrue(ChronicleEntry.objects.filter(pk=first["id"]).exists())

    def test_private_grade_excluded_from_parent_list_summary_detail_and_mcp(self):
        first = self.post().json()
        self.client.force_authenticate(self.parent)
        for url in ("/api/chronicle/grades/", f"/api/chronicle/?user_id={self.child.pk}", f"/api/chronicle/summary/?user_id={self.child.pk}"):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("Fractions quiz", str(response.data))
            self.assertNotIn(self.payload["reflection"], str(response.data))
            self.assertNotIn("82.5", str(response.data))
        self.assertEqual(self.client.get(f"/api/chronicle/{first['id']}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/chronicle/{first['id']}/mark-viewed/").status_code, 404)
        with override_user(self.parent):
            listing = list_chronicle_entries(ListChronicleEntriesIn(user_id=self.child.pk, kind="grade"))
            summary = get_chronicle_summary(GetChronicleSummaryIn(user_id=self.child.pk))
            with self.assertRaises(MCPNotFoundError):
                mark_chronicle_viewed(MarkChronicleViewedIn(entry_id=first["id"]))
        self.assertEqual(listing["entries"], [])
        self.assertEqual(summary["chapters"], [])

    def test_shared_grade_visible_only_to_owner_and_family_parents(self):
        first = self.post({**self.payload, "is_private": False}).json()
        self.client.force_authenticate(self.parent)
        response = self.client.get(f"/api/chronicle/grades/?user_id={self.child.pk}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"][0]["id"], first["id"])
        with override_user(self.parent):
            result = list_chronicle_entries(ListChronicleEntriesIn(user_id=self.child.pk, kind="grade"))
        self.assertEqual(result["entries"][0]["id"], first["id"])
        for caller in (self.sibling, self.outside_child, self.outside_parent):
            self.client.force_authenticate(caller)
            self.assertEqual(self.client.get(f"/api/chronicle/{first['id']}/").status_code, 404)
            self.assertEqual(self.client.get(f"/api/chronicle/grades/?user_id={self.child.pk}").json()["results"], [])

    def test_owner_reads_private_grade_and_mcp(self):
        first = self.post().json()
        response = self.client.get("/api/chronicle/grades/")
        self.assertEqual(response.json()["results"][0]["id"], first["id"])
        self.assertEqual(self.client.get(f"/api/chronicle/{first['id']}/").status_code, 200)
        with override_user(self.child):
            result = list_chronicle_entries(ListChronicleEntriesIn(kind="grade"))
        self.assertEqual(result["entries"][0]["summary"], self.payload["reflection"])

    def test_shared_grade_comments_notify_correct_tab_and_replay_once(self):
        first = self.post({**self.payload, "is_private": False}).json()
        url = f"/api/chronicle/entries/{first['id']}/comments/"
        self.client.force_authenticate(self.parent)
        payload = {"body": "Let's try a new study approach", "client_comment_id": str(uuid4())}
        reply = self.client.post(url, payload, format="json")
        self.assertEqual(reply.status_code, 201)
        replay = self.client.post(url, payload, format="json")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["id"], reply.json()["id"])
        notifications = Notification.objects.filter(user=self.child, notification_type=NotificationType.JOURNAL_REPLY)
        self.assertEqual(notifications.count(), 1)
        notice = notifications.get()
        self.assertEqual(notice.link, "/chronicle?tab=grades")
        self.assertIn("grades", notice.message)
        self.assertNotIn("82.5", notice.message)
        self.assertNotIn("study approach", notice.message)
        self.client.force_authenticate(self.child)
        self.assertEqual(self.client.get(url).json()[0]["body"], payload["body"])
        self.client.post(url, {"body": "Thanks for helping"}, format="json")
        self.assertEqual(Notification.objects.get(user=self.parent, notification_type=NotificationType.JOURNAL_REPLY).link, "/chronicle?tab=grades")
        self.assertEqual(GradeDailyCounter.objects.get(user=self.child).count, 1)
        self.assertEqual(SkillProgress.objects.get(user=self.child, skill=self.skill).xp_points, 10)

    def test_unshared_grade_comments_are_blocked_and_preserved(self):
        first = self.post({**self.payload, "is_private": False}).json()
        ChronicleComment.objects.create(entry_id=first["id"], author=self.parent, body="Encouragement")
        self.patch_entry(first["id"], {"is_private": True})
        self.client.force_authenticate(self.parent)
        url = f"/api/chronicle/entries/{first['id']}/comments/"
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.post(url, {"body": "Hello"}, format="json").status_code, 404)
        self.assertEqual(ChronicleComment.objects.filter(entry_id=first["id"]).count(), 1)

    def test_unauthenticated_grade_endpoints_require_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/chronicle/grades/").status_code, 401)
        self.assertEqual(self.post().status_code, 401)

    def test_malformed_get_filters_return_validation_errors(self):
        self.client.force_authenticate(self.parent)
        for query in (
            "user_id=abc", "user_id=0", "user_id=-1", "user_id=1.5", "user_id=999999999999999999999",
            "chapter_year=abc", "chapter_year=0", "chapter_year=-1", "chapter_year=2026.5", "chapter_year=10000",
        ):
            with self.subTest(query=query):
                self.assertEqual(self.client.get(f"/api/chronicle/grades/?{query}").status_code, 400)
