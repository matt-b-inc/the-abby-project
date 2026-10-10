from collections import defaultdict
from datetime import date

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.chronicle.access import visible_chronicle_entries
from apps.chronicle.grade_serializers import GradeListQuerySerializer
from apps.chronicle.grade_services import GradeRequestConflictError, GradeService
from apps.chronicle.models import ChronicleComment, ChronicleEntry
from apps.chronicle.serializers import (
    ChronicleCommentSerializer,
    ChronicleCommentWriteSerializer,
    ChronicleEntrySerializer,
    JournalEntryWriteSerializer,
    ManualEntryCreateSerializer,
    ManualEntryUpdateSerializer,
)
from apps.chronicle.services import ChronicleService, JournalAlreadyExistsError, JournalRequestConflictError
from apps.notifications.models import NotificationType
from apps.notifications.services import get_display_name, notify, notify_parents
from config.permissions import IsParent
from config.viewsets import (
    RoleFilteredQuerySetMixin, action_declares_permissions, child_not_found_response, get_child_or_404,
)


class ChronicleViewSet(
    RoleFilteredQuerySetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ChronicleEntrySerializer
    permission_classes = [IsAuthenticated]
    role_filter_field = "user"

    def get_permissions(self):
        if action_declares_permissions(self):
            return super().get_permissions()
        # Journal actions are self-authored by children and only need
        # IsAuthenticated — the viewset binds writes to ``request.user``.
        if self.action in ("journal", "journal_update", "journal_today"):
            return [IsAuthenticated()]
        if self.action in ("update", "partial_update", "destroy", "manual"):
            return [IsAuthenticated(), IsParent()]
        return [IsAuthenticated()]

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return ManualEntryUpdateSerializer
        return ChronicleEntrySerializer

    def get_queryset(self):
        # Use normalized integers so accepted values like "2026.0" never
        # reach Django's stricter integer-field conversion as raw strings.
        filters = GradeListQuerySerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        qs = visible_chronicle_entries(self.request.user, ChronicleEntry.objects.all())
        # Parents can further scope with ?user_id= — but only to a child in
        # the same family. The role-filtered queryset already family-scopes,
        # so the explicit user_id filter is layered on top.
        if self.request.user.role == "parent":
            user_id = filters.validated_data.get("user_id")
            if user_id:
                qs = qs.filter(
                    user_id=user_id,
                    user__family=self.request.user.family,
                )
        chapter_year = filters.validated_data.get("chapter_year")
        if chapter_year:
            qs = qs.filter(chapter_year=chapter_year)
        return qs

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        """Group entries by chapter_year into chapter cards."""
        filters = GradeListQuerySerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        target = request.user
        if request.user.role == "parent" and (uid := filters.validated_data.get("user_id")):
            from django.contrib.auth import get_user_model
            target = get_object_or_404(
                get_user_model(),
                pk=uid,
                role="child",
                family=request.user.family,
            )

        entries = list(
            visible_chronicle_entries(request.user, ChronicleEntry.objects.filter(user=target))
            .order_by("-chapter_year", "-occurred_on")
        )

        by_year: dict[int, list] = defaultdict(list)
        for e in entries:
            by_year[e.chapter_year].append(e)

        today = timezone.localdate()
        current_chapter = today.year if today.month >= 8 else today.year - 1

        chapters = []
        for year in sorted(by_year.keys(), reverse=True):
            is_current = (year == current_chapter)
            grade = None
            label = None
            if target.grade_entry_year is not None:
                grade = 9 + (year - target.grade_entry_year)
                if 9 <= grade <= 12:
                    label = {
                        9: "Freshman Year",
                        10: "Sophomore Year",
                        11: "Junior Year",
                        12: "Senior Year",
                    }[grade]
                elif grade < 9:
                    label = f"Grade {grade}"
                else:
                    # Post-HS — max age reached during this chapter (Aug year – Jul year+1).
                    # Aug–Dec birthdays land in calendar year `year`; Jan–Jul land in `year + 1`.
                    if target.date_of_birth:
                        age_in_chapter = year - target.date_of_birth.year
                        if target.date_of_birth.month < 8:
                            age_in_chapter += 1
                        label = f"Age {age_in_chapter} · {year}-{str(year + 1)[-2:]}"
            chapters.append({
                "chapter_year": year,
                "grade": grade,
                "label": label,
                "is_current": is_current,
                "is_post_hs": grade is not None and grade > 12,
                "stats": _stats_for(target, year, by_year[year], is_current),
                "entries": ChronicleEntrySerializer(by_year[year], many=True).data,
            })

        return Response({"chapters": chapters, "current_chapter_year": current_chapter})

    @action(detail=False, methods=["get"], url_path="pending-celebration")
    def pending_celebration(self, request):
        """Return the single unviewed BIRTHDAY entry for today, or 204."""
        today = timezone.localdate()
        entry = (
            ChronicleEntry.objects.filter(
                user=request.user,
                kind=ChronicleEntry.Kind.BIRTHDAY,
                occurred_on=today,
                viewed_at__isnull=True,
            )
            .order_by("-created_at")
            .first()
        )
        if entry is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(ChronicleEntrySerializer(entry).data)

    @action(detail=True, methods=["post"], url_path="mark-viewed")
    def mark_viewed(self, request, pk=None):
        """Set viewed_at=now() if null — idempotent."""
        entry = self.get_object()
        if entry.viewed_at is None:
            entry.viewed_at = timezone.now()
            entry.save(update_fields=["viewed_at"])
        return Response(ChronicleEntrySerializer(entry).data)

    @action(detail=False, methods=["post"], url_path="journal")
    def journal(self, request):
        """Child-authored journal entry. Always writes to request.user.

        Any ``user_id`` in the body is ignored — this endpoint is self-scoped
        so a child can't post a journal entry into another child's chronicle.

        One journal entry per user per local day — a second POST returns
        409 Conflict with the existing entry in the ``existing`` key so
        the frontend modal can flip into edit mode instead of error-toasting.
        """
        serializer = JournalEntryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            entry = ChronicleService.write_journal(
                request.user,
                title=data.get("title", ""),
                summary=data.get("summary", ""),
                is_private=data.get("is_private", True),
                client_entry_id=data.get("client_entry_id"),
            )
        except JournalAlreadyExistsError as exc:
            existing_payload = (
                ChronicleEntrySerializer(exc.entry).data if exc.entry else None
            )
            return Response(
                {
                    "detail": "You already wrote a journal entry today. Edit it instead.",
                    "existing": existing_payload,
                },
                status=status.HTTP_409_CONFLICT,
            )
        except JournalRequestConflictError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(
            ChronicleEntrySerializer(entry).data,
            status=status.HTTP_200_OK if getattr(entry, "_journal_replayed", False) else status.HTTP_201_CREATED,
        )

    @action(
        detail=False,
        methods=["get"],
        url_path="journal/today",
        url_name="journal-today",
    )
    def journal_today(self, request):
        """Return today's journal entry for request.user, or 204 if none.

        Used by the Quick Actions FAB to open the modal in edit mode when
        the child has already written today, avoiding a second-POST 409
        round-trip for the common case.
        """
        entry = ChronicleEntry.objects.filter(
            user=request.user,
            kind=ChronicleEntry.Kind.JOURNAL,
            occurred_on=timezone.localdate(),
        ).first()
        if entry is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(ChronicleEntrySerializer(entry).data)

    @action(
        detail=True,
        methods=["patch"],
        url_path="journal",
        url_name="journal-update",
    )
    def journal_update(self, request, pk=None):
        """Same-day journal edit. Locked to the owner; 403 after midnight."""
        from rest_framework.exceptions import PermissionDenied

        entry = get_object_or_404(ChronicleEntry, pk=pk, user=request.user)
        serializer = JournalEntryWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            updated = ChronicleService.update_journal(
                request.user,
                entry,
                title=data.get("title"),
                summary=data.get("summary"),
                is_private=data.get("is_private"),
            )
        except PermissionDenied as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response(ChronicleEntrySerializer(updated).data)

    @action(detail=False, methods=["get", "post"], url_path="grades")
    def grades(self, request):
        """Capture any number of results; reward the first capture per save day."""
        if request.method == "GET":
            filters = GradeListQuerySerializer(data=request.query_params)
            filters.is_valid(raise_exception=True)
            entries = self.get_queryset().filter(kind=ChronicleEntry.Kind.GRADE)
            page = self.paginate_queryset(entries)
            if page is not None:
                return self.get_paginated_response(ChronicleEntrySerializer(page, many=True).data)
            return Response(ChronicleEntrySerializer(entries, many=True).data)
        try:
            entry = GradeService.write_grade(request.user, request.data)
        except GradeRequestConflictError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(
            ChronicleEntrySerializer(entry).data,
            status=status.HTTP_200_OK if getattr(entry, "_grade_replayed", False) else status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["patch"], url_path="grade", url_name="grade-update")
    def grade_update(self, request, pk=None):
        updated = GradeService.update_grade(request.user, pk, request.data)
        return Response(ChronicleEntrySerializer(updated).data)

    @action(detail=False, methods=["post"], url_path="manual")
    def manual(self, request):
        """Create a manual chronicle entry for a child. Parent-only."""
        serializer = ManualEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user_id = data.pop("user_id")
        target = get_child_or_404(user_id, requesting_user=request.user)
        if target is None:
            return child_not_found_response()
        occurred_on: date = data["occurred_on"]
        chapter_year = occurred_on.year if occurred_on.month >= 8 else occurred_on.year - 1
        entry = ChronicleEntry.objects.create(
            user=target,
            kind=ChronicleEntry.Kind.MANUAL,
            chapter_year=chapter_year,
            **data,
        )
        return Response(ChronicleEntrySerializer(entry).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        if serializer.instance.kind != ChronicleEntry.Kind.MANUAL:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only manual entries are editable.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.kind != ChronicleEntry.Kind.MANUAL:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only manual entries are deletable.")
        instance.delete()


class JournalCommentsView(APIView):
    permission_classes = [IsAuthenticated]

    def _entry(self, request, entry_id, *, lock=False):
        queryset = visible_chronicle_entries(request.user, ChronicleEntry.objects.all()).filter(
            kind__in=(ChronicleEntry.Kind.JOURNAL, ChronicleEntry.Kind.GRADE), is_private=False,
        )
        if lock:
            queryset = queryset.select_for_update()
        return get_object_or_404(queryset, pk=entry_id)

    def get(self, request, entry_id):
        entry = self._entry(request, entry_id)
        comments = entry.comments.select_related("author").all()
        return Response(ChronicleCommentSerializer(comments, many=True).data)

    @transaction.atomic
    def post(self, request, entry_id):
        serializer = ChronicleCommentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # Serialize requests from this author across different entries too,
        # so a replay key cannot create duplicate rows under concurrent sends.
        # NO KEY UPDATE still serializes this author's sends but permits
        # notification/comment foreign-key checks by another family member.
        # A stronger lock can deadlock simultaneous parent/child replies.
        author = type(request.user).objects.select_for_update(no_key=True).get(pk=request.user.pk)
        entry = self._entry(request, entry_id, lock=True)
        request_id = data.get("client_comment_id")
        if request_id:
            existing = ChronicleComment.objects.filter(
                author=author, client_comment_id=request_id,
            ).first()
            if existing:
                if existing.entry_id != entry.pk or existing.body != data["body"]:
                    return Response(
                        {"detail": "This reply request was already used for a different message."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                return Response(ChronicleCommentSerializer(existing).data)
        comment = ChronicleComment.objects.create(entry=entry, author=author, **data)
        # A notification must remain safe if the owner later makes this
        # memory private; include no journal title or reply text in it.
        name = get_display_name(author)
        is_grade = entry.kind == ChronicleEntry.Kind.GRADE
        link = "/chronicle?tab=grades" if is_grade else "/chronicle?tab=journal"
        place = "grades" if is_grade else "journal"
        if author.role == "parent" and author.pk != entry.user_id:
            notify(
                entry.user, f"{name} replied to your memory",
                f"Open your {place} to read the reply.", NotificationType.JOURNAL_REPLY, link=link,
            )
        elif author.role == "child":
            notify_parents(
                f"{name} added a reply", f"Open the shared memory in your {place}.",
                NotificationType.JOURNAL_REPLY, link=link, about_user=entry.user,
            )
        return Response(ChronicleCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


def _stats_for(user, chapter_year, entries, is_current):
    """For past chapters, read frozen RECAP metadata; for current, compute live."""
    for e in entries:
        if e.kind == ChronicleEntry.Kind.RECAP:
            return e.metadata
    if not is_current:
        return {}
    # Live stats for the in-progress current chapter.
    from django.db.models import Sum

    from apps.projects.models import Project
    from apps.rewards.models import CoinLedger

    start = date(chapter_year, 8, 1)
    end = date(chapter_year + 1, 7, 31)
    return {
        "projects_completed": Project.objects.filter(
            assigned_to=user,
            status="completed",
            completed_at__date__range=(start, end),
        ).count(),
        "coins_earned": int(
            CoinLedger.objects.filter(
                user=user,
                created_at__date__range=(start, end),
                amount__gt=0,
            ).aggregate(t=Sum("amount"))["t"] or 0
        ),
    }
