import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPE_META, metaForNotification } from './notifications.constants.js';

// Hand-maintained mirror of apps/notifications/models.py::NotificationType.
// If the backend adds a new value, add it here AND add a row to
// NOTIFICATION_TYPE_META — this test fails otherwise so the bell never
// silently degrades to the generic Bell + no-route fallback for a new type.
const BACKEND_NOTIFICATION_TYPES = [
  'timecard_ready', 'timecard_approved', 'badge_earned', 'project_approved',
  'project_changes', 'payout_recorded', 'skill_unlocked', 'milestone_completed',
  'redemption_requested', 'chore_submitted', 'chore_approved', 'chore_rejected',
  'exchange_requested', 'exchange_approved', 'exchange_denied',
  'project_due_soon', 'chore_reminder', 'approval_reminder',
  'homework_created', 'homework_submitted', 'homework_approved',
  'homework_rejected', 'homework_due_soon', 'streak_milestone', 'streak_at_risk',
  'perfect_day', 'daily_check_in', 'savings_goal_completed', 'birthday',
  'chronicle_first_ever', 'comeback_suggested', 'creation_submitted',
  'creation_approved', 'creation_rejected', 'chore_proposed',
  'habit_proposed', 'chore_proposal_approved', 'habit_proposal_approved',
  'chore_proposal_rejected', 'habit_proposal_rejected', 'quest_completed',
  'drop_received', 'pet_evolved', 'mount_bred', 'low_reward_stock',
  'reward_restocked', 'expedition_returned', 'print_request_submitted',
  'print_request_approved', 'print_request_rejected', 'print_started',
  'print_finished', 'print_failed', 'print_budget_low', 'journal_reply',
];

describe('notification type meta', () => {
  it('has an entry for every backend NotificationType', () => {
    const missing = BACKEND_NOTIFICATION_TYPES.filter(
      (t) => !NOTIFICATION_TYPE_META[t],
    );
    expect(missing).toEqual([]);
  });

  it('falls back to a generic icon and no route for unknown types', () => {
    const meta = metaForNotification({ notification_type: 'something_new' });
    expect(meta.Icon).toBeDefined();
    expect(meta.defaultRoute).toBeNull();
  });

  it('returns a route for badge_earned', () => {
    const meta = metaForNotification({ notification_type: 'badge_earned' });
    expect(meta.defaultRoute).toBe('/atlas?tab=badges');
  });

  it('returns to the journal for a family response', () => {
    expect(metaForNotification({ notification_type: 'journal_reply' }).defaultRoute)
      .toBe('/chronicle?tab=journal');
  });
});
