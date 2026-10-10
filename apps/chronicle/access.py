"""Shared Chronicle read policy for REST and MCP callers."""
from django.db.models import Q

from config.viewsets import filter_queryset_by_role


def visible_chronicle_entries(user, queryset):
    """Owners keep their memories; parents see shared journals and grades."""
    queryset = filter_queryset_by_role(user, queryset, "user")
    if user.role == "parent":
        queryset = queryset.exclude(
            Q(kind__in=("journal", "grade"), is_private=True) & ~Q(user=user),
        )
    return queryset
