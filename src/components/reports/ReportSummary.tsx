import React, { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { Skeleton } from '../ui/Skeleton';
import {
  ExportButtons,
  fmtDate,
  logReportExport,
  Period,
  PeriodPicker,
  periodLabel,
  periodQuery,
  periodSlug,
  ReportTile,
  ServerPeriod,
  useReport,
} from './reportParts';
import { downloadPdf, downloadWorkbook } from './reportExports';

type Top = { proponent_id: number; ref_no: string | null; business_name: string; commitment: number; actual: number | null };
type Data = {
  period: ServerPeriod;
  as_of: string;
  locators: { registered: number; existing: number; expiring: number; expired: number; renewed: number; without_dates: number };
  leases: { total: number; signed_in_period: number; new_in_period: number; renewals_in_period: number };
  commitment: { investment_all: Record<string, number>; employees_all: number; investment_period: Record<string, number>; employees_period: number };
  top_investments: Top[];
  top_employees: Top[];
  lease_area: { total_sqm: number; locators: number; by_type: { type: string; sqm: number }[] };
  escalation: null;
};

const TITLE = 'SUMMARY OF LOCATORS AND INVESTMENTS';
const ESCALATION_NOTE = 'Not available yet — the escalation rate per period (checklist A-13) is not recorded in the system.';

const n = (v: number) => v.toLocaleString('en-US');
const peso = (v: number) => `₱${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sqm = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} sqm`;
const money = (currency: string, v: number) =>
  currency === 'PHP' ? peso(v) : `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const foreign = (byCurrency: Record<string, number>) => Object.entries(byCurrency).filter(([c]) => c !== 'PHP');
/** { PHP: 1, USD: 2 } → "₱1.00 + USD 2.00" (never added together). */
function amounts(byCurrency: Record<string, number>) {
  const parts = Object.entries(byCurrency)
    .sort(([a], [b]) => (a === 'PHP' ? -1 : b === 'PHP' ? 1 : a.localeCompare(b)))
    .map(([c, v]) => money(c, v));
  return parts.length ? parts.join(' + ') : peso(0);
}

/** G-13: the figures CIAC asked for, for a quarter or a year. */
export function ReportSummary({
  period,
  onPeriodChange,
  navigate,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
}) {
  const { data, loading, initialLoading, error } = useReport<Data>(`/api/reports/summary?${periodQuery(period)}`);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const { fullAccess, sidebarPermissions } = useControlPanelAccess();
  const onOpen =
    navigate && (fullAccess || sidebarPermissions['settings:proponents'])
      ? (id: number) => navigate(`/applications/proponents?proponentId=${id}`)
      : undefined;

  const figures = (d: Data): [string, string][] => [
    ['Registered locators', n(d.locators.registered)],
    [`With a lease in effect (as of ${fmtDate(d.as_of)})`, n(d.locators.existing)],
    ['Expiring (within the renewal window)', n(d.locators.expiring)],
    ['Renewed in the period', n(d.locators.renewed)],
    ['Expired in the period (not renewed)', n(d.locators.expired)],
    ['Lease agreements (all)', n(d.leases.total)],
    ['Lease agreements signed in the period', `${n(d.leases.signed_in_period)} (${n(d.leases.new_in_period)} new, ${n(d.leases.renewals_in_period)} renewals)`],
    ['Committed investment — all registered locators', amounts(d.commitment.investment_all)],
    ['Committed investment — signed in the period', amounts(d.commitment.investment_period)],
    ['Committed employees — all registered locators', n(d.commitment.employees_all)],
    ['Committed employees — signed in the period', n(d.commitment.employees_period)],
    ['Total lease area', `${sqm(d.lease_area.total_sqm)}${d.lease_area.by_type.length ? ` (${d.lease_area.by_type.map((t) => `${titleCase(t.type)} ${sqm(t.sqm)}`).join(', ')})` : ''}`],
    ['Escalation rate (with date of implementation)', ESCALATION_NOTE],
  ];
  const topRows = (list: Top[], money: boolean) =>
    list.map((t, i) => [String(i + 1), t.business_name, t.ref_no || '', money ? peso(t.commitment) : n(t.commitment), t.actual == null ? '' : money ? peso(t.actual) : n(t.actual)]);
  const notes = ['Amounts in another currency are shown as entered and are not added to peso totals. Top 3 by investment ranks peso amounts only.'];

  async function exportExcel() {
    if (!data) return;
    setExporting('xlsx');
    const subtitle = `${periodLabel(period).toUpperCase()} · AS OF ${fmtDate(data.as_of).toUpperCase()}`;
    const topSheet = (name: string, list: Top[], money: boolean) => ({
      name,
      subtitle,
      columns: [
        { header: 'RANK', width: 8 },
        { header: 'LOCATOR', width: 44, align: 'left' as const, bold: true },
        { header: 'REF NO.', width: 16 },
        { header: 'COMMITMENT', width: 22, align: 'right' as const },
        { header: 'ACTUAL', width: 22, align: 'right' as const },
      ],
      groups: topRows(list, money).map((cells) => ({ lines: [cells] })),
      empty: 'None recorded.',
    });
    try {
      await downloadWorkbook(`ciac-summary-${periodSlug(period)}.xlsx`, TITLE, [
        {
          name: 'Summary',
          subtitle,
          columns: [
            { header: 'FIGURE', width: 52, align: 'left', bold: true },
            { header: 'VALUE', width: 70, align: 'left' },
          ],
          groups: figures(data).map((cells) => ({ lines: [cells] })),
          notes,
        },
        topSheet('Top 3 Investments', data.top_investments, true),
        topSheet('Top 3 Employees', data.top_employees, false),
      ]);
      logReportExport('summary', 'xlsx', figures(data).length, { year: period.year, quarter: period.quarter ?? undefined });
      toast.success('Report exported to Excel');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to export');
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    if (!data) return;
    setExporting('pdf');
    try {
      const top = ['Rank', 'Locator', 'Ref No.', 'Commitment', 'Actual'];
      await downloadPdf(`ciac-summary-${periodSlug(period)}.pdf`, TITLE, `${periodLabel(period)} · as of ${fmtDate(data.as_of)}`, [
        { columns: ['Figure', 'Value'], body: figures(data), widths: [110, 167], aligns: ['left', 'left'], notes },
        { heading: 'Top 3 locators by committed investment', columns: top, body: topRows(data.top_investments, true), aligns: ['center', 'left', 'center', 'right', 'right'], empty: 'None recorded.' },
        { heading: 'Top 3 locators by committed employees', columns: top, body: topRows(data.top_employees, false), aligns: ['center', 'left', 'center', 'right', 'right'], empty: 'None recorded.' },
      ]);
      logReportExport('summary', 'pdf', figures(data).length, { year: period.year, quarter: period.quarter ?? undefined });
      toast.success('Report exported to PDF');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to export');
    } finally {
      setExporting(null);
    }
  }

  const d = data;
  return (
    <div className={cn('space-y-4 sm:space-y-5 transition-opacity', loading && d && 'opacity-60')}>
      <div className="glass-card p-3 sm:p-4 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <span className="text-[11px] text-secondary">{d ? `As of ${fmtDate(d.as_of)}` : ''}</span>
          <ExportButtons disabled={!d || loading} exporting={exporting} onExcel={exportExcel} onPdf={exportPdf} />
        </div>
        {error && !d ? <p className="text-[12px] mt-3" style={{ color: 'var(--tone-red)' }}>{error}</p> : null}
      </div>

      {/* No figures under an error: zeros would read as real numbers. */}
      {error && !d ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            <ReportTile label="Registered locators" value={n(d?.locators.registered ?? 0)} loading={initialLoading} />
            <ReportTile label="With a lease in effect" value={n(d?.locators.existing ?? 0)} sub="Existing and valid" loading={initialLoading} />
            <ReportTile label="Expiring" value={n(d?.locators.expiring ?? 0)} tone="var(--tone-amber)" sub="Within the renewal window" loading={initialLoading} />
            <ReportTile label="Renewed" value={n(d?.locators.renewed ?? 0)} tone="var(--tone-blue)" sub="In the period" loading={initialLoading} />
            <ReportTile
              label="Expired"
              value={n(d?.locators.expired ?? 0)}
              tone="var(--tone-red)"
              sub="In the period, not renewed"
              loading={initialLoading}
              className="col-span-2 lg:col-span-1"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Card title="Lease agreements" loading={initialLoading}>
              {d ? (
                <>
                  <Big>{n(d.leases.total)}</Big>
                  <Line label="Signed in the period" value={n(d.leases.signed_in_period)} />
                  <Line label="New locators" value={n(d.leases.new_in_period)} />
                  <Line label="Renewals" value={n(d.leases.renewals_in_period)} />
                </>
              ) : null}
            </Card>
            <Card title="Committed investment" loading={initialLoading}>
              {d ? (
                <>
                  <Big caption="All registered locators">{peso(d.commitment.investment_all.PHP || 0)}</Big>
                  <Line label="Signed in the period" value={peso(d.commitment.investment_period.PHP || 0)} />
                  {foreign(d.commitment.investment_all).map(([c, v]) => (
                    <Line key={c} label={`In ${c}, all (not converted)`} value={money(c, v)} />
                  ))}
                  {foreign(d.commitment.investment_period).map(([c, v]) => (
                    <Line key={c} label={`In ${c}, signed in the period`} value={money(c, v)} />
                  ))}
                </>
              ) : null}
            </Card>
            <Card title="Committed employees" loading={initialLoading}>
              {d ? (
                <>
                  <Big caption="All registered locators">{n(d.commitment.employees_all)}</Big>
                  <Line label="Signed in the period" value={n(d.commitment.employees_period)} />
                </>
              ) : null}
            </Card>
            <Card title="Total lease area" loading={initialLoading}>
              {d ? (
                <>
                  <Big>{sqm(d.lease_area.total_sqm)}</Big>
                  {d.lease_area.by_type.map((t) => (
                    <Line key={t.type} label={titleCase(t.type)} value={sqm(t.sqm)} />
                  ))}
                  <Line label="Locators counted" value={n(d.lease_area.locators)} />
                </>
              ) : null}
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card title="Top 3 — committed investment" loading={initialLoading}>
              {d ? <TopList items={d.top_investments} format={peso} onOpen={onOpen} /> : null}
            </Card>
            <Card title="Top 3 — committed employees" loading={initialLoading}>
              {d ? <TopList items={d.top_employees} format={n} onOpen={onOpen} /> : null}
            </Card>
            <Card title="Escalation rate" loading={initialLoading}>
              <p className="text-[12px] text-secondary">{ESCALATION_NOTE}</p>
            </Card>
          </div>
          <p className="text-[11px] text-secondary">{notes[0]}</p>
        </>
      )}
    </div>
  );
}

function Card({ title, loading, children }: { title: string; loading?: boolean; children: React.ReactNode }) {
  return (
    <div className="glass-card p-3.5 sm:p-4 !border-transparent min-w-0" style={{ backgroundColor: 'var(--surface)' }}>
      <h4 className="text-[11px] font-semibold text-secondary uppercase tracking-widest mb-2">{title}</h4>
      {loading ? <Skeleton className="h-[96px] w-full rounded-lg" /> : children}
    </div>
  );
}

function Big({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <div className="mb-2">
      <div className="text-lg font-bold leading-tight break-words" style={{ color: 'var(--text)' }}>
        {children}
      </div>
      {caption ? <div className="text-[10px] text-secondary">{caption}</div> : null}
    </div>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px] py-0.5">
      <span className="text-secondary">{label}</span>
      <span className="font-semibold text-right" style={{ color: 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

function TopList({ items, format, onOpen }: { items: Top[]; format: (v: number) => string; onOpen?: (id: number) => void }) {
  if (!items.length) return <p className="text-[11px] text-secondary">None recorded yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {items.map((it, i) => {
        const Name: any = onOpen ? 'button' : 'span';
        return (
          <li key={it.proponent_id} className="flex items-center gap-3 rounded-lg px-3 py-2 min-w-0" style={{ backgroundColor: 'var(--control-bg)' }}>
            <span className="text-sm font-bold w-4 shrink-0 text-secondary">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <Name
                type={onOpen ? 'button' : undefined}
                onClick={onOpen ? () => onOpen(it.proponent_id) : undefined}
                className={cn('block truncate text-left text-[12px] font-semibold max-w-full', onOpen && 'hover:underline cursor-pointer')}
                style={{ color: 'var(--text)' }}
                title={it.business_name}
              >
                {it.business_name}
              </Name>
              {it.ref_no ? <span className="block text-[10px] text-secondary font-mono">{it.ref_no}</span> : null}
            </div>
            <div className="text-right shrink-0">
              <span className="block text-[12px] font-bold" style={{ color: 'var(--text)' }}>
                {format(it.commitment)}
              </span>
              <span className="block text-[10px] text-secondary">Actual: {it.actual == null ? '—' : format(it.actual)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
