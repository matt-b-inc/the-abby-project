import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import PageShell from '../components/layout/PageShell';
import * as Sentry from '@sentry/react';
import {
  completeChore, getActiveQuest, getCoinSummaryByDay, getRecentDrops,
  getStable, logHabitTap,
} from '../api';
import { hapticTap } from '../utils/haptics';
import { useApi } from '../hooks/useApi';
import { formatCurrency } from '../utils/format';
import ParchmentCard from '../components/journal/ParchmentCard';
import QuestLogEntry from '../components/journal/QuestLogEntry';
import DeckleDivider from '../components/journal/DeckleDivider';
import RuneBadge from '../components/journal/RuneBadge';
import HeroPrimaryCard from '../components/dashboard/HeroPrimaryCard';
import VitalPipStrip from '../components/dashboard/VitalPipStrip';
import AccordionSection from '../components/dashboard/AccordionSection';
import DailyChallengeCard from '../components/dashboard/DailyChallengeCard';
import SinceLastVisitCard from '../components/dashboard/SinceLastVisitCard';
import StreakAtRiskBanner from '../components/dashboard/StreakAtRiskBanner';
import HomeworkSubmitSheet from '../components/HomeworkSubmitSheet';
import IconButton from '../components/IconButton';
import PageHeader from '../components/layout/PageHeader';
import ProgressBar from '../components/ProgressBar';
import Button from '../components/Button';
import ErrorAlert from '../components/ErrorAlert';
import ScrollRail from '../components/ScrollRail';
import Sparkline from '../components/Sparkline';
import { CoinIcon } from '../components/icons/JournalIcons';
import { BookOpen, Sparkles, Flame, Target, X, Compass, Award } from 'lucide-react';
import { RARITY_RING_COLORS } from '../constants/colors';
import { staggerChildren, staggerItem, inkBleed } from '../motion/variants';
import { formatWeekdayDate, mapProjectTone } from './_dashboardShared';
import MeadowVisitCard from './meadow/MeadowVisitCard';

const VISIBLE_LOG_CAP = 5;

// Map NextAction.icon names to lucide-react components for the quest log row
// glyph. Falls back to Sparkles if the backend ships an unknown name.
const ICON_MAP = { BookOpen, Sparkles, Flame };

// Map NextAction.kind to the kind-tag label shown in the QuestLogEntry.
const KIND_LABEL = { homework: 'Study', chore: 'Duty', habit: 'Ritual' };

/**
 * Group the next_actions feed into the three quest-log sections. The
 * backend already sorts by score DESC with deterministic tie-breaking, so
 * each section preserves the global ranking.
 */
function buildQuestLogFromActions(next_actions = []) {
  const study = [];
  const duty = [];
  const ritual = [];
  for (const a of next_actions) {
    if (a.kind === 'homework') study.push(a);
    else if (a.kind === 'chore') duty.push(a);
    else if (a.kind === 'habit') ritual.push(a);
  }
  return { study, duty, ritual };
}

export default function ChildDashboard({ data, reload }) {
  const { data: recentDrops, error: dropsError, reload: reloadDrops } = useApi(getRecentDrops);
  const { data: stableData } = useApi(getStable);
  const { data: activeQuest } = useApi(getActiveQuest);
  const { data: coinSummary } = useApi(getCoinSummaryByDay);
  const navigate = useNavigate();
  const [logExpanded, setLogExpanded] = useState(false);
  const [activeHomework, setActiveHomework] = useState(null);

  const {
    active_timer, current_balance, coin_balance, this_week, active_projects,
    recent_badges, savings_goals, rpg, next_actions = [], since_last_visit,
  } = data || {};

  const activePet = stableData?.pets?.find((p) => p.is_active) || null;

  // Audit M8: surface fast-action errors instead of silently swallowing
  // them. Pre-fix, ``.catch(() => {})`` masked 400s ("you've already
  // tapped this habit today"), 403s ("locked"), and 5xxs alike — the
  // user clicked, nothing happened, and operators had no signal.
  // ``actionError`` flips into a soft inline banner; everything also
  // hits Sentry so prod regressions are visible.
  const [actionError, setActionError] = useState('');
  const [completedIds, setCompletedIds] = useState(new Set());
  const handleActionError = useCallback((err, label) => {
    Sentry.captureException(err, { extra: { handler: label } });
    setActionError(err?.response?.error || err?.message || `${label} failed.`);
  }, []);

  const handleCompleteChore = useCallback(
    (id) => {
      hapticTap();
      setCompletedIds((prev) => new Set(prev).add(`chore-${id}`));
      return completeChore(id)
        .then(reload)
        .catch((err) => {
          setCompletedIds((prev) => {
            const next = new Set(prev);
            next.delete(`chore-${id}`);
            return next;
          });
          handleActionError(err, 'Mark duty done');
        });
    },
    [reload, handleActionError],
  );
  const handleTapHabit = useCallback(
    (id) => {
      hapticTap();
      setCompletedIds((prev) => new Set(prev).add(`habit-${id}`));
      return logHabitTap(id, 1)
        .then(reload)
        .catch((err) => {
          setCompletedIds((prev) => {
            const next = new Set(prev);
            next.delete(`habit-${id}`);
            return next;
          });
          handleActionError(err, 'Tap ritual');
        });
    },
    [reload, handleActionError],
  );
  // Open the homework submit sheet inline. We accept either a plain id
  // (from the hero's NextAction handler) or an action object (from the
  // quest log row); the sheet only needs `{id, title}`.
  const handleOpenHomework = (idOrAction) => {
    if (idOrAction && typeof idOrAction === 'object') {
      setActiveHomework(idOrAction);
    } else {
      const match = (next_actions || []).find(
        (a) => a.kind === 'homework' && a.id === idOrAction,
      );
      setActiveHomework(match || { id: idOrAction });
    }
  };

  const { study, duty, ritual } = buildQuestLogFromActions(next_actions);
  const sections = [
    { key: 'study', label: 'Study', tone: 'royal', actions: study },
    { key: 'duty', label: 'Duty', tone: 'moss', actions: duty },
    { key: 'ritual', label: 'Ritual', tone: 'gold', actions: ritual },
  ].filter((s) => s.actions.length > 0);

  const totalLogCount = study.length + duty.length + ritual.length;
  const visibleSections = (() => {
    if (logExpanded) return sections;
    let remaining = VISIBLE_LOG_CAP;
    const out = [];
    for (const s of sections) {
      if (remaining <= 0) break;
      const slice = s.actions.slice(0, remaining);
      remaining -= slice.length;
      out.push({ ...s, actions: slice });
    }
    return out;
  })();

  const onActionClick = (a) => {
    if (a.kind === 'homework') return handleOpenHomework(a);
    if (a.kind === 'chore') return handleCompleteChore(a.id);
    if (a.kind === 'habit') return handleTapHabit(a.id);
  };

  const { weekday, dateStr } = formatWeekdayDate();

  return (
    <PageShell variants={inkBleed}>
      <PageHeader
        title="Today's Entry"
        kicker={`${weekday} · ${dateStr} · to be inked before nightfall`}
      />

      <MeadowVisitCard />

      {actionError && (
        // Audit M8: surface fast-action errors. Auto-dismissable so a
        // stale message doesn't hang around when the next action succeeds.
        <div
          role="alert"
          className="rounded-lg border border-rose/40 bg-rose/10 px-4 py-2 text-body text-rose flex items-start gap-3"
        >
          <span className="flex-1">{actionError}</span>
          <IconButton
            size="sm"
            onClick={() => setActionError('')}
            aria-label="Dismiss error"
            className="text-rose/70! hover:text-rose!"
          >
            <X size={16} />
          </IconButton>
        </div>
      )}

      <SinceLastVisitCard summary={since_last_visit} />

      <StreakAtRiskBanner rpg={rpg} />

      <VitalPipStrip
        coinBalance={coin_balance}
        loginStreak={rpg?.login_streak}
        level={rpg?.level}
        activePet={activePet}
      />

      <HeroPrimaryCard
        role="child"
        ctx={{
          activeTimer: active_timer,
          rpg,
          nextAction: next_actions[0] || null,
          activeQuest,
          weekday, dateStr,
          onCompleteChore: handleCompleteChore,
          onTapHabit: handleTapHabit,
          onOpenHomework: handleOpenHomework,
        }}
      />

      <DailyChallengeCard />

      {totalLogCount === 0 && !active_projects?.length && !savings_goals?.length && !recent_badges?.length && (
        <ParchmentCard tone="bright">
          <div className="text-center py-6 px-4 space-y-4">
            <div className="text-4xl">🗺️</div>
            <h2 className="font-display italic text-2xl text-ink-primary">
              Your adventure begins here
            </h2>
            <p className="font-script text-ink-secondary text-body max-w-md mx-auto">
              Once your parent sets up duties, study, or ventures, they&apos;ll
              appear right here for you to tackle.
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => navigate('/quests')}>
                Explore quests
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/bestiary')}>
                Visit bestiary
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/treasury?tab=bazaar')}>
                Browse the bazaar
              </Button>
            </div>
          </div>
        </ParchmentCard>
      )}

      {totalLogCount > 0 && (
        <section>
          <div className="mb-2 flex justify-end">
            <RuneBadge tone="teal" size="sm">{totalLogCount}</RuneBadge>
          </div>
          <ParchmentCard flourish>
            <div className="space-y-3">
              {visibleSections.map((section, idx) => (
                <div key={section.key}>
                  {idx > 0 && (
                    <div className="border-t border-ink-page-shadow/40 pt-3 mt-1" aria-hidden="true" />
                  )}
                  <div className="flex items-center gap-2 font-script text-caption text-ink-whisper uppercase tracking-wider mb-1">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        { royal: 'bg-royal', moss: 'bg-moss', gold: 'bg-gold-leaf' }[section.tone] || 'bg-ink-whisper'
                      }`}
                      aria-hidden="true"
                    />
                    {section.label}
                  </div>
                  <ul className="space-y-2">
                    {section.actions.map((a) => {
                      const Icon = ICON_MAP[a.icon] || Sparkles;
                      const meta = a.subtitle;
                      let reward = null;
                      if (a.reward) {
                        const parts = [];
                        if (a.reward.money && a.reward.money !== '0.00') parts.push(`$${a.reward.money}`);
                        if (a.reward.coins) parts.push(`${a.reward.coins}🪙`);
                        if (parts.length) reward = parts.join(' · ');
                      }
                      return (
                        <QuestLogEntry
                          key={`${a.kind}-${a.id}`}
                          title={a.title}
                          meta={meta}
                          reward={reward}
                          status={completedIds.has(`${a.kind}-${a.id}`) ? 'done' : 'pending'}
                          kind={KIND_LABEL[a.kind] || section.label}
                          tone={a.tone || section.tone}
                          icon={<Icon size={16} />}
                          onAction={() => onActionClick(a)}
                        />
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {totalLogCount > VISIBLE_LOG_CAP && (
              <div className="mt-3">
                <Button variant="ghost" size="sm" onClick={() => setLogExpanded((v) => !v)}>
                  {logExpanded ? 'Show fewer' : `Show all ${totalLogCount} tasks →`}
                </Button>
              </div>
            )}
          </ParchmentCard>
        </section>
      )}

      <DeckleDivider glyph="flourish-corner" />

      {dropsError && !recentDrops && (
        <ErrorAlert message="Couldn't load recent drops." onRetry={reloadDrops} />
      )}

      {recentDrops?.length > 0 && (
        <section>
          <div className="mb-2">
            <div className="font-script text-sheikah-teal-deep text-body">drops from the last two days</div>
            <h2 className="font-display text-xl md:text-2xl text-ink-primary leading-tight">Recent Loot</h2>
          </div>
          <ScrollRail>
            {recentDrops.map((d) => (
              <motion.button
                key={d.id}
                type="button"
                whileHover={{ y: -2 }}
                onClick={() => navigate('/treasury?tab=satchel')}
                aria-label={`${d.item_name}${d.was_salvaged ? ' (salvaged)' : ''} — open satchel`}
                className={`shrink-0 w-28 p-3 rounded-xl bg-ink-page-aged border border-ink-page-shadow text-center ring-2 ring-offset-2 ring-offset-ink-page ${RARITY_RING_COLORS[d.rarity] || 'ring-transparent'}`}
              >
                <div className="text-3xl mb-1" aria-hidden="true">{d.item_icon || '📦'}</div>
                <div className="font-body text-caption font-medium truncate">{d.item_name}</div>
                {d.was_salvaged && (
                  <div className="font-script text-micro text-gold-leaf mt-0.5">salvaged</div>
                )}
              </motion.button>
            ))}
          </ScrollRail>
        </section>
      )}

      <AccordionSection
        index={0}
        title="Treasury"
        kicker="this week at a glance"
        icon={<CoinIcon size={18} />}
        tone="gold"
        defaultOpen
        peek={`${formatCurrency(current_balance)} · ${coin_balance ?? 0} coins · ${this_week?.hours_worked ?? 0}h`}
      >
        <motion.div variants={staggerChildren} initial="initial" animate="animate" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <motion.button
            variants={staggerItem}
            type="button"
            onClick={() => navigate('/treasury?tab=coffers')}
            aria-label={`Balance ${formatCurrency(current_balance)} — open coffers`}
            className="text-left rounded-xl border border-ink-page-shadow bg-ink-page-aged p-3 hover:bg-ink-page-rune-glow transition-colors"
          >
            <div className="font-script text-caption uppercase tracking-wider text-moss">Balance</div>
            <div className="font-display text-xl font-semibold text-ink-primary">{formatCurrency(current_balance)}</div>
          </motion.button>
          <motion.button
            variants={staggerItem}
            type="button"
            onClick={() => navigate('/treasury?tab=bazaar')}
            aria-label={`${coin_balance ?? 0} coins — open the bazaar`}
            className="text-left rounded-xl border border-ink-page-shadow bg-ink-page-aged p-3 hover:bg-ink-page-rune-glow transition-colors"
          >
            <div className="flex items-center gap-1 font-script text-caption uppercase tracking-wider text-gold-leaf">
              <CoinIcon size={14} aria-hidden="true" /> Coins
            </div>
            <div className="font-display text-xl font-semibold text-ink-primary">{coin_balance ?? 0}</div>
          </motion.button>
          <motion.button
            variants={staggerItem}
            type="button"
            onClick={() => navigate('/treasury?tab=wages')}
            aria-label={`${this_week?.hours_worked ?? 0} hours clocked this week — open wages`}
            className="text-left rounded-xl border border-ink-page-shadow bg-ink-page-aged p-3 hover:bg-ink-page-rune-glow transition-colors"
          >
            <div className="font-script text-caption uppercase tracking-wider text-sheikah-teal-deep">Hours this week</div>
            <div className="font-display text-xl font-semibold text-ink-primary">{this_week?.hours_worked ?? 0}h</div>
          </motion.button>
          <motion.button
            variants={staggerItem}
            type="button"
            onClick={() => navigate('/payments')}
            aria-label={`Earned this week ${formatCurrency(this_week?.earnings)} — open payments ledger`}
            className="text-left rounded-xl border border-ink-page-shadow bg-ink-page-aged p-3 hover:bg-ink-page-rune-glow transition-colors"
          >
            <div className="font-script text-caption uppercase tracking-wider text-ember-deep">Earned this week</div>
            <div className="font-display text-xl font-semibold text-ink-primary">{formatCurrency(this_week?.earnings)}</div>
          </motion.button>
        </motion.div>
        {coinSummary?.series?.some((p) => p.earned > 0) && (
          <div className="mt-3">
            <div className="font-script text-caption uppercase tracking-wider text-gold-leaf mb-1">
              Coins earned · last 30 days
            </div>
            <Sparkline
              data={coinSummary.series.map((p) => p.earned)}
              label="Coins earned per day over the last 30 days"
              strokeClass="stroke-gold-leaf"
            />
          </div>
        )}
        <div className="font-script text-caption text-ink-whisper mt-3 leading-relaxed">
          balance: pay from clocked ventures · coins: earned across all your work, spent in the bazaar · hours and earnings: this week's clocked time
        </div>
      </AccordionSection>

      {active_projects?.length > 0 && (
        <AccordionSection
          index={1}
          title="Next Up"
          kicker="ventures under way"
          icon={<Compass size={18} />}
          tone="teal"
          count={active_projects.length}
          peek={`${active_projects[0]?.title} · ${active_projects[0]?.milestones_completed ?? 0}/${active_projects[0]?.milestones_total ?? 0} milestones`}
        >
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {active_projects.map((p) => (
              <motion.button
                key={p.id}
                type="button"
                whileHover={{ y: -2 }}
                onClick={() => navigate(`/quests/ventures/${p.id}`)}
                className="text-left"
              >
                <ParchmentCard>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="font-display text-lg leading-tight truncate">{p.title}</div>
                    <RuneBadge tone={mapProjectTone(p.status)} size="sm">
                      {p.status.replace('_', ' ')}
                    </RuneBadge>
                  </div>
                  <div className="font-script text-caption text-ink-whisper mb-3">
                    difficulty: {'★'.repeat(p.difficulty || 1)}
                  </div>
                  {p.milestones_total > 0 && (
                    <>
                      <div className="flex justify-between font-rune text-tiny text-ink-whisper mb-1">
                        <span>MILESTONES</span>
                        <span>{p.milestones_completed}/{p.milestones_total}</span>
                      </div>
                      <ProgressBar
                        value={p.milestones_completed}
                        max={p.milestones_total}
                        aria-label={`${p.title} milestones`}
                        className="h-1.5"
                      />
                    </>
                  )}
                </ParchmentCard>
              </motion.button>
            ))}
          </div>
        </AccordionSection>
      )}

      {savings_goals?.length > 0 && (
        <AccordionSection
          index={2}
          title="Hoard"
          kicker="treasure chests in progress"
          icon={<Target size={18} />}
          tone="moss"
          count={savings_goals.length}
          peek={`${savings_goals[0]?.title} · ${savings_goals[0]?.percent_complete ?? 0}%`}
        >
          <div className="grid md:grid-cols-2 gap-3">
            {savings_goals.slice(0, 2).map((goal) => (
              <button
                key={goal.id}
                type="button"
                onClick={() => navigate('/treasury?tab=hoards')}
                className="text-left"
              >
                <ParchmentCard seal className="hover:brightness-105 transition-[filter]">
                  <div className="flex items-center gap-2 mb-2">
                    {goal.icon && <span className="text-xl">{goal.icon}</span>}
                    <Target size={16} className="text-moss shrink-0" />
                    <span className="font-display text-base leading-tight truncate">
                      {goal.title}
                    </span>
                  </div>
                  <div className="flex justify-between font-rune text-tiny text-ink-whisper mb-1">
                    <span>{formatCurrency(goal.current_amount)}</span>
                    <span>{formatCurrency(goal.target_amount)}</span>
                  </div>
                  <ProgressBar
                    value={goal.percent_complete}
                    max={100}
                    color="bg-moss"
                    aria-label={`${goal.title} savings progress`}
                  />
                </ParchmentCard>
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/treasury?tab=hoards')}
            className="mt-3 -ml-3 font-script text-caption text-sheikah-teal-deep! hover:underline"
          >
            View all in Treasury →
          </Button>
        </AccordionSection>
      )}

      {recent_badges?.length > 0 && (
        <AccordionSection
          index={3}
          title="Recent Accolades"
          kicker="badges earned"
          icon={<Award size={18} />}
          tone="ember"
          count={recent_badges.length}
          peek={`${recent_badges.length} badge${recent_badges.length !== 1 ? 's' : ''} · latest: ${recent_badges[0]?.badge__name}`}
        >
          <ScrollRail>
            {recent_badges.map((b, i) => (
              <motion.button
                key={b.badge__id}
                type="button"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => navigate('/atlas?tab=skills')}
                className="shrink-0 w-28 text-center p-3 rounded-xl bg-ink-page-aged border border-ink-page-shadow hover:border-gold-leaf/60 transition-colors"
              >
                <div className="text-4xl mb-1">{b.badge__icon || '🏅'}</div>
                <div className="font-body text-caption font-medium truncate">{b.badge__name}</div>
              </motion.button>
            ))}
          </ScrollRail>
        </AccordionSection>
      )}

      <HomeworkSubmitSheet
        assignment={activeHomework}
        onClose={() => setActiveHomework(null)}
        onSubmitted={() => {
          setActiveHomework(null);
          reload();
        }}
      />

    </PageShell>
  );
}
