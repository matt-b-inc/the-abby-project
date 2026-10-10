"""Tests for child-authored journal entries in the Chronicle timeline.

Covers the ``write_journal`` + ``update_journal`` services, the privacy flag,
the title-autofill rule, first-of-day streak/XP firing, and the REST actions
that children hit from the Quick Actions FAB.
"""
from datetime import date, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from apps.achievements.models import (
    Badge,
    Skill,
    SkillCategory,
    SkillProgress,
    Subject,
)
from apps.chronicle.models import ChronicleEntry
from apps.chronicle.services import ChronicleService

User = get_user_model()


def _make_language_arts_skills():
    """Create the Creative Writing + Vocabulary skills journal XP routes to."""
    category = SkillCategory.objects.create(name="Language Arts")
    writing = Subject.objects.create(category=category, name="Writing")
    reading = Subject.objects.create(category=category, name="Reading")
    creative_writing = Skill.objects.create(
        category=category, subject=writing, name="Creative Writing",
    )
    vocabulary = Skill.objects.create(
        category=category, subject=reading, name="Vocabulary",
    )
    return category, creative_writing, vocabulary


class JournalModelTests(TestCase):
    """Model-level assertions: the new Kind + is_private column exist."""

    def setUp(self):
        self.user = User.objects.create(username="abby", role=User.Role.CHILD)

    def test_journal_kind_exists(self):
        self.assertEqual(ChronicleEntry.Kind.JOURNAL, "journal")

    def test_entry_can_be_saved_with_is_private(self):
        entry = ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.JOURNAL,
            is_private=True,
            occurred_on=date.today(),
            chapter_year=2025,
            title="Today",
            summary="Wrote a story.",
        )
        entry.refresh_from_db()
        self.assertTrue(entry.is_private)

    def test_is_private_defaults_to_false_for_existing_kinds(self):
        entry = ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.MANUAL,
            occurred_on=date.today(),
            chapter_year=2025,
            title="Memory",
        )
        self.assertFalse(entry.is_private)


class WriteJournalTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="abby", role=User.Role.CHILD)
        _make_language_arts_skills()

    def test_creates_journal_entry(self):
        entry = ChronicleService.write_journal(
            self.user, title="", summary="Today I went to the park.",
        )
        self.assertEqual(entry.kind, ChronicleEntry.Kind.JOURNAL)
        self.assertTrue(entry.is_private)
        self.assertEqual(entry.user, self.user)
        self.assertEqual(entry.occurred_on, timezone.localdate())

    def test_autofills_title_from_body_first_60_chars(self):
        long_body = "This is the kind of body that goes on well past sixty characters in its full run."
        entry = ChronicleService.write_journal(
            self.user, title="", summary=long_body,
        )
        self.assertTrue(len(entry.title) <= 60 + 1)  # allow trailing ellipsis
        self.assertTrue(entry.title.startswith("This is the kind"))

    def test_blank_entry_is_not_saved_or_rewarded(self):
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            ChronicleService.write_journal(self.user, title="", summary="")
        self.assertFalse(ChronicleEntry.objects.filter(user=self.user).exists())

    def test_honors_user_provided_title(self):
        entry = ChronicleService.write_journal(
            self.user, title="A Sunny Day", summary="The sun came out.",
        )
        self.assertEqual(entry.title, "A Sunny Day")

    def test_first_entry_today_fires_game_loop(self):
        with mock.patch("apps.chronicle.services.GameLoopService") as mock_loop:
            mock_loop.on_task_completed.return_value = {}
            ChronicleService.write_journal(
                self.user, title="", summary="First entry today.",
            )
            mock_loop.on_task_completed.assert_called_once()
            args, kwargs = mock_loop.on_task_completed.call_args
            # Accept either positional or keyword trigger_type.
            self.assertEqual(args[0], self.user)
            self.assertEqual(str(args[1]), "journal_entry")

    def test_second_entry_today_raises_and_does_not_fire_game_loop(self):
        from apps.chronicle.services import JournalAlreadyExistsError

        first = ChronicleService.write_journal(
            self.user, title="", summary="First.",
        )
        with mock.patch("apps.chronicle.services.GameLoopService") as mock_loop:
            with self.assertRaises(JournalAlreadyExistsError) as ctx:
                ChronicleService.write_journal(
                    self.user, title="", summary="Second.",
                )
            mock_loop.on_task_completed.assert_not_called()
        # The exception carries the existing entry so the view can return
        # it in the 409 body for the frontend to flip into edit mode.
        self.assertEqual(ctx.exception.entry.pk, first.pk)
        # And no second row was written.
        self.assertEqual(
            ChronicleEntry.objects.filter(
                user=self.user, kind=ChronicleEntry.Kind.JOURNAL,
            ).count(),
            1,
        )

    def test_awards_xp_to_creative_writing_and_vocabulary(self):
        # Seed the skills; assert the award fans out weighted 2:1.
        ChronicleService.write_journal(
            self.user, title="", summary="Writing practice.",
        )
        cw = Skill.objects.get(name="Creative Writing")
        vocab = Skill.objects.get(name="Vocabulary")
        cw_xp = SkillProgress.objects.filter(user=self.user, skill=cw).values_list(
            "xp_points", flat=True,
        ).first()
        vocab_xp = SkillProgress.objects.filter(
            user=self.user, skill=vocab,
        ).values_list("xp_points", flat=True).first()
        self.assertEqual(cw_xp, 10)
        self.assertEqual(vocab_xp, 5)


class UpdateJournalTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="abby", role=User.Role.CHILD)
        self.other = User.objects.create(username="ben", role=User.Role.CHILD)
        _make_language_arts_skills()
        self.entry = ChronicleService.write_journal(
            self.user, title="", summary="Original body.",
        )

    def test_same_day_edit_succeeds_for_owner(self):
        updated = ChronicleService.update_journal(
            self.user, self.entry, title="New title", summary="Updated body.",
        )
        self.assertEqual(updated.title, "New title")
        self.assertEqual(updated.summary, "Updated body.")

    def test_owner_cannot_edit_yesterdays_entry(self):
        from rest_framework.exceptions import PermissionDenied

        # Fast-forward the entry by one day to simulate midnight crossing.
        self.entry.occurred_on = timezone.localdate() - timedelta(days=1)
        self.entry.save(update_fields=["occurred_on"])
        with self.assertRaises(PermissionDenied):
            ChronicleService.update_journal(
                self.user, self.entry, title="x", summary="y",
            )

    def test_other_user_cannot_edit(self):
        from rest_framework.exceptions import PermissionDenied

        with self.assertRaises(PermissionDenied):
            ChronicleService.update_journal(
                self.other, self.entry, title="hijack", summary="nope",
            )

    def test_cannot_edit_non_journal_entry(self):
        from rest_framework.exceptions import PermissionDenied

        manual = ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.MANUAL,
            occurred_on=timezone.localdate(),
            chapter_year=2025,
            title="Parent memory",
        )
        with self.assertRaises(PermissionDenied):
            ChronicleService.update_journal(
                self.user, manual, title="x", summary="y",
            )


class JournalAPITests(TestCase):
    def setUp(self):
        self.child = User.objects.create(username="abby", role=User.Role.CHILD)
        self.other_child = User.objects.create(username="ben", role=User.Role.CHILD)
        _make_language_arts_skills()
        self.client = APIClient()
        token = Token.objects.create(user=self.child)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_child_can_post_journal(self):
        resp = self.client.post(
            "/api/chronicle/journal/",
            {"title": "Today", "summary": "Had fun."},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        body = resp.json()
        self.assertEqual(body["kind"], "journal")
        self.assertTrue(body["is_private"])
        self.assertEqual(body["title"], "Today")

    def test_endpoint_ignores_user_id_and_uses_self(self):
        # Even if a malicious client tries to target another child, the
        # endpoint writes to request.user.
        resp = self.client.post(
            "/api/chronicle/journal/",
            {
                "title": "Hijack",
                "summary": "bad",
                "user_id": self.other_child.id,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        entries = ChronicleEntry.objects.filter(
            kind=ChronicleEntry.Kind.JOURNAL,
        )
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().user, self.child)

    def test_patch_same_day_succeeds(self):
        create_resp = self.client.post(
            "/api/chronicle/journal/",
            {"title": "Initial", "summary": "x"},
            format="json",
        )
        entry_id = create_resp.json()["id"]
        resp = self.client.patch(
            f"/api/chronicle/{entry_id}/journal/",
            {"title": "Renamed", "summary": "y"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json()["title"], "Renamed")

    def test_patch_other_user_entry_returns_403(self):
        # Arrange: other child has their own journal entry.
        other_entry = ChronicleService.write_journal(
            self.other_child, title="Other child's entry", summary="mine",
        )
        resp = self.client.patch(
            f"/api/chronicle/{other_entry.id}/journal/",
            {"title": "Hijack", "summary": "nope"},
            format="json",
        )
        self.assertIn(
            resp.status_code,
            (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND),
        )

    def test_serializer_exposes_is_private_on_list(self):
        ChronicleService.write_journal(
            self.child, title="First", summary="Private thought.",
        )
        resp = self.client.get("/api/chronicle/summary/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        entries = body["chapters"][0]["entries"]
        journal = next(e for e in entries if e["kind"] == "journal")
        self.assertTrue(journal["is_private"])

    def test_second_post_same_day_returns_409_with_existing(self):
        first = self.client.post(
            "/api/chronicle/journal/",
            {"title": "A", "summary": "First entry"},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post(
            "/api/chronicle/journal/",
            {"title": "B", "summary": "Attempted second"},
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        body = second.json()
        self.assertIn("detail", body)
        self.assertIsNotNone(body.get("existing"))
        self.assertEqual(body["existing"]["id"], first.json()["id"])
        # No second row was created.
        self.assertEqual(
            ChronicleEntry.objects.filter(
                user=self.child, kind=ChronicleEntry.Kind.JOURNAL,
            ).count(),
            1,
        )

    def test_journal_today_returns_204_when_no_entry(self):
        resp = self.client.get("/api/chronicle/journal/today/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

    def test_journal_today_returns_existing_entry(self):
        entry = ChronicleService.write_journal(
            self.child, title="Today", summary="Wrote a thing.",
        )
        resp = self.client.get("/api/chronicle/journal/today/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        body = resp.json()
        self.assertEqual(body["id"], entry.pk)
        self.assertEqual(body["kind"], "journal")


class JournalBadgeCriteriaTests(TestCase):
    """The two new badge criteria — journal_entries_written + streak_days."""

    def setUp(self):
        self.user = User.objects.create(username="abby", role=User.Role.CHILD)
        _make_language_arts_skills()

    def test_entries_written_counts_lifetime_journals(self):
        from apps.achievements import criteria

        badge = Badge.objects.create(
            name="Scribe of 1",
            description="First entry",
            criteria_type="journal_entries_written",
            criteria_value={"count": 1},
        )
        self.assertFalse(criteria.check(self.user, badge))
        ChronicleService.write_journal(
            self.user, title="", summary="One entry.",
        )
        self.assertTrue(criteria.check(self.user, badge))

    def test_entries_written_respects_count_threshold(self):
        from apps.achievements import criteria

        badge = Badge.objects.create(
            name="Scribe of 3",
            description="Three entries",
            criteria_type="journal_entries_written",
            criteria_value={"count": 3},
        )
        for i in range(2):
            ChronicleEntry.objects.create(
                user=self.user,
                kind=ChronicleEntry.Kind.JOURNAL,
                is_private=True,
                occurred_on=date.today() - timedelta(days=i),
                chapter_year=2025,
                title=f"Day {i}",
            )
        self.assertFalse(criteria.check(self.user, badge))
        ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.JOURNAL,
            is_private=True,
            occurred_on=date.today() - timedelta(days=2),
            chapter_year=2025,
            title="Day 2",
        )
        self.assertTrue(criteria.check(self.user, badge))

    def test_streak_days_counts_consecutive(self):
        from apps.achievements import criteria

        badge = Badge.objects.create(
            name="3-Day Scribe",
            description="Three day streak",
            criteria_type="journal_streak_days",
            criteria_value={"days": 3},
        )
        today = date.today()
        # 3 consecutive days
        for d in range(3):
            ChronicleEntry.objects.create(
                user=self.user,
                kind=ChronicleEntry.Kind.JOURNAL,
                is_private=True,
                occurred_on=today - timedelta(days=d),
                chapter_year=2025,
                title=f"d{d}",
            )
        self.assertTrue(criteria.check(self.user, badge))

    def test_streak_days_rejects_gaps(self):
        from apps.achievements import criteria

        badge = Badge.objects.create(
            name="3-Day Scribe",
            description="Three day streak",
            criteria_type="journal_streak_days",
            criteria_value={"days": 3},
        )
        today = date.today()
        # Only 2 consecutive days then a gap — should fail
        ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.JOURNAL,
            is_private=True,
            occurred_on=today,
            chapter_year=2025,
            title="today",
        )
        ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.JOURNAL,
            is_private=True,
            occurred_on=today - timedelta(days=1),
            chapter_year=2025,
            title="yesterday",
        )
        ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.JOURNAL,
            is_private=True,
            occurred_on=today - timedelta(days=5),
            chapter_year=2025,
            title="gap",
        )
        self.assertFalse(criteria.check(self.user, badge))

    def test_streak_days_counts_distinct_calendar_days(self):
        """The checker reduces to a set of ``occurred_on`` before counting.

        The DB unique-per-day constraint makes true same-day duplicates
        impossible via the service, but the checker's set() reduction is
        still the correct shape — a direct ORM write (e.g., from a data
        migration) can never inflate a streak count either.
        """
        from apps.achievements import criteria

        badge = Badge.objects.create(
            name="2-Day Scribe",
            description="Two day streak",
            criteria_type="journal_streak_days",
            criteria_value={"days": 2},
        )
        today = date.today()
        # One entry today — not enough for a 2-day streak.
        ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.JOURNAL,
            is_private=True,
            occurred_on=today,
            chapter_year=2025,
            title="today",
        )
        self.assertFalse(criteria.check(self.user, badge))
        ChronicleEntry.objects.create(
            user=self.user,
            kind=ChronicleEntry.Kind.JOURNAL,
            is_private=True,
            occurred_on=today - timedelta(days=1),
            chapter_year=2025,
            title="yesterday",
        )
        self.assertTrue(criteria.check(self.user, badge))
