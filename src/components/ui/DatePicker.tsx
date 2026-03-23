import React, { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Box, Button, Popover, Typography } from '@mui/material';
import { alpha, styled } from '@mui/material/styles';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { PickersDay } from '@mui/x-date-pickers/PickersDay';

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

type DatePickerProps = {
  value: [Date | null, Date | null];
  onChange: (next: [Date | null, Date | null]) => void;
  compact?: boolean;
  showPresets?: boolean;
};

export function DatePicker({
  value,
  onChange,
  compact = false,
  showPresets = false,
}: DatePickerProps) {
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
      {compact ? (
        <button
          type="button"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="Open date range picker"
          className="h-9 w-9 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
          }}
        >
          <CalendarDays size={16} />
        </button>
      ) : (
        <div className="relative group w-full sm:w-36 md:w-44 lg:w-64 xl:w-72 max-w-[170px] lg:max-w-none">
          <CalendarDays
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
            size={14}
          />
          <input
            type="text"
            readOnly
            value={isEmpty ? '' : rangeText}
            placeholder="Enter Date Range"
            aria-label="Date range"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all cursor-pointer"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              opacity: isEmpty ? 0.72 : 1,
              whiteSpace: 'nowrap',
            }}
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
              borderRadius: 2,
              // Tighter shell: hug calendar + presets; content sizes (cells, fonts) unchanged below
              width: { xs: 'calc(100vw - 12px)', sm: 'max-content' },
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: { xs: 'min(88vh, 640px)', sm: 'none' },
            },
          },
        }}
      >
        <Box
          sx={(t) => ({
            px: { xs: 1, sm: 1.25 },
            pt: { xs: 0.75, sm: 1 },
            pb: { xs: 0.5, sm: 0.75 },
            bgcolor: t.palette.mode === 'dark' ? '#000000' : t.palette.background.paper,
            color: t.palette.mode === 'dark' ? '#ffffff' : t.palette.text.primary,
          })}
        >
          <Typography
            variant="overline"
            sx={{ opacity: 0.9, letterSpacing: '0.12em', fontWeight: 700, lineHeight: 1.2, fontSize: { xs: 10, sm: 11 } }}
          >
            SELECTED RANGE
          </Typography>
          <Typography
            variant="body1"
            sx={{
              fontWeight: 600,
              mt: 0.25,
              lineHeight: 1.35,
              fontSize: { xs: '1rem', sm: '1.3rem' },
            }}
          >
            {rangeText}
          </Typography>
        </Box>

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
                      borderRadius: 0.5,
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
            sx={{
              width: { xs: '100%', sm: 'max-content' },
              maxWidth: '100%',
              mx: { xs: 'auto', sm: 0 },
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
              '& .MuiDayCalendar-slideTransition': { marginTop: 0 },
              '& .MuiDayCalendar-weekDayLabel': {
                width: { xs: 32, sm: 36 },
                fontSize: { xs: 11, sm: 12 },
              },
              '& .MuiPickersDay-root': {
                width: { xs: 32, sm: 36 },
                height: { xs: 32, sm: 36 },
                fontSize: { xs: 13, sm: 14 },
              },
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
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 0.75,
            px: { xs: 0.75, sm: 1 },
            pb: { xs: 0.75, sm: 0.75 },
            pt: { xs: 0.25, sm: 0 },
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' } }}>
            <Button
              size="small"
              fullWidth
              onClick={() => {
                onChange([null, null]);
              }}
            >
              Clear
            </Button>
            <Button size="small" variant="contained" onClick={() => setAnchorEl(null)} fullWidth>
              Save
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
