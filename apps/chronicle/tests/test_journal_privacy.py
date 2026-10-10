"""The MCP surface honors the same sharing contract as the iPhone web app."""
from django.test import TestCase
from django.utils import timezone

from apps.chronicle.models import ChronicleEntry
from apps.mcp_server.context import override_user
from apps.mcp_server.errors import MCPNotFoundError
from apps.mcp_server.schemas import GetChronicleSummaryIn, ListChronicleEntriesIn, MarkChronicleViewedIn
from apps.mcp_server.tools.chronicle import get_chronicle_summary, list_chronicle_entries, mark_chronicle_viewed
from config.tests.factories import make_family


class MCPJournalPrivacyTests(TestCase):
    def setUp(self):
        family = make_family(parents=[{"username": "mom"}], children=[{"username": "abby"}])
        self.parent = family.parents[0]
        self.child = family.children[0]
        self.entry = ChronicleEntry.objects.create(
            user=self.child, kind="journal", is_private=True,
            occurred_on=timezone.localdate(), chapter_year=2026,
            title="Secret title", summary="Secret body", metadata={"personal": "Secret metadata"},
        )

    def test_parent_mcp_lists_and_summary_do_not_expose_private_journal(self):
        with override_user(self.parent):
            listing = list_chronicle_entries(ListChronicleEntriesIn(user_id=self.child.pk))
            summary = get_chronicle_summary(GetChronicleSummaryIn(user_id=self.child.pk))
        self.assertEqual(listing["entries"], [])
        self.assertEqual(summary["chapters"], [])

    def test_owner_mcp_list_keeps_private_journal(self):
        with override_user(self.child):
            listing = list_chronicle_entries(ListChronicleEntriesIn())
        self.assertEqual(listing["entries"][0]["summary"], "Secret body")

    def test_parent_mcp_can_read_explicitly_shared_journal(self):
        self.entry.is_private = False
        self.entry.save(update_fields=["is_private"])
        with override_user(self.parent):
            listing = list_chronicle_entries(ListChronicleEntriesIn(user_id=self.child.pk))
        self.assertEqual(listing["entries"][0]["id"], self.entry.pk)

    def test_parent_mcp_mark_viewed_cannot_return_private_journal(self):
        with override_user(self.parent):
            with self.assertRaises(MCPNotFoundError):
                mark_chronicle_viewed(MarkChronicleViewedIn(entry_id=self.entry.pk))
