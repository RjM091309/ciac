import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Building2, ClipboardList, FileCheck, FileText, Inbox, LayoutDashboard, ListChecks, RotateCcw, XCircle } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { getStatusBadgeStyles } from './statusBadge';
import { cn } from '../../lib/utils';
import { balancedRowStyle } from '../../lib/balancedColumns';
import { DataTableControls } from '../ui/DataTableControls';
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
  type Trends,
  type Turnaround,
} from './widgets';

type DashboardApplicationRow = {
  id: number;
  proponent_name: string | null;
  application_no: string;
  application_type: string;
  is_renewal: boolean | number;
  status: string;
  submitted_at: string | null;
  created_at: string;
  requirements_total: number;
  requirements_verified: number;
  /** Where this row opens for the viewer's role; null = not clickable. */
  link?: string | null;
};

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

/** What the staff dashboard is for this role (server-decided from its
 * Control Panel menu access and, for Assessment, the user's level). */
type DashboardView = 'approval' | 'assessment-officer' | 'assessment-manager' | 'overview';

/** Shape of GET /api/dashboard/me for every non-admin staff role. Only the
 * widgets this role may have and has on come back (`widgets` says which);
 * everything else is absent, never just hidden. */
export type OfficerDashboardData = {
  view?: DashboardView;
  widgets?: Record<string, boolean>;
  applications?: DashboardApplicationRow[];
  stats?: Partial<{
    total: number;
    pending: number;
    approved: number;
    disapproved: number;
    rejected: number;
    returned: number;
    requirementsTotal: number;
    requirementsVerified: number;
    locators: number;
  }>;
  attention?: AttentionItem[];
  statusBreakdown?: StatusBreakdown;
  trends?: Trends;
  turnaround?: Turnaround;
  categoryCompletion?: CategoryCompletion[];
  canOpenRequirements?: boolean;
};

const VIEW_COPY: Record<
  DashboardView,
  { title: string; description: string; table: string; tableEmpty: string; attention: string; totalLabel: string }
> = {
  // Account Officer (Level 1: all renewals + the Approved Queue; Level 2: their own locators).
  approval: {
    title: 'Renewals & Locators',
    description: 'Renewals under review, approved locators waiting for an Account Officer, and permits or contracts nearing expiry.',
    table: 'Renewals & Approved Locators',
    tableEmpty: 'No renewals or locators to show right now.',
    attention: 'Renewals and locators waiting on you, plus permits and contracts nearing expiry',
    totalLabel: 'Total Renewals',
  },
  'assessment-officer': {
    title: 'My Assigned Applications',
    description: 'Applications assigned to you for evaluation.',
    table: 'Assigned to Me',
    tableEmpty: "You don't have any applications assigned right now.",
    attention: 'Your assignments that still need work',
    totalLabel: 'Total Assigned',
  },
  'assessment-manager': {
    title: 'Assessment Overview',
    description: "New applications in assessment, and what's waiting on your decision.",
    table: 'New Applications',
    tableEmpty: 'No new applications yet.',
    attention: 'Reviews awaiting your recommendation, and applications to assign',
    totalLabel: 'New Applications',
  },
  overview: {
    title: 'Applications Overview',
    description: 'A read-only summary of applications across the system.',
    table: 'All Applications',
    tableEmpty: 'No applications yet.',
    attention: '',
    totalLabel: 'Total Applications',
  },
};

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="glass-card p-3.5 flex flex-col gap-2 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="p-1.5 rounded-lg border shrink-0" style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}>
          <Icon size={16} style={{ color: 'var(--text)' }} />
        </div>
        <span className="text-[11px] font-medium text-secondary leading-tight line-clamp-2 sm:truncate">{label}</span>
      </div>
      <p className="text-xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
        {value}
      </p>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function OfficerDashboard({ data, navigate }: { data: OfficerDashboardData | null; navigate?: Navigate }) {
  const view: DashboardView = data?.view ?? 'overview';
  const copy = VIEW_COPY[view];
  const show = (key: string) => Boolean(data?.widgets?.[key]);
  const applications = data?.applications ?? [];
  const stats = data?.stats ?? {};

  const statCards = [
    { key: 'dashboard:stats:total', label: copy.totalLabel, value: stats.total ?? 0, icon: FileText },
    { key: 'dashboard:stats:pending', label: 'Pending', value: stats.pending ?? 0, icon: Inbox },
    { key: 'dashboard:stats:approved', label: 'Approved', value: stats.approved ?? 0, icon: FileCheck },
    { key: 'dashboard:stats:disapproved', label: 'Disapproved', value: stats.disapproved ?? 0, icon: Ban },
    { key: 'dashboard:stats:rejected', label: 'Rejected', value: stats.rejected ?? 0, icon: XCircle },
    { key: 'dashboard:stats:returned', label: 'Returned', value: stats.returned ?? 0, icon: RotateCcw },
    {
      key: 'dashboard:stats:requirements',
      label: 'Requirements Verified',
      value: `${stats.requirementsVerified ?? 0}/${stats.requirementsTotal ?? 0}`,
      icon: ListChecks,
    },
    { key: 'dashboard:stats:locators', label: 'Locators', value: stats.locators ?? 0, icon: Building2 },
  ].filter((c) => show('dashboard:stats') && show(c.key));

  // Needs Attention and Quick Tasks sit side by side on wide screens;
  // insights reflow to however many are on (balanced rows — no lone cards,
  // no empty gaps). Without Needs Attention, Quick Tasks joins the insights
  // row instead of stretching alone across a full-width row.
  const showAttention = show('dashboard:attention');
  const workCards: React.ReactNode[] = [];
  const insightCards: React.ReactNode[] = [];
  if (showAttention) {
    workCards.push(
      <AttentionCard key="attention" items={data?.attention ?? []} navigate={navigate} description={copy.attention} />
    );
  }
  if (showAttention && show('dashboard:quick-tasks')) workCards.push(<QuickTasksCard key="tasks" />);

  if (show('dashboard:status-chart') && data?.statusBreakdown) {
    insightCards.push(
      <StatusBreakdownCard
        key="status"
        breakdown={data.statusBreakdown}
        description={view === 'overview' ? 'Every application, by current status' : 'Applications on this dashboard, by status'}
      />
    );
  }
  if (show('dashboard:pipeline')) insightCards.push(<PipelineChartCard key="pipeline" trends={data?.trends} />);
  if (show('dashboard:performance')) insightCards.push(<PerformanceCard key="performance" turnaround={data?.turnaround ?? null} />);
  if (show('dashboard:requirements')) {
    insightCards.push(
      <RequirementsOverviewCard
        key="requirements"
        categoryCompletion={data?.categoryCompletion ?? []}
        // Only link to the Requirements catalog when the role can open it.
        navigate={data?.canOpenRequirements ? navigate : undefined}
      />
    );
  }

  if (!showAttention && show('dashboard:quick-tasks')) insightCards.push(<QuickTasksCard key="tasks" />);

  const showTable = show('dashboard:table');
  const nothingVisible = !statCards.length && !workCards.length && !insightCards.length && !showTable;

  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const tableTotalPages = useMemo(
    () => Math.max(1, Math.ceil(applications.length / Math.max(1, tablePageSize))),
    [applications.length, tablePageSize]
  );
  const tableSafePage = Math.min(Math.max(1, tablePage), tableTotalPages);
  const pagedApplications = useMemo(() => {
    const start = (tableSafePage - 1) * tablePageSize;
    return applications.slice(start, start + tablePageSize);
  }, [applications, tableSafePage, tablePageSize]);
  const tableShowingFrom = applications.length === 0 ? 0 : (tableSafePage - 1) * tablePageSize + 1;
  const tableShowingTo = Math.min(applications.length, tableSafePage * tablePageSize);
  const tableVisiblePageNumbers = useMemo(() => {
    const start = Math.max(1, tableSafePage - 1);
    const end = Math.min(tableTotalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [tableSafePage, tableTotalPages]);
  useEffect(() => {
    setTablePage(1);
  }, [applications.length, tablePageSize]);

  const openRow = (app: DashboardApplicationRow) => (navigate && app.link ? () => navigate(app.link as string) : undefined);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div
        className="relative overflow-hidden rounded-2xl px-4 py-5 sm:px-6 sm:py-6 !border-transparent"
        style={{
          backgroundColor: 'var(--surface)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
        }}
      >
        <div className="pointer-events-none absolute -top-32 -right-32 h-80 w-80 rounded-full bg-blue-600/30 blur-[100px]" />
        <div className="relative flex items-center gap-3">
          <div className="p-2.5 rounded-xl border shrink-0" style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}>
            {view === 'overview' ? (
              <LayoutDashboard size={22} style={{ color: 'var(--text)' }} />
            ) : (
              <ClipboardList size={22} style={{ color: 'var(--text)' }} />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-lg sm:text-xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              {copy.title}
            </h3>
            <p className="text-xs text-secondary">{copy.description}</p>
          </div>
        </div>
      </div>

      {nothingVisible ? (
        <div className="glass-card p-4 sm:p-6 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <EmptyState
            icon={<LayoutDashboard size={32} className="opacity-40" />}
            title="No dashboard widgets"
            description="None are turned on for your role. An administrator can enable them in Control Panel."
          />
        </div>
      ) : null}

      {/* A stat row with every card off doesn't render at all. */}
      {statCards.length > 0 ? (
        <div className="balanced-row" style={balancedRowStyle(statCards.length, { base: 2, sm: 4, xl: 7 })}>
          {statCards.map((c) => (
            <StatCard key={c.key} label={c.label} value={c.value} icon={c.icon} />
          ))}
        </div>
      ) : null}

      {workCards.length > 0 ? (
        <div className="balanced-row" style={balancedRowStyle(workCards.length, { base: 1, lg: 2 })}>
          {workCards}
        </div>
      ) : null}

      {insightCards.length > 0 ? (
        <div className="balanced-row" style={balancedRowStyle(insightCards.length, { base: 1, sm: 2, xl: 3 })}>
          {insightCards}
        </div>
      ) : null}

      {showTable && (
        <div className="rounded-2xl p-0 sm:p-5 sm:border sm:border-transparent sm:shadow-[0_1px_2px_0_rgb(0_0_0_/_0.05)] sm:bg-[var(--surface)]">
          <h4 className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>
            {copy.table}
          </h4>

          {applications.length === 0 ? (
            <EmptyState title="No applications" description={copy.tableEmpty} />
          ) : (
            <>
              {/* Mobile: card list — a <table> forces horizontal scrolling on narrow screens. */}
              <div className="sm:hidden space-y-2.5">
                {pagedApplications.map((app) => {
                  const badge = getStatusBadgeStyles(app.status);
                  const total = Number(app.requirements_total || 0);
                  const verified = Number(app.requirements_verified || 0);
                  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
                  const onOpen = openRow(app);
                  return (
                    <div
                      key={app.id}
                      role={onOpen ? 'button' : undefined}
                      tabIndex={onOpen ? 0 : undefined}
                      onClick={onOpen}
                      onKeyDown={
                        onOpen
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onOpen();
                              }
                            }
                          : undefined
                      }
                      className={cn('rounded-xl border p-3', onOpen && 'cursor-pointer active:brightness-95')}
                      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                          {app.application_no}
                        </span>
                        <span
                          className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border"
                          style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                        >
                          {app.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] font-medium truncate" style={{ color: 'var(--text)' }}>
                        {app.proponent_name || '—'}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-secondary">
                        <span>{Number(app.is_renewal) ? 'Renewal' : 'New'}</span>
                        <span>{formatDate(app.submitted_at || app.created_at)}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--control-bg)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--text)' }} />
                        </div>
                        <span className="shrink-0 text-[10px] text-secondary">
                          {verified}/{total} reqs
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tablet/desktop: table. */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr>
                      {['Application No.', 'Locator', 'Type', 'Status', 'Requirements', 'Submitted'].map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b whitespace-nowrap"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedApplications.map((app) => {
                      const badge = getStatusBadgeStyles(app.status);
                      const total = Number(app.requirements_total || 0);
                      const verified = Number(app.requirements_verified || 0);
                      const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
                      const onOpen = openRow(app);
                      return (
                        <tr
                          key={app.id}
                          onClick={onOpen}
                          className={cn('border-b last:border-b-0 transition-colors', onOpen && 'cursor-pointer hover:bg-[var(--surface-hover)]')}
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          <td className="px-3 py-2 text-[11px] font-semibold whitespace-nowrap" style={{ color: 'var(--text)' }}>
                            {app.application_no}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-secondary">{app.proponent_name || '—'}</td>
                          <td className="px-3 py-2 text-[11px] text-secondary">{Number(app.is_renewal) ? 'Renewal' : 'New'}</td>
                          <td className="px-3 py-2 text-[11px]">
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border whitespace-nowrap"
                              style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                            >
                              {app.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[11px] text-secondary w-40">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--control-bg)' }}>
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--text)' }} />
                              </div>
                              <span className="shrink-0 text-[10px]">
                                {verified}/{total}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{formatDate(app.submitted_at || app.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <DataTableControls
                page={tableSafePage}
                totalPages={tableTotalPages}
                totalItems={applications.length}
                showingFrom={tableShowingFrom}
                showingTo={tableShowingTo}
                visiblePageNumbers={tableVisiblePageNumbers}
                pageSize={tablePageSize}
                pageSizeOptions={[10, 20, 50, 100]}
                onPageSizeChange={(value) => setTablePageSize(value)}
                onPageChange={(p) => setTablePage(p)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
