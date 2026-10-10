"""Real row-lock regressions; SQLite cannot validate these interleavings."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, local
from time import monotonic, sleep
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, transaction
from django.test import TransactionTestCase

from apps.achievements.models import Badge, Skill, SkillCategory, SkillPrerequisite, SkillProgress, UserBadge
from apps.achievements.services import AwardService, BadgeService, SkillService


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
class XpConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="xp-concurrency", role="child")
        category = SkillCategory.objects.create(name="Concurrent awards")
        self.skill = Skill.objects.create(name="Practice", category=category)
        self.other = Skill.objects.create(name="Persistence", category=category)
        self.locked = Skill.objects.create(name="Advanced", category=category, is_locked_by_default=True)
        SkillPrerequisite.objects.create(skill=self.locked, required_skill=self.skill, required_level=2)
        self.badge = Badge.objects.create(
            name="Practice bonus", criteria_type="skill_level_reached", criteria_value={"level": 1},
            xp_bonus=70, award_coins=False,
        )

    @staticmethod
    def _worker(action, *, ready=None):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
                cursor.execute("SET statement_timeout = '10s'")
                cursor.execute("SELECT pg_backend_pid()")
                pid = cursor.fetchone()[0]
            if ready is not None:
                ready.append(pid)
            return action()
        finally:
            connection.close()

    def _overlap_before_first_progress_save(self, first, second):
        """Hold a stale snapshot window open until the competitor blocks or finishes.

        With the old code, the second award saves while the first still holds
        its Python snapshot, so releasing the first overwrites that award.
        With serialization, PostgreSQL reports the second waiting for a lock.
        """
        first_read = Event()
        release_first = Event()
        worker_state = local()
        second_pid = []
        original_save = SkillProgress.save

        def hold_save(progress, *args, **kwargs):
            if getattr(worker_state, "hold_save", False):
                worker_state.hold_save = False
                first_read.set()
                if not release_first.wait(10):
                    raise TimeoutError("First award was not released")
            return original_save(progress, *args, **kwargs)

        def held_first():
            worker_state.hold_save = True
            return first()

        with patch.object(SkillProgress, "save", hold_save), ThreadPoolExecutor(max_workers=2) as pool:
            first_future = pool.submit(self._worker, held_first)
            try:
                self.assertTrue(first_read.wait(5), "First award did not reach its progress save")
                second_future = pool.submit(self._worker, second, ready=second_pid)
                deadline = monotonic() + 5
                overlapped = False
                while monotonic() < deadline:
                    if second_future.done():
                        second_future.result()
                        overlapped = True
                        break
                    if second_pid:
                        with connection.cursor() as cursor:
                            cursor.execute(
                                "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s",
                                [second_pid[0]],
                            )
                            row = cursor.fetchone()
                        if row and row[0] == "Lock":
                            overlapped = True
                            break
                    sleep(0.01)
                self.assertTrue(overlapped, "Competing award neither completed nor reached a lock")
            finally:
                release_first.set()
            return first_future.result(timeout=15), second_future.result(timeout=15)

    def test_direct_award_and_badge_bonus_preserve_both_increments(self):
        for badge_first in (False, True):
            with self.subTest(badge_first=badge_first):
                SkillProgress.objects.filter(user=self.user).delete()
                SkillProgress.objects.create(user=self.user, skill=self.skill, xp_points=200, level=1)
                def direct():
                    return SkillService.award_xp(self.user, self.skill, 60)

                def bonus():
                    return BadgeService._award_badge_xp(self.user, self.badge)
                self._overlap_before_first_progress_save(
                    bonus if badge_first else direct, direct if badge_first else bonus,
                )
                progress = SkillProgress.objects.get(user=self.user, skill=self.skill)
                self.assertEqual((progress.xp_points, progress.level), (330, 2))
                self.assertTrue(SkillProgress.objects.get(user=self.user, skill=self.locked).unlocked)

    def test_first_awards_and_existing_awards_allow_foreign_key_key_share_locks(self):
        # Activity inserts may already hold KEY SHARE on the user before XP
        # runs. Two such callers must not upgrade to incompatible FOR UPDATE.
        for initial in (None, 200):
            with self.subTest(initial=initial):
                SkillProgress.objects.filter(user=self.user).delete()
                if initial is not None:
                    SkillProgress.objects.create(user=self.user, skill=self.skill, xp_points=initial, level=1)
                start = Barrier(2)

                def award(amount):
                    with transaction.atomic(), connection.cursor() as cursor:
                        cursor.execute(
                            f'SELECT id FROM "{get_user_model()._meta.db_table}" WHERE id = %s FOR KEY SHARE',
                            [self.user.pk],
                        )
                        start.wait(timeout=5)
                        SkillService.award_xp(self.user, self.skill, amount)

                with ThreadPoolExecutor(max_workers=2) as pool:
                    futures = [pool.submit(self._worker, lambda amount=amount: award(amount)) for amount in (60, 70)]
                    for future in futures:
                        future.result(timeout=15)
                progress = SkillProgress.objects.get(user=self.user, skill=self.skill)
                expected = (initial or 0) + 130
                self.assertEqual((progress.xp_points, progress.level), (expected, SkillService.level_for_xp(expected)))
                self.assertEqual(SkillProgress.objects.filter(user=self.user, skill=self.skill).count(), 1)

    def test_receipt_user_then_progress_locks_and_reverse_tag_order_do_not_deadlock(self):
        SkillProgress.objects.create(user=self.user, skill=self.skill, xp_points=200, level=1)
        SkillProgress.objects.create(user=self.user, skill=self.other, xp_points=200, level=1)
        tags = [SimpleNamespace(skill=skill, xp_weight=1) for skill in (self.skill, self.other)]

        def receipt_award():
            with transaction.atomic():
                get_user_model().objects.select_for_update().get(pk=self.user.pk)
                before = dict(
                    SkillProgress.objects.select_for_update().filter(user=self.user)
                    .values_list("skill_id", "xp_points")
                )
                AwardService.grant(self.user, xp_tags=tags, xp=120, badge_scopes={"unused-test-scope"})
                return {
                    progress.skill_id: progress.xp_points - before.get(progress.skill_id, 0)
                    for progress in SkillProgress.objects.filter(user=self.user)
                    if progress.xp_points > before.get(progress.skill_id, 0)
                }

        receipt, _ = self._overlap_before_first_progress_save(
            receipt_award,
            lambda: SkillService.distribute_tagged_xp(self.user, reversed(tags), 140),
        )
        self.assertEqual(receipt, {self.skill.pk: 60, self.other.pk: 60})
        for skill in (self.skill, self.other):
            progress = SkillProgress.objects.get(user=self.user, skill=skill)
            self.assertEqual((progress.xp_points, progress.level), (330, 2))
        self.assertTrue(SkillProgress.objects.get(user=self.user, skill=self.locked).unlocked)

    def test_concurrent_badge_evaluations_pay_once(self):
        SkillProgress.objects.create(user=self.user, skill=self.skill, xp_points=200, level=1)
        results = self._overlap_before_first_progress_save(
            lambda: BadgeService.evaluate_badges(self.user),
            lambda: BadgeService.evaluate_badges(self.user),
        )
        self.assertEqual(sum(len(result) for result in results), 1)
        self.assertEqual(UserBadge.objects.filter(user=self.user, badge=self.badge).count(), 1)
        progress = SkillProgress.objects.get(user=self.user, skill=self.skill)
        self.assertEqual((progress.xp_points, progress.level), (270, 1))
