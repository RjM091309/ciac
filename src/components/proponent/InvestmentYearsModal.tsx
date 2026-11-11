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

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-start justify-center px-3 pt-[8vh]">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div
        className="relative z-10 flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Performance Commitment per lease year"
      >
        {/* Title */}
        <div className="flex items-center justify-between gap-3 px-6 pt-5">
          <div>
            <div className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>
              Performance Commitment
            </div>
            <div className="text-[11px] text-secondary">
              Per lease year · {years.length} year{years.length === 1 ? '' : 's'} · {years.filter(hasFigures).length} filled in
            </div>
          </div>
          <button type="button" className="rounded-lg p-1.5 text-secondary hover:bg-[var(--hover-bg)]" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Summary strip */}
        <div className="mx-6 mt-4 grid grid-cols-2 divide-x rounded-xl border" style={border}>
          {(
            [
              ['Total Investment', 'investment_commitment', 'investment_actual', '₱ '],
              ['Peak Employees', 'employee_commitment', 'employee_actual', ''],
            ] as const
          ).map(([label, c, a, prefix]) => {
            const pct = progressOf(totals[c], totals[a]);
            return (
              <div key={label} className="flex flex-col gap-1 px-4 py-3" style={border}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-secondary">{label}</span>
                  {pct !== null ? (
                    <span className="text-[10px] font-bold tabular-nums" style={{ color: toneOf(pct) }}>
                      {pct}%
                    </span>
                  ) : null}
                </div>
                <div className="flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>
                    {totals[a] ? `${prefix}${totals[a]}` : '—'}
                  </span>
                  <span className="text-[11px] text-secondary">of {totals[c] ? `${prefix}${totals[c]}` : '—'} committed</span>
                </div>
              </div>
            );
          })}
        </div>

        {years.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs text-secondary">
            Set the lease's Start and End Term — one entry per lease year appears here.
          </div>
        ) : (
          <>
            {/* Years */}
            <div className="mt-4 flex items-center gap-2 px-6">
              <button
                type="button"
                disabled={index <= 0}
                onClick={() => go(-1)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[var(--selected-bg)]"
                style={{ ...border, color: 'var(--text)' }}
                aria-label="Previous year"
              >
                <ChevronLeft size={15} />
              </button>
              {/* All years at once, no scrolling: at least 10 a line (two lines up to 26 years). */}
              <div
                className="grid flex-1 gap-1.5 py-1"
                style={{ gridTemplateColumns: `repeat(${Math.max(10, Math.min(13, Math.ceil(years.length / 2)))}, minmax(0, 1fr))` }}
              >
                {years.map((y) => {
                  const active = y.year_no === year?.year_no;
                  const current = y.year_no === currentYear;
                  const filled = hasFigures(y);
                  return (
                    <button
                      key={y.year_no}
                      type="button"
                      data-year={y.year_no}
                      onClick={() => setSelected(y.year_no)}
                      className="relative flex min-w-0 flex-col items-center rounded-lg border px-1 py-1.5 leading-tight cursor-pointer transition-colors"
                      style={
                        active
                          ? { backgroundColor: 'var(--nav-active-bg)', borderColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                          : { borderColor: current ? '#16a34a' : 'var(--input-border)', color: 'var(--text)' }
                      }
                      title={current ? 'Current lease year' : undefined}
                    >
                      <span className="text-[11px] font-bold">Y{y.year_no}</span>
                      <span className="text-[9px]" style={{ opacity: 0.65 }}>
                        {yearOf(y.year_no) || '—'}
                      </span>
                      {filled ? (
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ backgroundColor: '#16a34a' }} aria-label="filled in" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={index >= years.length - 1}
                onClick={() => go(1)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[var(--selected-bg)]"
                style={{ ...border, color: 'var(--text)' }}
                aria-label="Next year"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            {/* The chosen year */}
            {year ? (
              <div className="mx-6 mt-4 rounded-xl border" style={border}>
                <div className="flex items-baseline justify-between gap-2 border-b px-4 py-2.5" style={border}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>
                      Year {year.year_no}
                    </span>
                    {year.year_no === currentYear ? (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: '#15803d' }}>
                        Current
                      </span>
                    ) : null}
                  </div>
                  {yearStart(year.year_no) ? (
                    <span className="text-[11px] text-secondary">
                      {yearStart(year.year_no)}
                      {yearStart(year.year_no + 1) ? ` – ${yearStart(year.year_no + 1)}` : ''}
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)_7.5rem] items-center gap-x-3 gap-y-3 px-4 py-4">
                  <span />
                  {['Commitment', 'Actual', 'Progress'].map((h) => (
                    <span key={h} className="text-[9px] font-semibold uppercase tracking-widest text-secondary">
                      {h}
                    </span>
                  ))}
                  {rows.map((r) => (
                    <React.Fragment key={r.label}>
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                        {r.label}
                      </span>
                      {input(r.c, r.money)}
                      {input(r.a, r.money)}
                      <ProgressCell commitment={year[r.c]} actual={year[r.a]} />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between gap-2 border-t px-6 py-3" style={border}>
          <span className="text-[11px] text-secondary">Investment adds up across the years · Employees takes the highest year</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onAddYear();
                setSelected(years.length + 1);
              }}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-[12px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[var(--selected-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}
              title="A year beyond the lease term (e.g. an extension)"
            >
              <Plus size={13} /> Add year
            </button>
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
      </div>
    </div>,
    document.body,
  );
}
