import React, { useState } from 'react';
import { Building2, FileCheck, FileClock, FileText, Inbox, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';
import { getStatusBadgeStyles } from './statusBadge';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { noLocatorProfileMessage } from '../../lib/locatorProfile';
import { cn } from '../../lib/utils';
import { applicationTypeLabel } from '../../lib/applicationTypes';
import { DashboardSkeleton } from '../ui/PortalSkeletons';

type DashboardApplicationRow = {
  id: number;
  application_no: string;
  application_type: string;
  is_renewal: boolean | number;
  status: string;
  submitted_at: string | null;
  created_at: string;
  requirements_total: number;
  requirements_verified: number;
};

type ProponentInfo = {
  id: number;
  business_name: string;
  registration_no: string | null;
};

export type ProponentDashboardData = {
  proponent: ProponentInfo | null;
  applications: DashboardApplicationRow[];
  stats: {
    total: number;
    draft?: number;
    pending: number;
    approved: number;
    rejected?: number;
    disapproved?: number;
    returned?: number;
    requirementsTotal: number;
    requirementsVerified: number;
  };
};

function StatCard({
  label,
  value,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string | number;
  icon: any;
  onClick?: () => void;
}) {
  return (
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
        'glass-card p-3.5 flex flex-col gap-2 !border-transparent transition-colors',
        onClick && 'cursor-pointer hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nav-active-bg)]',
      )}
      style={{ backgroundColor: 'var(--surface)' }}
    >
      <div className="flex items-center gap-2">
        <div
          className="p-1.5 rounded-lg border shrink-0"
          style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}
        >
          <Icon size={16} style={{ color: 'var(--text)' }} />
        </div>
        <span className="text-[11px] font-medium text-secondary truncate">{label}</span>
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

export function ProponentDashboard({
  data,
  widgetOverrides,
  navigate,
}: {
  data: ProponentDashboardData | null;
  /** Accepted for call-site compatibility; filing now lives in My Applications. */
  onFiled?: () => void;
  /** Set only by PreviewDashboard: the real Proponent role's saved widget
   * visibility, since the admin viewing this preview is exempt from Control
   * Panel restrictions and would otherwise always see everything. */
  widgetOverrides?: Record<string, boolean>;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
}) {
  const proponent = data?.proponent ?? null;
  const applications = data?.applications ?? [];
  const stats = data?.stats ?? { total: 0, draft: 0, pending: 0, approved: 0, rejected: 0, returned: 0, requirementsTotal: 0, requirementsVerified: 0 };
  const { canShowWidget: canShowWidgetForMe, ready: accessReady } = useControlPanelAccess();
  const canShowWidget = (key: string) => (widgetOverrides ? widgetOverrides[key] ?? true : canShowWidgetForMe(key));

  // Until this role's widget settings arrive every widget would read as
  // visible, so stat cards etc. flashed in and then vanished. Hold the
  // skeleton until they're known (the admin preview passes them in).
  if (!widgetOverrides && !accessReady) return <DashboardSkeleton />;

  if (!proponent) {
    return (
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <EmptyState
          title="No locator profile linked"
          description={noLocatorProfileMessage()}
        />
      </div>
    );
  }

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
            <Building2 size={22} style={{ color: 'var(--text)' }} />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg sm:text-xl font-bold tracking-tight truncate" style={{ color: 'var(--text)' }}>
              {proponent.business_name}
            </h3>
            <p className="text-xs text-secondary">
              Track your lease application status and requirement completion.
            </p>
          </div>
        </div>
      </div>

      {canShowWidget('dashboard:stats') && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-4">
          <StatCard label="Total Applications" value={stats.total} icon={FileText} onClick={navigate ? () => navigate('/me/applications') : undefined} />
          <StatCard label="Drafts" value={stats.draft ?? 0} icon={FileClock} onClick={navigate ? () => navigate('/me/applications') : undefined} />
          <StatCard label="Pending" value={stats.pending} icon={Inbox} onClick={navigate ? () => navigate('/me/applications') : undefined} />
          <StatCard label="Approved" value={stats.approved} icon={FileCheck} onClick={navigate ? () => navigate('/me/applications') : undefined} />
          {/* Disapproved is counted separately server-side (it isn't pending);
              to a Locator both outcomes read as "not approved". */}
          <StatCard label="Rejected" value={(stats.rejected ?? 0) + (stats.disapproved ?? 0)} icon={XCircle} onClick={navigate ? () => navigate('/me/applications') : undefined} />
          <StatCard label="Returned" value={stats.returned ?? 0} icon={RotateCcw} onClick={navigate ? () => navigate('/me/applications') : undefined} />
          <StatCard
            label="Requirements Verified"
            value={`${stats.requirementsVerified}/${stats.requirementsTotal}`}
            icon={FileCheck}
            onClick={navigate ? () => navigate('/me/applications') : undefined}
          />
        </div>
      )}

      {canShowWidget('dashboard:table') && (
      // No border-color transition inside (it flashed white in dark mode — see ProponentApplications).
      <div className="rounded-2xl p-0 sm:p-4 sm:p-5 sm:border sm:border-transparent sm:shadow-[0_1px_2px_0_rgb(0_0_0_/_0.05)] sm:bg-[var(--surface)] [transition-property:background-color,color] [&_*]:[transition-property:background-color,color]">
        <h4 className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>
          My Applications
        </h4>

        {applications.length === 0 ? (
          <EmptyState
            title="No applications yet"
            description="You haven't submitted any lease applications yet."
          />
        ) : (
          <>
            {/* Mobile: card list — a <table> forces horizontal scrolling on narrow screens. */}
            <div className="sm:hidden space-y-2.5">
              {applications.map((app) => {
                const badge = getStatusBadgeStyles(app.status);
                const total = Number(app.requirements_total || 0);
                const verified = Number(app.requirements_verified || 0);
                const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
                return (
                  <div
                    key={app.id}
                    role={navigate ? 'button' : undefined}
                    tabIndex={navigate ? 0 : undefined}
                    onClick={navigate ? () => navigate(`/me/applications?applicationId=${app.id}`) : undefined}
                    className={cn(
                      'rounded-xl border p-3',
                      navigate && 'cursor-pointer active:brightness-95',
                    )}
                    style={{
                      borderColor: 'var(--border-subtle)',
                      backgroundColor: 'var(--surface)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    }}
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
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-secondary">
                      <span className="truncate">
                        {applicationTypeLabel(app.application_type)} · {Number(app.is_renewal) ? 'Renewal' : 'New'}
                      </span>
                      <span className="shrink-0">{formatDate(app.submitted_at || app.created_at)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div
                        className="h-1.5 flex-1 rounded-full overflow-hidden"
                        style={{ backgroundColor: 'var(--control-bg)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: 'var(--text)' }}
                        />
                      </div>
                      <span className="shrink-0 text-[10px] text-secondary">{verified}/{total} reqs</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tablet/desktop: table. */}
            <div className="hidden sm:block overflow-x-auto">
              {/* Fixed column widths so the columns spread evenly across the card. */}
              <table className="w-full table-fixed text-left text-xs">
                <colgroup>
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '14%' }} />
                </colgroup>
                <thead>
                  <tr>
                    {['Application No.', 'Type', 'Track', 'Status', 'Requirements', 'Submitted'].map((col) => (
                      <th
                        key={col}
                        className={cn(
                          'px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b',
                          col === 'Submitted' && 'text-right'
                        )}
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => {
                    const badge = getStatusBadgeStyles(app.status);
                    const total = Number(app.requirements_total || 0);
                    const verified = Number(app.requirements_verified || 0);
                    const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
                    return (
                      <tr
                        key={app.id}
                        className={cn(
                          'border-b last:border-b-0',
                          navigate && 'cursor-pointer hover:bg-[var(--selected-bg)] transition-[background-color]'
                        )}
                        style={{ borderColor: 'var(--border-subtle)' }}
                        tabIndex={navigate ? 0 : undefined}
                        onClick={navigate ? () => navigate(`/me/applications?applicationId=${app.id}`) : undefined}
                        onKeyDown={
                          navigate
                            ? (e) => {
                                if (e.key === 'Enter') navigate(`/me/applications?applicationId=${app.id}`);
                              }
                            : undefined
                        }
                      >
                        <td className="px-3 py-2.5 text-[11px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                          {app.application_no}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-secondary truncate" title={applicationTypeLabel(app.application_type)}>
                          {applicationTypeLabel(app.application_type)}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-secondary">
                          {Number(app.is_renewal) ? 'Renewal' : 'New'}
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border"
                            style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                          >
                            {app.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-secondary">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-1.5 flex-1 rounded-full overflow-hidden"
                              style={{ backgroundColor: 'var(--control-bg)' }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: 'var(--text)' }}
                              />
                            </div>
                            <span className="shrink-0 text-[10px]">{verified}/{total}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-secondary text-right">{formatDate(app.submitted_at || app.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}
