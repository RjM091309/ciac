import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock,
  FileText,
  Gauge,
  MoreHorizontal,
  Plus,
  Rocket,
  Trash2,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

type TrendPoint = { label: string; total: number; approved: number };

export type AdminDashboardData = {
  totals: {
    registeredBusinesses: number;
    totalBusinesses: number;
    totalApplications: number;
    newApplications: number;
    renewalApplications: number;
    applicationsToday: number;
  };
  statusBreakdown: { draft?: number; pending: number; approved: number; rejected: number; returned: number };
  requirements: { total: number; verified: number };
  monthlyTrend: TrendPoint[];
  trends?: {
    daily: TrendPoint[];
    weekly: TrendPoint[];
    monthly: TrendPoint[];
    quarterly: TrendPoint[];
    yearly: TrendPoint[];
  };
  categoryCompletion: { category_name: string; total: number; verified: number }[];
  turnaround?: {
    avgTurnaroundDays: number | null;
    completedCount: number;
    openCount: number;
    avgOpenAgeDays: number | null;
    oldestOpenDays: number | null;
  };
  attention?: { application_id: number; application_no: string; proponent_name: string | null; status: string; is_renewal?: boolean; days_waiting: number }[];
};

type QuickTask = { id: number; title: string; is_done: boolean; created_at: string };

/** DBM-06 (real half): a personal to-do list backed by /api/quick-tasks —
 * replaces what used to be three hardcoded sample rows with no storage. */
function QuickTasks() {
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
    <div
      className="col-span-12 md:col-span-6 xl:col-span-5 glass-card p-4 sm:p-6 !border-transparent w-full min-w-0 touch-landscape-no-lift"
      style={{ backgroundColor: 'var(--surface)' }}
    >
      <h4 className="text-sm font-bold mb-1" style={{ color: 'var(--text)' }}>
        Quick Tasks
      </h4>
      <p className="text-[10px] text-secondary mb-4 sm:mb-6">Personal follow-ups — only visible to you</p>

      <div
        className="flex gap-2 p-1 rounded-xl mb-4 sm:mb-6 border"
        style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}
      >
        <button
          onClick={() => setTab('active')}
          className="flex-1 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-[10px] font-bold transition-colors"
          style={
            tab === 'active'
              ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
              : { color: 'var(--text-muted)' }
          }
        >
          Active ({active.length})
        </button>
        <button
          onClick={() => setTab('done')}
          className="flex-1 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-[10px] font-bold transition-colors"
          style={
            tab === 'done'
              ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
              : { color: 'var(--text-muted)' }
          }
        >
          Completed ({done.length})
        </button>
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
              <button
                onClick={() => removeTask(task.id)}
                className="shrink-0 p-1 rounded-md text-secondary hover:text-rose-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTask();
          }}
          className="w-full rounded-2xl pr-12 pl-4 py-2.5 text-xs focus:outline-none focus:ring-1 transition-all"
          style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text)' }}
        />
        <button
          onClick={addTask}
          disabled={busy || !draft.trim()}
          className="absolute inset-y-1 right-1 px-3 rounded-2xl transition-colors flex items-center justify-center disabled:opacity-40 cursor-pointer"
          style={{ backgroundColor: 'var(--control-bg)' }}
        >
          <Plus size={14} style={{ color: 'var(--text)' }} />
        </button>
      </div>
    </div>
  );
}

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
      <circle
        cx="120"
        cy="120"
        r={radius}
        fill="transparent"
        stroke="#1e293b"
        strokeWidth={strokeWidth}
        className="opacity-30"
      />
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

const MetricCard = ({
  title,
  value,
  icon: Icon,
  trend,
  trendValue,
  onClick,
}: {
  title: string;
  value: string | number;
  icon: any;
  trend?: 'up' | 'down';
  trendValue?: string;
  onClick?: () => void;
}) => (
  <div
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          }
        : undefined
    }
    className={cn(
      'glass-card p-3 sm:p-3.5 flex flex-col min-h-[100px] sm:h-31 transition-colors group !border-transparent',
      onClick && 'cursor-pointer hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nav-active-bg)]'
    )}
    style={{
      backgroundColor: 'var(--surface)',
    }}
  >
    {/* Fixed height for label row so value row aligns across all cards */}
    <div className="flex justify-between items-center gap-2 min-w-0 h-9 shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <div
          className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl border transition-colors shrink-0"
          style={{
            backgroundColor: 'var(--control-bg)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <Icon
            className="transition-colors"
            size={18}
            style={{ color: 'var(--text)' }}
          />
        </div>
        <span className="text-xs font-medium text-secondary truncate">{title}</span>
      </div>
      <button
        type="button"
        aria-label="More options"
        onClick={(e) => e.stopPropagation()}
        className="p-2 -m-1 rounded-full transition-colors shrink-0 touch-target min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:p-1 flex items-center justify-center"
        style={{
          color: 'var(--text-muted)',
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>

    <div className="flex items-end justify-between pt-1 sm:pt-1.5 gap-2 flex-1 min-h-0">
      <p className="text-lg sm:text-xl font-bold tracking-tight leading-none truncate min-w-0" style={{ color: 'var(--text)' }}>
        {value}
      </p>
      {trendValue && (
        <div
          className={cn(
            'flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full',
            trend === 'up' ? 'text-emerald-400 bg-emerald-400/10' : 'text-orange-400 bg-orange-400/10',
          )}
        >
          <TrendingUp size={10} className={trend === 'down' ? 'rotate-180' : ''} />
          {trendValue}
        </div>
      )}
    </div>
  </div>
);

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

export function Dashboard({ data, navigate }: { data: AdminDashboardData | null; navigate?: Navigate }) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [timeStr, ampm] = currentTime
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    .split(' ');

  const year = currentTime.getFullYear();
  const month = currentTime.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay();

  const totals = data?.totals ?? {
    registeredBusinesses: 0,
    totalBusinesses: 0,
    totalApplications: 0,
    newApplications: 0,
    renewalApplications: 0,
    applicationsToday: 0,
  };
  const statusBreakdown = data?.statusBreakdown ?? { pending: 0, approved: 0, rejected: 0, returned: 0 };
  const requirements = data?.requirements ?? { total: 0, verified: 0 };
  const monthlyTrend = data?.monthlyTrend ?? [];
  const categoryCompletion = data?.categoryCompletion ?? [];
  const turnaround = data?.turnaround ?? null;
  const attention = data?.attention ?? [];

  // DBM-04: daily/weekly/monthly/quarterly/yearly reporting periods, all real
  // (backend-bucketed) counts — this tab strip is what actually drives the
  // Application Pipeline chart below, not just cosmetic.
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('monthly');
  const PERIOD_LABELS: Record<typeof period, string> = {
    daily: 'Last 14 Days',
    weekly: 'Last 8 Weeks',
    monthly: 'Last 6 Months',
    quarterly: 'Last 4 Quarters',
    yearly: 'Last 3 Years',
  };
  const activeTrend = data?.trends?.[period] ?? (period === 'monthly' ? monthlyTrend : []);

  const overallPct = requirements.total > 0 ? Math.round((requirements.verified / requirements.total) * 100) : 0;
  const rejectedReturned = statusBreakdown.rejected + statusBreakdown.returned;
  const topCategories = categoryCompletion.slice(0, 3).map((c) => ({
    ...c,
    pct: c.total > 0 ? Math.round((c.verified / c.total) * 100) : 0,
  }));

  return (
    <>
      <div className="grid grid-cols-12 gap-4 sm:gap-4 lg:gap-5 touch-landscape-dashboard-grid">
        {/* Left side: hero + metrics — full width until 1181px (iPad Pro 1024 matches iPad Air stack) */}
        <div className="col-span-12 xl:col-span-8 flex flex-col gap-4 sm:gap-4 touch-landscape-top-left">
          {/* Welcome + Weather Card (from provided design) */}
          <div
            className="relative overflow-hidden rounded-2xl px-4 py-5 sm:px-6 sm:py-6 !border-transparent"
            style={{
              backgroundColor: 'var(--surface)',
              boxShadow:
                '0 6px 16px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
            }}
          >
            {/* Subtle Glow Effect */}
            <div className="pointer-events-none absolute -top-32 -right-32 h-80 w-80 rounded-full bg-blue-600/30 blur-[100px]" />

            <div className="relative flex flex-col md:flex-row justify-between gap-5 sm:gap-6">
              {/* Left Side: Greeting and Time */}
              <div className="flex flex-col justify-between space-y-5 sm:space-y-8">
                <div>
                  <h3 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                    Lease Application Center
                  </h3>
                  <p className="mt-1.5 sm:mt-2 text-xs md:text-sm text-secondary flex items-center gap-2 flex-wrap">
                    Monitor requirement completion and permit status for every locator.
                    <Rocket className="w-4 h-4 shrink-0" />
                  </p>
                </div>

                <div className="flex items-baseline gap-2">
                  <span
                    className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tighter"
                    style={{ color: 'var(--text)' }}
                  >
                    {timeStr}
                  </span>
                  <span
                    className="text-base sm:text-lg md:text-xl font-bold opacity-80 uppercase"
                    style={{ color: 'var(--text)' }}
                  >
                    {ampm}
                  </span>
                </div>
              </div>

              {/* Right Side: Application count and date */}
              <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-between gap-4 md:gap-0 text-left md:text-right">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-start md:items-end">
                    <span
                      className="text-2xl sm:text-3xl md:text-4xl font-bold"
                      style={{ color: 'var(--text)' }}
                    >
                      {totals.applicationsToday}
                    </span>
                    <span className="text-[11px] text-secondary font-medium tracking-tight">
                      applications submitted today
                    </span>
                  </div>
                  <FileText
                    className="w-10 h-10 md:w-12 md:h-12 shrink-0"
                    style={{ color: 'var(--text)' }}
                  />
                </div>

                <div className="md:mt-4 space-y-0.5 md:space-y-1">
                  <p className="text-xs sm:text-sm font-medium text-secondary">3Core Lease Desk</p>
                  <p className="text-xs font-semibold text-secondary">Application Monitoring</p>
                  <p className="text-[10px] sm:text-xs text-secondary">
                    {currentTime.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>

        {/* Metrics row directly under hero */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-4 touch-landscape-metrics">
          <MetricCard
            title="Total Applications"
            value={totals.totalApplications}
            icon={FileText}
            trend="up"
            trendValue={`${totals.newApplications} new · ${totals.renewalApplications} renewal`}
            onClick={navigate ? () => navigate('/applications/new') : undefined}
          />
          <MetricCard
            title="Registered Businesses"
            value={totals.registeredBusinesses}
            icon={Building2}
            trend="up"
            trendValue={`${totals.totalBusinesses} on record`}
            onClick={navigate ? () => navigate('/settings/proponents') : undefined}
          />
          <MetricCard
            title="Pending Review"
            value={statusBreakdown.pending}
            icon={Clock}
            trend={statusBreakdown.pending > 0 ? 'down' : 'up'}
            trendValue={`${statusBreakdown.approved} approved`}
            onClick={navigate ? () => navigate('/assessment') : undefined}
          />
          <MetricCard
            title="Rejected / Returned"
            value={rejectedReturned}
            icon={XCircle}
            onClick={navigate ? () => navigate('/approval') : undefined}
            trend={rejectedReturned > 0 ? 'down' : 'up'}
            trendValue={`${statusBreakdown.rejected} rejected, ${statusBreakdown.returned} returned`}
          />
          </div>
        </div>

        {/* Insights Card on the right, same row height */}
        <div
          className="col-span-12 xl:col-span-4 glass-card p-4 sm:p-6 flex flex-col !border-transparent touch-landscape-top-right"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <h4
            className="text-base font-bold mb-0.5"
            style={{ color: 'var(--text)' }}
          >
            Requirements Overview
          </h4>
          <p className="text-xs text-secondary mb-4 md:mb-6">Completion rate by requirement category</p>

          <div
            className="flex-1 rounded-2xl p-4 md:p-6 border flex flex-col"
            style={{
              backgroundColor: 'var(--control-bg)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {/* Mobile: stack vertically; Desktop: side-by-side */}
            <div className="flex flex-col md:flex-row items-center md:items-center gap-5 md:gap-5 touch-landscape-requirements-row">
              <div className="relative w-32 h-32 sm:w-36 sm:h-36 md:w-40 md:h-40 shrink-0 flex items-center justify-center">
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

              <div className="w-full min-w-0 md:flex-1 space-y-4 md:space-y-5">
                {topCategories.length > 0 ? (
                  topCategories.map((cat, i) => {
                    const style = CATEGORY_ICON_COLORS[i % CATEGORY_ICON_COLORS.length];
                    return (
                      <div
                        key={cat.category_name}
                        role={navigate ? 'button' : undefined}
                        tabIndex={navigate ? 0 : undefined}
                        onClick={navigate ? () => navigate('/applications/requirements') : undefined}
                        onKeyDown={
                          navigate
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  navigate('/applications/requirements');
                                }
                              }
                            : undefined
                        }
                        className={cn(
                          'flex items-center justify-between gap-3 group min-w-0 -mx-2 px-2 py-1 rounded-lg transition-colors',
                          navigate && 'cursor-pointer hover:bg-[var(--surface-hover)]'
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={cn('p-2 rounded-full shrink-0 transition-colors', style.bgColor)}>
                            <CircleDot size={16} className={style.color} />
                          </div>
                          <div className="min-w-0">
                            <p
                              className="text-xs font-bold leading-none mb-1 truncate sm:whitespace-normal"
                              style={{ color: 'var(--text)' }}
                            >
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
        </div>

        <QuickTasks />

        {/* Needs Attention — real oldest-waiting applications, replaces what
            used to be nothing (the old widget only had the mock list above). */}
        <div
          className="col-span-12 xl:col-span-4 glass-card p-4 sm:p-6 !border-transparent w-full min-w-0 touch-landscape-no-lift"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-500 shrink-0" />
            <h4 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              Needs Attention
            </h4>
          </div>
          <p className="text-[10px] text-secondary mb-4 sm:mb-6">Oldest applications still awaiting action</p>

          {attention.length === 0 ? (
            <p className="text-[11px] text-secondary">Nothing waiting — the queue is clear.</p>
          ) : (
            <div className="space-y-2">
              {attention.map((item) => (
                <div
                  key={item.application_id}
                  role={navigate ? 'button' : undefined}
                  tabIndex={navigate ? 0 : undefined}
                  onClick={
                    navigate
                      ? () => navigate(`/applications/${item.is_renewal ? 'renewals' : 'new'}?applicationId=${item.application_id}`)
                      : undefined
                  }
                  onKeyDown={
                    navigate
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(`/applications/${item.is_renewal ? 'renewals' : 'new'}?applicationId=${item.application_id}`);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'flex items-center justify-between gap-2 p-2.5 rounded-xl min-w-0 transition-colors',
                    navigate && 'cursor-pointer hover:brightness-110'
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
                    <p className="text-[10px] text-secondary truncate">{item.proponent_name || 'Unknown business'}</p>
                  </div>
                  <span
                    className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full"
                    style={{
                      backgroundColor: item.days_waiting > 14 ? 'rgba(244,63,94,.12)' : 'var(--control-bg)',
                      color: item.days_waiting > 14 ? '#f43f5e' : 'var(--text-muted)',
                    }}
                  >
                    {item.days_waiting}d
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Calendar */}
        <div className="col-span-12 md:col-span-6 xl:col-span-3 glass-card p-4 sm:p-6 !border-transparent w-full min-w-0 touch-landscape-no-lift" style={{ backgroundColor: 'var(--surface)' }}>
          <h4
            className="text-sm font-bold mb-1"
            style={{ color: 'var(--text)' }}
          >
            Calendar
          </h4>
          <p className="text-[10px] text-secondary mb-4 sm:mb-6">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>

          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <button className="p-2 sm:p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-lg text-secondary hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors -ml-1">
              <ChevronLeft size={14} />
            </button>
            <span
              className="text-[11px] sm:text-xs font-bold text-center px-1"
              style={{ color: 'var(--text)' }}
            >
              {currentTime.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button className="p-2 sm:p-1.5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-lg text-secondary hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors -mr-1">
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-2 sm:gap-y-4 gap-x-0.5 sm:gap-x-0 text-center">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
              <span key={day} className="text-[9px] sm:text-[10px] font-bold text-secondary uppercase">
                {day}
              </span>
            ))}
            {Array.from({ length: startWeekday + daysInMonth }).map((_, i) => {
              const dayNum = i - startWeekday + 1;

              if (i < startWeekday) {
                return (
                  <div key={`empty-${i}`} className="flex items-center justify-center">
                    <span className="text-[10px]">&nbsp;</span>
                  </div>
                );
              }

              const isToday = dayNum === currentTime.getDate();

              return (
                <div key={dayNum} className="flex items-center justify-center">
                  <span
                    className={cn(
                      'text-[10px] font-bold w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all',
                      isToday
                        ? 'shadow-lg'
                        : 'text-secondary hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
                    )}
                    style={
                      isToday
                        ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                        : undefined
                    }
                  >
                    {dayNum}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Application Pipeline Analytics */}
        <div
          className="col-span-12 xl:col-span-5 max-[1024px]:col-span-12 glass-card p-4 sm:p-6 !border-transparent"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <div className="flex justify-between items-start gap-2 mb-3 min-w-0 flex-wrap">
            <div>
              <h4 className="text-sm font-bold truncate min-w-0" style={{ color: 'var(--text)' }}>
                Application Pipeline
              </h4>
              <p className="text-[10px] text-secondary">{PERIOD_LABELS[period]}</p>
            </div>
            <div className="flex gap-0.5 p-0.5 rounded-lg border shrink-0" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}>
              {(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className="px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide transition-colors"
                  style={
                    period === p
                      ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                      : { color: 'var(--text-muted)' }
                  }
                >
                  {p.slice(0, 1)}
                </button>
              ))}
            </div>
          </div>

          <div className="h-40 sm:h-48 w-full min-h-[160px] min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={activeTrend.map((m) => ({ name: m.label, value: m.total }))}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primaryColor)" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="var(--primaryColor)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border-subtle)"
                  strokeOpacity={0.6}
                />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--surface)',
                    border: `1px solid var(--border-subtle)`,
                    borderRadius: '12px',
                    fontSize: '10px',
                    color: 'var(--text)',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  }}
                  itemStyle={{ color: 'var(--text)' }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--primaryColor)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorValue)"
                />
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
        </div>

        {/* Status Breakdown — the pending/approved/rejected/returned split as
            an actual chart (DBM-05), not just the four MetricCards above. */}
        <div className="col-span-12 xl:col-span-4 glass-card p-4 sm:p-6 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <h4 className="text-sm font-bold mb-1" style={{ color: 'var(--text)' }}>
            Status Breakdown
          </h4>
          <p className="text-[10px] text-secondary mb-4 sm:mb-6">Every application, by current status</p>
          <div className="h-40 sm:h-48 w-full min-h-[160px] min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart
                data={[
                  { name: 'Pending', value: statusBreakdown.pending, fill: '#f59e0b' },
                  { name: 'Approved', value: statusBreakdown.approved, fill: '#22c55e' },
                  { name: 'Rejected', value: statusBreakdown.rejected, fill: '#ef4444' },
                  { name: 'Returned', value: statusBreakdown.returned, fill: '#a855f7' },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" strokeOpacity={0.6} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    fontSize: '10px',
                    color: 'var(--text)',
                  }}
                  cursor={{ fill: 'var(--control-bg)' }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Turnaround & Processing Performance (DBM-09) */}
        <div className="col-span-12 xl:col-span-3 glass-card p-4 sm:p-6 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
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
            <div className="flex justify-between">
              <div>
                <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Open Now</span>
                <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{turnaround?.openCount ?? 0}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">Oldest Open</span>
                <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  {turnaround?.oldestOpenDays != null ? `${turnaround.oldestOpenDays}d` : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}



