import React, { useEffect, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { DataTableControls } from '../ui/DataTableControls';
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeleton';
import {
  Chip,
  ExportButtons,
  fmtDate,
  logReportExport,
  Period,
  PeriodPicker,
  periodLabel,
  periodQuery,
  periodSlug,
  ReportTile,
  SearchBox,
  ServerPeriod,
  useReport,
} from './reportParts';
import { Cell, downloadPdf, downloadWorkbook, xlDate, XlsxColumn } from './reportExports';
import { usePagination } from './reportUtils';

type Row = {
  proponent_id: number;
  ref_no: string | null;
  business_name: string;
  account_officer: string | null;
  lease_id: number;
  ref_code: string | null;
  contract_type: string | null;
  start: string | null;
  end: string;
  term_end: string | null;
  extended: boolean;
  days_left?: number;
  days_since?: number;
  application_no?: string | null;
  renewed_on?: string;
  previous_end?: string | null;
};
type ListKey = 'existing' | 'expiring' | 'renewed' | 'expired';
type Data = {
  period: ServerPeriod;
  as_of: string;
  expiring_window_days: number;
  without_dates: number;
} & Record<ListKey, Row[]>;

const LISTS: { key: ListKey; label: string; tone?: string }[] = [
  { key: 'existing', label: 'Existing' },
  { key: 'expiring', label: 'Expiring', tone: 'var(--tone-amber)' },
  { key: 'renewed', label: 'Renewed', tone: 'var(--tone-blue)' },
  { key: 'expired', label: 'Expired', tone: 'var(--tone-red)' },
];

const TITLE = 'LIST OF EXISTING, EXPIRING, RENEWED AND EXPIRED LOCATORS';

function describe(key: ListKey, d: Data) {
  const months = Math.round(d.expiring_window_days / 30.4);
  const asOf = fmtDate(d.as_of);
  switch (key) {
    case 'existing':
      return `A lease (or its extension) is in effect as of ${asOf}.`;
    case 'expiring':
      return `In effect as of ${asOf} and ends within ${months} month${months === 1 ? '' : 's'} (Portal Settings → Renewals).`;
    case 'renewed':
      return `A renewal was approved between ${fmtDate(d.period.from)} and ${asOf}.`;
    default:
      return `The last lease ended between ${fmtDate(d.period.from)} and ${asOf}, and none is in effect.`;
  }
}

function columnsFor(key: ListKey) {
  const base = ['Ref No.', 'Locator', 'Ref. Code', 'Type of Contract'];
  if (key === 'renewed') return [...base, 'Renewal No.', 'Renewed on', 'Previous End', 'New Start', 'New End', 'Account Officer'];
  return [...base, 'Start', 'End', key === 'expired' ? 'Days since' : 'Days left', 'Account Officer'];
}

function cellsFor(key: ListKey, r: Row, asText: boolean): Cell[] {
  const date = (v: string | null | undefined) => (asText ? (v ? fmtDate(v) : '') : xlDate(v));
  const end = asText && r.extended ? `${fmtDate(r.end)} (extended)` : date(r.end);
  const base: Cell[] = [r.ref_no, r.business_name, r.ref_code, r.contract_type];
  if (key === 'renewed') return [...base, r.application_no ?? null, date(r.renewed_on), date(r.previous_end), date(r.start), end, r.account_officer];
  return [...base, date(r.start), end, key === 'expired' ? r.days_since ?? null : r.days_left ?? null, r.account_officer];
}

/** G-10: the four locator lists for a quarter or a year. */
export function LocatorStatusReport({
  period,
  onPeriodChange,
  navigate,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
}) {
  const { data, loading, initialLoading, error } = useReport<Data>(`/api/reports/locator-status?${periodQuery(period)}`);
  const [list, setList] = useState<ListKey>('existing');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const { fullAccess, sidebarPermissions } = useControlPanelAccess();
  const canOpenLocator = Boolean(navigate) && (fullAccess || Boolean(sidebarPermissions['settings:proponents']));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.[list] || [];
    return q ? all.filter((r) => [r.business_name, r.ref_no, r.ref_code, r.account_officer].some((v) => String(v || '').toLowerCase().includes(q))) : all;
  }, [data, list, search]);
  useEffect(() => setPage(1), [list, search, period.year, period.quarter]);
  const pg = usePagination(rows, pageSize, page);

  const subtitle = data ? `${periodLabel(period)} · as of ${fmtDate(data.as_of)}` : periodLabel(period);
  const notes = (d: Data) => [
    'An Extension Date counts as the end of the current lease. An approved contract’s dates take precedence over the dates typed on the locator.',
    ...(d.without_dates ? [`${d.without_dates} registered locator(s) have no lease end date and are not in these lists.`] : []),
  ];

  async function exportExcel() {
    if (!data) return;
    setExporting('xlsx');
    try {
      await downloadWorkbook(
        `ciac-locator-status-${periodSlug(period)}.xlsx`,
        TITLE,
        LISTS.map((l) => {
          const cols = columnsFor(l.key);
          const columns: XlsxColumn[] = cols.map((h) => ({
            header: h.toUpperCase(),
            width: h === 'Locator' ? 40 : h === 'Account Officer' ? 24 : h.startsWith('Days') ? 11 : 20,
            align: h === 'Locator' ? 'left' : 'center',
            bold: h === 'Locator',
            numFmt: /Start|End|Renewed on/.test(h) ? 'd mmmm yyyy' : undefined,
          }));
          return {
            name: `${l.label} (${data[l.key].length})`,
            subtitle: `${l.label.toUpperCase()} — ${subtitle.toUpperCase()}`,
            columns,
            groups: data[l.key].map((r) => ({ lines: [cellsFor(l.key, r, false)], highlight: r.extended })),
            notes: [describe(l.key, data), ...(data[l.key].some((r) => r.extended) ? ['Highlighted: the end date is the Extension Date.'] : []), ...notes(data)],
            empty: 'None.',
          };
        })
      );
      logReportExport('locator-status', 'xlsx', LISTS.reduce((n, l) => n + data[l.key].length, 0), { year: period.year, quarter: period.quarter ?? undefined });
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
      await downloadPdf(
        `ciac-locator-status-${periodSlug(period)}.pdf`,
        TITLE,
        subtitle,
        LISTS.map((l, i) => ({
          heading: `${l.label} (${data[l.key].length}) — ${describe(l.key, data)}`,
          newPage: i > 0,
          columns: columnsFor(l.key),
          body: data[l.key].map((r) => cellsFor(l.key, r, true).map((c) => (c == null ? '' : String(c)))),
          aligns: columnsFor(l.key).map((h) => (h === 'Locator' ? 'left' : 'center')),
          notes: i === LISTS.length - 1 ? notes(data) : undefined,
          empty: 'None.',
        }))
      );
      logReportExport('locator-status', 'pdf', LISTS.reduce((n, l) => n + data[l.key].length, 0), { year: period.year, quarter: period.quarter ?? undefined });
      toast.success('Report exported to PDF');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to export');
    } finally {
      setExporting(null);
    }
  }

  const head = columnsFor(list);
  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {LISTS.map((l) => (
          <ReportTile
            key={l.key}
            label={l.label}
            value={data?.[l.key].length ?? 0}
            tone={l.tone}
            loading={initialLoading}
            active={list === l.key}
            onClick={() => setList(l.key)}
            sub={list === l.key ? 'Shown below' : 'View list'}
          />
        ))}
      </div>

      <div className="glass-card p-3 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 mb-3">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <SearchBox value={search} onChange={setSearch} placeholder="Search locator / ref no. / officer…" />
          <ExportButtons disabled={!data || loading} exporting={exporting} onExcel={exportExcel} onPdf={exportPdf} />
        </div>
        {data ? (
          <p className="text-[11px] text-secondary mb-3">
            <b style={{ color: 'var(--text)' }}>{LISTS.find((l) => l.key === list)?.label}:</b> {describe(list, data)} The Extension Date counts as the end of
            the current lease.{data.without_dates ? ` ${data.without_dates} locator(s) have no lease end date and aren't listed.` : ''}
          </p>
        ) : null}

        {error && !data ? (
          <EmptyState icon={<ListChecks size={40} className="opacity-40" />} title="Couldn't load the report" description={error} />
        ) : initialLoading ? (
          <TableSkeleton rows={6} />
        ) : !rows.length ? (
          <EmptyState icon={<ListChecks size={40} className="opacity-40" />} title="No locators" description={search ? 'No match for that search.' : 'None for this period.'} />
        ) : (
          <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {head.map((h) => (
                    <th key={h} className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((r) => (
                  <tr key={`${r.proponent_id}-${r.lease_id}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap font-mono">{r.ref_no || '—'}</td>
                    <td className="px-3 py-2 text-[11px] font-semibold min-w-[200px]">
                      {canOpenLocator ? (
                        <button type="button" className="text-left hover:underline" style={{ color: 'var(--text)' }} onClick={() => navigate?.(`/applications/proponents?proponentId=${r.proponent_id}`)}>
                          {r.business_name}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text)' }}>{r.business_name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap">{r.ref_code || '—'}</td>
                    <td className="px-3 py-2 text-[11px]">{r.contract_type || '—'}</td>
                    {list === 'renewed' ? (
                      <>
                        <td className="px-3 py-2 text-[11px] whitespace-nowrap">{r.application_no || '—'}</td>
                        <td className="px-3 py-2 text-[11px] whitespace-nowrap">{fmtDate(r.renewed_on)}</td>
                        <td className="px-3 py-2 text-[11px] whitespace-nowrap">{fmtDate(r.previous_end)}</td>
                        <td className="px-3 py-2 text-[11px] whitespace-nowrap">{fmtDate(r.start)}</td>
                        <EndCell r={r} />
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-[11px] whitespace-nowrap">{fmtDate(r.start)}</td>
                        <EndCell r={r} />
                        <td className="px-3 py-2 text-[11px] tabular-nums">{list === 'expired' ? r.days_since : r.days_left}</td>
                      </>
                    )}
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap text-secondary">{r.account_officer || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DataTableControls
          page={page}
          totalPages={pg.totalPages}
          totalItems={rows.length}
          showingFrom={pg.showingFrom}
          showingTo={pg.showingTo}
          visiblePageNumbers={pg.visiblePageNumbers}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50, 100]}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          onPageChange={setPage}
          loading={initialLoading}
        />
      </div>
    </div>
  );
}

function EndCell({ r }: { r: Row }) {
  return (
    <td className="px-3 py-2 text-[11px] whitespace-nowrap" title={r.extended ? `Extended — term ended ${fmtDate(r.term_end)}` : undefined}>
      {fmtDate(r.end)} {r.extended ? <Chip tone="var(--tone-violet)">Extended</Chip> : null}
    </td>
  );
}
