"""Independent PostgreSQL transactions validate grade retries and daily recognition."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event, local
from time import monotonic, sleep
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import TransactionTestCase
from django.utils import timezone

from apps.achievements.models import Skill, SkillCategory, SkillProgress
from apps.chronicle.grade_services import GradeService
from apps.chronicle.models import ChronicleEntry, GradeDailyCounter


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
class GradeConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="grade-concurrency", role="child")
        category = SkillCategory.objects.create(name="Life Skills")
        self.skill = Skill.objects.create(name="Time Management", category=category)
        self.payload = {
            "subject": "Math", "assessment": "Fractions quiz", "grade_format": "percentage",
            "score": "82.5", "client_entry_id": str(uuid4()),
        }

    def _capture(self, payload, *, ready=None):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
                cursor.execute("SET statement_timeout = '10s'")
                cursor.execute("SELECT pg_backend_pid()")
                pid = cursor.fetchone()[0]
            if ready is not None:
                ready.append(pid)
            entry = GradeService.write_grade(self.user, payload)
            return {
                "id": entry.pk, "replayed": getattr(entry, "_grade_replayed", False),
                "receipt": entry.metadata["reward_receipt"],
            }
        finally:
            connection.close()

    def _overlapping_captures(self, second_payload):
        """Start the competitor while the first transaction has not saved its entry."""
        first_ready = Event()
        release_first = Event()
        worker_state = local()
        second_pid = []
        original_save = ChronicleEntry.save

        def hold_first_entry(entry, *args, **kwargs):
            if getattr(worker_state, "hold_save", False) and entry._state.adding:
                worker_state.hold_save = False
                first_ready.set()
                if not release_first.wait(10):
                    raise TimeoutError("First grade capture was not released")
            return original_save(entry, *args, **kwargs)

        def first_capture():
            worker_state.hold_save = True
            return self._capture(self.payload)

        with patch.object(ChronicleEntry, "save", hold_first_entry), ThreadPoolExecutor(max_workers=2) as pool:
            first_future = pool.submit(first_capture)
            try:
                self.assertTrue(first_ready.wait(5), "First capture did not reach its pending entry save")
                second_future = pool.submit(self._capture, second_payload, ready=second_pid)
                deadline = monotonic() + 4
                competing_transaction_waited = False
                while monotonic() < deadline:
                    if second_future.done():
                        second_future.result()
                        break
                    if second_pid:
                        with connection.cursor() as cursor:
                            cursor.execute(
                                "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s", [second_pid[0]],
                            )
                            row = cursor.fetchone()
                        if row and row[0] == "Lock":
                            competing_transaction_waited = True
                            break
                    sleep(0.01)
                self.assertTrue(
                    competing_transaction_waited,
                    "Competing capture did not wait for the uncommitted first capture",
                )
            finally:
                release_first.set()
            return first_future.result(timeout=15), second_future.result(timeout=15)

    def test_concurrent_exact_uuid_retry_preserves_one_entry_and_original_receipt(self):
        original, retry = self._overlapping_captures(dict(self.payload))
        self.assertFalse(original["replayed"])
        self.assertTrue(retry["replayed"])
        self.assertEqual(original["id"], retry["id"])
        self.assertEqual(original["receipt"], retry["receipt"])
        self.assertEqual(original["receipt"]["status"], "awarded")
        self.assertEqual(original["receipt"]["xp_awarded"], 10)
        self.assertEqual(ChronicleEntry.objects.filter(user=self.user, kind="grade").count(), 1)
        self.assertEqual(GradeDailyCounter.objects.get(user=self.user, occurred_on=timezone.localdate()).count, 1)
        self.assertEqual(SkillProgress.objects.get(user=self.user, skill=self.skill).xp_points, 10)

    def test_concurrent_distinct_uuid_captures_share_one_daily_recognition_allowance(self):
        second_payload = {**self.payload, "assessment": "Another quiz", "client_entry_id": str(uuid4())}
        first, second = self._overlapping_captures(second_payload)
        self.assertNotEqual(first["id"], second["id"])
        self.assertFalse(first["replayed"])
        self.assertFalse(second["replayed"])
        self.assertEqual(first["receipt"]["status"], "awarded")
        self.assertEqual(first["receipt"]["xp_awarded"], 10)
        self.assertEqual(second["receipt"]["status"], "daily_limit")
        self.assertEqual(second["receipt"]["xp_awarded"], 0)
        self.assertEqual(ChronicleEntry.objects.filter(user=self.user, kind="grade").count(), 2)
        self.assertEqual(GradeDailyCounter.objects.get(user=self.user, occurred_on=timezone.localdate()).count, 2)
        self.assertEqual(SkillProgress.objects.get(user=self.user, skill=self.skill).xp_points, 10)
