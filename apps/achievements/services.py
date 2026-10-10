import logging

from django.contrib.auth import get_user_model
from django.db import models, transaction

from . import criteria
from .models import (
    Badge, ProjectSkillTag, Skill, SkillProgress, UserBadge, XP_THRESHOLDS,
)

logger = logging.getLogger(__name__)


def _lock_award_user(user):
    """Serialize awards, including first progress rows, within an atomic block.

    Always lock the user before SkillProgress or UserBadge rows. Receipt callers
    use the same order and may already hold this lock. PostgreSQL's NO KEY
    UPDATE also permits FK inserts by other activity transactions before they
    reach the award gate, avoiding a KEY SHARE -> UPDATE lock upgrade deadlock.
    """
    get_user_model().objects.select_for_update(no_key=True).get(pk=user.pk)


class SkillService:
    @staticmethod
    def level_for_xp(xp):
        """Determine level based on XP thresholds."""
        level = 0
        for lvl, threshold in sorted(XP_THRESHOLDS.items()):
            if xp >= threshold:
                level = lvl
            else:
                break
        return level

    @classmethod
    @transaction.atomic
    def award_xp(cls, user, skill, amount):
        """Award XP to a user for a specific skill. Returns the SkillProgress."""
        _lock_award_user(user)
        progress, _ = SkillProgress.objects.select_for_update().get_or_create(
            user=user, skill=skill,
            defaults={"unlocked": not skill.is_locked_by_default},
        )
        if not progress.unlocked:
            return progress

        progress.xp_points += amount
        progress.level = cls.level_for_xp(progress.xp_points)
        progress.save(update_fields=["xp_points", "level"])

        cls.evaluate_unlocks(user)
        return progress

    @classmethod
    def distribute_project_xp(cls, user, project, total_xp):
        """Distribute XP across a project's skill tags by weight ratio."""
        tags = ProjectSkillTag.objects.filter(project=project).select_related("skill")
        cls.distribute_tagged_xp(user, tags, total_xp)

    @classmethod
    @transaction.atomic
    def distribute_tagged_xp(cls, user, tags, total_xp):
        """Generic weighted-tag XP distribution.

        ``tags`` is any iterable of objects with ``.skill`` (Skill FK) and
        ``.xp_weight`` (int). Used for ProjectSkillTag, ChoreSkillTag,
        HabitSkillTag, QuestSkillTag — one helper for every entity that
        declares "doing this exercises these skills." Returns the list of
        per-skill XP amounts actually awarded (for logging).
        """
        _lock_award_user(user)
        awarded = []
        for skill, skill_xp in cls._iter_tagged_xp(tags, total_xp):
            cls.award_xp(user, skill, skill_xp)
            awarded.append((skill, skill_xp))
        return awarded

    @staticmethod
    def _iter_tagged_xp(tags, total_xp):
        """Yield ``(skill, xp_amount)`` for each tag with a positive share.

        Pure-math helper: no DB writes, no awards. Used by both
        ``distribute_tagged_xp`` (which awards) and
        ``AwardService._distribute_tagged_xp_logged`` (which awards + records
        an activity-log breakdown). Centralizing the by-weight math here
        guarantees the two paths can never diverge.
        """
        tag_list = list(tags)
        if not tag_list:
            return
        total_weight = sum(tag.xp_weight for tag in tag_list)
        if total_weight == 0:
            return
        for tag in tag_list:
            skill_xp = round(total_xp * (tag.xp_weight / total_weight))
            if skill_xp > 0:
                yield tag.skill, skill_xp

    @classmethod
    @transaction.atomic
    def evaluate_unlocks(cls, user):
        """Check all locked skills to see if prerequisites are now met."""
        _lock_award_user(user)
        locked_skills = Skill.objects.filter(is_locked_by_default=True).order_by("pk")
        newly_unlocked = []

        for skill in locked_skills:
            progress, _ = SkillProgress.objects.select_for_update().get_or_create(
                user=user, skill=skill,
                defaults={"unlocked": False},
            )
            if progress.unlocked:
                continue

            prerequisites = skill.prerequisites.select_related("required_skill").all()
            if not prerequisites.exists():
                continue

            all_met = all(
                SkillProgress.objects.filter(
                    user=user,
                    skill=prereq.required_skill,
                    level__gte=prereq.required_level,
                ).exists()
                for prereq in prerequisites
            )

            if all_met:
                progress.unlocked = True
                progress.save(update_fields=["unlocked"])
                newly_unlocked.append(skill)

        return newly_unlocked

    @staticmethod
    def get_category_summary(user, category):
        """Get aggregated level and total XP for a category."""
        progress = SkillProgress.objects.filter(
            user=user, skill__category=category, unlocked=True,
        )
        if not progress.exists():
            return {"level": 0, "total_xp": 0}

        agg = progress.aggregate(
            avg_level=models.Avg("level"),
            total_xp=models.Sum("xp_points"),
        )
        return {
            "level": round(agg["avg_level"] or 0),
            "total_xp": agg["total_xp"] or 0,
        }

    @staticmethod
    def _serialize_skill(skill, sp, user):
        prereqs = [
            {
                "skill_id": p.required_skill_id,
                "skill_name": p.required_skill.name,
                "required_level": p.required_level,
                "met": SkillProgress.objects.filter(
                    user=user,
                    skill=p.required_skill,
                    level__gte=p.required_level,
                ).exists() if sp and not sp.unlocked else True,
            }
            for p in skill.prerequisites.all()
        ]
        return {
            "id": skill.id,
            "name": skill.name,
            "icon": skill.icon,
            "description": skill.description,
            "is_locked_by_default": skill.is_locked_by_default,
            "level_names": skill.level_names,
            "xp_points": sp.xp_points if sp else 0,
            "level": sp.level if sp else 0,
            "unlocked": sp.unlocked if sp else not skill.is_locked_by_default,
            "xp_to_next_level": sp.xp_to_next_level if sp else XP_THRESHOLDS.get(1, 100),
            "prerequisites": prereqs,
        }

    @staticmethod
    def get_subject_summary(user, subject):
        """Get aggregated level and total XP for a subject."""
        progress = SkillProgress.objects.filter(
            user=user, skill__subject=subject, unlocked=True,
        )
        if not progress.exists():
            return {"level": 0, "total_xp": 0}
        agg = progress.aggregate(
            avg_level=models.Avg("level"),
            total_xp=models.Sum("xp_points"),
        )
        return {
            "level": round(agg["avg_level"] or 0),
            "total_xp": agg["total_xp"] or 0,
        }

    @classmethod
    def get_skill_tree(cls, user, category):
        """Return subjects nested with skills + user progress for a category."""
        from .models import Subject

        subjects = Subject.objects.filter(category=category).order_by("order", "name")
        skills = Skill.objects.filter(category=category).prefetch_related(
            "prerequisites__required_skill",
        )
        progress_map = {
            sp.skill_id: sp
            for sp in SkillProgress.objects.filter(user=user, skill__category=category)
        }

        skills_by_subject = {}
        orphan_skills = []
        for skill in skills:
            entry = cls._serialize_skill(skill, progress_map.get(skill.id), user)
            if skill.subject_id:
                skills_by_subject.setdefault(skill.subject_id, []).append(entry)
            else:
                orphan_skills.append(entry)

        tree = []
        for subject in subjects:
            tree.append({
                "id": subject.id,
                "name": subject.name,
                "icon": subject.icon,
                "description": subject.description,
                "order": subject.order,
                "summary": cls.get_subject_summary(user, subject),
                "skills": skills_by_subject.get(subject.id, []),
            })
        if orphan_skills:
            tree.append({
                "id": None,
                "name": "Other",
                "icon": "",
                "description": "",
                "order": 9999,
                "summary": {"level": 0, "total_xp": 0},
                "skills": orphan_skills,
            })
        return tree


class AwardService:
    """Unified XP + coin + badge awarding pipeline.

    The same three-step sequence (award XP → award coins → re-evaluate badges)
    runs from clock-out, project completion, and milestone completion. Routing
    it through one call site keeps those hooks consistent and makes it trivial
    to add a new award trigger later.
    """

    @staticmethod
    @transaction.atomic
    def grant(
        user,
        *,
        project=None,
        xp_tags=None,
        xp_source_label=None,
        xp=0,
        coins=0,
        coin_reason=None,
        coin_description="",
        money=0,
        money_entry_type=None,
        money_description="",
        created_by=None,
        badge_scopes=None,
    ):
        """Distribute XP + coins + optional money atomically and re-evaluate badges.

        XP sources (mutually exclusive — first one that matches wins):
          - ``project``: look up ``ProjectSkillTag`` rows for the project.
            Legacy path for clock-out/project/milestone completion.
          - ``xp_tags``: any iterable of tag objects with ``.skill`` and
            ``.xp_weight``. Used for chore/habit/quest skill tags —
            pass e.g. ``chore.skill_tags.all()``. ``xp_source_label``
            (e.g. "Chore: Dishes") goes into the activity log summary.

        If ``xp > 0`` but neither source is provided, XP is awarded to
        ``_award_badge_xp`` which dilutes it across every unlocked skill.
        That's the back-compat fallback for pre-skill-tag callers.

        ``money`` / ``money_entry_type`` are optional — pass them for paired
        award paths (clock-out hourly, chore reward, project/milestone bonus)
        that credit both ``PaymentLedger`` and ``CoinLedger`` in one breath.
        Badge-only and quest-only callers leave them off.

        Activity-log contract: inner ``CoinService``/``PaymentService`` calls
        stay silent inside this block; this method emits consolidated
        ``award.xp`` / ``award.coins`` / ``award.money`` events with the
        per-skill distribution and the original description.

        ``badge_scopes`` (audit H8) is forwarded to ``evaluate_badges`` so
        the per-grant badge re-eval only checks criteria that could
        plausibly have moved. Pass an iterable of strings — see
        ``apps.achievements.criteria._CRITERIA_SCOPES`` for the
        vocabulary. Default ``None`` evaluates every unearned badge
        (the pre-PR behaviour).
        """
        from apps.activity.services import ActivityLogService, activity_scope
        from apps.rpg.services import xp_boost_multiplier

        _lock_award_user(user)

        # Apply Scholar's Draught multiplier before distribution so the full
        # boosted total flows through the tag-weighted split and the activity
        # log. The original xp value is preserved in the event summary so
        # parents can see base-vs-boosted.
        boosted_xp = xp
        xp_boost_mult = xp_boost_multiplier(user) if xp > 0 else 1.0
        if xp_boost_mult > 1.0 and xp > 0:
            boosted_xp = int(xp * xp_boost_mult)

        with activity_scope(suppress_inner_ledger=True):
            xp_breakdown = []
            if project is not None and boosted_xp > 0:
                xp_breakdown = AwardService._distribute_project_xp_logged(
                    user, project, boosted_xp,
                )
            elif xp_tags is not None and boosted_xp > 0:
                xp_breakdown = AwardService._distribute_tagged_xp_logged(
                    user, xp_tags, boosted_xp,
                )

            if coins > 0 and coin_reason is not None:
                from apps.rewards.services import CoinService
                CoinService.award_coins(
                    user,
                    coins,
                    coin_reason,
                    description=coin_description,
                    created_by=created_by,
                )
                ActivityLogService.record(
                    category="award",
                    event_type="award.coins",
                    summary=coin_description or f"+{coins} coins ({coin_reason})",
                    actor=created_by,
                    subject=user,
                    coins_delta=int(coins),
                    breakdown=[
                        {"label": coin_reason, "value": int(coins), "op": "="},
                    ],
                    extras={"reason": coin_reason, "project_id": project.pk if project else None},
                )

            if money and money_entry_type is not None:
                from apps.payments.services import PaymentService
                PaymentService.record_entry(
                    user,
                    money,
                    money_entry_type,
                    description=money_description or coin_description,
                    project=project,
                    created_by=created_by,
                )
                ActivityLogService.record(
                    category="award",
                    event_type="award.money",
                    summary=money_description
                        or coin_description
                        or f"${money} ({money_entry_type})",
                    actor=created_by,
                    subject=user,
                    money_delta=money,
                    breakdown=[
                        {"label": money_entry_type, "value": str(money), "op": "="},
                    ],
                    extras={
                        "entry_type": money_entry_type,
                        "project_id": project.pk if project else None,
                    },
                )

            if xp_breakdown:
                summary_suffix = ""
                if project:
                    summary_suffix = f" · {project.title}"
                elif xp_source_label:
                    summary_suffix = f" · {xp_source_label}"
                boosted_suffix = (
                    f" (boosted ×{xp_boost_mult:g})"
                    if xp_boost_mult > 1.0 else ""
                )
                ActivityLogService.record(
                    category="award",
                    event_type="award.xp",
                    summary=f"+{boosted_xp} XP distributed{summary_suffix}{boosted_suffix}",
                    actor=created_by,
                    subject=user,
                    xp_delta=int(boosted_xp),
                    breakdown=xp_breakdown,
                    extras={
                        "project_id": project.pk if project else None,
                        "xp_base": int(xp),
                        "xp_boost_multiplier": xp_boost_mult,
                        "xp_awarded": int(boosted_xp),
                    },
                )

            BadgeService.evaluate_badges(
                user, created_by=created_by, scopes=badge_scopes,
            )

    @staticmethod
    def _distribute_project_xp_logged(user, project, total_xp):
        """Thin wrapper — look up the project's tags and distribute."""
        tags = ProjectSkillTag.objects.filter(project=project).select_related("skill")
        return AwardService._distribute_tagged_xp_logged(user, tags, total_xp)

    @staticmethod
    @transaction.atomic
    def _distribute_tagged_xp_logged(user, tags, total_xp):
        """Distribute ``total_xp`` across any weighted-tag iterable.

        Used by project, chore, habit, and quest XP paths. Returns
        activity-log breakdown rows in the shape the ``award.xp`` event
        expects, so every source logs identically. Shares the underlying
        by-weight math with ``SkillService.distribute_tagged_xp`` via
        ``_iter_tagged_xp`` — they cannot diverge.
        """
        _lock_award_user(user)
        rows = []
        for skill, skill_xp in SkillService._iter_tagged_xp(tags, total_xp):
            SkillService.award_xp(user, skill, skill_xp)
            rows.append({
                "label": skill.name,
                "value": skill_xp,
                "op": "+",
            })
        return rows


class BadgeService:
    @classmethod
    @transaction.atomic
    def evaluate_badges(cls, user, *, created_by=None, scopes=None):
        """Check unearned badges and award any newly qualified.

        Audit H8: ``scopes`` is an optional iterable of strings (see
        ``apps.achievements.criteria._CRITERIA_SCOPES`` for the
        vocabulary) declaring which subsystems just changed. When set,
        only badges whose criteria_type lists at least one matching
        scope (or no scope, treated as always-relevant) are evaluated —
        avoids re-running ~57 checkers on every chore approval. When
        ``scopes`` is None (default) the full unearned set is scanned,
        preserving the original semantics for callers that haven't
        opted in yet.
        """
        from apps.achievements.criteria import criteria_types_for_scopes
        from apps.activity.services import (
            ActivityLogService,
            activity_scope,
        )

        # Lock before the unique UserBadge insert: otherwise an XP award can
        # hold the user lock while waiting for that insert's transaction.
        # The earned marker and its payouts must also commit together.
        _lock_award_user(user)
        earned_ids = set(
            UserBadge.objects.filter(user=user).values_list("badge_id", flat=True)
        )
        all_badges = Badge.objects.exclude(id__in=earned_ids)
        if scopes:
            relevant_types = criteria_types_for_scopes(scopes)
            all_badges = all_badges.filter(criteria_type__in=relevant_types)
        newly_earned = []

        for badge in all_badges:
            if cls._check_criteria(user, badge):
                # Use get_or_create against the unique constraint so two
                # concurrent evaluations can't double-award. The losing
                # transaction returns ``created=False`` and skips the inner
                # award block — only the winner pays out.
                user_badge, created = UserBadge.objects.get_or_create(
                    user=user, badge=badge,
                )
                if not created:
                    continue
                # Suppress inner ledger emissions — ``award.badge`` below is
                # the canonical row. The rarity->coin breakdown captures the
                # same numeric data without a separate ``ledger.coins.*``.
                with activity_scope(suppress_inner_ledger=True):
                    if badge.xp_bonus > 0:
                        cls._award_badge_xp(user, badge)
                    cls._award_badge_coins(user, badge)
                newly_earned.append(badge)
                ActivityLogService.record(
                    category="award",
                    event_type="award.badge",
                    summary=f"Badge earned: {badge.name}",
                    actor=created_by,
                    subject=user,
                    target=user_badge,
                    breakdown=[
                        {"label": "rarity", "value": badge.rarity, "op": "note"},
                        {"label": "xp bonus", "value": badge.xp_bonus, "op": "+"},
                    ],
                    extras={
                        "badge_id": badge.pk,
                        "badge_name": badge.name,
                        "rarity": badge.rarity,
                    },
                )

        return newly_earned

    @staticmethod
    def _award_badge_coins(user, badge):
        """Award coins scaled by badge rarity.

        Skipped entirely when ``badge.award_coins`` is False — used for
        badges that represent purely-cosmetic achievement titles (e.g.
        quest-completion badges) where the triggering event already paid.
        """
        if not badge.award_coins:
            return
        from django.conf import settings
        from apps.rewards.services import CoinService
        from apps.rewards.models import CoinLedger

        rarity_map = getattr(settings, "COINS_PER_BADGE_RARITY", {})
        amount = int(rarity_map.get(badge.rarity, 0))
        if amount <= 0:
            return
        CoinService.award_coins(
            user, amount, CoinLedger.Reason.BADGE_BONUS,
            description=f"Badge earned: {badge.name}",
        )

    @staticmethod
    def _check_criteria(user, badge):
        return criteria.check(user, badge)

    @staticmethod
    @transaction.atomic
    def _award_badge_xp(user, badge):
        """Distribute badge XP bonus evenly across user's active skills."""
        _lock_award_user(user)
        active_progress = list(SkillProgress.objects.select_for_update().filter(
            user=user, unlocked=True, level__gt=0,
        ).order_by("pk"))
        if not active_progress:
            return
        xp_each = max(1, badge.xp_bonus // len(active_progress))
        for sp in active_progress:
            sp.xp_points += xp_each
            sp.level = SkillService.level_for_xp(sp.xp_points)
            sp.save(update_fields=["xp_points", "level"])
        SkillService.evaluate_unlocks(user)
