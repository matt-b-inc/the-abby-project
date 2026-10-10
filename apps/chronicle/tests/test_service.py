"""Tests for ChronicleService — all writers are idempotent."""
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.chronicle.models import ChronicleEntry
from apps.chronicle.services import ChronicleService

User = get_user_model()


class RecordFirstTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="kid", role=User.Role.CHILD)

    def test_first_call_creates_entry(self):
        entry = ChronicleService.record_first(
            self.user,
            event_slug="first_bounty_payout",
            title="First bounty payout",
        )
        self.assertIsNotNone(entry)
        self.assertEqual(entry.kind, ChronicleEntry.Kind.FIRST_EVER)
        self.assertEqual(entry.event_slug, "first_bounty_payout")
        self.assertEqual(entry.occurred_on, date.today())
        self.assertEqual(entry.chapter_year, date.today().year if date.today().month >= 8 else date.today().year - 1)

    def test_duplicate_slug_returns_none(self):
        ChronicleService.record_first(self.user, event_slug="first_project_completed", title="x")
        second = ChronicleService.record_first(self.user, event_slug="first_project_completed", title="y")
        self.assertIsNone(second)
        self.assertEqual(ChronicleEntry.objects.filter(event_slug="first_project_completed").count(), 1)

    def test_accepts_custom_occurred_on(self):
        entry = ChronicleService.record_first(
            self.user,
            event_slug="first_milestone_bonus",
            title="First milestone",
            occurred_on=date(2025, 9, 14),
        )
        self.assertEqual(entry.occurred_on, date(2025, 9, 14))
        self.assertEqual(entry.chapter_year, 2025)

    def test_related_tuple_is_written(self):
        entry = ChronicleService.record_first(
            self.user,
            event_slug="first_legendary_badge",
            title="First legendary badge",
            related=("badge", 42),
        )
        self.assertEqual(entry.related_object_type, "badge")
        self.assertEqual(entry.related_object_id, 42)

    def test_metadata_and_icon_slug(self):
        entry = ChronicleService.record_first(
            self.user,
            event_slug="first_exchange_approved",
            title="First exchange",
            icon_slug="coin-stack",
            metadata={"amount": 500},
        )
        self.assertEqual(entry.icon_slug, "coin-stack")
        self.assertEqual(entry.metadata, {"amount": 500})


class RecordBirthdayTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="kid", role=User.Role.CHILD, date_of_birth=date(2011, 4, 21))

    def test_creates_entry_keyed_on_occurred_on(self):
        entry = ChronicleService.record_birthday(self.user, on_date=date(2026, 4, 21))
        self.assertEqual(entry.kind, ChronicleEntry.Kind.BIRTHDAY)
        self.assertEqual(entry.occurred_on, date(2026, 4, 21))
        self.assertEqual(entry.chapter_year, 2025)

    def test_second_call_same_day_returns_existing(self):
        first = ChronicleService.record_birthday(self.user, on_date=date(2026, 4, 21))
        second = ChronicleService.record_birthday(self.user, on_date=date(2026, 4, 21))
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(ChronicleEntry.objects.filter(kind="birthday").count(), 1)

    def test_title_includes_age_when_known(self):
        entry = ChronicleService.record_birthday(self.user, on_date=date(2026, 4, 21))
        self.assertIn("15", entry.title)


class RecordChapterTransitionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="kid", role=User.Role.CHILD)

    def test_chapter_start_writes_entry(self):
        entry = ChronicleService.record_chapter_start(self.user, 2025)
        self.assertEqual(entry.kind, ChronicleEntry.Kind.CHAPTER_START)
        self.assertEqual(entry.chapter_year, 2025)
        self.assertEqual(entry.occurred_on, date(2025, 8, 1))

    def test_chapter_start_is_idempotent(self):
        ChronicleService.record_chapter_start(self.user, 2025)
        ChronicleService.record_chapter_start(self.user, 2025)
        self.assertEqual(ChronicleEntry.objects.filter(kind="chapter_start", chapter_year=2025).count(), 1)

    def test_chapter_end_writes_entry(self):
        entry = ChronicleService.record_chapter_end(self.user, 2025)
        self.assertEqual(entry.kind, ChronicleEntry.Kind.CHAPTER_END)
        self.assertEqual(entry.chapter_year, 2025)
        self.assertEqual(entry.occurred_on, date(2026, 6, 1))

    def test_chapter_end_is_idempotent(self):
        ChronicleService.record_chapter_end(self.user, 2025)
        ChronicleService.record_chapter_end(self.user, 2025)
        self.assertEqual(ChronicleEntry.objects.filter(kind="chapter_end", chapter_year=2025).count(), 1)


class FreezeRecapTests(TestCase):
    def setUp(self):
        from datetime import datetime, timezone

        from apps.projects.models import Project
        from apps.rewards.models import CoinLedger

        self.user = User.objects.create(username="kid", role=User.Role.CHILD)
        # Project.created_by is a required non-null FK; use the same user as creator.
        # Project.completed_at is a DateTimeField — pass timezone-aware datetimes.
        # Seed minimal fixtures that fall inside chapter_year=2025 (Aug 2025 - Jul 2026).
        Project.objects.create(
            assigned_to=self.user,
            created_by=self.user,
            title="Test project A",
            status="completed",
            completed_at=datetime(2025, 10, 15, 12, 0, tzinfo=timezone.utc),
        )
        Project.objects.create(
            assigned_to=self.user,
            created_by=self.user,
            title="Test project B",
            status="completed",
            completed_at=datetime(2026, 2, 1, 12, 0, tzinfo=timezone.utc),
        )
        # CoinLedger.amount is IntegerField — plain int, no Decimal.
        ledger = CoinLedger.objects.create(
            user=self.user,
            amount=50,
            reason=CoinLedger.Reason.ADJUSTMENT,
        )
        # Keep the earned coins in the chapter being tested as the clock moves.
        CoinLedger.objects.filter(pk=ledger.pk).update(
            created_at=datetime(2025, 10, 15, 12, 0, tzinfo=timezone.utc),
        )

    def test_freeze_recap_aggregates_into_metadata(self):
        recap = ChronicleService.freeze_recap(self.user, 2025)
        self.assertEqual(recap.kind, ChronicleEntry.Kind.RECAP)
        self.assertEqual(recap.chapter_year, 2025)
        self.assertEqual(recap.occurred_on, date(2026, 6, 1))
        self.assertEqual(recap.metadata.get("projects_completed"), 2)
        self.assertEqual(recap.metadata.get("coins_earned"), 50)

    def test_freeze_recap_is_idempotent(self):
        first = ChronicleService.freeze_recap(self.user, 2025)
        second = ChronicleService.freeze_recap(self.user, 2025)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(ChronicleEntry.objects.filter(kind="recap").count(), 1)
