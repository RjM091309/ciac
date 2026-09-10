import React, { useState } from 'react';
import { Building2, FileCheck, FileClock, FileText, Inbox, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';
import { getStatusBadgeStyles } from './statusBadge';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';

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
    returned?: number;
    requirementsTotal: number;
    requirementsVerified: number;
  };
};

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div
      className="glass-card p-3.5 flex flex-col gap-2 !border-transparent"
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
}: {
  data: ProponentDashboardData | null;
  /** Accepted for call-site compatibility; filing now lives in My Applications. */
  onFiled?: () => void;
  /** Set only by PreviewDashboard: the real Proponent role's saved widget
   * visibility, since the admin viewing this preview is exempt from Control
   * Panel restrictions and would otherwise always see everything. */
  widgetOverrides?: Record<string, boolean>;
}) {
  const proponent = data?.proponent ?? null;
  const applications = data?.applications ?? [];
  const stats = data?.stats ?? { total: 0, draft: 0, pending: 0, approved: 0, rejected: 0, returned: 0, requirementsTotal: 0, requirementsVerified: 0 };
  const { canShowWidget: canShowWidgetForMe } = useControlPanelAccess();
  const canShowWidget = (key: string) => (widgetOverrides ? widgetOverrides[key] ?? true : canShowWidgetForMe(key));

  if (!proponent) {
    return (
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <EmptyState
          title="No locator profile linked"
          description="Your account isn't linked to a locator/company profile yet. Please contact CIAC to have your account linked."
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
          <StatCard label="Total Applications" value={stats.total} icon={FileText} />
          <StatCard label="Drafts" value={stats.draft ?? 0} icon={FileClock} />
          <StatCard label="Pending" value={stats.pending} icon={Inbox} />
          <StatCard label="Approved" value={stats.approved} icon={FileCheck} />
          <StatCard label="Rejected" value={stats.rejected ?? 0} icon={XCircle} />
          <StatCard label="Returned" value={stats.returned ?? 0} icon={RotateCcw} />
          <StatCard
            label="Requirements Verified"
            value={`${stats.requirementsVerified}/${stats.requirementsTotal}`}
            icon={FileCheck}
          />
        </div>
      )}

      {canShowWidget('dashboard:table') && (
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <h4 className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>
          My Applications
        </h4>

        {applications.length === 0 ? (
          <EmptyState
            title="No applications yet"
            description="You haven't submitted any lease applications yet."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Application No.', 'Type', 'Status', 'Requirements', 'Submitted'].map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b"
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
                    <tr key={app.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                        {app.application_no}
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
                      <td className="px-3 py-2 text-[11px] text-secondary w-40">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-1.5 flex-1 rounded-full overflow-hidden"
                            style={{ backgroundColor: 'var(--control-bg)' }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: 'var(--nav-active-bg)' }}
                            />
                          </div>
                          <span className="shrink-0 text-[10px]">{verified}/{total}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{formatDate(app.submitted_at || app.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
