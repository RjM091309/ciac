import React, { useState } from 'react';
import { Popover } from '@mui/material';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

// A month picker ('YYYY-MM') in the app's style — the field opens a year with
// its twelve months (instead of the browser's native month input).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ym = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;

export function monthLabel(v?: string | null) {
  if (!v || !/^\d{4}-\d{2}$/.test(v)) return '';
  return `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`;
}

export function MonthPicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Pick a month',
  className = 'w-36',
}: {
  value: string;
  onChange: (next: string) => void;
  /** Earliest / latest month that can be picked ('YYYY-MM'). */
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [year, setYear] = useState(() => Number((value || min || '').slice(0, 4)) || new Date().getFullYear());
  const disabled = (v: string) => Boolean((min && v < min) || (max && v > max));

  return (
    <>
      <button
        type="button"
        className={`app-input relative inline-flex h-9 items-center pl-8 pr-3 text-left text-xs ${className}`}
        onClick={(e) => {
          setYear(Number((value || min || '').slice(0, 4)) || new Date().getFullYear());
          setAnchor(e.currentTarget);
        }}
      >
        <CalendarDays size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <span className={value ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}>{monthLabel(value) || placeholder}</span>
      </button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 0.5, borderRadius: '12px', overflow: 'hidden' } } }}
      >
        <div className="w-60 p-3" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              className="rounded-md p-1 text-secondary hover:bg-[var(--selected-bg)] disabled:opacity-30"
              disabled={Boolean(min && ym(year - 1, 11) < min)}
              onClick={() => setYear((y) => y - 1)}
              aria-label="Previous year"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[13px] font-bold tabular-nums">{year}</span>
            <button
              type="button"
              className="rounded-md p-1 text-secondary hover:bg-[var(--selected-bg)] disabled:opacity-30"
              disabled={Boolean(max && ym(year + 1, 0) > max)}
              onClick={() => setYear((y) => y + 1)}
              aria-label="Next year"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((label, i) => {
              const v = ym(year, i);
              const on = v === value;
              const off = disabled(v);
              return (
                <button
                  key={label}
                  type="button"
                  disabled={off}
                  onClick={() => {
                    onChange(v);
                    setAnchor(null);
                  }}
                  className="rounded-lg py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--selected-bg)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                  style={on ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' } : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </Popover>
    </>
  );
}
