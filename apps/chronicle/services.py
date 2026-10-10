"""ChronicleService — all writers are idempotent.

`record_first` relies on the partial unique index on
(user, event_slug) where kind=first_ever for emit-once semantics.
Other writers use get_or_create keyed on their natural identity.

``write_journal`` accepts a stable client ID for interrupted mobile saves.
The daily journal is created and rewarded once; exact retries return it.
"""
from __future__ import annotations

import logging
import hashlib
import json
from dataclasses import dataclass
from datetime import date
from typing import Optional

from django.db import IntegrityError, transaction
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.chronicle.models import ChronicleEntry

# Hoisted so ``mock.patch("apps.chronicle.services.GameLoopService")`` in
# journal tests patches the name the service actually reads. Lazy-imported
# it before we can still reach via apps.rpg.services, but module-level makes
# the mock targetable without contortions.
from apps.rpg.services import GameLoopService  # noqa: E402
from apps.rpg.constants import TriggerType  # noqa: E402

logger = logging.getLogger(__name__)


class JournalAlreadyExistsError(Exception):
    """Raised when a child tries to write a second journal entry in one day.

    Carries the existing entry on ``.entry`` so the view can surface it in
    the 409 response body — the frontend uses it to flip the modal into
    edit mode instead of error-toasting.
    """

    def __init__(self, entry):
        super().__init__("A journal entry already exists for today.")
        self.entry = entry


class JournalRequestConflictError(Exception):
    """A client ID was reused with a different journal submission."""


def _journal_request_fingerprint(title, summary, is_private):
    payload = json.dumps(
        [title.strip(), summary.strip(), bool(is_private)],
        ensure_ascii=False, separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _journal_replay(user, client_entry_id, fingerprint):
    if client_entry_id is None:
        return None
    entry = ChronicleEntry.objects.filter(
        user=user, client_entry_id=client_entry_id,
    ).first()
    if entry is not None:
        if entry.kind != ChronicleEntry.Kind.JOURNAL or entry.metadata.get("request_fingerprint") != fingerprint:
            raise JournalRequestConflictError(
                "This save ID was already used for a different entry."
            )
        entry._journal_replayed = True
    return entry


def _award_journal_xp(user, entry):
    return award_verified_xp(
        user, entry, tag_loader=_journal_xp_tags, pool=JOURNAL_XP_POOL,
        source_label="Journal entry", evaluate_without_tags=True,
    )


def award_verified_xp(user, entry, *, tag_loader, pool, source_label, evaluate_without_tags=False, badge_scopes=None):
    """Persist what the award transaction actually changed, including boosts.

    A failed award rolls back to its savepoint while the memory survives.
    Neither configured XP nor game-loop response dictionaries prove an award.
    """
    receipt = {
        "receipt_id": f"{entry.kind}:{entry.pk}",
        "status": "unavailable", "xp_awarded": 0, "skills": [],
    }
    try:
        from apps.achievements.models import SkillProgress
        from apps.achievements.services import AwardService, BadgeService

        with transaction.atomic():
            tags = tag_loader()
            if not tags:
                if evaluate_without_tags:
                    BadgeService.evaluate_badges(user, scopes={"chronicle", "badges"})
                return receipt
            before = dict(
                SkillProgress.objects.select_for_update().filter(user=user)
                .values_list("skill_id", "xp_points")
            )
            AwardService.grant(
                user, xp_tags=tags, xp=pool,
                xp_source_label=source_label, badge_scopes=badge_scopes,
            )
            skills = []
            for progress in SkillProgress.objects.filter(user=user).select_related("skill"):
                delta = progress.xp_points - before.get(progress.skill_id, 0)
                if delta > 0:
                    skills.append({
                        "skill_id": progress.skill_id,
                        "name": progress.skill.name, "xp": delta,
                    })
            receipt.update(
                status="awarded" if skills else "not_eligible",
                xp_awarded=sum(skill["xp"] for skill in skills),
                skills=sorted(skills, key=lambda skill: skill["skill_id"]),
                awarded_at=timezone.now().isoformat(),
            )
    except Exception:
        logger.exception("Chronicle XP award hook failed for user %s (%s)", user.pk, entry.kind)
    return receipt


JOURNAL_XP_POOL = 15
# Order matters — the weights split the pool 2:1. Creative Writing gets
# the bulk (10 XP) because it's the primary skill being exercised;
# Vocabulary (5 XP) gets the leftover because any writing practice
# reinforces word use. Both skills are authored in ``skill_tree.yaml``
# under the Language Arts category.
JOURNAL_SKILL_WEIGHTS = [
    ("Creative Writing", 2),
    ("Vocabulary", 1),
]

JOURNAL_TITLE_MAX_BODY_CHARS = 60


@dataclass
class _JournalTag:
    """Shim matching the ``.skill`` + ``.xp_weight`` duck-type expected by
    ``SkillService.distribute_tagged_xp``. Lets the journal service reuse the
    weighted-XP distribution without a real ``JournalSkillTag`` model.
    """

    skill: object
    xp_weight: int


def _chapter_year_for(d: date) -> int:
    return d.year if d.month >= 8 else d.year - 1


def _autofill_journal_title(title: str, body: str, occurred_on: date) -> str:
    """Fallback rule for journal titles.

    - If the child provided a title, use it unchanged.
    - Otherwise use the first ~60 characters of the body with an ellipsis.
    - If the body is also empty, fall back to a human-readable date stamp.
    """
    clean_title = (title or "").strip()
    if clean_title:
        return clean_title[:160]
    clean_body = (body or "").strip()
    if clean_body:
        if len(clean_body) <= JOURNAL_TITLE_MAX_BODY_CHARS:
            return clean_body
        return clean_body[:JOURNAL_TITLE_MAX_BODY_CHARS].rstrip() + "…"
    if hasattr(occurred_on, "strftime"):
        # Platform-safe: build the label manually because %-d (Linux) /
        # %#d (Windows) aren't portable.
        return f"{occurred_on.strftime('%B')} {occurred_on.day} entry"
    return f"{occurred_on} entry"


def _journal_xp_tags():
    """Resolve the two hardcoded Language Arts skills by name.

    Returns an empty list on a fresh DB that hasn't loaded the skill catalog
    yet — ``AwardService.grant`` then no-ops on the XP branch, which is the
    correct fallback (no XP awarded, but the rest of the flow continues).
    """
    from apps.achievements.models import Skill

    tags = []
    for name, weight in JOURNAL_SKILL_WEIGHTS:
        skill = Skill.objects.filter(
            category__name="Language Arts", name=name,
        ).first()
        if skill is not None:
            tags.append(_JournalTag(skill=skill, xp_weight=weight))
    return tags


class ChronicleService:
    @staticmethod
    def record_first(
        user,
        event_slug: str,
        *,
        title: str,
        summary: str = "",
        icon_slug: str = "",
        related: Optional[tuple[str, int]] = None,
        occurred_on: Optional[date] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[ChronicleEntry]:
        """Write a FIRST_EVER entry. Returns None if already exists for this (user, event_slug)."""
        if not event_slug:
            raise ValueError("event_slug is required for record_first")
        day = occurred_on or date.today()
        related_type, related_id = (related or ("", None))
        try:
            with transaction.atomic():
                return ChronicleEntry.objects.create(
                    user=user,
                    kind=ChronicleEntry.Kind.FIRST_EVER,
                    occurred_on=day,
                    chapter_year=_chapter_year_for(day),
                    title=title,
                    summary=summary,
                    icon_slug=icon_slug,
                    event_slug=event_slug,
                    related_object_type=related_type,
                    related_object_id=related_id,
                    metadata=metadata or {},
                )
        except IntegrityError:
            return None

    @staticmethod
    def record_birthday(user, *, on_date: Optional[date] = None) -> ChronicleEntry:
        """Idempotent. Keyed on (user, kind=BIRTHDAY, occurred_on)."""
        day = on_date or date.today()
        age = None
        if user.date_of_birth:
            age = day.year - user.date_of_birth.year
            if (day.month, day.day) < (user.date_of_birth.month, user.date_of_birth.day):
                age -= 1
        title = f"Turned {age}" if age is not None else "Birthday"
        entry, _ = ChronicleEntry.objects.get_or_create(
            user=user,
            kind=ChronicleEntry.Kind.BIRTHDAY,
            occurred_on=day,
            defaults={
                "chapter_year": _chapter_year_for(day),
                "title": title,
                "icon_slug": "birthday-candle",
            },
        )
        return entry

    @staticmethod
    def record_chapter_start(user, chapter_year: int) -> ChronicleEntry:
        day = date(chapter_year, 8, 1)
        entry, _ = ChronicleEntry.objects.get_or_create(
            user=user,
            kind=ChronicleEntry.Kind.CHAPTER_START,
            chapter_year=chapter_year,
            defaults={
                "occurred_on": day,
                "title": "New chapter begins",
            },
        )
        return entry

    @staticmethod
    def record_chapter_end(user, chapter_year: int) -> ChronicleEntry:
        day = date(chapter_year + 1, 6, 1)
        entry, _ = ChronicleEntry.objects.get_or_create(
            user=user,
            kind=ChronicleEntry.Kind.CHAPTER_END,
            chapter_year=chapter_year,
            defaults={
                "occurred_on": day,
                "title": "Chapter closes",
            },
        )
        return entry

    @staticmethod
    def record_creation(
        user,
        *,
        creation_id: int,
        title: str,
        caption: str = "",
        occurred_on: Optional[date] = None,
    ) -> ChronicleEntry:
        """Emit a ChronicleEntry of kind=CREATION for a Creation row.

        Idempotent per (user, related_object_type='creation', related_object_id).
        Callers pass the Creation's ``id`` and a pre-resolved title. Not
        ``is_private`` — creations are meant to be seen on the timeline.
        """
        day = occurred_on or timezone.localdate()
        entry, _ = ChronicleEntry.objects.get_or_create(
            user=user,
            related_object_type="creation",
            related_object_id=creation_id,
            defaults={
                "kind": ChronicleEntry.Kind.CREATION,
                "occurred_on": day,
                "chapter_year": _chapter_year_for(day),
                "title": title[:160],
                "summary": caption or "",
                "icon_slug": "palette",
            },
        )
        return entry

    @staticmethod
    @transaction.atomic
    def write_journal(
        user,
        *,
        title: str,
        summary: str,
        occurred_on: Optional[date] = None,
        client_entry_id=None,
        is_private: bool = True,
    ) -> ChronicleEntry:
        """Create a child-authored journal entry for the given user.

        Always sets ``kind=JOURNAL``; entries are private by default. At most one
        journal entry per user per local day — a second call raises
        ``JournalAlreadyExistsError`` carrying the existing entry. Creation
        awards XP to Creative Writing + Vocabulary (hardcoded 10/5 split)
        and fires the RPG game loop so the child earns streak credit, a
        drop roll, and quest progress. The one-per-day constraint makes
        the anti-farm gate trivial: every create IS the day's only write.
        """
        if not (title.strip() or summary.strip()):
            raise ValidationError({"summary": "Add a thought or a title before saving."})
        day = occurred_on or timezone.localdate()
        fingerprint = _journal_request_fingerprint(title, summary, is_private)
        # Serialize competing daily journal writes on PostgreSQL, including
        # reward eligibility. SQLite's unique constraints remain the backstop.
        get_user_model().objects.select_for_update().get(pk=user.pk)
        replay = _journal_replay(user, client_entry_id, fingerprint)
        if replay is not None:
            return replay

        # Service-layer pre-check — gives callers a clean exception with
        # the existing entry attached so the view can 409 with context.
        # The partial unique index on (user, occurred_on) where kind=journal
        # is the DB-layer backstop for concurrent-POST races.
        existing = ChronicleEntry.objects.filter(
            user=user,
            kind=ChronicleEntry.Kind.JOURNAL,
            occurred_on=day,
        ).first()
        if existing is not None:
            raise JournalAlreadyExistsError(existing)

        resolved_title = _autofill_journal_title(title, summary, day)
        try:
            with transaction.atomic():
                entry = ChronicleEntry.objects.create(
                    user=user,
                    kind=ChronicleEntry.Kind.JOURNAL,
                    is_private=is_private,
                    client_entry_id=client_entry_id,
                    occurred_on=day,
                    chapter_year=_chapter_year_for(day),
                    title=resolved_title,
                    summary=summary or "",
                    metadata={"request_fingerprint": fingerprint},
                )
        except IntegrityError:
            # Race condition: two POSTs landed between the pre-check and
            # create. Re-read and surface the winner as the "existing" row.
            replay = _journal_replay(user, client_entry_id, fingerprint)
            if replay is not None:
                return replay
            existing = ChronicleEntry.objects.filter(
                user=user,
                kind=ChronicleEntry.Kind.JOURNAL,
                occurred_on=day,
            ).first()
            if existing is None:
                raise
            raise JournalAlreadyExistsError(existing)

        entry.metadata["reward_receipt"] = _award_journal_xp(user, entry)

        # Note: kept inline (rather than ``safe_game_loop_call``) so journal
        # tests can patch ``apps.chronicle.services.GameLoopService`` —
        # see the import-hoist comment at the top of this module.
        try:
            with transaction.atomic():
                GameLoopService.on_task_completed(
                    user,
                    TriggerType.JOURNAL_ENTRY,
                    {"entry_id": entry.pk},
                )
        except Exception:
            # Same defensive stance — the write succeeded; streak/drops
            # are best-effort downstream effects.
            logger.exception("Journal game-loop hook failed for user %s", user.pk)

        entry.save(update_fields=["metadata"])
        return entry

    @staticmethod
    @transaction.atomic
    def update_journal(
        user,
        entry: ChronicleEntry,
        *,
        title: Optional[str] = None,
        summary: Optional[str] = None,
        is_private: Optional[bool] = None,
    ) -> ChronicleEntry:
        """Edit a journal entry owned by ``user`` on the same local day.

        Raises ``PermissionDenied`` when the caller is not the owner, the
        entry isn't a journal entry, or the entry was written on a prior day
        (entries lock at local midnight).
        """
        if entry.user_id != user.id:
            raise PermissionDenied("You can only edit your own journal entries.")
        if entry.kind != ChronicleEntry.Kind.JOURNAL:
            raise PermissionDenied("Only journal entries are editable here.")
        text_changed = title is not None or summary is not None
        if text_changed and entry.occurred_on != timezone.localdate():
            raise PermissionDenied(
                "Journal entries lock after the day ends — this one is part of the chronicle now."
            )
        fields = []
        if text_changed:
            next_title = entry.title if title is None else title
            next_summary = entry.summary if summary is None else summary
            if not (next_title.strip() or next_summary.strip()):
                raise ValidationError({"summary": "Keep a thought or a title in your entry."})
            entry.title = _autofill_journal_title(next_title, next_summary, entry.occurred_on)
            entry.summary = next_summary
            fields.extend(["title", "summary"])
        if is_private is not None:
            entry.is_private = is_private
            fields.append("is_private")
        if fields:
            entry.save(update_fields=fields)
        return entry

    @staticmethod
    def freeze_recap(user, chapter_year: int) -> ChronicleEntry:
        """Aggregates stats for the chapter and writes a RECAP entry. Idempotent."""
        from django.db.models import Sum

        from apps.projects.models import Project
        from apps.rewards.models import CoinLedger

        start = date(chapter_year, 8, 1)
        end = date(chapter_year + 1, 7, 31)

        stats = {}

        # Project.completed_at is a DateTimeField — use __date__range to compare
        # the date portion so plain date boundaries work correctly.
        stats["projects_completed"] = Project.objects.filter(
            assigned_to=user,
            status="completed",
            completed_at__date__range=(start, end),
        ).count()

        # CoinLedger.amount is IntegerField; Sum returns int (or None when empty).
        coins_earned = (
            CoinLedger.objects.filter(
                user=user,
                created_at__date__range=(start, end),
                amount__gt=0,
            ).aggregate(total=Sum("amount"))["total"]
            or 0
        )
        stats["coins_earned"] = coins_earned

        # Optional additive aggregations — wrap each so a missing app
        # doesn't break recap writes. Each block short-circuits on import
        # failure without failing the overall freeze.
        try:
            from apps.homework.models import HomeworkSubmission

            # HomeworkSubmission.decided_at is a DateTimeField (from ApprovalWorkflowModel).
            stats["homework_approved"] = HomeworkSubmission.objects.filter(
                assignment__assigned_to=user,
                status="approved",
                decided_at__date__range=(start, end),
            ).count()
        except Exception as exc:  # pragma: no cover
            logger.debug("homework recap skipped: %s", exc)

        try:
            from apps.chores.models import ChoreCompletion

            # ChoreCompletion.completed_date is a DateField — plain __range works.
            stats["chores_approved"] = ChoreCompletion.objects.filter(
                user=user,
                status="approved",
                completed_date__range=(start, end),
            ).count()
        except Exception as exc:  # pragma: no cover
            logger.debug("chores recap skipped: %s", exc)

        entry, _ = ChronicleEntry.objects.get_or_create(
            user=user,
            kind=ChronicleEntry.Kind.RECAP,
            chapter_year=chapter_year,
            defaults={
                "occurred_on": date(chapter_year + 1, 6, 1),
                "title": f"Chapter {chapter_year}-{str(chapter_year + 1)[-2:]} recap",
                "metadata": stats,
            },
        )
        return entry
