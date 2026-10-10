from django.conf import settings
from django.db import models
from django.db.models import Index, Q, UniqueConstraint

from config.base_models import CreatedAtModel, DailyCounterModel


class ChronicleEntry(CreatedAtModel):
    class Kind(models.TextChoices):
        BIRTHDAY      = "birthday", "Birthday"
        CHAPTER_START = "chapter_start", "Chapter start"
        CHAPTER_END   = "chapter_end", "Chapter end"
        FIRST_EVER    = "first_ever", "First ever"
        MILESTONE     = "milestone", "Milestone"
        RECAP         = "recap", "Recap"
        MANUAL        = "manual", "Manual"
        JOURNAL       = "journal", "Journal"
        CREATION      = "creation", "Creation"
        GRADE         = "grade", "Grade"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="chronicle_entries",
    )
    kind = models.CharField(max_length=32, choices=Kind.choices)
    occurred_on = models.DateField()
    chapter_year = models.PositiveIntegerField(
        help_text="August-starting year the chapter covers (e.g. 2025 = Aug 2025–Jul 2026)."
    )
    title = models.CharField(max_length=160)
    summary = models.TextField(blank=True)
    icon_slug = models.CharField(max_length=80, blank=True)
    event_slug = models.CharField(max_length=80, blank=True)
    related_object_type = models.CharField(max_length=40, blank=True)
    related_object_id = models.PositiveIntegerField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    client_entry_id = models.UUIDField(null=True, blank=True, editable=False)
    viewed_at = models.DateTimeField(null=True, blank=True)
    is_private = models.BooleanField(
        default=False,
        help_text=(
            "Private journal and grade entries are readable only by their author. "
            "The author can explicitly share an entry with family."
        ),
    )

    class Meta:
        ordering = ["-occurred_on", "-created_at"]
        indexes = [
            Index(fields=["user", "chapter_year"]),
            Index(fields=["user", "event_slug"]),
            Index(fields=["user", "viewed_at"]),
        ]
        constraints = [
            UniqueConstraint(
                fields=["user", "client_entry_id"],
                name="unique_chronicle_client_entry_per_user",
            ),
            UniqueConstraint(
                fields=["user", "event_slug"],
                condition=Q(kind="first_ever"),
                name="unique_first_ever_per_user",
            ),
            # One journal entry per user per local day. Enforces the
            # "write once a day" design rule at the DB layer so a race
            # condition between two concurrent POSTs can't slip past the
            # service-layer pre-check.
            UniqueConstraint(
                fields=["user", "occurred_on"],
                condition=Q(kind="journal"),
                name="unique_journal_per_user_per_day",
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover — string form
        return f"{self.user_id}·{self.kind}·{self.title}"


class GradeDailyCounter(DailyCounterModel):
    """Count grade captures by save date; corrections cannot reset eligibility."""

    class Meta(DailyCounterModel.Meta):
        pass


from .comment_models import ChronicleComment  # noqa: E402,F401
