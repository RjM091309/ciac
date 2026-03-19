import React, { useMemo, useState } from 'react';
import { Bell, ChevronRight, Moon, Search, SunMedium, Zap } from 'lucide-react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Box, Button, Popover, TextField, Typography } from '@mui/material';
import { alpha, styled } from '@mui/material/styles';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { PickersDay } from '@mui/x-date-pickers/PickersDay';
import { useGlobalDate } from '../state/GlobalDateContext';

function formatRange(value: [Date | null, Date | null]) {
  const [start, end] = value;
  if (!start && !end) return 'Enter Date';
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

/** Material-style range: tinted strip between dates; solid primary circles on start/end. */
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
      borderRadius: '50%',
      '&:hover, &:focus': {
        backgroundColor: theme.palette.primary.dark,
      },
    }),
  };
});

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

function HeaderRangePicker({
  value,
  onChange,
}: {
  value: [Date | null, Date | null];
  onChange: (next: [Date | null, Date | null]) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const rangeText = formatRange(value);
  const [start, end] = value;
  const isEmpty = !start && !end;
  const selectedPreset = detectPreset(value);
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
      <TextField
        label="Date range"
        value={rangeText}
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        inputProps={{ readOnly: true }}
        sx={{
          minWidth: 190,
          cursor: 'pointer',
          '& .MuiInputBase-root': {
            height: 36, // match header search bar (h-9)
            borderRadius: 9999,
            backgroundColor: (t) =>
              t.palette.mode === 'dark'
                ? 'color-mix(in oklab, var(--control-bg) 70%, transparent)'
                : t.palette.background.paper,
          },
          '& .MuiInputBase-input': {
            whiteSpace: 'nowrap',
            paddingTop: 0,
            paddingBottom: 0,
            fontSize: 12, // match search bar's text-xs
            opacity: isEmpty ? 0.72 : 1,
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: (t) =>
              t.palette.mode === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)',
          },
        }}
      />

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: { overflow: 'hidden', borderRadius: 2, width: 520, maxWidth: 'calc(100vw - 16px)' },
          },
        }}
      >
        <Box
          sx={(t) => ({
            px: 2.25,
            pt: 1.75,
            pb: 1.5,
            bgcolor: t.palette.mode === 'dark' ? '#000000' : t.palette.background.paper,
            color: t.palette.mode === 'dark' ? '#ffffff' : t.palette.text.primary,
          })}
        >
          <Typography
            variant="overline"
            sx={{ opacity: 0.9, letterSpacing: '0.12em', fontWeight: 700, lineHeight: 1.2 }}
          >
            SELECTED RANGE
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 400, mt: 0.5, lineHeight: 1.1 }}>
            {rangeText}
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: '132px 1fr', minHeight: 312 }}>
          <Box
            sx={{
              p: 1,
              borderRight: (t) =>
                `1px solid ${t.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'}`,
              display: 'flex',
              flexDirection: 'column',
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
                    borderRadius: 0.5,
                    minHeight: 34,
                    fontSize: 13,
                  }}
                >
                  {preset.label}
                </Button>
              );
            })}
          </Box>

          <DateCalendar
            value={start}
            onChange={(picked) => {
              if (!picked) return;
              const day = stripTime(picked);

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
            slots={{
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
            }}
          />
        </Box>

        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            pb: 1.25,
          }}
        >
          <Box />

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              onClick={() => {
                onChange([null, null]);
              }}
            >
              Clear
            </Button>
            <Button size="small" variant="contained" onClick={() => setAnchorEl(null)}>
              Save
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}

export function AppHeader({
  onToggleSidebar,
  theme,
  onToggleTheme,
}: {
  onToggleSidebar: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  const { range, setRange } = useGlobalDate();
  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: theme,
          primary:
            theme === 'dark'
              ? { main: '#ffffff', contrastText: '#000000' }
              : { main: '#000000', contrastText: '#ffffff' },
          background:
            theme === 'dark'
              ? { default: '#000000', paper: '#0b0b0b' }
              : { default: '#ffffff', paper: '#ffffff' },
          text:
            theme === 'dark'
              ? { primary: '#ffffff', secondary: 'rgba(255,255,255,0.72)' }
              : { primary: '#000000', secondary: 'rgba(0,0,0,0.72)' },
          divider: theme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
        },
        shape: { borderRadius: 12 },
        components: {
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                backgroundColor: theme === 'dark' ? '#0b0b0b' : '#ffffff',
              },
              notchedOutline: {
                borderColor: theme === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)',
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: 'none',
              },
            },
          },
        },
      }),
    [theme]
  );

  return (
    <header className="shrink-0 px-2 sm:px-4 pt-2 sm:pt-3 mb-2 safe-top">
      <div
        className="min-h-12 sm:min-h-14 rounded-2xl backdrop-blur-xl px-3 sm:px-4 md:px-5 flex items-center justify-between gap-2 sm:gap-3 flex-nowrap"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--surface) 65%, transparent)',
          boxShadow:
            '0 10px 24px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 65%, transparent)',
        }}
      >
        {/* Left: hamburger + logo */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            className="h-10 w-10 sm:h-9 sm:w-9 rounded-full flex flex-col items-center justify-center gap-[3px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
          </button>

          <div
            className="p-1 rounded-lg shadow-sm shrink-0"
            style={{
              backgroundImage: 'var(--greeting-gradient)',
              boxShadow: '0 0 0 1px color-mix(in oklab, var(--border-subtle) 75%, transparent)',
            }}
          >
            <Zap className="text-[var(--foreground)]" size={14} fill="currentColor" />
          </div>
          <span className="text-xs sm:text-sm font-bold tracking-tight text-[var(--text)] truncate">
            3Core
          </span>
        </div>

        {/* Right: search (desktop) + actions + profile */}
        <div className="flex items-center gap-1 sm:gap-2 md:gap-3 flex-shrink-0 min-w-0">
          <div className="relative group hidden sm:block w-full sm:w-44 md:w-56 lg:w-72 max-w-[200px] md:max-w-none">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search..."
              className="h-9 rounded-full pl-9 pr-14 md:pr-16 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 px-2 py-1 rounded-full"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--surface-hover) 80%, transparent)',
              }}
            >
              <span className="text-[9px] text-[var(--text-muted)] font-bold tracking-tight">
                Ctrl
              </span>
              <span className="text-[9px] text-[var(--text-muted)] font-bold">K</span>
            </div>
          </div>

          <div className="hidden md:block shrink-0">
            <ThemeProvider theme={muiTheme}>
              <HeaderRangePicker value={range} onChange={setRange} />
            </ThemeProvider>
          </div>

          <div
            className="hidden sm:flex items-center gap-1.5 pl-2 pr-2.5 h-9 rounded-full cursor-pointer transition-colors shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <img src="https://flagcdn.com/w20/us.png" alt="US" className="w-4 h-2.5 rounded-sm" />
            <span className="text-[11px] font-bold">EN</span>
            <ChevronRight size={12} className="rotate-90 opacity-70" />
          </div>

          <button
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
            className="h-10 w-10 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0 cursor-pointer"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            {theme === 'dark' ? <SunMedium size={16} /> : <Moon size={16} />}
          </button>

          <button
            aria-label="Notifications"
            className="h-10 w-10 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] transition-colors relative shrink-0"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <Bell size={16} />
            <span className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 bg-rose-500 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white shadow-[0_6px_14px_rgba(0,0,0,0.35)]">
              11
            </span>
          </button>

          <div
            className="h-6 sm:h-9 w-px mx-0.5 sm:mx-1 shrink-0 hidden sm:block"
            aria-hidden
            style={{ backgroundColor: 'var(--border-subtle)' }}
          />

          <div
            className="h-9 min-w-[36px] flex items-center gap-1.5 sm:gap-2 pl-1 pr-2 sm:pr-2.5 rounded-full cursor-pointer group transition-colors shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-[var(--foreground)]"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)',
              }}
            >
            
            </div>
            <span className="text-xs font-bold hidden sm:inline truncate max-w-[4rem] md:max-w-none">
              3CORE
            </span>
            <ChevronRight size={12} className="rotate-90 opacity-70 shrink-0 hidden sm:block" />
          </div>
        </div>
      </div>
    </header>
  );
}

