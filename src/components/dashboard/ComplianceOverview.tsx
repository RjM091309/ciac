import React from 'react';
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardCheck, FileClock, ShieldCheck } from 'lucide-react';

// Compliance section for the admin and Compliance Officer dashboards: an
// alarm banner when documents have expired / are due within 30 days or
// corrective actions are overdue, the checklist + expiry roll-up, and the
// lists to act on. Data: GET /api/dashboard/me → data.compliance
// (ComplianceInspection.getComplianceDashboard).

export type ComplianceDashboardData = {
  locators: number;
  fullyComplied: number;
  items: { total: number; complied: number; submitted: number };
  expiry: { expired: number; within30: number; within90: number; within180: number };
  standing: { compliant: number; monitoring: number; atRisk: number };
  overdueActions: number;
  upcomingInspections: { id: number; title: string; scheduled_date: string; proponent_name: string }[];
  awaitingReview: { proponent_id: number; proponent_name: string; item_name: string }[];
  awaitingReviewTotal: number;
  alerts: { proponent_id: number; proponent_name: string; item_name: string; validity_to: string; days_left: number }[];
  alertsTotal: number;
};

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

const COMPLIANCE_PAGE = '/compliance/inspections';
// Same solid rose as the header's notification count badge.
const ALARM = '#f43f5e';

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Stat({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl px-3 py-2 min-w-0" style={{ border: '1px solid var(--border-subtle)' }}>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary truncate">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums leading-tight" style={{ color: color || 'var(--text)' }}>
        {value}
      </div>
      {sub ? <div className="text-[10px] text-secondary truncate">{sub}</div> : null}
    </div>
  );
}

export function ComplianceOverview({ data, navigate }: { data: ComplianceDashboardData; navigate?: Navigate }) {
  const open = () => navigate?.(COMPLIANCE_PAGE);
  const urgent = data.expiry.expired + data.expiry.within30;
  const showAlarm = urgent > 0 || data.overdueActions > 0;
  const compliedPct = data.items.total ? Math.round((data.items.complied / data.items.total) * 100) : 0;

  return (
    <div className="space-y-3">
      {showAlarm ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
          style={{ backgroundColor: ALARM, color: '#ffffff', boxShadow: '0 6px 16px rgba(244,63,94,.35)' }}
        >
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
              <AlertTriangle size={18} />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">Compliance alert</div>
            <div className="text-[12px] opacity-95">
              {[
                data.expiry.expired ? `${data.expiry.expired} document${data.expiry.expired === 1 ? '' : 's'} expired` : null,
                data.expiry.within30 ? `${data.expiry.within30} expiring within 30 days` : null,
                data.overdueActions ? `${data.overdueActions} overdue corrective action${data.overdueActions === 1 ? '' : 's'}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          {navigate ? (
            <button
              type="button"
              onClick={open}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold cursor-pointer"
              style={{ color: ALARM }}
            >
              Review <ArrowRight size={13} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={16} style={{ color: 'var(--text)' }} />
          <h4 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
            Compliance
          </h4>
          {navigate ? (
            <button
              type="button"
              onClick={open}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-secondary hover:text-[var(--text)] cursor-pointer"
            >
              Open Compliance & Inspection <ArrowRight size={12} />
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
          <Stat label="Fully complied" value={`${data.fullyComplied}/${data.locators}`} sub="locators" />
          <Stat label="Items complied" value={`${compliedPct}%`} sub={`${data.items.complied} of ${data.items.total}`} color="#10b981" />
          <Stat label="Awaiting review" value={data.awaitingReviewTotal} color={data.awaitingReviewTotal ? '#3b82f6' : undefined} />
          <Stat label="Expired" value={data.expiry.expired} color={data.expiry.expired ? ALARM : undefined} />
          <Stat label="≤ 1 month" value={data.expiry.within30} color={data.expiry.within30 ? ALARM : undefined} />
          <Stat label="≤ 3 months" value={data.expiry.within90} color={data.expiry.within90 ? '#f59e0b' : undefined} />
          <Stat label="≤ 6 months" value={data.expiry.within180} />
          <Stat
            label="At risk / Monitoring"
            value={`${data.standing.atRisk} / ${data.standing.monitoring}`}
            sub={data.overdueActions ? `${data.overdueActions} overdue action(s)` : 'from inspections'}
            color={data.standing.atRisk ? ALARM : undefined}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
          <List
            title="Expired / due within 30 days"
            icon={FileClock}
            total={data.alertsTotal}
            empty="Nothing expiring in the next 30 days."
            onOpen={navigate ? open : undefined}
          >
            {data.alerts.map((a, i) => (
              <Row
                key={`${a.proponent_id}-${a.item_name}-${i}`}
                title={a.item_name}
                sub={a.proponent_name}
                badge={a.days_left < 0 ? `${Math.abs(a.days_left)}d overdue` : a.days_left === 0 ? 'today' : `${a.days_left}d left`}
                badgeColor={ALARM}
                solid={a.days_left < 0}
              />
            ))}
          </List>
          <List
            title="Awaiting review"
            icon={ClipboardCheck}
            total={data.awaitingReviewTotal}
            empty="No uploads waiting for review."
            onOpen={navigate ? open : undefined}
          >
            {data.awaitingReview.map((a, i) => (
              <Row key={`${a.proponent_id}-${a.item_name}-${i}`} title={a.item_name} sub={a.proponent_name} badge="Submitted" badgeColor="#3b82f6" />
            ))}
          </List>
          <List
            title="Inspections in the next 30 days"
            icon={CalendarClock}
            total={data.upcomingInspections.length}
            empty="No inspections scheduled in the next 30 days."
            onOpen={navigate ? open : undefined}
          >
            {data.upcomingInspections.map((u) => (
              <Row key={u.id} title={u.title} sub={u.proponent_name} badge={fmtDate(u.scheduled_date)} badgeColor="var(--text-muted)" />
            ))}
          </List>
        </div>
      </div>
    </div>
  );
}

function List({
  title,
  icon: Icon,
  total,
  empty,
  onOpen,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number }>;
  total: number;
  empty: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-3 min-w-0" style={{ border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={13} />
        <div className="text-[11px] font-bold" style={{ color: 'var(--text)' }}>{title}</div>
        <span className="ml-auto text-[11px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>{total}</span>
      </div>
      {total === 0 ? (
        <p className="text-[11px] text-secondary">{empty}</p>
      ) : (
        <div className="sidebar-scroll max-h-[220px] overflow-y-auto space-y-1.5 pr-0.5">{children}</div>
      )}
      {total > 0 && onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold cursor-pointer hover:brightness-110"
          style={{ border: '1px solid var(--border-subtle)', color: 'var(--text)' }}
        >
          View more <ArrowRight size={12} />
        </button>
      ) : null}
    </div>
  );
}

function Row({ title, sub, badge, badgeColor, solid }: { title: string; sub: string; badge: string; badgeColor: string; solid?: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 min-w-0"
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface-hover) 70%, transparent)' }}
    >
      <div className="min-w-0">
        <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--text)' }}>{title}</div>
        <div className="text-[10px] text-secondary truncate">{sub}</div>
      </div>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap"
        style={solid ? { backgroundColor: badgeColor, color: '#ffffff' } : { color: badgeColor, border: `1px solid ${badgeColor}` }}
      >
        {badge}
      </span>
    </div>
  );
}
