import React, { useEffect, useState } from 'react';
import { Building2, ChevronLeft, ChevronRight, Clock, FileText, MoreHorizontal, Rocket, TrendingUp, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  AttentionCard,
  PerformanceCard,
  PipelineChartCard,
  QuickTasksCard,
  RequirementsOverviewCard,
  StatusBreakdownCard,
  type AttentionItem,
  type CategoryCompletion,
  type StatusBreakdown,
  type TrendPoint,
  type Trends,
  type Turnaround,
} from './widgets';

export type AdminDashboardData = {
  totals: {
    registeredBusinesses: number;
    totalBusinesses: number;
    totalApplications: number;
    newApplications: number;
    renewalApplications: number;
    applicationsToday: number;
  };
  statusBreakdown: StatusBreakdown & { draft?: number };
  requirements: { total: number; verified: number };
  monthlyTrend: TrendPoint[];
  trends?: Trends;
  categoryCompletion: CategoryCompletion[];
  turnaround?: Turnaround;
  attention?: AttentionItem[];
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
      'glass-card p-3 sm:p-3.5 flex flex-col min-w-0 min-h-[112px] sm:min-h-[100px] sm:h-31 transition-colors group !border-transparent',
      onClick && 'cursor-pointer hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nav-active-bg)]'
    )}
    style={{
      backgroundColor: 'var(--surface)',
    }}
  >
    {/* Fixed height for label row so value row aligns across all cards */}
    <div className="flex justify-between items-center gap-2 min-w-0 h-8 sm:h-9 shrink-0">
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
        <span className="text-[11px] sm:text-xs font-medium text-secondary truncate">{title}</span>
      </div>
      <button
        type="button"
        aria-label="More options"
        onClick={(e) => e.stopPropagation()}
        className="hidden sm:flex p-1 -m-1 rounded-full transition-colors shrink-0 touch-target items-center justify-center"
        style={{
          color: 'var(--text-muted)',
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>

    {/* Phone: value stacked over the chip (half-width cards are too narrow
        for both on one line); sm+: side by side. */}
    <div className="flex flex-col items-start sm:flex-row sm:items-end justify-end sm:justify-between pt-1 sm:pt-1.5 gap-1.5 sm:gap-2 flex-1 min-h-0 min-w-0">
      <p className="text-2xl sm:text-xl font-bold tracking-tight leading-none truncate min-w-0 max-w-full" style={{ color: 'var(--text)' }}>
        {value}
      </p>
      {trendValue && (
        <div
          className={cn(
            'flex items-center gap-1 text-[9px] sm:text-[10px] font-bold px-2 py-1 rounded-full max-w-full min-w-0 sm:shrink-0 sm:max-w-none sm:min-w-fit',
            trend === 'up' ? 'text-emerald-400 bg-emerald-400/10' : 'text-orange-400 bg-orange-400/10',
          )}
        >
          <TrendingUp size={10} className={cn('shrink-0', trend === 'down' && 'rotate-180')} />
          <span className="truncate">{trendValue}</span>
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
  const statusBreakdown = data?.statusBreakdown ?? { pending: 0, approved: 0, disapproved: 0, rejected: 0, returned: 0 };
  const requirements = data?.requirements ?? { total: 0, verified: 0 };
  const monthlyTrend = data?.monthlyTrend ?? [];
  const categoryCompletion = data?.categoryCompletion ?? [];
  const turnaround = data?.turnaround ?? null;
  const attention = data?.attention ?? [];

  const rejectedReturned = statusBreakdown.rejected + statusBreakdown.returned;

  return (
    <>
      <div className="grid grid-cols-12 gap-3 sm:gap-4 lg:gap-5 touch-landscape-dashboard-grid">
        {/* Left side: hero + metrics — full width until 1181px (iPad Pro 1024 matches iPad Air stack) */}
        <div className="col-span-12 xl:col-span-8 flex flex-col gap-3 sm:gap-4 touch-landscape-top-left">
          {/* Welcome + Weather Card (from provided design) */}
          <div
            className="relative overflow-hidden rounded-2xl px-4 py-4 sm:px-6 sm:py-6 !border-transparent"
            style={{
              backgroundColor: 'var(--surface)',
              boxShadow:
                '0 6px 16px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
            }}
          >
            {/* Subtle Glow Effect */}
            <div className="pointer-events-none absolute -top-32 -right-32 h-80 w-80 rounded-full bg-blue-600/30 blur-[100px]" />

            {/* Phone: compact hero — title, then clock + today's count on one row. */}
            <div className="relative sm:hidden">
              <h3 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                Lease Application Center
              </h3>
              <p className="mt-0.5 text-[11px] text-secondary">
                {currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <div className="mt-4 flex items-end justify-between gap-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tracking-tighter leading-none" style={{ color: 'var(--text)' }}>
                    {timeStr}
                  </span>
                  <span className="text-sm font-bold opacity-80 uppercase" style={{ color: 'var(--text)' }}>
                    {ampm}
                  </span>
                </div>
                <div
                  className="flex items-center gap-2"
                >
                  <FileText size={16} className="shrink-0" style={{ color: 'var(--text)' }} />
                  <div className="leading-tight">
                    <p className="text-base font-bold" style={{ color: 'var(--text)' }}>{totals.applicationsToday}</p>
                    <p className="text-[9px] text-secondary font-medium">submitted today</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative hidden sm:flex flex-col md:flex-row justify-between gap-5 sm:gap-6">
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
                  <p className="text-xs sm:text-sm font-medium text-secondary">CIAC Lease Desk</p>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 touch-landscape-metrics">
          <MetricCard
            title="New Applications"
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
            onClick={navigate ? () => navigate('/applications/proponents') : undefined}
          />
          <MetricCard
            title="Pending Review"
            value={statusBreakdown.pending}
            icon={Clock}
            trend={statusBreakdown.pending > 0 ? 'down' : 'up'}
            trendValue={`${statusBreakdown.approved} approved`}
            // Same statuses c_dashboard.js counts as pending (everything but DRAFT and the decided/returned ones).
            onClick={navigate ? () => navigate('/applications/new?status=SUBMITTED,RESUBMITTED,FOR_APPROVAL') : undefined}
          />
          <MetricCard
            title="Rejected / Returned"
            value={rejectedReturned}
            icon={XCircle}
            onClick={navigate ? () => navigate('/applications/new?status=REJECTED,RETURNED') : undefined}
            trend={rejectedReturned > 0 ? 'down' : 'up'}
            trendValue={`${statusBreakdown.rejected} rejected, ${statusBreakdown.returned} returned`}
          />
          </div>
        </div>

        {/* Insights Card on the right, same row height */}
        <RequirementsOverviewCard
          categoryCompletion={categoryCompletion}
          overall={requirements}
          navigate={navigate}
          sizing="viewport"
          className="col-span-12 xl:col-span-4 touch-landscape-top-right"
        />

        <QuickTasksCard className="col-span-12 md:col-span-6 xl:col-span-5 touch-landscape-no-lift" />

        {/* Needs Attention — real oldest-waiting applications, plus permits
            and contracts about to expire. */}
        <AttentionCard items={attention} navigate={navigate} className="col-span-12 xl:col-span-4 touch-landscape-no-lift" />

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

        <PipelineChartCard
          trends={data?.trends}
          fallbackMonthly={monthlyTrend}
          className="col-span-12 xl:col-span-5 max-[1024px]:col-span-12"
        />

        <StatusBreakdownCard breakdown={statusBreakdown} className="col-span-12 xl:col-span-4" />

        <PerformanceCard turnaround={turnaround} className="col-span-12 xl:col-span-3" />
      </div>
    </>
  );
}



