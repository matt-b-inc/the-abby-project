from datetime import timedelta
from unittest import mock
from uuid import uuid4

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.achievements.models import SkillProgress
from apps.chronicle.models import ChronicleEntry
from apps.chronicle.tests.test_journal import _make_language_arts_skills
from apps.rewards.models import CoinLedger
from config.tests.factories import make_family


class JournalReceiptTests(TestCase):
    def setUp(self):
        family = make_family(children=[{"username": "journal-child"}, {"username": "sibling"}])
        self.child, self.sibling = family.children
        _, self.writing, self.vocabulary = _make_language_arts_skills()
        self.client = APIClient()
        self.client.force_authenticate(self.child)
        self.payload = {
            "client_entry_id": str(uuid4()),
            "title": "A hard day", "summary": "I want to remember this too.",
        }
        patcher = mock.patch("apps.chronicle.services.GameLoopService.on_task_completed", return_value={})
        self.loop = patcher.start()
        self.addCleanup(patcher.stop)

    def post(self, payload=None):
        return self.client.post("/api/chronicle/journal/", payload or self.payload, format="json")

    def test_confirmed_xp_receipt_survives_repeated_save_and_edit(self):
        first = self.post()
        self.assertEqual(first.status_code, 201)
        receipt = first.json()["reward_receipt"]
        self.assertEqual(receipt["status"], "awarded")
        self.assertEqual(receipt["xp_awarded"], 15)
        self.assertEqual(sorted(s["xp"] for s in receipt["skills"]), [5, 10])
        second = self.post()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["id"], first.json()["id"])
        self.assertEqual(second.json()["reward_receipt"], receipt)
        self.assertEqual(ChronicleEntry.objects.filter(kind="journal").count(), 1)
        self.loop.assert_called_once()
        edited = self.client.patch(
            f"/api/chronicle/{first.json()['id']}/journal/",
            {"summary": "A little more to remember."}, format="json",
        )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()["reward_receipt"], receipt)
        # Reconciliation returns the current memory without repeating awards.
        replay = self.post()
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["summary"], "A little more to remember.")
        self.assertEqual(sum(SkillProgress.objects.filter(user=self.child).values_list("xp_points", flat=True)), 15)

    def test_reused_id_with_different_submission_cannot_overwrite_or_award(self):
        first = self.post()
        conflict = self.post({**self.payload, "summary": "Different text"})
        self.assertEqual(conflict.status_code, 409)
        entry = ChronicleEntry.objects.get(pk=first.json()["id"])
        self.assertEqual(entry.summary, self.payload["summary"])
        self.loop.assert_called_once()

    def test_replay_after_midnight_finds_original_entry(self):
        first = self.post()
        tomorrow = timezone.localdate() + timedelta(days=1)
        with mock.patch("apps.chronicle.services.timezone.localdate", return_value=tomorrow):
            replay = self.post()
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["id"], first.json()["id"])
        self.assertEqual(ChronicleEntry.objects.filter(kind="journal").count(), 1)

    def test_client_id_is_scoped_to_authenticated_user(self):
        self.post()
        self.client.force_authenticate(self.sibling)
        sibling = self.post()
        self.assertEqual(sibling.status_code, 201)
        self.assertEqual(sibling.json()["user"], self.sibling.pk)
        self.assertEqual(ChronicleEntry.objects.filter(kind="journal").count(), 2)

    def test_invalid_id_and_blank_content_do_not_save(self):
        response = self.post({**self.payload, "client_entry_id": "bad-uuid"})
        self.assertEqual(response.status_code, 400)
        response = self.post({**self.payload, "title": " ", "summary": "\n "})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ChronicleEntry.objects.filter(kind="journal").exists())
        self.loop.assert_not_called()

    def test_receipt_reflects_boosted_xp(self):
        with mock.patch("apps.rpg.services.xp_boost_multiplier", return_value=2):
            response = self.post()
        self.assertEqual(response.json()["reward_receipt"]["xp_awarded"], 30)
        self.assertEqual(sum(SkillProgress.objects.filter(user=self.child).values_list("xp_points", flat=True)), 30)

    def test_locked_skills_are_not_claimed_as_awarded(self):
        for skill in (self.writing, self.vocabulary):
            SkillProgress.objects.create(user=self.child, skill=skill, unlocked=False)
        response = self.post()
        self.assertEqual(response.status_code, 201)
        receipt = response.json()["reward_receipt"]
        self.assertEqual(receipt["status"], "not_eligible")
        self.assertEqual(receipt["xp_awarded"], 0)
        self.assertEqual(receipt["skills"], [])

    def test_award_failure_rolls_back_rewards_but_preserves_memory(self):
        def failed_award(user, **kwargs):
            SkillProgress.objects.create(user=user, skill=self.writing, xp_points=10)
            raise RuntimeError("simulated interrupted award")

        with mock.patch("apps.achievements.services.AwardService.grant", side_effect=failed_award):
            with self.assertLogs("apps.chronicle.services", level="ERROR"):
                first = self.post()
        self.assertEqual(first.status_code, 201)
        self.assertFalse(SkillProgress.objects.filter(user=self.child).exists())
        self.assertEqual(first.json()["reward_receipt"]["status"], "unavailable")
        self.assertEqual(first.json()["reward_receipt"]["xp_awarded"], 0)
        replay = self.post()
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["reward_receipt"], first.json()["reward_receipt"])

    def test_game_loop_failure_preserves_memory_and_verified_xp(self):
        def failed_loop(user, *args):
            CoinLedger.objects.create(user=user, amount=3, reason="adjustment")
            raise RuntimeError("simulated game-loop failure")

        self.loop.side_effect = failed_loop
        with self.assertLogs("apps.chronicle.services", level="ERROR"):
            response = self.post()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["reward_receipt"]["xp_awarded"], 15)
        self.assertFalse(CoinLedger.objects.filter(user=self.child).exists())

    def test_unseeded_catalog_preserves_memory_without_inventing_xp(self):
        self.writing.delete()
        self.vocabulary.delete()
        response = self.post()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["reward_receipt"]["status"], "unavailable")
        self.assertEqual(response.json()["reward_receipt"]["xp_awarded"], 0)

    def test_legacy_entry_has_no_invented_receipt(self):
        entry = ChronicleEntry.objects.create(
            user=self.child, kind="journal", occurred_on=timezone.localdate(),
            chapter_year=2026, title="An old memory", is_private=True,
        )
        response = self.client.get(f"/api/chronicle/{entry.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reward_receipt"]["xp_awarded"], 0)
