"""Reliable grade capture with once-per-save-day recognition."""
import hashlib
import json
from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.chronicle.grade_serializers import GradeEntryWriteSerializer
from apps.chronicle.models import ChronicleEntry, GradeDailyCounter
from apps.chronicle.services import _JournalTag, _chapter_year_for, award_verified_xp
from config.services import bump_daily_counter

GRADE_XP_POOL = 10


class GradeRequestConflictError(Exception):
    """An author reused an existing save UUID for another submission."""


def _grade_xp_tags():
    from apps.achievements.models import Skill

    skill = Skill.objects.filter(category__name="Life Skills", name="Time Management").first()
    return [_JournalTag(skill=skill, xp_weight=1)] if skill else []


def _fingerprint(data):
    normalized = {
        "grade": data["grade"], "reflection": data.get("reflection", ""),
        "occurred_on": data["occurred_on"].isoformat(), "is_private": data.get("is_private", True),
    }
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _replay(entry, fingerprint):
    if entry is None:
        return None
    if entry.kind != ChronicleEntry.Kind.GRADE or entry.metadata.get("request_fingerprint") != fingerprint:
        raise GradeRequestConflictError("This save ID was already used for a different entry.")
    entry._grade_replayed = True
    return entry


class GradeService:
    @staticmethod
    @transaction.atomic
    def write_grade(user, submission):
        if user.role != "child":
            raise PermissionDenied("Only children can record their grades.")
        # Match journal's user-before-progress lock order. This also covers
        # competing UUIDs before a daily counter exists.
        get_user_model().objects.select_for_update(no_key=True).get(pk=user.pk)
        serializer = GradeEntryWriteSerializer(data=submission)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        existing = ChronicleEntry.objects.filter(user=user, client_entry_id=data["client_entry_id"]).first()
        if existing is not None and "occurred_on" not in submission:
            # A retry of an omitted/default date still refers to the original
            # save after midnight, even if the owner later corrected its date.
            original_day = existing.metadata.get("request_occurred_on")
            if original_day:
                data["occurred_on"] = date.fromisoformat(original_day)
        fingerprint = _fingerprint(data)
        replay = _replay(existing, fingerprint)
        if replay is not None:
            return replay
        day = data["occurred_on"]
        try:
            with transaction.atomic():
                entry = ChronicleEntry.objects.create(
                    user=user, kind=ChronicleEntry.Kind.GRADE, occurred_on=day,
                    chapter_year=_chapter_year_for(day), is_private=data.get("is_private", True),
                    title=f"{data['grade']['subject']} · {data['grade']['assessment']}"[:160],
                    summary=data.get("reflection", ""), icon_slug="graduation-cap",
                    client_entry_id=data["client_entry_id"],
                    metadata={
                        "grade": data["grade"], "request_fingerprint": fingerprint,
                        "request_occurred_on": day.isoformat(),
                    },
                )
        except IntegrityError:
            winner = ChronicleEntry.objects.filter(user=user, client_entry_id=data["client_entry_id"]).first()
            if winner is None:
                raise
            return _replay(winner, fingerprint)
        reward_day = timezone.localdate()
        prior_count = bump_daily_counter(GradeDailyCounter, user, reward_day)
        if prior_count == 0:
            receipt = award_verified_xp(
                user, entry, tag_loader=_grade_xp_tags, pool=GRADE_XP_POOL,
                source_label="Recorded a grade", badge_scopes={"skill_xp", "badges"},
            )
        else:
            receipt = {"receipt_id": f"grade:{entry.pk}", "status": "daily_limit", "xp_awarded": 0, "skills": []}
        receipt["reward_day"] = reward_day.isoformat()
        entry.metadata["reward_receipt"] = receipt
        entry.save(update_fields=["metadata"])
        return entry

    @staticmethod
    @transaction.atomic
    def update_grade(user, entry_id, submission):
        if user.role != "child":
            raise PermissionDenied("Only the grade's author can make corrections.")
        get_user_model().objects.select_for_update(no_key=True).get(pk=user.pk)
        entry = get_object_or_404(
            ChronicleEntry.objects.select_for_update(), pk=entry_id, user=user, kind=ChronicleEntry.Kind.GRADE,
        )
        serializer = GradeEntryWriteSerializer(data=submission, partial=True, context={"entry": entry})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        entry.metadata = {**entry.metadata, "grade": data["grade"]}
        entry.title = f"{data['grade']['subject']} · {data['grade']['assessment']}"[:160]
        if "reflection" in data:
            entry.summary = data["reflection"]
        if "occurred_on" in data:
            entry.occurred_on = data["occurred_on"]
            entry.chapter_year = _chapter_year_for(entry.occurred_on)
        if "is_private" in data:
            entry.is_private = data["is_private"]
        entry.save(update_fields=["metadata", "title", "summary", "occurred_on", "chapter_year", "is_private"])
        return entry
