import {
  Award, Star, ListChecks, BookOpen, Sparkles, Hammer, Coins, Gift,
  Cake, Flame, ScrollText, Palette, Footprints, Backpack, PawPrint,
  AlertTriangle, PackageCheck, BellRing, Hourglass, Trophy, Crown,
  Map as MapIcon, Box, Printer, CircleAlert, MessageCircle,
} from 'lucide-react';

// Sensible default routes per notification type. Used as a fallback when
// the backend ``link`` field is empty so a click always takes the user
// somewhere relevant. Mirrors the route table in App.jsx.
//
// ``accent`` is a tone keyword the bell maps to a Tailwind text class —
// keeping it abstract so themes can re-skin without touching this file.
//
// Notification types not listed here render with the generic ``Bell`` and
// no default route. Add a row here when a new ``NotificationType`` lands;
// the notification bell will pick it up automatically.
export const NOTIFICATION_TYPE_META = {
  // Approvals + work products
  badge_earned:            { icon: Award,         accent: 'gold',   route: '/atlas?tab=badges' },
  skill_unlocked:          { icon: Star,          accent: 'gold',   route: '/atlas?tab=skills' },
  milestone_completed:     { icon: Hammer,        accent: 'teal',   route: '/quests?tab=ventures' },
  project_approved:        { icon: Hammer,        accent: 'moss',   route: '/quests?tab=ventures' },
  project_changes:         { icon: Hammer,        accent: 'ember',  route: '/quests?tab=ventures' },
  project_due_soon:        { icon: Hourglass,     accent: 'ember',  route: '/quests?tab=ventures' },

  // Duties (chores)
  chore_submitted:         { icon: ListChecks,    accent: 'teal',   route: '/quests?tab=duties' },
  chore_approved:          { icon: ListChecks,    accent: 'moss',   route: '/quests?tab=duties' },
  chore_rejected:          { icon: ListChecks,    accent: 'ember',  route: '/quests?tab=duties' },
  chore_reminder:          { icon: BellRing,      accent: 'ink',    route: '/quests?tab=duties' },
  chore_proposed:          { icon: ListChecks,    accent: 'teal',   route: '/quests?tab=duties' },
  chore_proposal_approved: { icon: ListChecks,    accent: 'moss',   route: '/quests?tab=duties' },
  chore_proposal_rejected: { icon: ListChecks,    accent: 'ember',  route: '/quests?tab=duties' },

  // Rituals (habits)
  habit_proposed:          { icon: Sparkles,      accent: 'teal',   route: '/quests?tab=rituals' },
  habit_proposal_approved: { icon: Sparkles,      accent: 'moss',   route: '/quests?tab=rituals' },
  habit_proposal_rejected: { icon: Sparkles,      accent: 'ember',  route: '/quests?tab=rituals' },

  // Study (homework)
  homework_created:        { icon: BookOpen,      accent: 'teal',   route: '/quests?tab=study' },
  homework_submitted:      { icon: BookOpen,      accent: 'teal',   route: '/quests?tab=study' },
  homework_approved:       { icon: BookOpen,      accent: 'moss',   route: '/quests?tab=study' },
  homework_rejected:       { icon: BookOpen,      accent: 'ember',  route: '/quests?tab=study' },
  homework_due_soon:       { icon: Hourglass,     accent: 'ember',  route: '/quests?tab=study' },

  // Wages
  timecard_ready:          { icon: Hourglass,     accent: 'teal',   route: '/treasury?tab=wages' },
  timecard_approved:       { icon: Hourglass,     accent: 'moss',   route: '/treasury?tab=wages' },
  payout_recorded:         { icon: Coins,         accent: 'gold',   route: '/treasury?tab=coffers' },

  // Rewards
  redemption_requested:    { icon: Gift,          accent: 'teal',   route: '/treasury?tab=bazaar' },
  exchange_requested:      { icon: Coins,         accent: 'teal',   route: '/treasury?tab=bazaar' },
  exchange_approved:       { icon: Coins,         accent: 'moss',   route: '/treasury?tab=bazaar' },
  exchange_denied:         { icon: Coins,         accent: 'ember',  route: '/treasury?tab=bazaar' },
  low_reward_stock:        { icon: AlertTriangle, accent: 'ember',  route: '/manage' },
  reward_restocked:        { icon: PackageCheck,  accent: 'moss',   route: '/treasury?tab=bazaar' },

  // RPG progression
  streak_milestone:        { icon: Flame,         accent: 'ember',  route: '/sigil' },
  streak_at_risk:          { icon: Flame,         accent: 'ember',  route: '/quests' },
  perfect_day:             { icon: Sparkles,      accent: 'gold',   route: '/sigil' },
  daily_check_in:          { icon: Sparkles,      accent: 'teal',   route: '/sigil' },
  drop_received:           { icon: Backpack,      accent: 'gold',   route: '/treasury?tab=satchel' },
  quest_completed:         { icon: Trophy,        accent: 'gold',   route: '/trials' },
  pet_evolved:             { icon: PawPrint,      accent: 'gold',   route: '/bestiary?tab=companions' },
  mount_bred:              { icon: Crown,         accent: 'gold',   route: '/bestiary?tab=hatchery' },
  expedition_returned:     { icon: MapIcon,       accent: 'gold',   route: '/bestiary?tab=mounts' },

  // Milestones / goals / chronicle / creations
  savings_goal_completed:  { icon: Coins,         accent: 'gold',   route: '/quests?tab=ventures' },
  birthday:                { icon: Cake,          accent: 'gold',   route: '/chronicle?tab=yearbook' },
  chronicle_first_ever:    { icon: ScrollText,    accent: 'teal',   route: '/chronicle?tab=yearbook' },
  journal_reply:           { icon: MessageCircle, accent: 'teal',  route: '/chronicle?tab=journal' },
  comeback_suggested:      { icon: Footprints,    accent: 'teal',   route: '/trials' },
  creation_submitted:      { icon: Palette,       accent: 'teal',   route: '/chronicle?tab=sketchbook' },
  creation_approved:       { icon: Palette,       accent: 'moss',   route: '/chronicle?tab=sketchbook' },
  creation_rejected:       { icon: Palette,       accent: 'ember',  route: '/chronicle?tab=sketchbook' },

  // Forge (3D print requests)
  print_request_submitted: { icon: Box,          accent: 'teal',   route: '/quests?tab=forge' },
  print_request_approved:  { icon: Box,          accent: 'moss',   route: '/quests?tab=forge' },
  print_request_rejected:  { icon: Box,          accent: 'ember',  route: '/quests?tab=forge' },
  print_started:           { icon: Printer,      accent: 'teal',   route: '/quests?tab=forge' },
  print_finished:          { icon: Printer,      accent: 'moss',   route: '/quests?tab=forge' },
  print_failed:            { icon: CircleAlert,  accent: 'ember',  route: '/quests?tab=forge' },
  print_budget_low:        { icon: AlertTriangle, accent: 'ember', route: '/quests?tab=forge' },

  // Misc
  approval_reminder:       { icon: BellRing,      accent: 'ember',  route: '/' },
};

const ACCENT_CLASS = {
  gold:  'text-gold-leaf',
  teal:  'text-sheikah-teal-deep',
  moss:  'text-moss-deep',
  ember: 'text-ember-deep',
  ink:   'text-ink-secondary',
};

export function metaForNotification(notification) {
  const meta = NOTIFICATION_TYPE_META[notification?.notification_type];
  return {
    Icon: meta?.icon || BellRing,
    accentClass: ACCENT_CLASS[meta?.accent] || 'text-ink-secondary',
    defaultRoute: meta?.route || null,
  };
}
