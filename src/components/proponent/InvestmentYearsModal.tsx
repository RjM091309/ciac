import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';

export type InvestmentYear = {
  year_no: number;
  investment_commitment: string;
  investment_actual: string;
  employee_commitment: string;
  employee_actual: string;
};
type FieldKey = Exclude<keyof InvestmentYear, 'year_no'>;

const hasFigures = (y: InvestmentYear) =>
  [y.investment_commitment, y.investment_actual, y.employee_commitment, y.employee_actual].some((v) => v.trim());
const num = (v: string) => {
  const n = Number(String(v || '').replace(/,/g, ''));
  return String(v || '').trim() && Number.isFinite(n) ? n : null;
};
/** Actual as a share of the commitment, or null when there's no commitment. */
const progressOf = (commitment: string, actual: string) => {
  const c = num(commitment);
  if (c === null || c <= 0) return null;
  return Math.round(((num(actual) ?? 0) / c) * 100);
};
const toneOf = (pct: number) => (pct >= 100 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626');

function ProgressCell({ commitment, actual }: { commitment: string; actual: string }) {
  const pct = progressOf(commitment, actual);
  if (pct === null) return <span className="text-[11px] text-secondary">—</span>;
  const tone = toneOf(pct);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--control-bg)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: tone }} />
      </div>
      <span className="w-10 text-right text-[11px] font-bold tabular-nums" style={{ color: tone }}>
        {pct}%
      </span>
    </div>
  );
}

/**
 * Performance Commitment per lease year (4-10), in a pop-up: a summary strip,
 * the years as a row of chips, and the chosen year's Investment / Employees
 * (commitment, actual, progress). Edits go to the card's form; saved with the
 * card's Save.
 */
export function InvestmentYearsModal({
  open,
  years,
  currentYear,
  yearStart,
  totals,
  disabled,
  format,
  onChange,
  onAddYear,
  onClose,
}: {
  open: boolean;
  years: InvestmentYear[];
  currentYear: number;
  /** "Feb 26, 2026" for a year, or '' when the lease has no Start Term. */
  yearStart: (yearNo: number) => string;
  totals: Record<FieldKey, string>;
  disabled?: boolean;
  format: { typing: (key: FieldKey, value: string) => string; leaving: (key: FieldKey, value: string) => string };
  onChange: (yearNo: number, patch: Partial<InvestmentYear>) => void;
  onAddYear: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(currentYear);

  useEffect(() => {
    if (open) setSelected(currentYear);
  }, [open, currentYear]);


  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const border = { borderColor: 'var(--input-border)' };
  const year = years.find((y) => y.year_no === selected) ?? years[0];
  const index = year ? years.indexOf(year) : -1;
  const yearOf = (n: number) => (yearStart(n) ? yearStart(n).slice(-4) : '');
  const go = (step: number) => {
    const target = years[index + step];
    if (target) setSelected(target.year_no);
  };

  const input = (key: FieldKey, money: boolean) =>
    year ? (
      <div className="app-form-control flex h-10 items-stretch overflow-hidden p-0">
        {money ? (
          <span className="flex items-center pl-3 text-[12px] font-semibold text-secondary" aria-hidden>
            ₱
          </span>
        ) : null}
        <input
          className="w-0 min-w-0 flex-1 border-0 bg-transparent px-3 text-right text-[13px] font-semibold tabular-nums outline-none"
          style={{ color: 'var(--text)' }}
          inputMode={money ? 'decimal' : 'numeric'}
          placeholder={money ? '0.00' : '0'}
          value={year[key]}
          disabled={disabled}
          aria-label={key.replace(/_/g, ' ')}
          onChange={(e) => onChange(year.year_no, { [key]: format.typing(key, e.target.value) })}
          onBlur={() => {
            const next = format.leaving(key, year[key]);
            if (next !== year[key]) onChange(year.year_no, { [key]: next });
          }}
        />
      </div>
    ) : null;

  const rows = [
    { label: 'Investment', c: 'investment_commitment', a: 'investment_actual', money: true },
    { label: 'No. of Employees', c: 'employee_commitment', a: 'employee_actual', money: false },
  ] as const;

  const range = year && yearStart(year.year_no)
    ? `${yearStart(year.year_no)}${yearStart(year.year_no + 1) ? ` – ${yearStart(year.year_no + 1)}` : ''}`
    : '';
  const filledCount = years.filter(hasFigures).length;

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-start justify-center px-3 pt-[6vh]">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div
        className="relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Performance Commitment per lease year"
      >
        {/* Title */}
        <div className="flex items-start justify-between gap-3 border-b px-6 py-4" style={border}>
          <div>
            <div className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>
              Performance Commitment
            </div>
            <div className="mt-0.5 text-[11px] text-secondary">
              {years.length} lease year{years.length === 1 ? '' : 's'} · {filledCount} filled in
            </div>
          </div>
          <button type="button" className="rounded-lg p-1.5 text-secondary hover:bg-[var(--hover-bg)]" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Overall, across every year */}
        <div className="grid grid-cols-1 gap-3 px-6 pt-4 sm:grid-cols-2">
          {(
            [
              ['Total Investment', 'investment_commitment', 'investment_actual', '₱ ', 'Adds up across the years'],
              ['Peak Employees', 'employee_commitment', 'employee_actual', '', 'The highest year'],
            ] as const
          ).map(([label, c, a, prefix, hint]) => {
            const pct = progressOf(totals[c], totals[a]);
            const empty = !totals[c] && !totals[a];
            return (
              <div key={label} className="rounded-xl border px-4 py-3" style={border}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-secondary">{label}</span>
                  <span className="text-[10px] text-secondary">{hint}</span>
                </div>
                {empty ? (
                  <div className="mt-1.5 text-[12px] italic text-secondary">Nothing filled in yet</div>
                ) : (
                  <>
                    <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                      <span className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>
                        {totals[a] ? `${prefix}${totals[a]}` : `${prefix}0`}
                      </span>
                      <span className="text-[11px] text-secondary">
                        actual of {totals[c] ? `${prefix}${totals[c]}` : '—'} committed
                      </span>
                    </div>
                    {pct !== null ? (
                      <div className="mt-2">
                        <ProgressCell commitment={totals[c]} actual={totals[a]} />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {years.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs text-secondary">
            Set the lease's Start and End Term — one entry per lease year appears here.
          </div>
        ) : (
          <div className="mx-6 mt-4 grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border sm:grid-cols-[13rem_minmax(0,1fr)]" style={border}>
            {/* Years — a list like a file explorer; the chosen one is highlighted */}
            <div className="flex min-h-0 flex-col border-b sm:border-b-0 sm:border-r" style={border}>
              <div className="px-3 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-widest text-secondary">Lease years</div>
              <div className="hover-scrollbar max-h-40 flex-1 overflow-y-auto px-2 pb-2 sm:max-h-[19rem]">
                {years.map((y) => {
                  const active = y.year_no === year?.year_no;
                  const current = y.year_no === currentYear;
                  const filled = hasFigures(y);
                  return (
                    <button
                      key={y.year_no}
                      type="button"
                      ref={(el) => {
                        if (el && active) el.scrollIntoView({ block: 'nearest' });
                      }}
                      onClick={() => setSelected(y.year_no)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left cursor-pointer transition-colors ${
                        active ? '' : 'hover:bg-[var(--selected-bg)]'
                      }`}
                      style={active ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' } : { color: 'var(--text)' }}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={
                          filled
                            ? { backgroundColor: '#16a34a' }
                            : { border: '1.5px solid', borderColor: active ? 'currentColor' : 'var(--input-border)', opacity: active ? 0.6 : 1 }
                        }
                        title={filled ? 'Filled in' : 'Not filled in'}
                      />
                      <span className="text-[12px] font-semibold">Year {y.year_no}</span>
                      <span className="text-[11px] tabular-nums" style={{ opacity: 0.6 }}>
                        {yearOf(y.year_no)}
                      </span>
                      {current ? (
                        <span
                          className="ml-auto rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
                          style={
                            active
                              ? { backgroundColor: 'rgba(255,255,255,.2)' }
                              : { backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: '#15803d' }
                          }
                        >
                          Now
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="border-t p-2" style={border}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onAddYear();
                    setSelected(years.length + 1);
                  }}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-1.5 text-[11px] font-semibold text-secondary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[var(--selected-bg)]"
                  style={border}
                  title="A year beyond the lease term (e.g. an extension)"
                >
                  <Plus size={12} /> Add year
                </button>
              </div>
            </div>

            {/* The chosen year */}
            {year ? (
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center justify-between gap-2 border-b px-5 py-3" style={border}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
                        Year {year.year_no}
                      </span>
                      {year.year_no === currentYear ? (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: '#15803d' }}>
                          Current year
                        </span>
                      ) : null}
                    </div>
                    {range ? <div className="mt-0.5 text-[11px] text-secondary">{range}</div> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {[
                      { step: -1, off: index <= 0, icon: <ChevronLeft size={15} />, label: 'Previous year' },
                      { step: 1, off: index >= years.length - 1, icon: <ChevronRight size={15} />, label: 'Next year' },
                    ].map((b) => (
                      <button
                        key={b.step}
                        type="button"
                        disabled={b.off}
                        onClick={() => go(b.step)}
                        className="grid h-8 w-8 place-items-center rounded-lg border cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[var(--selected-bg)]"
                        style={{ ...border, color: 'var(--text)' }}
                        aria-label={b.label}
                        title={b.label}
                      >
                        {b.icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-4 px-5 py-4">
                  {rows.map((r) => {
                    const pct = progressOf(year[r.c], year[r.a]);
                    return (
                      <div key={r.label}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[12px] font-bold" style={{ color: 'var(--text)' }}>
                            {r.label}
                          </span>
                          {pct !== null ? (
                            <span className="text-[11px] text-secondary">
                              <span className="font-bold tabular-nums" style={{ color: toneOf(pct) }}>
                                {pct}%
                              </span>{' '}
                              of commitment
                            </span>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {(
                            [
                              ['Commitment', r.c],
                              ['Actual', r.a],
                            ] as const
                          ).map(([h, key]) => (
                            <label key={h} className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-secondary">{h}</span>
                              {input(key, r.money)}
                            </label>
                          ))}
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--control-bg)' }}>
                          {pct !== null ? (
                            <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: toneOf(pct) }} />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t px-6 py-3" style={border}>
          <span className="text-[11px] text-secondary">Saved together with the locator's Save.</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-5 py-2 text-[12px] font-semibold cursor-pointer hover:opacity-90"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
