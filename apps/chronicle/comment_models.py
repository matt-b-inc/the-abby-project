"""Family conversations attached to explicitly shared journal and grade memories."""
from django.conf import settings
from django.db import models

from config.base_models import CreatedAtModel


class ChronicleComment(CreatedAtModel):
    entry = models.ForeignKey(
        "chronicle.ChronicleEntry", on_delete=models.CASCADE, related_name="comments",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chronicle_comments",
    )
    body = models.TextField(max_length=2000)
    client_comment_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["author", "client_comment_id"], name="unique_chronicle_comment_request",
            ),
        ]
