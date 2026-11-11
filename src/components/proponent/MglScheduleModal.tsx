import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, X } from 'lucide-react';

/** One Property Schedule row, as the MGL Schedule needs it. */
export type MglSourceRow = {
  no: number;
  label: string; // e.g. "OPEN SPACE · 2026"
  /** The property the row is for: rows of one property (its yearly
   * escalations) share a column. */
  group: string;
  groupLabel: string; // e.g. "OPEN SPACE · 100 SQM"
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  mgl: number; // MGL per month
  currency: string;
};

type Month = {
  no: number;
  start: Date;
  end: Date;
  parts: { row: MglSourceRow; amount: number; prorated: boolean }[];
  totals: Record<string, number>;
};

const DAY = 86_400_000;
const parse = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
/** Same day N months later (clamped to the month's last day: Jan 31 + 1 = Feb 28). */
function addMonths(date: Date, n: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last)));
}
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY) + 1; // inclusive
const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * MGL Schedule (Property Schedule, "breakdown 1st to last month"): every month
 * from the first row's Date From to the last row's Date To. Months count from
 * the start date (Jan 8 – Feb 7, Feb 8 – Mar 7, …). Each month takes the
 * MGL/MO of every row covering it; a row covering only part of a month (a
 * rate change mid-month, or the last short month) is prorated by days.
 */
export function buildMglSchedule(rows: MglSourceRow[], stepMonths = 1): { months: Month[]; gaps: number[] } {
  const valid = rows.filter((r) => r.from && r.to && r.to >= r.from && Number.isFinite(r.mgl));
  if (!valid.length) return { months: [], gaps: [] };
  const first = parse(valid.map((r) => r.from).sort()[0]);
  const last = parse(valid.map((r) => r.to).sort().slice(-1)[0]);
  const months: Month[] = [];
  const gaps: number[] = [];
  for (let k = 0; k < 600; k += 1) {
    const start = addMonths(first, k * stepMonths);
    if (start > last) break;
    const nextStart = addMonths(first, (k + 1) * stepMonths);
    const end = new Date(Math.min(nextStart.getTime() - DAY, last.getTime()));
    const fullDays = days(start, new Date(nextStart.getTime() - DAY));
    const parts: Month['parts'] = [];
    const totals: Record<string, number> = {};
    for (const row of valid) {
      const from = parse(row.from);
      const to = parse(row.to);
      const ovStart = from > start ? from : start;
      const ovEnd = to < end ? to : end;
      if (ovEnd < ovStart) continue;
      const covered = days(ovStart, ovEnd);
      const prorated = covered < fullDays;
      const amount = round2(prorated ? (row.mgl * covered) / fullDays : row.mgl);
      parts.push({ row, amount, prorated });
      totals[row.currency] = round2((totals[row.currency] ?? 0) + amount);
    }
    if (!parts.length) gaps.push(k + 1);
    months.push({ no: k + 1, start, end, parts, totals });
  }
  return { months, gaps };
}

type Cell = { amount: number; prorated: boolean; currency: string } | null;
type Line =
  | { kind: 'month'; m: Month; cells: Record<string, Cell>; running: Record<string, number> }
  | { kind: 'year'; year: number; cells: Record<string, Record<string, number>>; total: Record<string, number> };

export function MglScheduleModal({
  open,
  rows,
  locatorName,
  period = 'MONTH',
  onClose,
}: {
  open: boolean;
  rows: MglSourceRow[];
  locatorName?: string;
  /** The lease's billing basis (4-04): a yearly lease is broken down by year. */
  period?: 'MONTH' | 'YEAR';
  onClose: () => void;
}) {
  const yearly = period === 'YEAR';
  const unitWord = yearly ? 'Year' : 'Month';
  const { months, gaps } = useMemo(() => buildMglSchedule(rows, yearly ? 12 : 1), [rows, yearly]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // One column per property (escalation rows of the same property share it).
  const groups: { key: string; label: string }[] = [];
  for (const r of rows) if (!groups.some((g) => g.key === r.group)) groups.push({ key: r.group, label: r.groupLabel });
  const currencies = Array.from(new Set(rows.map((r) => r.currency)));
  const single = currencies.length <= 1;
  const unit = single ? currencies[0] || 'PHP' : '';
  const show = (t: Record<string, number>) =>
    Object.keys(t).length
      ? Object.entries(t)
          .map(([cur, v]) => (single ? money(v) : `${money(v)} ${cur}`))
          .join(' + ')
      : '—';
  const add = (into: Record<string, number>, cur: string, v: number) => {
    into[cur] = round2((into[cur] ?? 0) + v);
  };

  const groupTotals: Record<string, Record<string, number>> = {};
  const grand: Record<string, number> = {};
  const lines: Line[] = [];
  let yearCells: Record<string, Record<string, number>> = {};
  let yearTotal: Record<string, number> = {};
  months.forEach((m, i) => {
    const cells: Record<string, Cell> = {};
    for (const g of groups) {
      const parts = m.parts.filter((p) => p.row.group === g.key);
      if (!parts.length) {
        cells[g.key] = null;
        continue;
      }
      const amount = round2(parts.reduce((sum, p) => sum + p.amount, 0));
      const currency = parts[0].row.currency;
      cells[g.key] = { amount, prorated: parts.some((p) => p.prorated), currency };
      groupTotals[g.key] = groupTotals[g.key] ?? {};
      add(groupTotals[g.key], currency, amount);
      yearCells[g.key] = yearCells[g.key] ?? {};
      add(yearCells[g.key], currency, amount);
    }
    for (const [cur, v] of Object.entries(m.totals)) {
      add(grand, cur, v);
      add(yearTotal, cur, v);
    }
    lines.push({ kind: 'month', m, cells, running: { ...grand } });
    // A subtotal after every 12 months (one lease year), and after the last month.
    if (!yearly && ((i + 1) % 12 === 0 || i === months.length - 1)) {
      lines.push({ kind: 'year', year: Math.floor(i / 12) + 1, cells: yearCells, total: yearTotal });
      yearCells = {};
      yearTotal = {};
    }
  });

  // Only what isn't repeated: a property column only when there are several
  // (else it equals the total), year subtotals only past one lease year (else
  // they equal the grand total).
  const multi = groups.length > 1;
  const years = yearly ? 1 : Math.ceil(months.length / 12);
  const anyProrated = months.some((m) => m.parts.some((p) => p.prorated));
  const shownLines = years > 1 ? lines : lines.filter((l) => l.kind === 'month');

  const border = { borderColor: 'var(--input-border)' };
  const th = (label: React.ReactNode, right: boolean, key: string) => (
    <th
      key={key}
      className={`px-2 py-2 font-semibold uppercase tracking-wide text-[9px] border-b whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={{ ...border, color: 'var(--text)', backgroundColor: 'var(--control-bg)' }}
    >
      {label}
    </th>
  );
  const num = 'px-2 py-1.5 border-b tabular-nums text-right whitespace-nowrap';

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-start justify-center px-3 pt-[6vh]">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div
        className="relative z-10 flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        role="dialog"
        aria-modal="true"
        aria-label="MGL Schedule"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={border}>
          <div className="flex items-start gap-2">
            <CalendarRange size={16} className="mt-0.5" style={{ color: 'var(--text)' }} />
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                MGL Schedule{locatorName ? ` — ${locatorName}` : ''}
              </div>
              <div className="text-[11px] text-secondary">
                {multi ? 'One column per property · ' : groups[0] ? `${groups[0].label} · ` : ''}
                {yearly ? 'yearly lease — years count' : 'months count'} from the start date
                {single && months.length ? ` · amounts in ${unit}` : ''}
              </div>
            </div>
          </div>
          <button type="button" className="rounded-md p-1 text-secondary hover:bg-[var(--hover-bg)]" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {months.length ? (
          <div className={`grid grid-cols-2 gap-2 border-b px-5 py-3 ${multi ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`} style={border}>
            {[
              [yearly ? 'Years' : 'Months', String(months.length)],
              ...(multi ? [['Properties', String(groups.length)]] : []),
              ['Period', `${fmtDate(months[0].start)} – ${fmtDate(months[months.length - 1].end)}`],
              ['Grand Total', `${show(grand)}${single ? ` ${unit}` : ''}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border px-3 py-2" style={border}>
                <div className="text-[9px] font-semibold uppercase tracking-widest text-secondary">{label}</div>
                <div className="truncate text-[13px] font-bold tabular-nums" style={{ color: 'var(--text)' }} title={value}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex-1 overflow-auto px-5 py-4">
          {months.length === 0 ? (
            <div className="py-10 text-center text-xs text-secondary">
              Nothing to compute yet — the Property Schedule needs rows with Date From, Date To and an MGL/MO.
            </div>
          ) : (
            <>
              {gaps.length ? (
                <div
                  className="mb-3 rounded-lg border px-3 py-2 text-[11px]"
                  style={{ borderColor: 'rgba(245,158,11,.35)', backgroundColor: 'rgba(245,158,11,.10)', color: '#b45309' }}
                >
                  No property row covers {unitWord.toLowerCase()}
                  {gaps.length > 1 ? 's' : ''} {gaps.join(', ')} — check the Property Schedule's dates.
                </div>
              ) : null}
              <div className="overflow-x-auto rounded-lg border" style={border}>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      {th(unitWord, false, 'month')}
                      {th('Period', false, 'period')}
                      {multi ? groups.map((g) => th(g.label, true, g.key)) : null}
                      {th(multi ? 'Total' : yearly ? 'MGL/YR' : 'MGL', true, 'total')}
                      {th('Running Total', true, 'running')}
                    </tr>
                  </thead>
                  <tbody>
                    {shownLines.map((line) =>
                      line.kind === 'month' ? (
                        <tr key={`m${line.m.no}`} style={{ backgroundColor: line.m.parts.length ? undefined : 'rgba(245,158,11,.06)' }}>
                          <td className="px-2 py-1.5 border-b font-semibold tabular-nums" style={{ ...border, color: 'var(--text)' }}>
                            {line.m.no}
                          </td>
                          <td className="px-2 py-1.5 border-b whitespace-nowrap" style={{ ...border, color: 'var(--text)' }}>
                            {fmtDate(line.m.start)} – {fmtDate(line.m.end)}
                          </td>
                          {(multi ? groups : []).map((g) => {
                            const c = line.cells[g.key];
                            return (
                              <td
                                key={g.key}
                                className={num}
                                style={{ ...border, color: c ? 'var(--text)' : 'var(--text-muted)' }}
                                title={c?.prorated ? 'Prorated — the row covers only part of this month' : undefined}
                              >
                                {c ? (
                                  <>
                                    {money(c.amount)}
                                    {single ? '' : ` ${c.currency}`}
                                    {c.prorated ? <span style={{ color: '#b45309' }}>*</span> : null}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </td>
                            );
                          })}
                          <td className={`${num} font-semibold`} style={{ ...border, color: 'var(--text)' }}>
                            {show(line.m.totals)}
                            {!multi && line.m.parts.some((p) => p.prorated) ? <span style={{ color: '#b45309' }}>*</span> : null}
                          </td>
                          <td className={`${num} text-secondary`} style={border}>
                            {show(line.running)}
                          </td>
                        </tr>
                      ) : (
                        <tr key={`y${line.year}`} style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}>
                          <td colSpan={2} className="px-2 py-1.5 border-b text-[11px] font-bold" style={{ ...border, color: 'var(--text)' }}>
                            Lease Year {line.year} — subtotal
                          </td>
                          {(multi ? groups : []).map((g) => (
                            <td key={g.key} className={`${num} font-semibold`} style={{ ...border, color: 'var(--text)' }}>
                              {line.cells[g.key] ? show(line.cells[g.key]) : '—'}
                            </td>
                          ))}
                          <td className={`${num} font-bold`} style={{ ...border, color: 'var(--text)' }}>
                            {show(line.total)}
                          </td>
                          <td className="border-b" style={border} />
                        </tr>
                      ),
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ backgroundColor: 'var(--control-bg)' }}>
                      <td colSpan={2} className="px-2 py-2 text-[11px] font-bold" style={{ color: 'var(--text)' }}>
                        Grand Total · {months.length} {unitWord.toLowerCase()}
                        {months.length === 1 ? '' : 's'}
                      </td>
                      {(multi ? groups : []).map((g) => (
                        <td key={g.key} className="px-2 py-2 text-right text-[11px] font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--text)' }}>
                          {groupTotals[g.key] ? show(groupTotals[g.key]) : '—'}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right text-[12px] font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--text)' }}>
                        {show(grand)}
                        {single ? ` ${unit}` : ''}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              {anyProrated ? (
                <div className="mt-2 text-[10px] text-secondary">
                  <span style={{ color: '#b45309' }}>*</span> Prorated — the property row covers only part of that{' '}
                  {unitWord.toLowerCase()}.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
