"""XP, unlocks, and badge rewards must commit or roll back together."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase, override_settings

from apps.achievements.models import (
    Badge,
    Skill,
    SkillCategory,
    SkillPrerequisite,
    SkillProgress,
    UserBadge,
)
from apps.achievements.services import BadgeService, SkillService
from apps.activity.models import ActivityEvent
from apps.projects.models import User
from apps.rewards.models import CoinLedger
from apps.rewards.services import CoinService


CACHE_OVERRIDE = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
}


@override_settings(CACHES=CACHE_OVERRIDE, CELERY_TASK_ALWAYS_EAGER=True)
class _XpTransactionFixture(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="xp-child", password="pw", role="child",
        )
        self.category = SkillCategory.objects.create(name="XP transactions")
        self.skill_a = Skill.objects.create(
            name="First skill", category=self.category,
        )
        self.skill_b = Skill.objects.create(
            name="Second skill", category=self.category,
        )

    def _progress(self, skill, xp, level, *, unlocked=True):
        return SkillProgress.objects.create(
            user=self.user, skill=skill, xp_points=xp,
            level=level, unlocked=unlocked,
        )

    def _dependent_skill(self, required_level):
        skill = Skill.objects.create(
            name="Dependent skill", category=self.category,
            is_locked_by_default=True,
        )
        SkillPrerequisite.objects.create(
            skill=skill, required_skill=self.skill_a,
            required_level=required_level,
        )
        return skill

    def _badge(self, xp_bonus, *, award_coins=False):
        return Badge.objects.create(
            name="XP transaction badge", description="Reach level one",
            criteria_type=Badge.CriteriaType.SKILL_LEVEL_REACHED,
            criteria_value={"level": 1}, xp_bonus=xp_bonus,
            award_coins=award_coins,
        )


class XpAwardTransactionTests(_XpTransactionFixture):
    def test_unlock_failure_rolls_back_existing_xp_and_new_unlock_row(self):
        progress = self._progress(self.skill_a, 90, 0)
        dependent = self._dependent_skill(required_level=1)
        evaluate_unlocks = SkillService.evaluate_unlocks

        def fail_after_unlock(user):
            self.assertIn(dependent, evaluate_unlocks(user))
            raise RuntimeError("unlock processing failed")

        with patch.object(
            SkillService, "evaluate_unlocks", side_effect=fail_after_unlock,
        ):
            with self.assertRaisesRegex(RuntimeError, "unlock processing failed"):
                SkillService.award_xp(self.user, self.skill_a, 10)

        progress.refresh_from_db()
        self.assertEqual((progress.xp_points, progress.level), (90, 0))
        self.assertFalse(
            SkillProgress.objects.filter(user=self.user, skill=dependent).exists(),
        )

        SkillService.award_xp(self.user, self.skill_a, 10)
        progress.refresh_from_db()
        self.assertEqual((progress.xp_points, progress.level), (100, 1))
        self.assertTrue(
            SkillProgress.objects.get(user=self.user, skill=dependent).unlocked,
        )

    def test_unlock_failure_rolls_back_first_progress_creation(self):
        dependent = self._dependent_skill(required_level=1)
        evaluate_unlocks = SkillService.evaluate_unlocks

        def fail_after_unlock(user):
            self.assertIn(dependent, evaluate_unlocks(user))
            raise RuntimeError("first award failed")

        with patch.object(
            SkillService, "evaluate_unlocks", side_effect=fail_after_unlock,
        ):
            with self.assertRaisesRegex(RuntimeError, "first award failed"):
                SkillService.award_xp(self.user, self.skill_a, 100)

        self.assertFalse(SkillProgress.objects.filter(user=self.user).exists())

    def test_distribution_failure_rolls_back_all_skills_and_unlocks(self):
        progress = self._progress(self.skill_a, 90, 0)
        dependent = self._dependent_skill(required_level=1)
        tags = [
            SimpleNamespace(skill=self.skill_a, xp_weight=1),
            SimpleNamespace(skill=self.skill_b, xp_weight=1),
        ]
        award_xp = SkillService.award_xp

        def fail_after_second_award(user, skill, amount):
            result = award_xp(user, skill, amount)
            if skill == self.skill_b:
                # Both awards have written before this failure is raised.
                self.assertEqual(result.xp_points, 20)
                self.assertTrue(
                    SkillProgress.objects.get(user=user, skill=dependent).unlocked,
                )
                raise RuntimeError("second skill award failed")
            return result

        with patch.object(
            SkillService, "award_xp", side_effect=fail_after_second_award,
        ):
            with self.assertRaisesRegex(RuntimeError, "second skill award failed"):
                SkillService.distribute_tagged_xp(self.user, tags, 40)

        progress.refresh_from_db()
        self.assertEqual((progress.xp_points, progress.level), (90, 0))
        self.assertFalse(
            SkillProgress.objects.filter(
                user=self.user, skill__in=[self.skill_b, dependent],
            ).exists(),
        )

        awarded = SkillService.distribute_tagged_xp(self.user, tags, 40)
        self.assertEqual(awarded, [(self.skill_a, 20), (self.skill_b, 20)])
        progress.refresh_from_db()
        self.assertEqual((progress.xp_points, progress.level), (110, 1))
        second = SkillProgress.objects.get(user=self.user, skill=self.skill_b)
        self.assertEqual((second.xp_points, second.level), (20, 0))
        self.assertTrue(
            SkillProgress.objects.get(user=self.user, skill=dependent).unlocked,
        )

    def test_unlocking_stale_progress_preserves_xp_and_level(self):
        self._progress(self.skill_a, 300, 2)
        dependent = self._dependent_skill(required_level=2)
        progress = self._progress(dependent, 0, 0, unlocked=False)
        save = SkillProgress.save

        def update_xp_before_unlock_save(instance, *args, **kwargs):
            if instance.pk == progress.pk and instance.unlocked:
                # Simulate another writer after the unlock evaluator's read.
                SkillProgress.objects.filter(pk=instance.pk).update(
                    xp_points=125, level=1,
                )
            return save(instance, *args, **kwargs)

        with patch.object(SkillProgress, "save", new=update_xp_before_unlock_save):
            self.assertEqual(SkillService.evaluate_unlocks(self.user), [dependent])

        progress.refresh_from_db()
        self.assertTrue(progress.unlocked)
        self.assertEqual((progress.xp_points, progress.level), (125, 1))


class BadgeXpTransactionTests(_XpTransactionFixture):
    def test_bonus_divides_only_across_unlocked_positive_level_skills(self):
        first = self._progress(self.skill_a, 100, 1)
        second = self._progress(self.skill_b, 310, 2)
        third_skill = Skill.objects.create(name="Third skill", category=self.category)
        third = self._progress(third_skill, 600, 3)
        beginner_skill = Skill.objects.create(name="Beginner skill", category=self.category)
        beginner = self._progress(beginner_skill, 99, 0)
        locked_skill = Skill.objects.create(
            name="Locked skill", category=self.category, is_locked_by_default=True,
        )
        locked = self._progress(locked_skill, 600, 3, unlocked=False)

        BadgeService._award_badge_xp(self.user, self._badge(11))

        for progress, expected_xp, expected_level in [
            (first, 103, 1), (second, 313, 2), (third, 603, 3),
            (beginner, 99, 0), (locked, 600, 3),
        ]:
            with self.subTest(skill=progress.skill.name):
                progress.refresh_from_db()
                self.assertEqual(
                    (progress.xp_points, progress.level),
                    (expected_xp, expected_level),
                )
        self.assertFalse(locked.unlocked)

    def test_bonus_preserves_minimum_one_xp_per_eligible_skill(self):
        first = self._progress(self.skill_a, 299, 1)
        second = self._progress(self.skill_b, 599, 2)

        BadgeService._award_badge_xp(self.user, self._badge(1))

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.xp_points, first.level), (300, 2))
        self.assertEqual((second.xp_points, second.level), (600, 3))

    def test_bonus_with_no_eligible_skills_does_not_create_progress(self):
        beginner = self._progress(self.skill_a, 99, 0)
        locked = self._progress(self.skill_b, 300, 2, unlocked=False)

        BadgeService._award_badge_xp(self.user, self._badge(200))

        beginner.refresh_from_db()
        locked.refresh_from_db()
        self.assertEqual((beginner.xp_points, beginner.level), (99, 0))
        self.assertEqual((locked.xp_points, locked.level), (300, 2))
        self.assertEqual(SkillProgress.objects.filter(user=self.user).count(), 2)

    def test_bonus_crosses_multiple_thresholds_and_unlocks_prerequisite(self):
        progress = self._progress(self.skill_a, 1490, 4)
        dependent = self._dependent_skill(required_level=6)

        BadgeService._award_badge_xp(self.user, self._badge(1100))

        progress.refresh_from_db()
        self.assertEqual((progress.xp_points, progress.level), (2590, 6))
        unlocked = SkillProgress.objects.get(user=self.user, skill=dependent)
        self.assertTrue(unlocked.unlocked)
        self.assertEqual((unlocked.xp_points, unlocked.level), (0, 0))

    @override_settings(COINS_PER_BADGE_RARITY={Badge.Rarity.COMMON: 7})
    def test_badge_reward_failure_rolls_back_and_retry_awards_once(self):
        progress = self._progress(self.skill_a, 290, 1)
        dependent = self._dependent_skill(required_level=2)
        badge = self._badge(20, award_coins=True)
        award_coins = CoinService.award_coins

        def fail_after_coin_write(*args, **kwargs):
            award_coins(*args, **kwargs)
            self.assertTrue(
                UserBadge.objects.filter(user=self.user, badge=badge).exists(),
            )
            current = SkillProgress.objects.get(pk=progress.pk)
            self.assertEqual((current.xp_points, current.level), (310, 2))
            self.assertTrue(
                SkillProgress.objects.get(user=self.user, skill=dependent).unlocked,
            )
            self.assertEqual(CoinLedger.objects.filter(user=self.user).count(), 1)
            raise RuntimeError("badge payout failed")

        with patch.object(CoinService, "award_coins", side_effect=fail_after_coin_write):
            with self.assertRaisesRegex(RuntimeError, "badge payout failed"):
                BadgeService.evaluate_badges(self.user)

        progress.refresh_from_db()
        self.assertEqual((progress.xp_points, progress.level), (290, 1))
        self.assertFalse(UserBadge.objects.filter(user=self.user, badge=badge).exists())
        self.assertFalse(
            SkillProgress.objects.filter(user=self.user, skill=dependent).exists(),
        )
        self.assertFalse(CoinLedger.objects.filter(user=self.user).exists())
        self.assertFalse(
            ActivityEvent.objects.filter(subject=self.user, event_type="award.badge").exists(),
        )

        self.assertEqual(BadgeService.evaluate_badges(self.user), [badge])
        self.assertEqual(BadgeService.evaluate_badges(self.user), [])
        progress.refresh_from_db()
        self.assertEqual((progress.xp_points, progress.level), (310, 2))
        self.assertTrue(
            SkillProgress.objects.get(user=self.user, skill=dependent).unlocked,
        )
        self.assertEqual(UserBadge.objects.filter(user=self.user, badge=badge).count(), 1)
        coins = CoinLedger.objects.get(user=self.user, reason=CoinLedger.Reason.BADGE_BONUS)
        self.assertEqual(coins.amount, 7)
        self.assertEqual(
            ActivityEvent.objects.filter(subject=self.user, event_type="award.badge").count(),
            1,
        )
