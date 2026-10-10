"""Chronicle / Journal MCP tools.

Mirrors ``/api/chronicle/*``. Two distinct surfaces:

  * **Journal** (child self-scoped) — one entry per local day enforced by
    a partial unique index. Second-write raises ``JournalAlreadyExistsError``;
    we surface it as a ``MCPValidationError`` carrying the existing entry's
    id so callers can pivot to ``update_journal``. Edit lock at local
    midnight is ``MCPPermissionDenied``.

  * **Manual entries** (parent-only) — free-form chronicle markers on a
    child's timeline. CRUD here mirrors the REST viewset (only MANUAL-kind
    rows are editable / deletable to protect FIRST_EVER / RECAP / BIRTHDAY
    history).
"""
from __future__ import annotations

from datetime import date
from typing import Any

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied as DRFPermissionDenied

from apps.chronicle.access import visible_chronicle_entries
from apps.chronicle.models import ChronicleEntry
from apps.chronicle.services import ChronicleService, JournalAlreadyExistsError

from ..context import (
    get_current_user, get_in_family, require_parent, resolve_target_user,
)
from ..errors import MCPNotFoundError, MCPPermissionDenied, MCPValidationError, safe_tool
from ..schemas import (
    CreateManualEntryIn,
    DeleteChronicleEntryIn,
    GetChronicleSummaryIn,
    GetPendingCelebrationIn,
    GetTodayJournalIn,
    ListChronicleEntriesIn,
    MarkChronicleViewedIn,
    UpdateJournalIn,
    UpdateManualEntryIn,
    WriteJournalIn,
)
from ..server import tool
from ..shapes import chronicle_entry_to_dict, many


def _chapter_year_for(d: date) -> int:
    return d.year if d.month >= 8 else d.year - 1


@tool()
@safe_tool
def list_chronicle_entries(params: ListChronicleEntriesIn) -> dict[str, Any]:
    """Read-only timeline of all chronicle entries for a user.

    Returns every kind (journal, grade, creation, manual, birthday, milestone,
    first_ever, recap, chapter boundaries) interleaved by ``occurred_on``.
    Children see their own; parents see any child in their family.

    To CREATE entries use a kind-specific tool:
      - child journal entry → ``write_journal``
      - child "I made a thing" → ``log_creation`` (also emits a chronicle row)
      - parent-authored memory → ``create_manual_entry``

    Other kinds (birthday / milestone / first_ever / recap) are emitted
    automatically by services and Celery tasks — there is no MCP write
    surface for them.
    """
    user = get_current_user()
    target = resolve_target_user(user, params.user_id)
    qs = visible_chronicle_entries(user, ChronicleEntry.objects.filter(user=target))
    if params.chapter_year is not None:
        qs = qs.filter(chapter_year=params.chapter_year)
    if params.kind:
        qs = qs.filter(kind=params.kind)
    qs = qs.order_by("-occurred_on", "-created_at")[: params.limit]
    return {"entries": many(qs, chronicle_entry_to_dict)}


@tool()
@safe_tool
def get_chronicle_summary(params: GetChronicleSummaryIn) -> dict[str, Any]:
    """Group entries by chapter_year with per-chapter stats.

    For past chapters returns frozen RECAP metadata; for the current
    chapter computes live aggregates (projects completed, coins earned).
    Mirrors ``GET /api/chronicle/summary/``.
    """
    from collections import defaultdict
    from apps.chronicle.views import _stats_for

    user = get_current_user()
    target = resolve_target_user(user, params.user_id)

    entries = list(
        visible_chronicle_entries(user, ChronicleEntry.objects.filter(user=target))
        .order_by("-chapter_year", "-occurred_on"),
    )
    by_year: dict[int, list] = defaultdict(list)
    for e in entries:
        by_year[e.chapter_year].append(e)

    # Audit H11: use Phoenix-local date, not server UTC. ``date.today()``
    # returns the wrong day around midnight Phoenix (it's already next-day
    # in UTC), causing today's birthday / today's journal to vanish from
    # the lookup.
    today = timezone.localdate()
    current_chapter = _chapter_year_for(today)

    chapters = []
    for year in sorted(by_year.keys(), reverse=True):
        is_current = year == current_chapter
        chapters.append({
            "chapter_year": year,
            "is_current": is_current,
            "stats": _stats_for(target, year, by_year[year], is_current),
            "entries": [chronicle_entry_to_dict(e) for e in by_year[year]],
        })
    return {"chapters": chapters, "current_chapter_year": current_chapter}


@tool()
@safe_tool
def mark_chronicle_viewed(params: MarkChronicleViewedIn) -> dict[str, Any]:
    """Set ``viewed_at=now()`` on an entry the caller can see. Idempotent.

    Audit C8: scope by family for parents and by ownership for children.
    Without scoping, a parent could stamp ``viewed_at`` on any family's
    entry (low-impact alone but violates the scoping doctrine).
    """
    user = get_current_user()
    qs = visible_chronicle_entries(user, ChronicleEntry.objects.all())
    try:
        entry = qs.get(pk=params.entry_id)
    except ChronicleEntry.DoesNotExist:
        raise MCPNotFoundError(f"ChronicleEntry {params.entry_id} not found.")
    if entry.viewed_at is None:
        entry.viewed_at = timezone.now()
        entry.save(update_fields=["viewed_at"])
    return chronicle_entry_to_dict(entry)


@tool()
@safe_tool
def get_pending_celebration(params: GetPendingCelebrationIn) -> dict[str, Any]:
    """Return today's unviewed BIRTHDAY entry for the caller, or ``null``."""
    user = get_current_user()
    # Audit H11: use Phoenix-local date, not server UTC. ``date.today()``
    # returns the wrong day around midnight Phoenix (it's already next-day
    # in UTC), causing today's birthday / today's journal to vanish from
    # the lookup.
    today = timezone.localdate()
    entry = (
        ChronicleEntry.objects.filter(
            user=user,
            kind=ChronicleEntry.Kind.BIRTHDAY,
            occurred_on=today,
            viewed_at__isnull=True,
        )
        .order_by("-created_at")
        .first()
    )
    return {"entry": chronicle_entry_to_dict(entry) if entry else None}


@tool()
@safe_tool
def get_today_journal(params: GetTodayJournalIn) -> dict[str, Any]:
    """Return today's journal entry for the caller, or ``null`` if none."""
    user = get_current_user()
    entry = ChronicleEntry.objects.filter(
        user=user,
        kind=ChronicleEntry.Kind.JOURNAL,
        occurred_on=timezone.localdate(),
    ).first()
    return {"entry": chronicle_entry_to_dict(entry) if entry else None}


@tool()
@safe_tool
def write_journal(params: WriteJournalIn) -> dict[str, Any]:
    """Write today's journal entry (caller is always the author).

    Use when the child wants to write a short reflection / diary entry
    about TODAY. Distinct from neighbors:
      - ``log_creation`` — for "I made a thing" (image + caption).
      - ``create_manual_entry`` — parent backfilling a memory on the
        child's timeline (any past date, no rewards).

    One entry per local day — a second call raises ``MCPValidationError``
    with ``existing_entry_id`` in the message so callers can switch to
    ``update_journal``. Awards 15 XP across Creative Writing + Vocabulary
    and fires the streak / drop / quest game loop.
    """
    user = get_current_user()
    try:
        entry = ChronicleService.write_journal(
            user, title=params.title, summary=params.summary,
        )
    except JournalAlreadyExistsError as exc:
        existing_id = exc.entry.id if exc.entry else None
        raise MCPValidationError(
            f"You already wrote a journal entry today (id={existing_id}). "
            f"Use update_journal to edit it.",
        )
    return chronicle_entry_to_dict(entry)


@tool()
@safe_tool
def update_journal(params: UpdateJournalIn) -> dict[str, Any]:
    """Edit today's journal entry. Locked to owner; 403 after midnight.

    Pair with ``write_journal``: after a second-of-day write returns
    ``existing_entry_id``, call this with that id. Once the local day
    rolls over the entry becomes immutable (preserves the chronicle as
    a historical record) — callers get ``MCPPermissionDenied``.

    Audit C8: scope to caller's own entries up front. The service-layer
    owner check would still block the actual write, but a probe could
    distinguish "exists in another family" from "doesn't exist" via the
    403-vs-404 status. Scoping here closes the leak.
    """
    user = get_current_user()
    try:
        entry = ChronicleEntry.objects.get(pk=params.entry_id, user=user)
    except ChronicleEntry.DoesNotExist:
        raise MCPNotFoundError(f"ChronicleEntry {params.entry_id} not found.")
    try:
        updated = ChronicleService.update_journal(
            user, entry, title=params.title, summary=params.summary,
        )
    except DRFPermissionDenied as exc:
        raise MCPPermissionDenied(str(exc))
    return chronicle_entry_to_dict(updated)


@tool()
@safe_tool
def create_manual_entry(params: CreateManualEntryIn) -> dict[str, Any]:
    """Create a parent-authored manual chronicle entry on a child's timeline.

    Use for backfilling a memory ABOUT the child on any date —
    ``occurred_on`` can be in the past (e.g. "First time riding a bike,
    2024-07-15"). Parent-only. No XP, no coins, no drops, no game loop —
    this is pure timeline curation.

    Distinct from neighbors:
      - ``write_journal`` is child-self-authored, today-only, auto-awarding.
      - ``log_creation`` is child-self-authored, requires an image, and
        emits its own chronicle row automatically.

    Editable later via ``update_manual_entry`` / ``delete_chronicle_entry``
    (MANUAL-kind only — birthdays / firsts / recaps stay immutable).
    """
    parent = require_parent()

    target = resolve_target_user(parent, params.user_id)
    if getattr(target, "role", None) != "child":
        raise MCPNotFoundError(f"Child {params.user_id} not found.")

    entry = ChronicleEntry.objects.create(
        user=target,
        kind=ChronicleEntry.Kind.MANUAL,
        chapter_year=_chapter_year_for(params.occurred_on),
        title=params.title,
        summary=params.summary,
        icon_slug=params.icon_slug,
        occurred_on=params.occurred_on,
        metadata=params.metadata,
    )
    return chronicle_entry_to_dict(entry)


@tool()
@safe_tool
def update_manual_entry(params: UpdateManualEntryIn) -> dict[str, Any]:
    """Edit a manual chronicle entry (parent-only, MANUAL-kind only).

    Audit C8: family-scope so a parent can't edit another family's
    manual chronicle row.
    """
    parent = require_parent()
    entry = get_in_family(
        ChronicleEntry, params.entry_id, actor=parent,
        family_path="user__family",
    )
    if entry.kind != ChronicleEntry.Kind.MANUAL:
        raise MCPPermissionDenied(
            "Only manual entries are editable. Birthdays / firsts / recaps are immutable history.",
        )

    updates = params.model_dump(exclude={"entry_id"}, exclude_unset=True)
    for field, value in updates.items():
        setattr(entry, field, value)
    if "occurred_on" in updates:
        entry.chapter_year = _chapter_year_for(entry.occurred_on)
    entry.save()
    return chronicle_entry_to_dict(entry)


@tool()
@safe_tool
def delete_chronicle_entry(params: DeleteChronicleEntryIn) -> dict[str, Any]:
    """Delete a manual chronicle entry (parent-only, MANUAL-kind only).

    Audit C8: family-scope so a parent can't delete another family's row.
    """
    parent = require_parent()
    entry = get_in_family(
        ChronicleEntry, params.entry_id, actor=parent,
        family_path="user__family",
    )
    if entry.kind != ChronicleEntry.Kind.MANUAL:
        raise MCPPermissionDenied(
            "Only manual entries are deletable. Birthdays / firsts / recaps are immutable history.",
        )
    entry.delete()
    return {"deleted": True, "entry_id": params.entry_id}
