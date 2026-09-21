import React, { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Box, Button, Popover } from '@mui/material';
import { alpha, styled } from '@mui/material/styles';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { PickersDay } from '@mui/x-date-pickers/PickersDay';

function formatRange(value: [Date | null, Date | null], placeholder: string = 'Enter Date') {
  const [start, end] = value;
  if (!start && !end) return placeholder;
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start && !end) return `${fmt(start)} –`;
  return '–– – ––';
}

type RangeDayProps = {
  isRangeMiddle?: boolean;
  isRangeStart?: boolean;
  isRangeEnd?: boolean;
};

const RangePickersDay = styled(PickersDay, {
  shouldForwardProp: (prop) =>
    prop !== 'isRangeMiddle' && prop !== 'isRangeStart' && prop !== 'isRangeEnd',
})<RangeDayProps>(({ theme, isRangeMiddle, isRangeStart, isRangeEnd }) => {
  const stripBg =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.primary.main, 0.28)
      : alpha(theme.palette.primary.main, 0.14);
  const stripText = theme.palette.text.primary;

  return {
    ...(isRangeMiddle && {
      borderRadius: 0,
      backgroundColor: stripBg,
      color: stripText,
      fontWeight: 600,
      '&:hover, &:focus': {
        backgroundColor: alpha(
          theme.palette.primary.main,
          theme.palette.mode === 'dark' ? 0.38 : 0.22
        ),
      },
    }),
    ...((isRangeStart || isRangeEnd) && {
      zIndex: 1,
      backgroundColor: theme.palette.primary.main,
      color: theme.palette.primary.contrastText,
      fontWeight: 700,
      borderRadius: 0,
      '&:hover, &:focus': {
        backgroundColor: theme.palette.primary.dark,
      },
    }),
  };
});

/** 'YYYY-MM-DD' <-> local Date, without the UTC shift toISOString() would add. */
export function parseYmd(v: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
export function toYmd(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function stripTime(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function isBetweenInclusive(day: Date, start: Date, end: Date) {
  const t = day.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/** Rows the calendar grid needs for a month (Sunday-first). MUI reserves 6 rows
 * of height for every month, which leaves a gap under 4/5-row months. */
function weeksInMonth(month: Date) {
  const offset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Math.ceil((offset + days) / 7);
}

function getRelativeRange(days: number): [Date, Date] {
  const end = stripTime(new Date());
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  return [start, end];
}

function getTodayRange(): [Date, Date] {
  const today = stripTime(new Date());
  return [today, today];
}

function getYesterdayRange(): [Date, Date] {
  const day = stripTime(new Date());
  day.setDate(day.getDate() - 1);
  return [day, day];
}

function getMonthRange(offsetMonths: number): [Date, Date] {
  const now = stripTime(new Date());
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  return [start, end];
}

type PresetKey =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

function sameRange(a: [Date | null, Date | null], b: [Date, Date]) {
  const [as, ae] = a;
  return Boolean(as && ae && isSameDay(as, b[0]) && isSameDay(ae, b[1]));
}

function detectPreset(range: [Date | null, Date | null]): PresetKey {
  if (sameRange(range, getTodayRange())) return 'today';
  if (sameRange(range, getYesterdayRange())) return 'yesterday';
  if (sameRange(range, getRelativeRange(7))) return 'last7';
  if (sameRange(range, getRelativeRange(30))) return 'last30';
  if (sameRange(range, getMonthRange(0))) return 'thisMonth';
  if (sameRange(range, getMonthRange(-1))) return 'lastMonth';
  return 'custom';
}

export function DatePicker({
  value,
  onChange,
  compact = false,
  showPresets = false,
  mode = 'range',
  placeholder = 'Enter Date',
  fullWidth = false,
  rounded = 'full',
  dense = false,
  boxed = false,
  bordered = false,
}: {
  value: any;
  onChange: (next: any) => void;
  compact?: boolean;
  showPresets?: boolean;
  mode?: 'single' | 'range';
  placeholder?: string;
  fullWidth?: boolean;
  /** Corner style of the trigger input. Defaults to the pill shape used
   * across the app; pass 'lg' to match app-form-control (0.5rem) in dense
   * forms that mix date pickers with plain inputs (e.g. the Locator edit form). */
  rounded?: 'full' | 'lg';
  /** Shrinks the trigger to app-form-control-sm's rendered height (28px)
   * instead of the app-wide default (36px), for forms that mix date pickers
   * with plain inputs in the same row (e.g. the Locator edit form). */
  dense?: boolean;
  /** Renders the trigger as the exact same bordered box as app-form-control
   * (border on the outer box, transparent/borderless input inside) instead
   * of the app-wide filled-pill look. Implies dense sizing. Use this to make
   * a date field pixel-match a plain text field it sits beside. */
  boxed?: boolean;
  /** Pill-shaped form field with a visible border and solid background (matches
   * AppSelect), instead of the borderless filter-bar look. */
  bordered?: boolean;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date());

  let rangeText = '';
  let start: Date | null = null;
  let end: Date | null = null;
  let isEmpty = true;
  let selectedPreset: PresetKey | null = null;

  if (mode === 'single') {
    isEmpty = !value;
    rangeText = value ? value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : placeholder;
  } else {
    rangeText = formatRange(value, placeholder);
    [start, end] = value || [null, null];
    isEmpty = !start && !end;
    selectedPreset = detectPreset(value || [null, null]);
  }
  // Month the calendar opens on (selected date, else today) — kept in sync via onMonthChange.
  const openMonth = (mode === 'single' ? value : start) || new Date();
  const weekRows = weeksInMonth(viewMonth);
  const presets: { key: PresetKey; label: string; range?: [Date, Date] }[] = [
    { key: 'today', label: 'Today', range: getTodayRange() },
    { key: 'yesterday', label: 'Yesterday', range: getYesterdayRange() },
    { key: 'last7', label: 'Last 7 Days', range: getRelativeRange(7) },
    { key: 'last30', label: 'Last 30 Days', range: getRelativeRange(30) },
    { key: 'thisMonth', label: 'This Month', range: getMonthRange(0) },
    { key: 'lastMonth', label: 'Last Month', range: getMonthRange(-1) },
    { key: 'custom', label: 'Custom range' },
  ];

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={(e) => {
            setViewMonth(openMonth);
            setAnchorEl(e.currentTarget);
          }}
          aria-label="Open date range picker"
          className="h-9 w-9 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
          }}
        >
          <CalendarDays size={16} />
        </button>
      ) : (
        <div
          className={`relative group w-full flex items-stretch ${
            boxed ? 'app-form-control app-form-control-sm p-0 overflow-hidden' : ''
          } ${fullWidth || boxed ? '' : 'sm:w-36 md:w-44 lg:w-64 xl:w-72 max-w-[170px] lg:max-w-none'}`}
        >
          <CalendarDays
            className={`absolute ${dense || boxed ? 'left-2' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none`}
            size={dense || boxed ? 12 : 14}
          />
          <input
            type="text"
            readOnly
            value={isEmpty ? '' : rangeText}
            placeholder={placeholder}
            aria-label="Date range"
            onClick={(e) => {
              setViewMonth(openMonth);
              setAnchorEl(e.currentTarget);
            }}
            className={
              boxed
                ? 'flex-1 min-w-0 border-0 bg-transparent outline-none pl-7 pr-2 py-1 text-xs w-full text-[var(--text)] placeholder:text-[var(--text-muted)] cursor-pointer'
                : `${dense ? 'h-7 pl-7 pr-2' : `${bordered ? 'h-8 border' : 'h-9'} pl-9 pr-3`} ${rounded === 'lg' ? 'rounded-lg' : 'rounded-full'} text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all cursor-pointer`
            }
            style={
              boxed
                ? { opacity: isEmpty ? 0.72 : 1, whiteSpace: 'nowrap' }
                : {
                    ...(bordered
                      ? { backgroundColor: 'var(--surface)', borderColor: 'var(--input-border)' }
                      : { backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }),
                    opacity: isEmpty && !bordered ? 0.72 : 1,
                    whiteSpace: 'nowrap',
                  }
            }
          />
        </div>
      )}

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              overflow: 'hidden',
              borderRadius: 0,
              // Tighter shell: hug calendar + presets; content sizes (cells, fonts) unchanged below
              width: { xs: 'calc(100vw - 12px)', sm: 'max-content' },
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: { xs: 'min(88vh, 640px)', sm: 'none' },
            },
          },
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: showPresets ? { xs: '1fr', sm: '128px max-content' } : 'max-content',
            minHeight: { xs: 'auto', sm: 'auto' },
            maxHeight: { xs: 'calc(88vh - 160px)', sm: 'none' },
            overflowY: { xs: 'auto', sm: 'visible' },
          }}
        >
          {showPresets ? (
            <Box
              sx={{
                p: 0.75,
                borderRight: {
                  xs: 'none',
                  sm: (t) =>
                    `1px solid ${t.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'}`,
                },
                borderBottom: {
                  xs: (t) =>
                    `1px solid ${t.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'}`,
                  sm: 'none',
                },
                display: 'flex',
                flexDirection: { xs: 'row', sm: 'column' },
                flexWrap: { xs: 'wrap', sm: 'nowrap' },
                gap: 0.5,
              }}
            >
              {presets.map((preset) => {
                const active = selectedPreset === preset.key;
                return (
                  <Button
                    key={preset.key}
                    size="small"
                    variant={active ? 'contained' : 'text'}
                    onClick={() => {
                      if (preset.range) onChange(preset.range);
                    }}
                    sx={{
                      justifyContent: 'flex-start',
                      textTransform: 'none',
                      px: 1.2,
                      py: 0.7,
                      borderRadius: 0,
                      minHeight: 34,
                      fontSize: 13,
                      flex: { xs: '1 1 calc(50% - 4px)', sm: 'initial' },
                      minWidth: 0,
                    }}
                  >
                    {preset.label}
                  </Button>
                );
              })}
            </Box>
          ) : null}

          <DateCalendar
            value={mode === 'single' ? value : start}
            onMonthChange={setViewMonth}
            onChange={(picked) => {
              if (!picked) return;
              const day = stripTime(picked);

              if (mode === 'single') {
                onChange(day);
                setAnchorEl(null);
                return;
              }

              if (!start || (start && end)) {
                onChange([day, null]);
                return;
              }

              const s = stripTime(start);
              if (day.getTime() < s.getTime()) {
                onChange([day, null]);
                return;
              }
              onChange([s, day]);
            }}
            sx={{
              width: { xs: '100%', sm: 'max-content' },
              maxWidth: '100%',
              // MUI pins the calendar root to a fixed 336px; let it hug its content instead
              height: 'auto',
              mx: { xs: 'auto', sm: 0 },
              px: { xs: 1.5, sm: 2 },
              pt: { xs: 1.5, sm: 2 },
              pb: { xs: 1, sm: 1.5 },
              // Trim chrome only — day cell px & font sizes stay the same
              '& .MuiDateCalendar-root': { p: 0, margin: 0, width: 'max-content', maxWidth: '100%' },
              '& .MuiPickersCalendarHeader-root': {
                pl: { xs: 0.5, sm: 0.75 },
                pr: { xs: 0.5, sm: 0.75 },
                pt: 0,
                pb: 0.25,
                margin: 0,
                minHeight: 0,
              },
              '& .MuiPickersCalendarHeader-label': { fontSize: { xs: '1.1rem', sm: '1.25rem' }, fontWeight: 600 },
              '& .MuiDayCalendar-header': { px: { xs: 0.25, sm: 0.5 }, marginTop: 0 },
              '& .MuiDayCalendar-weekContainer': { mx: { xs: 0, sm: 0 } },
              // Cell = day size + 2px margin top/bottom; size the grid to this month's rows only
              '& .MuiDayCalendar-slideTransition': { marginTop: 0, minHeight: { xs: weekRows * 36, sm: weekRows * 40 } },
              '& .MuiDayCalendar-weekDayLabel': {
                width: { xs: 32, sm: 36 },
                fontSize: { xs: 11, sm: 12 },
              },
              '& .MuiIconButton-root, & .MuiPickersCalendarHeader-switchViewButton': { borderRadius: 0 },
              '& .MuiPickersDay-root': {
                borderRadius: 0,
                width: { xs: 32, sm: 36 },
                height: { xs: 32, sm: 36 },
                fontSize: { xs: 13, sm: 14 },
              },
            }}
            slots={
              mode === 'single'
                ? undefined
                : {
                    day: (dayProps) => {
                      const day = stripTime(dayProps.day as Date);
                      const s = start ? stripTime(start) : null;
                      const e = end ? stripTime(end) : null;

                      const inSpan = Boolean(s && e && isBetweenInclusive(day, s, e));
                      const isStart = Boolean(s && isSameDay(day, s));
                      const isEnd = Boolean(e && isSameDay(day, e));
                      const isRangeMiddle = Boolean(inSpan && !isStart && !isEnd);
                      const selected = Boolean(isStart || isEnd);

                      return (
                        <RangePickersDay
                          {...dayProps}
                          day={dayProps.day}
                          selected={selected}
                          isRangeMiddle={isRangeMiddle}
                          isRangeStart={isStart}
                          isRangeEnd={isEnd}
                        />
                      );
                    },
                  }
            }
          />
        </Box>

        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 0.75,
            px: { xs: 1.5, sm: 2 },
            pb: { xs: 1.5, sm: 2 },
            pt: { xs: 0.5, sm: 0.5 },
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' } }}>
            <Button
              size="small"
              fullWidth
              sx={{ borderRadius: 0 }}
              onClick={() => {
                onChange(mode === 'single' ? null : [null, null]);
                if (mode === 'single') setAnchorEl(null);
              }}
            >
              Clear
            </Button>
            <Button size="small" variant="contained" onClick={() => setAnchorEl(null)} fullWidth sx={{ borderRadius: 0 }}>
              Save
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
