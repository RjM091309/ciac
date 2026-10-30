// Shared by the period reports (Summary, Quarterly Investments, Locator
// Status) and GIS Filing: the year/quarter picker, stat tiles, the fetch
// hook, export buttons and the export audit call.
import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { AppSelect } from '../ui/AppSelect';
import { Skeleton } from '../ui/Skeleton';

/** quarter null = the whole year. */
export type Period = { year: number; quarter: number | null };
export type ServerPeriod = { year: number; quarter: number | null; from: string; to: string; label: string };

export const QUARTER_LABELS = ['1st Quarter', '2nd Quarter', '3rd Quarter', '4th Quarter'];

export function currentPeriod(): Period {
  const now = new Date();
  return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 };
}

export function periodLabel(p: Period) {
  return p.quarter ? `${QUARTER_LABELS[p.quarter - 1]} ${p.year}` : `Year ${p.year}`;
}

/** For file names: 2026-Q1 / 2026. */
export function periodSlug(p: Period) {
  return p.quarter ? `${p.year}-Q${p.quarter}` : String(p.year);
}

export function periodQuery(p: Period) {
  return `year=${p.year}${p.quarter ? `&quarter=${p.quarter}` : ''}`;
}

const FIRST_YEAR = 2000;

/** Only periods that have started (the server refuses later ones): years up
 * to this one, and this year's quarters up to the current one. */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const now = currentPeriod();
  const years = Array.from({ length: now.year - FIRST_YEAR + 1 }, (_, i) => String(now.year - i));
  const lastQuarter = (year: number) => (year === now.year ? (now.quarter as number) : 4);
  return (
    <div className="flex gap-2 w-full sm:w-auto">
      <div className="w-[104px] shrink-0">
        <AppSelect
          compact
          isClearable={false}
          value={String(value.year)}
          onChange={(v) => {
            if (!v) return;
            const year = Number(v);
            onChange({ year, quarter: value.quarter && value.quarter > lastQuarter(year) ? lastQuarter(year) : value.quarter });
          }}
          options={years.map((y) => ({ value: y, label: y }))}
        />
      </div>
      <div className="flex-1 sm:flex-none sm:w-40">
        <AppSelect
          compact
          isClearable={false}
          value={value.quarter ? String(value.quarter) : 'year'}
          onChange={(v) => onChange({ ...value, quarter: v === 'year' || !v ? null : Number(v) })}
          options={[
            ...QUARTER_LABELS.slice(0, lastQuarter(value.year)).map((label, i) => ({ value: String(i + 1), label })),
            { value: 'year', label: 'Whole year' },
          ]}
        />
      </div>
    </div>
  );
}

/** GET a report; keeps the last data on screen (dimmed by the caller) while a
 * new period loads. A failed load clears it, so an earlier period's numbers
 * never stay up under the new period, and says why. */
export function useReport<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(url, { credentials: 'include' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) throw new Error(json?.message || 'Failed to load the report');
        if (!cancelled) {
          setData(json.data);
          setError(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError((e as Error).message);
        toast.error((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { data, loading, initialLoading: loading && !data, error };
}

export function ReportTile({
  label,
  value,
  sub,
  tone,
  loading,
  active,
  onClick,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  loading?: boolean;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? Boolean(active) : undefined}
      className={cn(
        'rounded-xl px-2.5 sm:px-3 py-2.5 sm:py-3 flex flex-col justify-between gap-1 shadow-sm min-w-0 text-left border',
        onClick && 'cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-md',
        active ? 'border-[var(--text)]' : 'border-transparent',
        className
      )}
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <span className="text-[9px] sm:text-[10px] font-semibold text-secondary uppercase tracking-wide sm:tracking-widest leading-tight">{label}</span>
      {loading ? (
        <Skeleton className="h-[22px] w-12 rounded" />
      ) : (
        <span className="flex flex-col">
          <span className="text-lg font-bold leading-tight" style={{ color: tone || 'var(--text)' }}>
            {value}
          </span>
          {sub ? <span className="text-[10px] text-secondary leading-tight mt-0.5">{sub}</span> : null}
        </span>
      )}
    </Tag>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative group w-full sm:w-72">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
        style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
      />
    </div>
  );
}

export function ExportButtons({
  disabled,
  exporting,
  onExcel,
  onPdf,
}: {
  disabled?: boolean;
  exporting: 'xlsx' | 'pdf' | null;
  onExcel: () => void;
  onPdf: () => void;
}) {
  const cls =
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold border disabled:opacity-50 disabled:cursor-not-allowed';
  const style = { borderColor: 'var(--border)', color: 'var(--text)' };
  return (
    <div className="flex gap-2 md:ml-auto">
      <button type="button" onClick={onExcel} disabled={disabled || Boolean(exporting)} className={cls} style={style}>
        {exporting === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Export Excel
      </button>
      <button type="button" onClick={onPdf} disabled={disabled || Boolean(exporting)} className={cls} style={style}>
        {exporting === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Export PDF
      </button>
    </div>
  );
}

/** The file is built in the browser, so the server only learns of the export
 * from this call (audit log). Fire-and-forget. */
export function logReportExport(report: string, format: 'xlsx' | 'pdf', rowCount: number, filters: Record<string, string | number | undefined>) {
  fetch('/api/reports/export-log', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, format, rowCount, filters }),
  }).catch(() => {});
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(`${v.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Chip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ borderColor: tone ? `color-mix(in oklab, ${tone} 45%, transparent)` : 'var(--border-subtle)', color: tone || 'var(--text-secondary)' }}
    >
      {children}
    </span>
  );
}
