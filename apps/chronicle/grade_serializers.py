"""Validate and normalize school results independently of reward eligibility."""
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers


GRADE_LETTERS = ("A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "NP", "I")
GRADE_VALUE_FIELDS = {"score", "possible", "letter"}


def _local_today():
    return timezone.localdate()


def canonical_decimal(value):
    """Use JSON-safe decimal strings without rounding or redundant zeros."""
    value = Decimal(value)
    if not value:
        return "0"
    rendered = format(value, "f")
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered


class GradeEntryWriteSerializer(serializers.Serializer):
    subject = serializers.CharField(max_length=80)
    assessment = serializers.CharField(max_length=80)
    grade_format = serializers.ChoiceField(choices=("percentage", "points", "letter"))
    score = serializers.DecimalField(
        max_digits=18, decimal_places=6, min_value=Decimal("0"), required=False, allow_null=True,
    )
    possible = serializers.DecimalField(max_digits=18, decimal_places=6, required=False, allow_null=True)
    letter = serializers.ChoiceField(choices=GRADE_LETTERS, required=False, allow_blank=True, allow_null=True)
    reflection = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
    occurred_on = serializers.DateField(required=False, default=_local_today)
    is_private = serializers.BooleanField(required=False, default=True)
    client_entry_id = serializers.UUIDField()

    def validate_occurred_on(self, day):
        if day > timezone.localdate():
            raise serializers.ValidationError("A grade's date cannot be in the future.")
        return day

    def validate(self, data):
        entry = self.context.get("entry")
        if entry is not None and "client_entry_id" in data:
            raise serializers.ValidationError({"client_entry_id": "The original save ID cannot be changed."})
        previous = entry.metadata.get("grade", {}) if entry is not None else {}
        # A format switch begins with only the subject/assessment; old points
        # or letters must not accidentally become a new format's result.
        switched = "grade_format" in data and data["grade_format"] != previous.get("grade_format")
        merged = {
            key: value for key, value in previous.items()
            if not switched or key not in GRADE_VALUE_FIELDS
        }
        merged.update({key: value for key, value in data.items() if key in {
            "subject", "assessment", "grade_format", *GRADE_VALUE_FIELDS,
        }})
        grade_format = merged.get("grade_format")
        active = {
            "percentage": {"score"}, "points": {"score", "possible"}, "letter": {"letter"},
        }.get(grade_format, set())
        errors = {}
        for key in GRADE_VALUE_FIELDS - active:
            if data.get(key) not in (None, ""):
                errors[key] = f"This field is not used for {grade_format} grades."
        for key in ("subject", "assessment", "grade_format", *active):
            if merged.get(key) in (None, ""):
                errors[key] = "This field is required."
        if errors:
            raise serializers.ValidationError(errors)
        if grade_format == "percentage" and Decimal(merged["score"]) > 100:
            raise serializers.ValidationError({"score": "A percentage must be between 0 and 100."})
        if grade_format == "points" and Decimal(merged["possible"]) <= 0:
            raise serializers.ValidationError({"possible": "Possible points must be greater than zero."})
        normalized = {key: merged[key] for key in ("subject", "assessment", "grade_format", *active)}
        for key in active & {"score", "possible"}:
            normalized[key] = canonical_decimal(normalized[key])
        data["grade"] = normalized
        return data


class GradeListQuerySerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=False, min_value=1, max_value=2**63 - 1)
    chapter_year = serializers.IntegerField(required=False, min_value=1, max_value=9999)
