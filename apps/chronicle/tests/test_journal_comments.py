"""Family replies, sharing access, and interrupted-send replay behavior."""
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone
from rest_framework.test import APITestCase

from apps.chronicle.models import ChronicleComment, ChronicleEntry
from apps.notifications.models import Notification, NotificationType
from apps.rewards.models import CoinLedger
from config.tests.factories import make_family


class SharedJournalTests(APITestCase):
    def setUp(self):
        self.family = make_family(
            parents=[{"username": "mom", "display_name": "Mom"}],
            children=[{"username": "abby"}, {"username": "sibling"}],
        )
        self.other_family = make_family("Other", parents=[{"username": "outsider"}])
        self.child = self.family.children[0]
        self.parent = self.family.parents[0]
        self.private = self.make_entry(is_private=True)
        self.shared = self.make_entry(day_offset=1, is_private=False)

    def make_entry(self, *, day_offset=0, is_private=True, user=None, kind="journal"):
        day = timezone.localdate() - timedelta(days=day_offset)
        return ChronicleEntry.objects.create(
            user=user or self.child, kind=kind, occurred_on=day,
            chapter_year=day.year if day.month >= 8 else day.year - 1,
            title="Private title" if is_private else "Shared title",
            summary="Private body" if is_private else "Shared body", is_private=is_private,
            metadata={"sensitive": "private metadata"} if is_private else {},
        )

    def replies(self, entry=None):
        return f"/api/chronicle/entries/{(entry or self.shared).pk}/comments/"

    def test_owner_reads_private_and_shared_entries(self):
        self.client.force_authenticate(self.child)
        response = self.client.get("/api/chronicle/")
        self.assertEqual({row["id"] for row in response.data["results"]}, {self.private.pk, self.shared.pk})
        self.assertEqual(self.client.get(f"/api/chronicle/{self.private.pk}/").status_code, 200)

    def test_parent_list_and_summary_exclude_private_content(self):
        self.client.force_authenticate(self.parent)
        for url in ("/api/chronicle/", f"/api/chronicle/summary/?user_id={self.child.pk}"):
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                payload = str(response.data)
                self.assertIn("Shared body", payload)
                for secret in ("Private title", "Private body", "private metadata"):
                    self.assertNotIn(secret, payload)

    def test_parent_private_detail_and_mark_viewed_are_inaccessible(self):
        self.client.force_authenticate(self.parent)
        self.assertEqual(self.client.get(f"/api/chronicle/{self.private.pk}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/chronicle/{self.private.pk}/mark-viewed/").status_code, 404)
        self.private.refresh_from_db()
        self.assertIsNone(self.private.viewed_at)

    def test_owner_changes_historical_sharing_without_rewriting_or_rewarding(self):
        self.client.force_authenticate(self.child)
        with patch("apps.chronicle.services.GameLoopService.on_task_completed") as game_loop:
            response = self.client.patch(
                f"/api/chronicle/{self.shared.pk}/journal/", {"is_private": True}, format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.shared.refresh_from_db()
        self.assertTrue(self.shared.is_private)
        self.assertEqual(self.shared.summary, "Shared body")
        self.assertEqual(self.shared.title, "Shared title")
        game_loop.assert_not_called()
        self.assertFalse(CoinLedger.objects.filter(user=self.child).exists())

    def test_historical_text_edit_remains_locked_even_with_sharing_change(self):
        self.client.force_authenticate(self.child)
        response = self.client.patch(
            f"/api/chronicle/{self.shared.pk}/journal/",
            {"is_private": True, "summary": "Overwrite"}, format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.shared.refresh_from_db()
        self.assertFalse(self.shared.is_private)
        self.assertEqual(self.shared.summary, "Shared body")

    def test_parent_cannot_change_child_sharing(self):
        self.client.force_authenticate(self.parent)
        response = self.client.patch(
            f"/api/chronicle/{self.shared.pk}/journal/", {"is_private": True}, format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_same_day_partial_text_patch_preserves_other_fields(self):
        self.client.force_authenticate(self.child)
        response = self.client.patch(
            f"/api/chronicle/{self.private.pk}/journal/", {"summary": "Updated words"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.private.refresh_from_db()
        self.assertEqual(self.private.title, "Private title")
        self.assertEqual(self.private.summary, "Updated words")
        self.assertTrue(self.private.is_private)

    def test_parent_and_owner_can_converse_with_author_names(self):
        self.client.force_authenticate(self.parent)
        response = self.client.post(self.replies(), {"body": "Proud of your effort!"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["author_name"], "Mom")
        self.assertEqual(response.data["author_role"], "parent")
        self.client.force_authenticate(self.child)
        second = self.client.post(self.replies(), {"body": "Thanks, Mom!"}, format="json")
        self.assertEqual(second.status_code, 201)
        thread = self.client.get(self.replies())
        self.assertEqual([row["body"] for row in thread.data], ["Proud of your effort!", "Thanks, Mom!"])
        self.assertFalse(CoinLedger.objects.filter(user=self.child).exists())

    def test_reply_notifies_other_side_and_preserves_privacy_in_notification_text(self):
        self.client.force_authenticate(self.parent)
        response = self.client.post(self.replies(), {"body": "Sensitive reply body"}, format="json")
        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.get(user=self.child, notification_type=NotificationType.JOURNAL_REPLY)
        self.assertEqual(notification.link, "/chronicle?tab=journal")
        self.assertNotIn("Sensitive reply body", notification.message)
        self.assertNotIn(self.shared.title, notification.title)
        self.client.force_authenticate(self.child)
        self.client.post(self.replies(), {"body": "Thank you"}, format="json")
        self.assertEqual(Notification.objects.filter(
            user=self.parent, notification_type=NotificationType.JOURNAL_REPLY,
        ).count(), 1)
        self.assertFalse(Notification.objects.filter(user=self.other_family.parents[0]).exists())

    def test_private_entry_has_no_comment_surface_even_for_owner(self):
        for caller in (self.child, self.parent):
            self.client.force_authenticate(caller)
            with self.subTest(caller=caller.username):
                self.assertEqual(self.client.get(self.replies(self.private)).status_code, 404)
                self.assertEqual(self.client.post(
                    self.replies(self.private), {"body": "Hello"}, format="json",
                ).status_code, 404)
        self.assertFalse(ChronicleComment.objects.exists())

    def test_sibling_and_other_family_cannot_read_or_reply_to_shared_entry(self):
        for caller in (self.family.children[1], self.other_family.parents[0]):
            self.client.force_authenticate(caller)
            with self.subTest(caller=caller.username):
                self.assertEqual(self.client.get(self.replies()).status_code, 404)
                self.assertEqual(self.client.post(self.replies(), {"body": "Hello"}, format="json").status_code, 404)
                self.assertEqual(self.client.post(f"/api/chronicle/{self.shared.pk}/mark-viewed/").status_code, 404)

    def test_unsharing_preserves_thread_but_blocks_parent_access(self):
        ChronicleComment.objects.create(entry=self.shared, author=self.parent, body="Saved reply")
        self.client.force_authenticate(self.child)
        self.client.patch(f"/api/chronicle/{self.shared.pk}/journal/", {"is_private": True}, format="json")
        self.client.force_authenticate(self.parent)
        self.assertEqual(self.client.get(self.replies()).status_code, 404)
        self.assertEqual(ChronicleComment.objects.filter(entry=self.shared).count(), 1)

    def test_non_journal_entries_cannot_receive_replies(self):
        memory = self.make_entry(kind="manual", is_private=False)
        self.client.force_authenticate(self.parent)
        self.assertEqual(self.client.post(self.replies(memory), {"body": "Hello"}, format="json").status_code, 404)

    def test_blank_and_oversized_replies_are_rejected(self):
        self.client.force_authenticate(self.parent)
        for body in ("", " \n\t ", "x" * 2001):
            with self.subTest(length=len(body)):
                self.assertEqual(self.client.post(self.replies(), {"body": body}, format="json").status_code, 400)
        self.assertFalse(ChronicleComment.objects.exists())

    def test_retry_returns_same_reply_without_another_notification(self):
        self.client.force_authenticate(self.parent)
        payload = {"body": "Keep going!", "client_comment_id": str(uuid.uuid4())}
        first = self.client.post(self.replies(), payload, format="json")
        second = self.client.post(self.replies(), payload, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(ChronicleComment.objects.count(), 1)
        self.assertEqual(Notification.objects.filter(notification_type=NotificationType.JOURNAL_REPLY).count(), 1)

    def test_retry_key_cannot_be_used_for_a_different_message_or_entry(self):
        self.client.force_authenticate(self.parent)
        payload = {"body": "Original", "client_comment_id": str(uuid.uuid4())}
        self.client.post(self.replies(), payload, format="json")
        response = self.client.post(self.replies(), {**payload, "body": "Replacement"}, format="json")
        self.assertEqual(response.status_code, 400)
        another = self.make_entry(day_offset=2, is_private=False)
        response = self.client.post(self.replies(another), payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ChronicleComment.objects.count(), 1)

    def test_invalid_reply_uuid_is_rejected(self):
        self.client.force_authenticate(self.parent)
        response = self.client.post(
            self.replies(), {"body": "Hello", "client_comment_id": "invalid"}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_unauthenticated_read_and_reply_require_login(self):
        self.assertEqual(self.client.get(self.replies()).status_code, 401)
        self.assertEqual(self.client.post(self.replies(), {"body": "Hello"}, format="json").status_code, 401)
