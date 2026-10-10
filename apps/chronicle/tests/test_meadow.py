"""The world consumes confirmed rewards without copying private memories."""
from datetime import timedelta
from unittest import mock
from uuid import uuid4

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.achievements.models import SkillProgress
from apps.chronicle.models import ChronicleComment, ChronicleEntry
from apps.chronicle.tests.test_journal import _make_language_arts_skills
from apps.rewards.models import CoinLedger
from config.tests.factories import make_family


class MeadowProgressTests(TestCase):
    def setUp(self):
        family = make_family(
            parents=[{"username": "meadow-parent"}],
            children=[{"username": "meadow-child"}, {"username": "meadow-sibling"}],
        )
        self.parent = family.parents[0]
        self.child, self.sibling = family.children
        other = make_family("Other family", children=[{"username": "other-child"}])
        self.other_child = other.children[0]
        self.client = APIClient()
        self.client.force_authenticate(self.child)

    def entry(self, *, user=None, days_ago=0, kind="journal", receipt_status="awarded", xp=15):
        entry = ChronicleEntry.objects.create(
            user=user or self.child, kind=kind,
            occurred_on=timezone.localdate() - timedelta(days=days_ago),
            chapter_year=2026, title="Private journal title", summary="Private journal body",
            is_private=True,
        )
        entry.metadata = {"reward_receipt": {
            "receipt_id": f"{kind}:{entry.pk}", "status": receipt_status, "xp_awarded": xp,
            "skills": [{"name": "Private skill metadata", "xp": xp}],
            "awarded_at": timezone.now().isoformat(),
        }, "private_metadata": "Private extra metadata"}
        entry.save(update_fields=["metadata"])
        return entry

    def get(self, query=""):
        response = self.client.get(f"/api/chronicle/meadow/{query}")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_empty_world_has_no_invented_rewards(self):
        self.assertEqual(self.get(), {
            "schema_version": 1, "keepsake_count": 0, "journal_xp_awarded": 0, "keepsakes": [],
        })

    def test_only_safe_projection_of_own_private_journal_is_returned(self):
        entry = self.entry()
        ChronicleComment.objects.create(entry=entry, author=self.parent, body="Private family reply")
        data = self.get()
        self.assertEqual(set(data), {"schema_version", "keepsake_count", "journal_xp_awarded", "keepsakes"})
        self.assertEqual(data["keepsake_count"], 1)
        self.assertEqual(data["journal_xp_awarded"], 15)
        self.assertEqual(data["keepsakes"], [{
            "receipt_id": f"journal:{entry.pk}", "type": "memory_bloom",
            "title": "Memory bloom", "earned_at": entry.created_at.isoformat(),
        }])
        self.assertNotIn("Private", str(data))

    def test_child_cannot_choose_sibling_or_other_family_with_filters(self):
        own = self.entry()
        self.entry(user=self.sibling)
        foreign = self.entry(user=self.other_child)
        for user in (self.sibling, self.other_child):
            data = self.get(f"?user_id={user.pk}&chapter_year=1900")
            self.assertEqual(data["keepsake_count"], 1)
            self.assertEqual(data["keepsakes"][0]["receipt_id"], f"journal:{own.pk}")
            self.assertNotIn(f"journal:{foreign.pk}", str(data))
        self.client.force_authenticate(self.sibling)
        self.assertEqual(self.get()["keepsake_count"], 1)
        self.client.force_authenticate(self.other_child)
        self.assertEqual(self.get()["keepsakes"][0]["receipt_id"], f"journal:{foreign.pk}")

    def test_parent_cannot_read_child_meadow_even_after_sharing(self):
        entry = self.entry()
        entry.is_private = False
        entry.save(update_fields=["is_private"])
        self.client.force_authenticate(self.parent)
        response = self.client.get(f"/api/chronicle/meadow/?user_id={self.child.pk}")
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("keepsakes", response.json())

    def test_authentication_is_required(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/chronicle/meadow/").status_code, 401)

    def test_world_endpoint_does_not_accept_reward_claims(self):
        self.assertEqual(self.client.post("/api/chronicle/meadow/", {}, format="json").status_code, 405)

    def test_legacy_failed_zero_and_unconfirmed_receipts_do_not_create_keepsakes(self):
        values = [("unavailable", 15), ("not_eligible", 15), ("daily_limit", 15),
                  ("awarded", 0), ("awarded", -1), ("awarded", True), ("awarded", "15")]
        for day, (receipt_status, xp) in enumerate(values):
            self.entry(days_ago=day, receipt_status=receipt_status, xp=xp)
        legacy = self.entry(days_ago=len(values))
        legacy.metadata = {}
        legacy.save(update_fields=["metadata"])
        malformed = self.entry(days_ago=len(values) + 1)
        malformed.metadata["reward_receipt"] = "Private malformed receipt"
        malformed.save(update_fields=["metadata"])
        mismatched = self.entry(days_ago=len(values) + 2)
        mismatched.metadata["reward_receipt"]["receipt_id"] = "Private arbitrary receipt identity"
        mismatched.save(update_fields=["metadata"])
        self.assertEqual(self.get()["keepsake_count"], 0)
        self.assertEqual(self.get()["journal_xp_awarded"], 0)

    def test_non_journal_rewards_are_excluded_from_first_slice(self):
        self.entry(kind="grade")
        self.entry(kind="manual")
        self.assertEqual(self.get()["keepsakes"], [])

    def test_count_covers_all_history_while_recent_collection_is_bounded(self):
        entries = [self.entry(days_ago=day) for day in range(32)]
        data = self.get()
        self.assertEqual(data["keepsake_count"], 32)
        self.assertEqual(data["journal_xp_awarded"], 480)
        self.assertEqual(len(data["keepsakes"]), 30)
        self.assertEqual(
            [item["receipt_id"] for item in data["keepsakes"]],
            [f"journal:{entry.pk}" for entry in reversed(entries[2:])],
        )

    def test_shared_creation_time_uses_stable_id_tiebreaker(self):
        first = self.entry(days_ago=1)
        second = self.entry()
        ChronicleEntry.objects.filter(pk__in=[first.pk, second.pk]).update(created_at=first.created_at)
        self.assertEqual(
            [item["receipt_id"] for item in self.get()["keepsakes"]],
            [f"journal:{second.pk}", f"journal:{first.pk}"],
        )

    def test_edits_sharing_comments_and_reads_preserve_keepsake_and_economy(self):
        entry = self.entry()
        before = self.get()
        with mock.patch("apps.achievements.services.AwardService.grant") as award:
            edited = self.client.patch(
                f"/api/chronicle/{entry.pk}/journal/",
                {"summary": "Changed private thought", "is_private": False}, format="json",
            )
            self.assertEqual(edited.status_code, 200)
            comment = self.client.post(
                f"/api/chronicle/entries/{entry.pk}/comments/",
                {"body": "A family reply"}, format="json",
            )
            self.assertEqual(comment.status_code, 201)
            self.assertEqual(self.get(), before)
            self.assertEqual(self.get(), before)
            award.assert_not_called()
        entry.refresh_from_db()
        self.assertEqual(entry.metadata["reward_receipt"]["xp_awarded"], 15)
        self.assertEqual(ChronicleEntry.objects.count(), 1)
        self.assertFalse(SkillProgress.objects.exists())
        self.assertFalse(CoinLedger.objects.exists())

    def test_actual_confirmed_save_retry_and_daily_cap_yield_one_keepsake(self):
        _make_language_arts_skills()
        payload = {"client_entry_id": str(uuid4()), "summary": "A little thought."}
        with mock.patch("apps.chronicle.services.GameLoopService.on_task_completed", return_value={}) as loop:
            first = self.client.post("/api/chronicle/journal/", payload, format="json")
            self.assertEqual(first.status_code, 201)
            before = self.get()
            replay = self.client.post("/api/chronicle/journal/", payload, format="json")
            self.assertEqual(replay.status_code, 200)
            second = self.client.post(
                "/api/chronicle/journal/",
                {"client_entry_id": str(uuid4()), "summary": "Another thought."}, format="json",
            )
            self.assertEqual(second.status_code, 409)
            self.assertEqual(self.get(), before)
            loop.assert_called_once()
        self.assertEqual(before["keepsake_count"], 1)
        self.assertEqual(before["keepsakes"][0]["receipt_id"], first.json()["reward_receipt"]["receipt_id"])
        self.assertEqual(before["journal_xp_awarded"], 15)
        self.assertEqual(sum(SkillProgress.objects.values_list("xp_points", flat=True)), 15)
