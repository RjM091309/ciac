import React, { useEffect, useState } from 'react';
import { AlertTriangle, Calendar, Check, CircleDot, Gauge, Plus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

// Dashboard widgets shared by the admin Dashboard and the staff
// OfficerDashboard, so the two never drift apart. Each renders its own card;
// the caller only decides placement through `className`.

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

export type TrendPoint = { label: string; total: number; approved: number };
export type Trends = {
  daily: TrendPoint[];
  weekly: TrendPoint[];
  monthly: TrendPoint[];
  quarterly: TrendPoint[];
  yearly: TrendPoint[];
};
export type CategoryCompletion = { category_name: string; total: number; verified: number };
export type Turnaround = {
  avgTurnaroundDays: number | null;
  completedCount: number;
  openCount: number;
  avgOpenAgeDays: number | null;
  oldestOpenDays: number | null;
};
export type StatusBreakdown = {
  pending: number;
  approved: number;
  disapproved?: number;
  rejected: number;
  returned: number;
};

export type AttentionItem = {
  // Absent/'application' = a queued application; 'permit'/'contract' are
  // expiring/expired compliance records — application_id is then that
  // record's own id (permit, when permit_id is absent) or the application it
  // belongs to (contract).
  kind?: 'application' | 'permit' | 'contract';
  application_id: number;
  /** The permit's own id (kind === 'permit' only) — for deep-linking to and
   * highlighting the specific row on the Permits page. */
  permit_id?: number;
  application_no: string;
  proponent_name: string | null;
  status: string;
  is_renewal?: boolean;
  is_expired?: boolean;
  days_waiting: number;
  /** Set by the staff dashboard API: where this row opens for the viewer's
   * role, or null when that role can't open it (row isn't clickable).
   * Absent (admin) = derived from the item's kind. */
  link?: string | null;
};

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn('glass-card p-4 sm:p-6 !border-transparent w-full min-w-0', className)}
      style={{ backgroundColor: 'var(--surface)' }}
    >
      {children}
    </div>
  );
}

/** Makes a non-button element act like one (click + Enter/Space) when `onActivate` is set. */
function clickableProps(onActivate?: () => void) {
  if (!onActivate) return {};
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

function prettyStatus(status: string) {
  const s = String(status || '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------- Quick Tasks ------------------------------ */

type QuickTask = { id: number; title: string; is_done: boolean; created_at: string };

/** DBM-06 (real half): a personal to-do list backed by /api/quick-tasks —
 * replaces what used to be three hardcoded sample rows with no storage. */
export function QuickTasksCard({ className }: { className?: string }) {
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/quick-tasks', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setTasks(json?.data ?? []);
    } catch {
      // Quiet failure — this widget is a convenience, not core dashboard data.
    }
  }

  useEffect(() => {
    load();
  }, []);

  const active = tasks.filter((t) => !t.is_done);
  const done = tasks.filter((t) => t.is_done);
  const visible = tab === 'active' ? active : done;

  async function addTask() {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/quick-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to add task');
      setTasks((prev) => [json.data, ...prev]);
      setDraft('');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add task');
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task: QuickTask) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, is_done: !t.is_done } : t)));
    try {
      await fetch(`/api/quick-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_done: !task.is_done }),
      });
    } catch {
      load();
    }
  }

  async function removeTask(id: number) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await fetch(`/api/quick-tasks/${id}`, { method: 'DELETE', credentials: 'include' });
    } catch {
      load();
    }
  }

  return (
    <Card className={className}>
      <h4 className="text-sm font-bold mb-1" style={{ color: 'var(--text)' }}>
        Quick Tasks
      </h4>
      <p className="text-[10px] text-secondary mb-4 sm:mb-6">Personal follow-ups — only visible to you</p>

      <div
        className="flex gap-2 p-1 rounded-xl mb-4 sm:mb-6 border"
        style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}
      >
        {(
          [
            ['active', `Active (${active.length})`],
            ['done', `Completed (${done.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="flex-1 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
            style={
              tab === key
                ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                : { color: 'var(--text-muted)' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6 min-h-[2.5rem]">
        {visible.length === 0 ? (
          <p className="text-[11px] text-secondary">
            {tab === 'active' ? 'No open tasks — add one below.' : 'Nothing completed yet.'}
          </p>
        ) : (
          visible.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between gap-2 p-3 rounded-xl transition-all group min-w-0"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--surface-hover) 70%, transparent)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <button
                type="button"
                onClick={() => toggleTask(task)}
                className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 text-left cursor-pointer"
              >
                <span
                  className="w-4 h-4 rounded-full border shrink-0 flex items-center justify-center"
                  style={{
                    borderColor: task.is_done ? 'var(--nav-active-bg)' : 'var(--border-subtle)',
                    backgroundColor: task.is_done ? 'var(--nav-active-bg)' : 'transparent',
                  }}
                >
                  {task.is_done ? <Check size={10} style={{ color: 'var(--nav-active-text)' }} /> : null}
                </span>
                <p
                  className={cn('text-xs font-bold truncate min-w-0', task.is_done && 'line-through opacity-60')}
                  style={{ color: 'var(--text)' }}
                >
                  {task.title}
                </p>
              </button>
              {/* Hover-revealed on mouse; always shown on touch (no hover there). */}
              <button
                type="button"
                onClick={() => removeTask(task.id)}
                className="shrink-0 p-1 rounded-md text-secondary hover:text-rose-500 cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 touch-target flex items-center justify-center transition-opacity"
                aria-label="Delete task"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="relative">
        <input
          type="text"
          placeholder="Add a quick task..."
          aria-label="New quick task"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTask();
          }}
          className="w-full rounded-2xl pr-12 pl-4 py-2.5 text-xs focus:outline-none focus:ring-1 transition-all"
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' }}
        />
        <button
          type="button"
          onClick={addTask}
          disabled={busy || !draft.trim()}
          aria-label="Add task"
          className="absolute inset-y-1 right-1 px-3 rounded-2xl transition-colors flex items-center justify-center disabled:opacity-40 cursor-pointer"
          style={{ backgroundColor: 'var(--control-bg)' }}
        >
          <Plus size={14} style={{ color: 'var(--text)' }} />
        </button>
      </div>
    </Card>
  );
}

/* -------------------------- Requirements Overview ------------------------- */

const RING_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
const CATEGORY_ICON_COLORS = [
  { color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  { color: 'text-emerald-400', bgColor: 'bg-emerald-400/10' },
  { color: 'text-amber-400', bgColor: 'bg-amber-400/10' },
  { color: 'text-secondary', bgColor: 'bg-zinc-500/10' },
];

const RadialProgress = ({
  value,
  radius,
  strokeWidth,
  color,
  delay = 0,
}: {
  value: number;
  radius: number;
  strokeWidth: number;
  color: string;
  delay?: number;
}) => {
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <g className="transform -rotate-90 origin-center">
      <circle cx="120" cy="120" r={radius} fill="transparent" stroke="#1e293b" strokeWidth={strokeWidth} className="opacity-30" />
      <motion.circle
        cx="120"
        cy="120"
        r={radius}
        fill="transparent"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.5, delay, ease: 'easeOut' }}
        strokeLinecap="round"
      />
    </g>
  );
};

/**
 * Requirement completion by category. `sizing` picks what the ring/list
 * layout responds to: 'viewport' (the admin dashboard's fixed grid slot) or
 * 'container' (the card's own width — the staff dashboard's reflowing grid
 * can make this card anything from a phone column to a third of a desktop row).
 */
export function RequirementsOverviewCard({
  categoryCompletion,
  overall,
  navigate,
  sizing = 'container',
  className,
}: {
  categoryCompletion: CategoryCompletion[];
  /** Overall verified/total; defaults to the sum across categories. */
  overall?: { total: number; verified: number };
  navigate?: Navigate;
  sizing?: 'viewport' | 'container';
  className?: string;
}) {
  const totals = overall ?? {
    total: categoryCompletion.reduce((s, c) => s + c.total, 0),
    verified: categoryCompletion.reduce((s, c) => s + c.verified, 0),
  };
  const overallPct = totals.total > 0 ? Math.round((totals.verified / totals.total) * 100) : 0;
  const topCategories = categoryCompletion.slice(0, 3).map((c) => ({
    ...c,
    pct: c.total > 0 ? Math.round((c.verified / c.total) * 100) : 0,
  }));
  const byViewport = sizing === 'viewport';
  const openRequirements = navigate ? () => navigate('/applications/requirements') : undefined;

  return (
    <Card className={cn('flex flex-col', !byViewport && '@container', className)}>
      <h4 className="text-base font-bold mb-0.5" style={{ color: 'var(--text)' }}>
        Requirements Overview
      </h4>
      <p className={cn('text-xs text-secondary mb-3 sm:mb-4', byViewport && 'md:mb-6')}>Completion rate by requirement category</p>

      <div
        className={cn('flex-1 rounded-2xl p-3 sm:p-4 border flex flex-col', byViewport && 'md:p-6')}
        style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}
      >
        <div
          className={cn(
            'flex flex-col items-center gap-5',
            byViewport ? 'md:flex-row touch-landscape-requirements-row' : '@sm:flex-row'
          )}
        >
          <div
            className={cn(
              'relative w-28 h-28 shrink-0 flex items-center justify-center',
              byViewport ? 'sm:w-36 sm:h-36 md:w-40 md:h-40' : '@sm:w-32 @sm:h-32'
            )}
          >
            <svg className="w-full h-full" viewBox="0 0 240 240" preserveAspectRatio="xMidYMid meet">
              {topCategories.length > 0 ? (
                topCategories.map((cat, i) => (
                  <RadialProgress
                    key={cat.category_name}
                    value={cat.pct}
                    radius={90 - i * 20}
                    strokeWidth={12}
                    color={RING_COLORS[i % RING_COLORS.length]}
                    delay={i * 0.2}
                  />
                ))
              ) : (
                <RadialProgress value={overallPct} radius={90} strokeWidth={12} color="#3b82f6" delay={0} />
              )}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.span
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.8 }}
                className="text-lg md:text-xl font-extrabold tracking-tight"
                style={{ color: 'var(--text)' }}
              >
                {overallPct}%
              </motion.span>
            </div>
          </div>

          <div className={cn('w-full min-w-0 space-y-4', byViewport ? 'md:flex-1 md:space-y-5' : '@sm:flex-1')}>
            {topCategories.length > 0 ? (
              topCategories.map((cat, i) => {
                const style = CATEGORY_ICON_COLORS[i % CATEGORY_ICON_COLORS.length];
                return (
                  <div
                    key={cat.category_name}
                    {...clickableProps(openRequirements)}
                    className={cn(
                      'flex items-center justify-between gap-3 group min-w-0 -mx-2 px-2 py-1 rounded-lg transition-colors',
                      openRequirements && 'cursor-pointer hover:bg-[var(--surface-hover)]'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn('p-2 rounded-full shrink-0 transition-colors', style.bgColor)}>
                        <CircleDot size={16} className={style.color} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold leading-none mb-1 truncate sm:whitespace-normal" style={{ color: 'var(--text)' }}>
                          {cat.category_name}
                        </p>
                        <p className="text-[10px] text-secondary leading-none">
                          {cat.verified}/{cat.total} requirements verified
                        </p>
                      </div>
                    </div>
                    <span className={cn('text-xs font-bold shrink-0', style.color)}>{cat.pct}%</span>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-secondary">No requirement categories with data yet.</p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------- Needs Attention ---------------------------- */

/** Colors/labels the attention-list day-count pill by urgency. Permits and
 * contracts count down to expiry (fewer days = more urgent, and an
 * already-expired one is most urgent of all); a queued application counts up
 * from when it was filed (more days waiting = more urgent). */
/** Urgency tier for an attention item — shared by the badge color and the
 * card's Critical/Warning filter, so the pill and the filter never disagree. */
function attentionUrgency(item: AttentionItem): 'critical' | 'warning' | 'normal' {
  const isExpiry = item.kind === 'permit' || item.kind === 'contract';
  return isExpiry
    ? item.is_expired || item.days_waiting <= 7
      ? 'critical'
      : item.days_waiting <= 30
        ? 'warning'
        : 'normal'
    : item.days_waiting > 14
      ? 'critical'
      : item.days_waiting > 7
        ? 'warning'
        : 'normal';
}

function attentionBadge(item: AttentionItem) {
  const isExpiry = item.kind === 'permit' || item.kind === 'contract';
  const urgency = attentionUrgency(item);
  const days = `${item.days_waiting} day${item.days_waiting === 1 ? '' : 's'}`;
  const label = isExpiry ? (item.is_expired ? `${days} overdue` : `${days} left`) : `waiting ${days}`;
  const palette = {
    critical: { bg: 'rgba(244,63,94,.14)', color: '#f43f5e' },
    warning: { bg: 'rgba(249,115,22,.14)', color: '#f97316' },
    normal: { bg: 'var(--control-bg)', color: 'var(--text-muted)' },
  }[urgency];
  return {
    label,
    Icon: isExpiry && item.is_expired ? AlertTriangle : Calendar,
    pulse: urgency !== 'normal',
    ...palette,
  };
}

function defaultAttentionTarget(item: AttentionItem) {
  if (item.kind === 'permit') return `/compliance/permits?permitId=${item.permit_id ?? item.application_id}`;
  if (item.kind === 'contract') return `/approval?applicationId=${item.application_id}`;
  return `/applications/${item.is_renewal ? 'renewals' : 'new'}?applicationId=${item.application_id}`;
}

export function AttentionCard({
  items,
  navigate,
  title = 'Needs Attention',
  description = 'Applications, permits, and contracts waiting on you',
  className,
}: {
  items: AttentionItem[];
  navigate?: Navigate;
  title?: string;
  description?: string;
  className?: string;
}) {
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');
  let criticalCount = 0;
  let warningCount = 0;
  for (const it of items) {
    const u = attentionUrgency(it);
    if (u === 'critical') criticalCount += 1;
    else if (u === 'warning') warningCount += 1;
  }
  const shown = filter === 'all' ? items : items.filter((it) => attentionUrgency(it) === filter);
  const chips: { key: 'all' | 'critical' | 'warning'; label: string; color: string; bg: string }[] = [
    { key: 'all', label: `All (${items.length})`, color: 'var(--text)', bg: 'var(--control-bg)' },
    { key: 'critical', label: `Critical${criticalCount ? ` (${criticalCount})` : ''}`, color: '#f43f5e', bg: 'rgba(244,63,94,.14)' },
    { key: 'warning', label: `Warning${warningCount ? ` (${warningCount})` : ''}`, color: '#f97316', bg: 'rgba(249,115,22,.14)' },
  ];
  return (
    <Card className={className}>
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle size={14} className="text-amber-500 shrink-0" />
        <h4 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          {title}
        </h4>
      </div>
      <p className="text-[10px] text-secondary mb-3">{description}</p>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {chips.map((chip) => {
            const activeChip = filter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors"
                style={
                  activeChip
                    ? { backgroundColor: chip.bg, color: chip.color, borderColor: 'transparent' }
                    : { backgroundColor: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-[11px] text-secondary">Nothing waiting — the queue is clear.</p>
      ) : shown.length === 0 ? (
        <p className="text-[11px] text-secondary">No {filter} items right now.</p>
      ) : (
        // Fits ~5 rows without a scrollbar; once there are more, this
        // scrolls with the same invisible-until-hover scrollbar as the
        // sidebar ("sidebar-scroll") instead of growing the whole card, with
        // a bottom fade so the next row's edge never awkwardly peeks in.
        <div className={cn('sidebar-scroll space-y-2 pr-0.5', shown.length > 5 && 'h-[310px] overflow-y-auto attention-fade-bottom')}>
          {shown.map((item) => {
            const target = item.link !== undefined ? item.link : defaultAttentionTarget(item);
            const badge = attentionBadge(item);
            const isApplication = !item.kind || item.kind === 'application';
            return (
              <div
                key={`${item.kind || 'application'}-${item.permit_id ?? item.application_id}`}
                {...clickableProps(navigate && target ? () => navigate(target) : undefined)}
                className={cn(
                  'flex items-center justify-between gap-2 p-2.5 rounded-xl min-w-0 transition-colors',
                  navigate && target && 'cursor-pointer hover:brightness-110'
                )}
                style={{
                  backgroundColor: 'color-mix(in oklab, var(--surface-hover) 70%, transparent)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-bold truncate" style={{ color: 'var(--text)' }}>
                    {item.application_no}
                  </p>
                  <p className="text-[10px] text-secondary truncate">
                    {item.proponent_name || 'Unknown business'}
                    {isApplication && item.status ? ` · ${prettyStatus(item.status)}` : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap',
                    badge.pulse && 'shimmer-badge'
                  )}
                  style={{ backgroundColor: badge.bg, color: badge.color }}
                >
                  <badge.Icon size={11} />
                  {badge.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* --------------------------- Application Pipeline ------------------------- */

type Period = keyof Trends;
const PERIOD_LABELS: Record<Period, string> = {
  daily: 'Last 14 Days',
  weekly: 'Last 8 Weeks',
  monthly: 'Last 6 Months',
  quarterly: 'Last 4 Quarters',
  yearly: 'Last 3 Years',
};

const tooltipStyle = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '12px',
  fontSize: '10px',
  color: 'var(--text)',
};

/** DBM-04: daily/weekly/monthly/quarterly/yearly reporting periods, all real
 * (backend-bucketed) counts. */
export function PipelineChartCard({
  trends,
  fallbackMonthly = [],
  className,
}: {
  trends?: Trends | null;
  /** Older payloads only had the monthly series. */
  fallbackMonthly?: TrendPoint[];
  className?: string;
}) {
  const [period, setPeriod] = useState<Period>('monthly');
  const activeTrend = trends?.[period] ?? (period === 'monthly' ? fallbackMonthly : []);

  return (
    <Card className={className}>
      <div className="flex justify-between items-start gap-2 mb-3 min-w-0 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-sm font-bold truncate min-w-0" style={{ color: 'var(--text)' }}>
            Application Pipeline
          </h4>
          <p className="text-[10px] text-secondary">{PERIOD_LABELS[period]}</p>
        </div>
        <div
          role="tablist"
          aria-label="Reporting period"
          className="flex gap-0.5 p-0.5 rounded-lg border shrink-0"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
        >
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              aria-label={PERIOD_LABELS[p]}
              title={PERIOD_LABELS[p]}
              onClick={() => setPeriod(p)}
              className="min-w-[32px] min-h-[32px] sm:min-w-0 sm:min-h-0 px-2 py-1 rounded-md text-[10px] sm:text-[9px] font-bold uppercase tracking-wide transition-colors cursor-pointer"
              style={period === p ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' } : { color: 'var(--text-muted)' }}
            >
              {p.slice(0, 1)}
            </button>
          ))}
        </div>
      </div>

      <div className="h-36 sm:h-48 w-full min-h-[144px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={activeTrend.map((m) => ({ name: m.label, value: m.total }))}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primaryColor)" stopOpacity={0.12} />
                <stop offset="95%" stopColor="var(--primaryColor)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" strokeOpacity={0.6} />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ ...tooltipStyle, boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ color: 'var(--text)' }}
            />
            <Area type="monotone" dataKey="value" stroke="var(--primaryColor)" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-between mt-3 sm:mt-4">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Previous</span>
          <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>
            {activeTrend[activeTrend.length - 2]?.total ?? 0}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Current</span>
          <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>
            {activeTrend[activeTrend.length - 1]?.total ?? 0}
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------- Status Breakdown --------------------------- */

/** The pending/approved/disapproved/rejected/returned split as an actual
 * chart (DBM-05). */
export function StatusBreakdownCard({
  breakdown,
  description = 'Every application, by current status',
  className,
}: {
  breakdown: StatusBreakdown;
  description?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <h4 className="text-sm font-bold mb-1" style={{ color: 'var(--text)' }}>
        Status Breakdown
      </h4>
      <p className="text-[10px] text-secondary mb-4 sm:mb-6">{description}</p>
      <div className="h-36 sm:h-48 w-full min-h-[144px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart
            data={[
              { name: 'Pending', value: breakdown.pending, fill: '#f59e0b' },
              { name: 'Approved', value: breakdown.approved, fill: '#22c55e' },
              // Slate, not another red: Rejected already is one.
              { name: 'Disapproved', value: breakdown.disapproved ?? 0, fill: '#64748b' },
              { name: 'Rejected', value: breakdown.rejected, fill: '#ef4444' },
              { name: 'Returned', value: breakdown.returned, fill: '#a855f7' },
            ]}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" strokeOpacity={0.6} />
            {/* interval={0} keeps all five labels; they shrink rather than
                drop out when the card is narrow. */}
            <XAxis dataKey="name" interval={0} tick={{ fontSize: 8, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--control-bg)' }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/* ------------------------- Processing Performance ------------------------- */

/** Turnaround & processing performance (DBM-09). */
export function PerformanceCard({ turnaround, className }: { turnaround: Turnaround | null; className?: string }) {
  return (
    <Card className={className}>
      <div className="flex items-center gap-2 mb-1">
        <Gauge size={14} className="shrink-0" style={{ color: 'var(--text)' }} />
        <h4 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          Processing Performance
        </h4>
      </div>
      <p className="text-[10px] text-secondary mb-4 sm:mb-6">Submission to final decision</p>

      <div className="space-y-4">
        <div>
          <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Avg. Turnaround</span>
          <p className="text-xl font-bold" style={{ color: 'var(--text)' }}>
            {turnaround?.avgTurnaroundDays != null ? `${turnaround.avgTurnaroundDays}d` : '—'}
          </p>
          <p className="text-[10px] text-secondary">across {turnaround?.completedCount ?? 0} decided applications</p>
        </div>
        <div className="h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
        <div className="flex justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Open Now</span>
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              {turnaround?.openCount ?? 0}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Oldest Open</span>
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              {turnaround?.oldestOpenDays != null ? `${turnaround.oldestOpenDays}d` : '—'}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
