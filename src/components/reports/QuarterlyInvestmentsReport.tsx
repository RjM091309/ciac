import React, { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
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
  QUARTER_LABELS,
  ReportTile,
  SearchBox,
  ServerPeriod,
  useReport,
} from './reportParts';
import { Cell, downloadPdf, downloadWorkbook, millionsCell, Money, PdfCell, xlDate, XlsxColumn } from './reportExports';

type Row = {
  lease_id: number;
  proponent_id: number;
  ref_no: string | null;
  ref_code: string | null;
  firm_name: string;
  is_renewal: boolean;
  application_no: string | null;
  quarter: number;
  date_registration: string;
  date_approval: string | null;
  stockholders: { nationality: string | null; ownership: number }[];
  activity: string | null;
  project_cost: Money;
  project_cost_text: string | null;
  paid_up_capital: Money;
  paid_up_capital_text: string | null;
  labor: number | null;
  foreign_currency: boolean;
};
type Data = { period: ServerPeriod; rows: Row[] };

const TITLE = 'COMPILATION OF THE QUARTERLY APPROVED INVESTMENTS';
const AMBER = 'var(--tone-amber)';

// CIAC's template columns, without the ones the system has no data for yet
// (Country, ICT Classification, Province, Region, Industry Code) and without
// the column-number row.
const XLSX_COLUMNS: XlsxColumn[] = [
  { header: 'FIRM NAME', width: 28, bold: true },
  { header: 'DATE OF REGISTRATION', width: 20.7, numFmt: 'd mmmm yyyy' },
  { header: 'DATE OF APPROVAL', width: 20.7, numFmt: 'd mmmm yyyy' },
  { header: 'NATIONALITY', width: 15.7 },
  { header: '%\nOWNERSHIP', width: 15.7, numFmt: '0.00%' },
  { header: 'ACTIVITY', width: 59.6 },
  { header: 'PROJECT COST\n(In Million PhP)', width: 24.3, numFmt: '#,##0.000' },
  { header: 'PAID UP CAPITAL\n(In Million PhP)', width: 22.9, numFmt: '#,##0.00' },
  { header: 'LABOR', width: 15.7, numFmt: '#,##0' },
];
const PER_STOCKHOLDER = [3, 4];

function millions(m: Money, text: string | null, digits: number) {
  if (!m) return text || '—';
  if (m.currency !== 'PHP') return `${m.currency} ${m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (m.amount / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
const pct = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

function notesFor(rows: Row[]) {
  const notes: string[] = [];
  if (rows.some((r) => r.foreign_currency))
    notes.push('Highlighted rows have an amount in a currency other than PHP. It is shown as entered and is not converted to millions of pesos.');
  if (rows.some((r) => !r.date_approval))
    notes.push('A blank Date of Approval means the lease was encoded or imported without an approval in the system.');
  return notes;
}

/** CIAC's "Compilation of the Quarterly Approved Investments": every lease
 * agreement signed in the period (new locators and renewals), one row per
 * stockholder, firm cells merged — on screen, in Excel and in PDF. */
export function QuarterlyInvestmentsReport({
  period,
  onPeriodChange,
  navigate,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
}) {
  const { data, loading, initialLoading, error } = useReport<Data>(`/api/reports/investments?${periodQuery(period)}`);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const { fullAccess, sidebarPermissions } = useControlPanelAccess();
  const canOpenLocator = Boolean(navigate) && (fullAccess || Boolean(sidebarPermissions['settings:proponents']));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.rows || [];
    return q ? all.filter((r) => [r.firm_name, r.ref_no, r.ref_code].some((v) => String(v || '').toLowerCase().includes(q))) : all;
  }, [data, search]);

  // The quarters shown: the one picked, or all four for a whole year.
  const quarters = period.quarter ? [period.quarter] : [1, 2, 3, 4];
  const byQuarter = (q: number) => rows.filter((r) => r.quarter === q);

  const totals = useMemo(() => {
    const all = data?.rows || [];
    const peso = all.reduce((n, r) => n + (r.project_cost?.currency === 'PHP' ? r.project_cost.amount : 0), 0);
    const usd = all.reduce((n, r) => n + (r.project_cost && r.project_cost.currency !== 'PHP' ? r.project_cost.amount : 0), 0);
    return {
      firms: all.length,
      renewals: all.filter((r) => r.is_renewal).length,
      peso,
      usd,
      labor: all.reduce((n, r) => n + (r.labor || 0), 0),
      foreign: all.filter((r) => r.foreign_currency).length,
    };
  }, [data]);

  const linesOf = (r: Row): Cell[][] => {
    const firm: Cell[] = [
      r.firm_name,
      xlDate(r.date_registration),
      xlDate(r.date_approval),
      null,
      null,
      r.activity,
      millionsCell(r.project_cost, r.project_cost_text),
      millionsCell(r.paid_up_capital, r.paid_up_capital_text),
      r.labor,
    ];
    if (!r.stockholders.length) return [firm];
    return r.stockholders.map((s, i) => {
      const line = i === 0 ? [...firm] : firm.map(() => null as Cell);
      line[3] = s.nationality ? titleCase(s.nationality) : null;
      line[4] = s.ownership / 100;
      return line;
    });
  };

  async function exportExcel() {
    if (!data) return;
    setExporting('xlsx');
    try {
      await downloadWorkbook(
        `ciac-quarterly-approved-investments-${periodSlug(period)}.xlsx`,
        TITLE,
        quarters.map((q) => {
          const list = byQuarter(q);
          return {
            name: QUARTER_LABELS[q - 1],
            subtitle: `${QUARTER_LABELS[q - 1].toUpperCase()} ${period.year}`,
            columns: XLSX_COLUMNS,
            perLine: PER_STOCKHOLDER,
            groups: list.map((r) => ({ lines: linesOf(r), highlight: r.foreign_currency })),
            notes: notesFor(list),
            empty: 'No lease agreements signed this quarter.',
          };
        })
      );
      logReportExport('investments', 'xlsx', rows.length, { year: period.year, quarter: period.quarter ?? undefined, search: search.trim() || undefined });
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
      const fill = (r: Row) => (r.foreign_currency ? { fillColor: [255, 242, 204] } : undefined);
      await downloadPdf(
        `ciac-quarterly-approved-investments-${periodSlug(period)}.pdf`,
        TITLE,
        periodLabel(period),
        quarters.map((q, i) => {
          const list = byQuarter(q);
          return {
            heading: `${QUARTER_LABELS[q - 1]} ${period.year}`,
            newPage: i > 0,
            columns: XLSX_COLUMNS.map((c) => c.header.replace('\n', ' ')),
            widths: [32, 26, 23, 21, 21, 66, 30, 30, 18],
            body: list.flatMap((r) => {
              const span = Math.max(1, r.stockholders.length);
              const merged = (content: string, bold = false): PdfCell => ({ content, rowSpan: span, styles: { ...fill(r), ...(bold ? { fontStyle: 'bold' } : {}) } });
              const firstLine = (s?: Row['stockholders'][number]): PdfCell[] => [
                merged(r.firm_name, true),
                merged(fmtDate(r.date_registration)),
                merged(r.date_approval ? fmtDate(r.date_approval) : ''),
                { content: s?.nationality ? titleCase(s.nationality) : '', styles: fill(r) },
                { content: s ? pct(s.ownership) : '', styles: fill(r) },
                merged(r.activity || ''),
                merged(millions(r.project_cost, r.project_cost_text, 3)),
                merged(millions(r.paid_up_capital, r.paid_up_capital_text, 2)),
                merged(r.labor == null ? '' : r.labor.toLocaleString('en-US')),
              ];
              if (!r.stockholders.length) return [firstLine()];
              return r.stockholders.map((s, k) =>
                k === 0
                  ? firstLine(s)
                  : [
                      { content: s.nationality ? titleCase(s.nationality) : '', styles: fill(r) },
                      { content: pct(s.ownership), styles: fill(r) },
                    ]
              );
            }),
            notes: notesFor(list),
            empty: 'No lease agreements signed this quarter.',
          };
        })
      );
      logReportExport('investments', 'pdf', rows.length, { year: period.year, quarter: period.quarter ?? undefined, search: search.trim() || undefined });
      toast.success('Report exported to PDF');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to export');
    } finally {
      setExporting(null);
    }
  }

  const head = ['Firm Name', 'Date of Registration', 'Date of Approval', 'Nationality', '% Ownership', 'Activity', 'Project Cost (₱M)', 'Paid-up Capital (₱M)', 'Labor'];

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <ReportTile
          label="Lease agreements signed"
          value={totals.firms}
          sub={`${totals.firms - totals.renewals} new · ${totals.renewals} renewal${totals.renewals === 1 ? '' : 's'}`}
          loading={initialLoading}
        />
        <ReportTile
          label="Committed project cost"
          value={`₱${(totals.peso / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}M`}
          sub={totals.usd ? `+ USD ${totals.usd.toLocaleString('en-US')} (not converted)` : 'In PHP'}
          loading={initialLoading}
        />
        <ReportTile label="Committed labor" value={totals.labor.toLocaleString('en-US')} sub="Employees" loading={initialLoading} />
        <ReportTile label="Amounts not in PHP" value={totals.foreign} tone={totals.foreign ? AMBER : undefined} sub="Highlighted below" loading={initialLoading} />
      </div>

      <div className="glass-card p-3 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 mb-3">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <SearchBox value={search} onChange={setSearch} placeholder="Search firm / ref no. / ref. code…" />
          <ExportButtons disabled={!data || loading} exporting={exporting} onExcel={exportExcel} onPdf={exportPdf} />
        </div>
        <p className="text-[11px] text-secondary mb-3">
          Lease agreements signed in the period (Date of Registration = Date Signed; Date of Approval = approved in the system). Project Cost and
          Labor are the committed figures. Amounts are in millions of pesos.
        </p>

        {error && !data ? (
          <EmptyState icon={<Landmark size={40} className="opacity-40" />} title="Couldn't load the report" description={error} />
        ) : initialLoading ? (
          <TableSkeleton rows={6} />
        ) : (
          <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
            <table className="min-w-[1100px] w-full text-left text-xs border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {head.map((h) => (
                    <th key={h} className="px-2.5 py-2.5 text-[10px] uppercase tracking-wider text-secondary align-bottom">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quarters.map((q) => {
                  const list = byQuarter(q);
                  return (
                    <React.Fragment key={q}>
                      {quarters.length > 1 ? (
                        <tr>
                          <td colSpan={head.length} className="px-2.5 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text)' }}>
                            {QUARTER_LABELS[q - 1]} <span className="text-secondary font-semibold">· {list.length}</span>
                          </td>
                        </tr>
                      ) : null}
                      {list.length === 0 ? (
                        <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td colSpan={head.length} className="px-2.5 py-4 text-center text-[11px] text-secondary">
                            {search ? 'No match for that search.' : 'No lease agreements signed this quarter.'}
                          </td>
                        </tr>
                      ) : (
                        list.map((r) => <FirmRows key={r.lease_id} r={r} onOpen={canOpenLocator ? () => navigate?.(`/applications/proponents?proponentId=${r.proponent_id}`) : undefined} />)
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FirmRows({ r, onOpen }: { r: Row; onOpen?: () => void }) {
  const span = Math.max(1, r.stockholders.length);
  const cellStyle: React.CSSProperties = r.foreign_currency ? { backgroundColor: 'color-mix(in oklab, var(--tone-amber) 12%, transparent)' } : {};
  const merged = 'px-2.5 py-2 align-top';
  const Name: any = onOpen ? 'button' : 'span';
  const first = r.stockholders[0];
  return (
    <>
      <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <td rowSpan={span} className={merged} style={{ ...cellStyle, ...(r.foreign_currency ? { boxShadow: `inset 3px 0 0 ${AMBER}` } : {}) }}>
          <Name
            type={onOpen ? 'button' : undefined}
            onClick={onOpen}
            className={cn('text-left text-[11px] font-semibold', onOpen && 'hover:underline cursor-pointer')}
            style={{ color: 'var(--text)' }}
          >
            {r.firm_name}
          </Name>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {r.ref_no ? <span className="text-[10px] text-secondary font-mono">{r.ref_no}</span> : null}
            {r.is_renewal ? <Chip tone="var(--tone-blue)">Renewal</Chip> : null}
            {r.foreign_currency ? <Chip tone={AMBER}>Not in PHP</Chip> : null}
          </div>
        </td>
        <td rowSpan={span} className={cn(merged, 'whitespace-nowrap')} style={cellStyle}>
          {fmtDate(r.date_registration)}
        </td>
        <td rowSpan={span} className={cn(merged, 'whitespace-nowrap')} style={cellStyle}>
          {r.date_approval ? fmtDate(r.date_approval) : <span className="text-secondary">—</span>}
        </td>
        <StockholderCells s={first} style={cellStyle} />
        <td rowSpan={span} className={cn(merged, 'text-[11px] min-w-[240px] max-w-[360px]')} style={cellStyle}>
          {r.activity || <span className="text-secondary">—</span>}
        </td>
        <td rowSpan={span} className={cn(merged, 'text-right tabular-nums whitespace-nowrap')} style={cellStyle}>
          {millions(r.project_cost, r.project_cost_text, 3)}
        </td>
        <td rowSpan={span} className={cn(merged, 'text-right tabular-nums whitespace-nowrap')} style={cellStyle}>
          {millions(r.paid_up_capital, r.paid_up_capital_text, 2)}
        </td>
        <td rowSpan={span} className={cn(merged, 'text-right tabular-nums')} style={cellStyle}>
          {r.labor == null ? '—' : r.labor.toLocaleString('en-US')}
        </td>
      </tr>
      {r.stockholders.slice(1).map((s, i) => (
        <tr key={i}>
          <StockholderCells s={s} style={cellStyle} />
        </tr>
      ))}
    </>
  );
}

function StockholderCells({ s, style }: { s?: { nationality: string | null; ownership: number }; style: React.CSSProperties }) {
  return (
    <>
      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ ...style, borderTop: '1px dashed var(--border-subtle)' }}>
        {s ? s.nationality ? titleCase(s.nationality) : 'Not specified' : <span className="text-secondary">No stockholders</span>}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums" style={{ ...style, borderTop: '1px dashed var(--border-subtle)' }}>
        {s ? pct(s.ownership) : ''}
      </td>
    </>
  );
}

/** "HONG KONG" → "Hong Kong", as the template writes nationalities. */
function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
