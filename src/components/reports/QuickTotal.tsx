import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, FileText, Loader2, Sigma } from 'lucide-react';
import { toast } from 'sonner';
import { AppSelect } from '../ui/AppSelect';
import { downloadPdf, downloadWorkbook, type XlsxColumn } from './reportExports';
import { fmtDate } from './reportParts';

// Custom Report → Quick total: "Total [Investment] by [Nationality] as of
// [2025]" — one sentence, one summary table (server: CustomReport.quickTotal).
// The Registered Locators filters set in the Custom Report apply too.

type Opt = { value: string; label: string };
type Group = { label: string; locators: number; values: Record<string, number> };
type Result = {
  measure: { key: string; label: string };
  by: { key: string; label: string };
  period: 'asof' | 'in';
  year: number;
  as_of: string | null;
  fields: string[];
  groups: Group[];
  totals: { locators: number; values: Record<string, number> };
  without_value: number;
  /** Per type (Committed / Actual): locators with no figure. */
  without?: Record<string, number>;
};

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json.data as T;
}

/** The sentence "Total [measure] by [by] as of / in [year]" — kept in a Custom Report template. */
export type TotalsConfig = { measure: string; by: string; period: 'asof' | 'in'; year: string };
export const defaultTotalsConfig = (): TotalsConfig => ({
  measure: 'investment',
  by: 'nationality',
  period: 'asof',
  year: String(new Date().getFullYear()),
});

export function QuickTotal({
  filters,
  filterText,
  embedded = false,
  config,
  onConfigChange,
}: {
  filters: Record<string, string>;
  filterText: string;
  /** Inside the Custom Report's result panel (its Totals mode): no card or heading of its own. */
  embedded?: boolean;
  /** Controlled by the page (so a template can save / restore it); else kept here. */
  config?: TotalsConfig;
  onConfigChange?: (next: TotalsConfig) => void;
}) {
  const thisYear = new Date().getFullYear();
  const [opts, setOpts] = useState<{ measures: Opt[]; by: Opt[] } | null>(null);
  const [own, setOwn] = useState<TotalsConfig>(defaultTotalsConfig);
  const cfg = config ?? own;
  const setCfg = (patch: Partial<TotalsConfig>) => {
    const next = { ...cfg, ...patch };
    if (onConfigChange) onConfigChange(next);
    else setOwn(next);
  };
  const { measure, by, period, year } = cfg;
  const setMeasure = (v: string) => setCfg({ measure: v });
  const setBy = (v: string) => setCfg({ by: v });
  const setPeriod = (v: 'asof' | 'in') => setCfg({ period: v });
  const setYear = (v: string) => setCfg({ year: v });
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch('/api/reports/custom/quick-total/options', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => setOpts(j.data || null))
      .catch(() => setOpts(null));
  }, []);

  const years = useMemo(
    () => Array.from({ length: thisYear - 1999 }, (_, i) => String(thisYear - i)).map((y) => ({ value: y, label: y })),
    [thisYear]
  );

  // Live, like the List: recomputed (debounced) whenever the sentence or the
  // Custom Report's filters change; a stale answer never replaces a newer one.
  const filtersKey = JSON.stringify(filters);
  const requestSeq = useRef(0);
  useEffect(() => {
    if (!opts) return undefined;
    const seq = ++requestSeq.current;
    const t = window.setTimeout(async () => {
      setRunning(true);
      try {
        const data = await post<Result>('/api/reports/custom/quick-total', {
          measure,
          by,
          period,
          year: Number(year),
          filters: JSON.parse(filtersKey),
        });
        if (seq === requestSeq.current) setResult(data);
      } catch (e: any) {
        if (seq === requestSeq.current) toast.error(e?.message || 'Could not compute the total');
      } finally {
        if (seq === requestSeq.current) setRunning(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [opts, measure, by, period, year, filtersKey]);

  const isCount = result?.measure.key === 'locators';
  // Columns of figures: the locator count, then the measure (per currency for investment).
  const valueCols = result
    ? result.fields.map((f) => ({
        key: f,
        // "Committed PHP" → "Committed (PHP)"; employees: "Committed"; area: the measure.
        label:
          f === 'value'
            ? result.measure.label
            : /^(PHP|USD)$/.test(f)
              ? `${result.measure.label} (${f})`
              : f.replace(/^(\w+) (PHP|USD)$/, '$1 ($2)'),
      }))
    : [];
  const shareOf = (g: Group) => {
    if (!result) return 0;
    if (isCount || !valueCols.length) return result.totals.locators ? g.locators / result.totals.locators : 0;
    const f = valueCols[0].key;
    return result.totals.values[f] ? (g.values[f] || 0) / result.totals.values[f] : 0;
  };

  const title = result
    ? `Total ${result.measure.label} by ${result.by.label} ${result.period === 'in' ? `in ${result.year}` : `as of ${fmtDate(result.as_of)}`}`
    : '';
  const subtitle = [filterText, result?.by.key === 'nationality' ? 'Amounts split by stockholder ownership; a locator is counted under its largest nationality' : '']
    .filter(Boolean)
    .join(' · ');

  async function exportFile(kind: 'xlsx' | 'pdf') {
    if (!result) return;
    setExporting(true);
    try {
      const base = title.replace(/[^A-Za-z0-9]+/g, '-');
      if (kind === 'xlsx') {
        const columns: XlsxColumn[] = [
          { header: result.by.label, width: 36 },
          { header: 'Locators', width: 12, align: 'right' },
          ...valueCols.map((c) => ({ header: c.label, width: 20, align: 'right' as const, numFmt: '#,##0.##' })),
          { header: '% Share', width: 10, align: 'right', numFmt: '0.0%' },
        ];
        await downloadWorkbook(`${base}.xlsx`, title.toUpperCase(), [
          {
            name: 'Total',
            subtitle,
            columns,
            groups: [
              ...result.groups.map((g) => ({ lines: [[g.label, g.locators, ...valueCols.map((c) => g.values[c.key] || 0), shareOf(g)]] })),
              { lines: [['TOTAL', result.totals.locators, ...valueCols.map((c) => result.totals.values[c.key] || 0), 1]], highlight: true },
            ],
            empty: 'No locators for this period.',
          },
        ]);
      } else {
        await downloadPdf(`${base}.pdf`, title.toUpperCase(), subtitle, [
          {
            heading: title,
            columns: [result.by.label, 'Locators', ...valueCols.map((c) => c.label), '% Share'],
            body: [
              ...result.groups.map((g) => [g.label, fmt(g.locators), ...valueCols.map((c) => fmt(g.values[c.key] || 0)), `${(shareOf(g) * 100).toFixed(1)}%`]),
              ['TOTAL', fmt(result.totals.locators), ...valueCols.map((c) => fmt(result.totals.values[c.key] || 0)), '100%'],
            ],
            aligns: ['left', 'right', ...valueCols.map(() => 'right' as const), 'right'],
            empty: 'No locators for this period.',
          },
        ]);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const word = 'text-[12.5px] font-semibold text-secondary';
  return (
    <div
      className={embedded ? '' : 'rounded-2xl border'}
      style={
        embedded
          ? undefined
          : {
              borderColor: 'var(--border-subtle)',
              backgroundColor: 'var(--surface)',
              boxShadow: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.05)',
            }
      }
    >
      {embedded ? null : (
        <div
          className="flex items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, var(--surface))' }}
        >
          <Sigma size={14} className="text-secondary" />
          <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>
            Quick total
          </span>
          <span className="text-[11px] text-secondary">Registered Locators · uses the filters set below</span>
        </div>
      )}

      {/* The sentence: Total [measure] by [group] as of / in [year] */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className={word}>Total</span>
        <div className="w-48">
          <AppSelect compact isClearable={false} value={measure} onChange={(v) => setMeasure(String(v || 'locators'))} options={opts?.measures || []} />
        </div>
        <span className={word}>by</span>
        <div className="w-60">
          <AppSelect compact isClearable={false} value={by} onChange={(v) => setBy(String(v || 'industry'))} options={opts?.by || []} />
        </div>
        <div className="w-36">
          <AppSelect
            compact
            isClearable={false}
            value={period}
            onChange={(v) => setPeriod(v === 'in' ? 'in' : 'asof')}
            options={[
              { value: 'asof', label: 'as of' },
              { value: 'in', label: 'signed in' },
            ]}
          />
        </div>
        <div className="w-28">
          <AppSelect compact isClearable={false} value={year} onChange={(v) => setYear(String(v || thisYear))} options={years} />
        </div>
        {running ? <Loader2 size={14} className="animate-spin text-secondary" /> : null}
        {result ? (
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              disabled={exporting}
              onClick={() => exportFile('xlsx')}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
            >
              <FileSpreadsheet size={13} /> Excel
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => exportFile('pdf')}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
            >
              <FileText size={13} /> PDF
            </button>
          </span>
        ) : null}
      </div>

      {result ? (
        <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="mb-2 text-[13px] font-bold" style={{ color: 'var(--text)' }}>
            {title}
          </div>
          <div className="mb-2 text-[11px] text-secondary">
            {result.period === 'in'
              ? `Locators with a lease agreement signed in ${result.year} (new or renewal).`
              : `Locators with a lease in effect on ${fmtDate(result.as_of)}.`}
            {result.by.key === 'nationality' ? ' Amounts are split by stockholder ownership %; each locator is counted once, under its largest nationality.' : ''}
            {!isCount && result.without && Object.keys(result.without).length
              ? ` Not encoded: ${Object.entries(result.without)
                  .map(([type, n]) => `${type.toLowerCase()} — ${n} of ${result.totals.locators}`)
                  .join(', ')}.`
              : !isCount && result.without_value
                ? ` ${result.without_value} of ${result.totals.locators} locator${result.totals.locators === 1 ? '' : 's'} have no ${result.measure.label.toLowerCase()} encoded.`
                : ''}
            {valueCols.length > 1 ? ` Share is of the ${valueCols[0].label.toLowerCase()} total.` : ''}
          </div>
          <div
            className={embedded ? 'overflow-x-auto rounded-xl border hover-scrollbar' : 'max-h-96 overflow-auto rounded-xl border hover-scrollbar'}
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="sticky top-0" style={{ backgroundColor: 'var(--surface)' }}>
                <tr className="text-[10px] uppercase tracking-wider text-secondary">
                  <th className="border-b px-3 py-2 font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>{result.by.label}</th>
                  <th className="border-b px-3 py-2 text-right font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>Locators</th>
                  {valueCols.map((c) => (
                    <th key={c.key} className="border-b px-3 py-2 text-right font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>
                      {c.label}
                    </th>
                  ))}
                  <th className="w-1/4 border-b px-3 py-2 font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {result.groups.map((g) => {
                  const pct = shareOf(g) * 100;
                  return (
                    <tr key={g.label} className="border-t hover:bg-[var(--selected-bg)]" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-1.5" style={{ color: g.label === 'Not specified' ? 'var(--text-muted)' : 'var(--text)' }}>
                        {g.label}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text)' }}>
                        {fmt(g.locators)}
                      </td>
                      {valueCols.map((c) => (
                        <td key={c.key} className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
                          {fmt(g.values[c.key] || 0)}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--control-bg)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--nav-active-bg)' }} />
                          </div>
                          <span className="w-11 text-right text-[10.5px] tabular-nums text-secondary">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!result.groups.length ? (
                  <tr>
                    <td colSpan={3 + valueCols.length} className="px-3 py-4 text-center text-[11px] text-secondary">
                      No locators for this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(result.totals.locators)}</td>
                  {valueCols.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                      {fmt(result.totals.values[c.key] || 0)}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
