import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileSpreadsheet, FileText, RotateCcw, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { DatePicker } from '../ui/DatePicker';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  RESUBMITTED: 'Resubmitted',
  RETURNED: 'Returned',
  REJECTED: 'Rejected',
  FOR_APPROVAL: 'For Approval',
  DISAPPROVED: 'Disapproved',
  APPROVED: 'Approved',
};
const STATUS_ORDER = Object.keys(STATUS_LABELS);
// Applications-by-Status is split in two so the ever-growing Approved total
// never dwarfs the handful of applications still moving through the queue —
// each group gets its own bar scale.
const IN_PROGRESS_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED', 'RETURNED', 'FOR_APPROVAL'];
const OUTCOME_STATUSES = ['APPROVED', 'DISAPPROVED', 'REJECTED'];

// Matches NO_TYPE_CODE in server/models/Report.js — applications with no type.
const NO_TYPE_CODE = '__NONE__';
// Treemap shows this many types as their own tiles; the rest merge into "Other".
const TYPE_TILE_LIMIT = 7;
// A type whose tile would get less area than this (px², at the card's current
// width) folds into "Other" instead of rendering as an unlabeled sliver —
// on a phone that's ~3% of the total, on desktop ~2%.
const MIN_TYPE_TILE_AREA = 2400;
const OTHER_TILE_COLOR = '#94a3b8';

// Every chart body in the Applications row shares this height so the three
// cards stay equal no matter how many statuses/types/months there are.
const CHART_BODY_HEIGHT = 240;
// Recharts' default Area draw time, stated so the dots can wait it out.
const AREA_DRAW_MS = 1500;

type TrendRange = '12M' | '24M' | 'ALL';
const TREND_RANGES: { value: TrendRange; label: string }[] = [
  { value: '12M', label: '12M' },
  { value: '24M', label: '24M' },
  { value: 'ALL', label: 'All' },
];
const MOBILE_SORT_OPTIONS = [
  { value: 'submitted_at', label: 'Submitted date' },
  { value: 'proponent_name', label: 'Locator' },
  { value: 'application_no', label: 'Application no.' },
  { value: 'application_type_name', label: 'Type' },
  { value: 'status', label: 'Status' },
];
const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

// Shared Tooltip look for every chart on this page: themed so labels stay
// readable in dark mode (recharts defaults to a white tooltip box with
// near-white text there), and cursor=false drops the gray hover-highlight
// rectangle Bar/Line charts draw by default — Pie charts never had one, so
// this makes every chart's hover behavior consistent (just the number pops up).
// --tooltip-bg/--tooltip-border (index.css) equal --surface/--border in light
// mode (unchanged look) but switch to the more distinct --control-bg/
// --input-border pair in dark mode, where --surface/--border are nearly the
// same shade as the chart card itself and the tooltip barely separated from it.
const CHART_TOOLTIP_PROPS = {
  cursor: false,
  contentStyle: {
    fontSize: 11,
    borderRadius: 8,
    backgroundColor: 'var(--tooltip-bg)',
    border: '1px solid var(--tooltip-border)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  },
  labelStyle: { color: 'var(--text)', fontWeight: 600 },
  itemStyle: { color: 'var(--text)' },
} as const;

// Same status vocabulary/colors as the Permit & Contract page (PermitsManagement.tsx)
// so a status reads the same color whether it's a badge there or a bar here.
const PERMIT_STATUS_LABELS: Record<string, string> = {
  VALID: 'Valid',
  EXPIRING: 'Expiring',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};
const PERMIT_STATUS_ORDER = Object.keys(PERMIT_STATUS_LABELS);
const PERMIT_STATUS_TONE: Record<string, { bg: string; color: string }> = {
  VALID: { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  EXPIRING: { bg: 'rgba(245,158,11,0.14)', color: '#f59e0b' },
  EXPIRED: { bg: 'rgba(220,38,38,0.14)', color: '#fca5a5' },
  REVOKED: { bg: 'rgba(148,163,184,0.14)', color: '#94a3b8' },
};

// Same vocabulary/colors as Compliance & Inspection (ComplianceInspections.tsx).
const INSPECTION_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const INSPECTION_STATUS_ORDER = Object.keys(INSPECTION_STATUS_LABELS);
const INSPECTION_STATUS_TONE: Record<string, { bg: string; color: string }> = {
  SCHEDULED: { bg: 'rgba(245,158,11,.14)', color: '#f59e0b' },
  IN_PROGRESS: { bg: 'rgba(59,130,246,.14)', color: '#3b82f6' },
  COMPLETED: { bg: 'rgba(16,185,129,.14)', color: '#10b981' },
  CANCELLED: { bg: 'rgba(148,163,184,.14)', color: '#94a3b8' },
};

const INSPECTION_RESULT_LABELS: Record<string, string> = {
  PASSED: 'Passed',
  PASSED_WITH_FINDINGS: 'Passed w/ Findings',
  FAILED: 'Failed',
};
const INSPECTION_RESULT_ORDER = Object.keys(INSPECTION_RESULT_LABELS);
const INSPECTION_RESULT_TONE: Record<string, { bg: string; color: string }> = {
  PASSED: { bg: 'rgba(16,185,129,.14)', color: '#10b981' },
  PASSED_WITH_FINDINGS: { bg: 'rgba(245,158,11,.14)', color: '#f59e0b' },
  FAILED: { bg: 'rgba(239,68,68,.14)', color: '#ef4444' },
};

type Overview = {
  total_applications: number;
  applications_by_status: Record<string, number>;
  applications_by_type: { code: string; name: string; total: number }[];
  applications_new_vs_renewal: { new: number; renewal: number };
  monthly_trend: { month: string; total: number }[];
  permits_by_status: Record<string, number>;
  inspections_by_status: Record<string, number>;
  inspections_by_result: Record<string, number>;
  contracts_issued: number;
};

type AppRow = {
  id: number;
  application_no: string;
  proponent_name: string | null;
  application_type: string;
  application_type_name: string;
  is_renewal: number | boolean;
  status: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string | null;
};

function fmtDate(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function monthLabel(ym: string) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

// Month arithmetic on "yyyy-MM" keys as a single integer (year*12 + month0),
// so gap-filling the trend is plain counting.
function ymIndex(ym: string) {
  const [y, m] = String(ym || '').split('-').map(Number);
  return y && m ? y * 12 + (m - 1) : NaN;
}
function ymFromIndex(i: number) {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

type TrendPoint = { key: string; label: string; total: number; unit: 'month' | 'year' };

/** Turns the server's sparse month list (only months that have applications)
 * into an evenly spaced series: the last 12/24 months with empty months as 0,
 * or for "All" the whole history — by month when it spans ≤ 24 months,
 * otherwise rolled up by year so a decade of data stays readable. */
function buildTrendSeries(monthly: { month: string; total: number }[], range: TrendRange, dateFrom: Date | null): TrendPoint[] {
  const counts = new Map<number, number>();
  monthly.forEach((m) => {
    const i = ymIndex(m.month);
    if (!Number.isNaN(i)) counts.set(i, (counts.get(i) || 0) + m.total);
  });
  if (counts.size === 0) return [];
  const idx = [...counts.keys()];
  const last = Math.max(...idx);
  const first = Math.min(...idx);

  let start: number;
  if (range === 'ALL') {
    if (last - first + 1 > 24) {
      const byYear = new Map<number, number>();
      counts.forEach((total, i) => byYear.set(Math.floor(i / 12), (byYear.get(Math.floor(i / 12)) || 0) + total));
      const firstYear = Math.floor(first / 12);
      const lastYear = Math.floor(last / 12);
      return Array.from({ length: lastYear - firstYear + 1 }, (_, k) => {
        const y = firstYear + k;
        return { key: String(y), label: String(y), total: byYear.get(y) || 0, unit: 'year' as const };
      });
    }
    start = first;
  } else {
    start = last - (range === '12M' ? 12 : 24) + 1;
    // A From-date filter means nothing earlier can have data — don't pad with zeros.
    if (dateFrom) start = Math.max(start, Math.min(last, dateFrom.getFullYear() * 12 + dateFrom.getMonth()));
  }
  return Array.from({ length: last - start + 1 }, (_, k) => {
    const ym = ymFromIndex(start + k);
    return { key: ym, label: monthLabel(ym), total: counts.get(start + k) || 0, unit: 'month' as const };
  });
}

function csvEscape(v: string | number) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readFiltersFromUrl() {
  if (typeof window === 'undefined')
    return { dateFrom: null as Date | null, dateTo: null as Date | null, type: '', status: '', renewal: '' };
  const params = new URLSearchParams(window.location.search);
  const df = params.get('dateFrom');
  const dt = params.get('dateTo');
  const parsedFrom = df ? new Date(df) : null;
  const parsedTo = dt ? new Date(dt) : null;
  return {
    dateFrom: parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : null,
    dateTo: parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : null,
    type: params.get('type') || '',
    status: params.get('status') || '',
    renewal: params.get('renewal') || '',
  };
}

// Phones get chart layouts that fit a ~350px card (horizontal status bars,
// thinned month ticks) — recharts needs this in JS, not CSS.
/** False on the first render, true right after mount. Chart entry animations
 * key off this instead of motion's `initial`: App.tsx wraps every page in
 * <AnimatePresence initial={false}>, which makes nested motion elements skip
 * their `initial` state on a direct page load. Animating from a first-render
 * value to the real one is a plain change, so it plays either way. */
function useHasMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}

// Callback ref (not useRef) so measuring starts whenever the element mounts —
// the treemap box only exists once data has loaded.
function useElementWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

function useIsPhone() {
  const query = '(max-width: 639px)';
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsPhone(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isPhone;
}

function usePagination<T>(items: T[], pageSize: number, page: number) {
  return useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / Math.max(1, pageSize)));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const visible =
      totalPages <= 5
        ? Array.from({ length: totalPages }, (_, i) => i + 1)
        : safePage <= 3
          ? [1, 2, 3, 4, 5]
          : safePage >= totalPages - 2
            ? [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
            : [safePage - 2, safePage - 1, safePage, safePage + 1, safePage + 2];
    return {
      totalPages,
      pageItems: items.slice(start, start + pageSize),
      showingFrom: items.length === 0 ? 0 : start + 1,
      showingTo: Math.min(items.length, safePage * pageSize),
      visiblePageNumbers: visible,
    };
  }, [items, pageSize, page]);
}

export function ReportsAnalytics({ navigate }: { navigate?: (to: string, opts?: { replace?: boolean }) => void }) {
  const urlFilters = useMemo(readFiltersFromUrl, []);
  const [dateFrom, setDateFrom] = useState<Date | null>(urlFilters.dateFrom);
  const [dateTo, setDateTo] = useState<Date | null>(urlFilters.dateTo);
  const [typeFilter, setTypeFilter] = useState(urlFilters.type);
  const [statusFilter, setStatusFilter] = useState(urlFilters.status);
  const [renewalFilter, setRenewalFilter] = useState(urlFilters.renewal);
  const [typeOptions, setTypeOptions] = useState<{ value: string; label: string }[]>([]);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [rows, setRows] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<
    'application_no' | 'proponent_name' | 'application_type_name' | 'status' | 'submitted_at' | null
  >(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [trendRange, setTrendRange] = useState<TrendRange>('12M');
  const [otherTypesOpen, setOtherTypesOpen] = useState(false);
  const [typeCardRef, typeCardWidth] = useElementWidth<HTMLDivElement>();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const tableRef = useRef<HTMLDivElement>(null);
  const isPhone = useIsPhone();
  const { fullAccess, sidebarPermissions } = useControlPanelAccess();
  const canOpenAssessment = fullAccess || Boolean(sidebarPermissions['assessment:queue']);

  function scrollToTable() {
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function drillToStatus(status: string) {
    setStatusFilter(status);
    scrollToTable();
  }
  function drillToType(code: string) {
    setTypeFilter(code);
    scrollToTable();
  }
  function drillToTrendPoint(p: TrendPoint) {
    if (p.unit === 'year') {
      const y = Number(p.key);
      if (!y) return;
      setDateFrom(new Date(y, 0, 1));
      setDateTo(new Date(y, 11, 31));
    } else {
      const [y, m] = p.key.split('-').map(Number);
      if (!y || !m) return;
      setDateFrom(new Date(y, m - 1, 1));
      setDateTo(new Date(y, m, 0));
    }
    scrollToTable();
  }

  useEffect(() => {
    let cancelled = false;
    fetch('/api/application-types', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const opts = (json?.data || [])
          .filter((t: any) => t.is_active === undefined || Number(t.is_active) === 1 || t.is_active === true)
          .map((t: any) => ({ value: t.code, label: t.name }));
        setTypeOptions(opts);
      })
      .catch(() => {
        // Type filter is a nice-to-have — a failed fetch just leaves the dropdown empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom.toISOString());
    if (dateTo) params.set('dateTo', dateTo.toISOString());
    if (typeFilter) params.set('applicationType', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (renewalFilter) params.set('isRenewal', renewalFilter);
    const qs = params.toString();

    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/reports/overview${qs ? `?${qs}` : ''}`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`/api/reports/applications${qs ? `?${qs}` : ''}`, { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([overviewJson, appsJson]) => {
        if (cancelled) return;
        if (!overviewJson?.success) throw new Error(overviewJson?.message || 'Failed to load report overview');
        if (!appsJson?.success) throw new Error(appsJson?.message || 'Failed to load applications list');
        setOverview(overviewJson.data);
        setRows(appsJson.data || []);
        setPage(1);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e?.message || 'Failed to load reports');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, typeFilter, statusFilter, renewalFilter]);

  // Keeps the address bar in sync with the current filters (replace, not push,
  // so tweaking a date range doesn't spam browser history) — lets a filtered
  // report view be bookmarked or shared as a link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (dateFrom) params.set('dateFrom', dateFrom.toISOString());
    else params.delete('dateFrom');
    if (dateTo) params.set('dateTo', dateTo.toISOString());
    else params.delete('dateTo');
    if (typeFilter) params.set('type', typeFilter);
    else params.delete('type');
    if (statusFilter) params.set('status', statusFilter);
    else params.delete('status');
    if (renewalFilter) params.set('renewal', renewalFilter);
    else params.delete('renewal');
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }, [dateFrom, dateTo, typeFilter, statusFilter, renewalFilter]);

  // Search/sort are client-side over the already-filtered rows, so re-paginate
  // to page 1 whenever either changes (same as a server-side filter change).
  useEffect(() => {
    setPage(1);
  }, [search, sortKey, sortDir]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) => r.application_no.toLowerCase().includes(q) || (r.proponent_name || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      let av: string | number = a[sortKey] || '';
      let bv: string | number = b[sortKey] || '';
      if (sortKey === 'submitted_at') {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filteredRows, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortKey(null);
    }
  }

  const pg = usePagination(sortedRows, pageSize, page);

  const statusCounts = overview?.applications_by_status || {};
  const hasStatusData = STATUS_ORDER.some((st) => statusCounts[st]);

  const typeTiles = useMemo(() => {
    const sorted = [...(overview?.applications_by_type || [])].filter((t) => t.total > 0).sort((a, b) => b.total - a.total);
    const grandTotal = sorted.reduce((sum, t) => sum + t.total, 0);
    // Smallest share of the total that still gets a labelable tile at this
    // width (0 until the card has been measured).
    const minShare = typeCardWidth ? MIN_TYPE_TILE_AREA / (typeCardWidth * CHART_BODY_HEIGHT) : 0;
    const share = (n: number) => (grandTotal ? n / grandTotal : 0);
    let cut = 0;
    while (cut < sorted.length && cut < TYPE_TILE_LIMIT && share(sorted[cut].total) >= minShare) cut++;
    // A single leftover type big enough for its own tile beats "Other (1 type)".
    if (sorted.length - cut === 1 && share(sorted[cut].total) >= minShare) cut++;
    // The "Other" tile itself must be big enough to label — pull in more types until it is.
    while (cut > 1 && cut < sorted.length && share(sorted.slice(cut).reduce((sum, t) => sum + t.total, 0)) < minShare) cut--;
    const tiles: TypeTileDatum[] = sorted.slice(0, cut).map((t, i) => ({
      code: t.code,
      name: t.name,
      total: t.total,
      pct: grandTotal ? (t.total / grandTotal) * 100 : 0,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
    const rest = sorted.slice(cut);
    if (rest.length) {
      const restTotal = rest.reduce((sum, t) => sum + t.total, 0);
      tiles.push({
        code: '',
        name: `Other (${rest.length} ${rest.length === 1 ? 'type' : 'types'})`,
        total: restTotal,
        pct: grandTotal ? (restTotal / grandTotal) * 100 : 0,
        color: OTHER_TILE_COLOR,
        isOther: true,
      });
    }
    return { tiles, rest, grandTotal };
  }, [overview, typeCardWidth]);

  const trendSeries = useMemo(
    () => buildTrendSeries(overview?.monthly_trend || [], trendRange, dateFrom),
    [overview, trendRange, dateFrom]
  );

  const permitStatusChartData = useMemo(() => {
    const src = overview?.permits_by_status || {};
    return PERMIT_STATUS_ORDER.filter((s) => src[s]).map((s) => ({ key: s, label: PERMIT_STATUS_LABELS[s], total: src[s] }));
  }, [overview]);

  const inspectionStatusChartData = useMemo(() => {
    const src = overview?.inspections_by_status || {};
    return INSPECTION_STATUS_ORDER.filter((s) => src[s]).map((s) => ({ key: s, label: INSPECTION_STATUS_LABELS[s], total: src[s] }));
  }, [overview]);

  const inspectionResultChartData = useMemo(() => {
    const src = overview?.inspections_by_result || {};
    return INSPECTION_RESULT_ORDER.filter((s) => src[s]).map((s) => ({ key: s, label: INSPECTION_RESULT_LABELS[s], total: src[s] }));
  }, [overview]);

  // "Unspecified" isn't a real application type, so it's only offered in the
  // Type filter while there are such applications (or it's already selected).
  const typeSelectOptions = useMemo(() => {
    const hasNone =
      typeFilter === NO_TYPE_CODE || (overview?.applications_by_type || []).some((t) => t.code === NO_TYPE_CODE);
    return hasNone ? [...typeOptions, { value: NO_TYPE_CODE, label: 'Unspecified' }] : typeOptions;
  }, [typeOptions, overview, typeFilter]);

  const totalPermits = useMemo(
    () => Object.values(overview?.permits_by_status || {}).reduce((a, b) => a + b, 0),
    [overview]
  );
  const totalInspections = useMemo(
    () => Object.values(overview?.inspections_by_status || {}).reduce((a, b) => a + b, 0),
    [overview]
  );

  function resetFilters() {
    setDateFrom(null);
    setDateTo(null);
    setTypeFilter('');
    setStatusFilter('');
    setRenewalFilter('');
    setSearch('');
    setSortKey(null);
  }

  /** Tells the server an export happened, for the audit log — the file is
   * built here in the browser, so the server wouldn't know otherwise.
   * Fire-and-forget: a failed log call never blocks the user's export. */
  function logExport(format: 'csv' | 'pdf') {
    // Local calendar date — toISOString() would shift a picked date to the
    // previous day for users east of UTC.
    const ymd = (d: Date | null) =>
      d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : undefined;
    fetch('/api/reports/export-log', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format,
        rowCount: sortedRows.length,
        filters: {
          dateFrom: ymd(dateFrom),
          dateTo: ymd(dateTo),
          applicationType: typeFilter || undefined,
          status: statusFilter || undefined,
          isRenewal: renewalFilter || undefined,
          search: search.trim() || undefined,
        },
      }),
    }).catch(() => {});
  }

  function exportCsv() {
    if (sortedRows.length === 0) return;
    setExporting('csv');
    try {
      const header = ['Application No.', 'Locator', 'Type', 'New/Renewal', 'Status', 'Submitted', 'Created'];
      const lines = [header.map(csvEscape).join(',')];
      sortedRows.forEach((r) => {
        lines.push(
          [
            r.application_no,
            r.proponent_name || '',
            r.application_type_name,
            r.is_renewal ? 'Renewal' : 'New',
            STATUS_LABELS[r.status] || r.status,
            fmtDate(r.submitted_at),
            fmtDate(r.created_at),
          ]
            .map(csvEscape)
            .join(',')
        );
      });
      // UTF-8 BOM so Excel doesn't mangle special characters on open.
      downloadBlob(`ciac-applications-report-${Date.now()}.csv`, `﻿${lines.join('\n')}`, 'text/csv;charset=utf-8;');
      logExport('csv');
      toast.success('Report exported for Excel');
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    if (sortedRows.length === 0) return;
    setExporting('pdf');
    try {
      const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const autoTable = autoTableModule.default;
      const doc = new jsPDF({ orientation: 'landscape' });

      doc.setFontSize(14);
      doc.text('CIAC — Reports & Analytics', 14, 16);

      doc.setFontSize(9);
      doc.setTextColor(100);
      const rangeLabel =
        dateFrom || dateTo
          ? `Period: ${dateFrom ? fmtDate(dateFrom.toISOString()) : 'Start'} to ${dateTo ? fmtDate(dateTo.toISOString()) : 'Present'}`
          : 'Period: All time';
      doc.text(`${rangeLabel}  ·  Generated ${new Date().toLocaleString('en-US')}`, 14, 22);

      doc.setTextColor(0);
      doc.setFontSize(10);
      const summaryLine = [
        `Total: ${overview?.total_applications ?? 0}`,
        `Approved: ${overview?.applications_by_status?.APPROVED ?? 0}`,
        `For Approval: ${overview?.applications_by_status?.FOR_APPROVAL ?? 0}`,
        `Returned: ${overview?.applications_by_status?.RETURNED ?? 0}`,
        `Disapproved: ${overview?.applications_by_status?.DISAPPROVED ?? 0}`,
      ].join('   |   ');
      doc.text(summaryLine, 14, 30);

      autoTable(doc, {
        startY: 36,
        head: [['Application No.', 'Locator', 'Type', 'New/Renewal', 'Status', 'Submitted']],
        body: sortedRows.map((r) => [
          r.application_no,
          r.proponent_name || '—',
          r.application_type_name,
          r.is_renewal ? 'Renewal' : 'New',
          STATUS_LABELS[r.status] || r.status,
          fmtDate(r.submitted_at),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
      });

      doc.save(`ciac-applications-report-${Date.now()}.pdf`);
      logExport('pdf');
      toast.success('Report exported to PDF');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to export PDF');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap flex-1">
            <FieldLabel label="From">
              <div className="w-full sm:w-44">
                <DatePicker mode="single" bordered fullWidth value={dateFrom} onChange={setDateFrom} placeholder="From date" />
              </div>
            </FieldLabel>
            <FieldLabel label="To">
              <div className="w-full sm:w-44">
                <DatePicker mode="single" bordered fullWidth value={dateTo} onChange={setDateTo} placeholder="To date" />
              </div>
            </FieldLabel>
            <FieldLabel label="Application Type">
              <div className="w-full sm:w-44">
                <AppSelect
                  compact
                  placeholder="All types"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={typeSelectOptions}
                  isClearable
                />
              </div>
            </FieldLabel>
            <FieldLabel label="Status">
              <div className="w-full sm:w-44">
                <AppSelect
                  compact
                  placeholder="All statuses"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
                  isClearable
                />
              </div>
            </FieldLabel>
            <FieldLabel label="New / Renewal" className="col-span-2">
              <div className="w-full sm:w-40">
                <AppSelect
                  compact
                  placeholder="All"
                  value={renewalFilter}
                  onChange={setRenewalFilter}
                  options={[
                    { value: 'new', label: 'New' },
                    { value: 'renewal', label: 'Renewal' },
                  ]}
                  isClearable
                />
              </div>
            </FieldLabel>
          </div>

          {/* Phones: three equal buttons across the full width. */}
          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center [&>button]:justify-center [&>button]:whitespace-nowrap [&>button]:px-2 sm:[&>button]:px-3">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              title="Clear filters"
            >
              <RotateCcw size={13} />
              Clear
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={exporting !== null || sortedRows.length === 0}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold border cursor-pointer',
                (exporting !== null || sortedRows.length === 0) && 'opacity-50 cursor-not-allowed'
              )}
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <FileSpreadsheet size={13} />
              Export Excel
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={exporting !== null || sortedRows.length === 0}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold shadow-sm cursor-pointer',
                (exporting !== null || sortedRows.length === 0) && 'opacity-50 cursor-not-allowed'
              )}
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            >
              <FileText size={13} />
              Export PDF
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
        <StatTile loading={loading}
          label="Total Applications"
          value={overview?.total_applications ?? '—'}
          onClick={() => drillToStatus('')}
          title="Show all statuses in the table below"
        />
        <StatTile loading={loading}
          label="Approved"
          value={overview?.applications_by_status?.APPROVED ?? 0}
          tone="#10b981"
          onClick={() => drillToStatus('APPROVED')}
          title="Filter the table to Approved applications"
        />
        <StatTile loading={loading}
          label="For Approval"
          value={overview?.applications_by_status?.FOR_APPROVAL ?? 0}
          tone="#3b82f6"
          onClick={() => drillToStatus('FOR_APPROVAL')}
          title="Filter the table to applications For Approval"
        />
        <StatTile loading={loading}
          label="Returned"
          value={overview?.applications_by_status?.RETURNED ?? 0}
          tone="#f59e0b"
          onClick={() => drillToStatus('RETURNED')}
          title="Filter the table to Returned applications"
        />
        <StatTile loading={loading}
          label="Disapproved / Rejected"
          value={(overview?.applications_by_status?.DISAPPROVED ?? 0) + (overview?.applications_by_status?.REJECTED ?? 0)}
          tone="#ef4444"
        />
        <StatTile loading={loading} label="Contracts Issued" value={overview?.contracts_issued ?? '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Applications by Status">
          {loading ? (
            <StatusSkeleton />
          ) : hasStatusData ? (
            <StatusSplit counts={statusCounts} onPick={drillToStatus} />
          ) : (
            <ChartEmpty />
          )}
        </ChartCard>

        <ChartCard title="Applications by Type">
          {loading ? (
            <TypeSkeleton />
          ) : typeTiles.tiles.length === 0 ? (
            <ChartEmpty />
          ) : (
            <div ref={typeCardRef} className="relative" style={{ height: CHART_BODY_HEIGHT }}>
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={typeTiles.tiles}
                  dataKey="total"
                  nameKey="name"
                  aspectRatio={4 / 3}
                  isAnimationActive={false}
                  content={
                    <TypeTile
                      onPick={(t: TypeTileDatum) => (t.isOther ? setOtherTypesOpen(true) : drillToType(t.code))}
                    />
                  }
                >
                  <Tooltip {...CHART_TOOLTIP_PROPS} content={<TypeTooltip />} />
                </Treemap>
              </ResponsiveContainer>
              {otherTypesOpen && typeTiles.rest.length > 0 && (
                <OtherTypesPanel
                  items={typeTiles.rest}
                  grandTotal={typeTiles.grandTotal}
                  onClose={() => setOtherTypesOpen(false)}
                  onPick={(code) => {
                    setOtherTypesOpen(false);
                    drillToType(code);
                  }}
                />
              )}
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Application Volume"
          action={
            <div
              className="inline-flex rounded-md p-0.5 gap-0.5"
              style={{ backgroundColor: 'var(--border-subtle)' }}
              role="group"
              aria-label="Volume range"
            >
              {TREND_RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setTrendRange(r.value)}
                  aria-pressed={trendRange === r.value}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer"
                  style={
                    trendRange === r.value
                      ? { backgroundColor: 'var(--surface)', color: 'var(--text)' }
                      : { color: 'var(--text-muted)' }
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
          }
        >
          {loading ? (
            <TrendSkeleton />
          ) : trendSeries.length === 0 ? (
            <ChartEmpty />
          ) : (
            <TrendChart key={trendRange} points={trendSeries} onPick={drillToTrendPoint} isPhone={isPhone} />
          )}
        </ChartCard>
      </div>

      <div className="space-y-3">
        <h3 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          Permits & Inspections
        </h3>

        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
          <StatTile loading={loading} label="Total Permits" value={overview ? totalPermits : '—'} />
          <StatTile loading={loading} label="Valid Permits" value={overview?.permits_by_status?.VALID ?? 0} tone={PERMIT_STATUS_TONE.VALID.color} />
          <StatTile loading={loading} label="Expiring Permits" value={overview?.permits_by_status?.EXPIRING ?? 0} tone={PERMIT_STATUS_TONE.EXPIRING.color} />
          <StatTile loading={loading} label="Expired Permits" value={overview?.permits_by_status?.EXPIRED ?? 0} tone={PERMIT_STATUS_TONE.EXPIRED.color} />
          <StatTile loading={loading} label="Total Inspections" value={overview ? totalInspections : '—'} />
          <StatTile loading={loading} label="Failed Inspections" value={overview?.inspections_by_result?.FAILED ?? 0} tone={INSPECTION_RESULT_TONE.FAILED.color} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard title="Permits by Status">
            <ProportionRibbon loading={loading} items={permitStatusChartData} toneMap={PERMIT_STATUS_TONE} />
          </ChartCard>

          <ChartCard title="Inspections by Status">
            <ProportionRibbon loading={loading} items={inspectionStatusChartData} toneMap={INSPECTION_STATUS_TONE} />
          </ChartCard>

          <ChartCard title="Inspections by Result">
            <ProportionRibbon loading={loading} items={inspectionResultChartData} toneMap={INSPECTION_RESULT_TONE} />
          </ChartCard>
        </div>
      </div>

      <div ref={tableRef} className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              Applications
            </h3>
            <span className="text-[11px] text-secondary">
              {sortedRows.length} record{sortedRows.length === 1 ? '' : 's'}
              {overview &&
                (renewalFilter === 'new' ? (
                  <> · {overview.applications_new_vs_renewal.new} new</>
                ) : renewalFilter === 'renewal' ? (
                  <> · {overview.applications_new_vs_renewal.renewal} renewal</>
                ) : (
                  <> · {overview.applications_new_vs_renewal.new} new / {overview.applications_new_vs_renewal.renewal} renewal</>
                ))}
            </span>
          </div>
          <div className="relative w-full sm:w-56">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search application no. or locator"
              className="w-full rounded-lg pl-8 pr-3 py-2 text-[11px] border bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </div>
        </div>

        {loading ? (
          <TableSkeleton columns={6} rows={6} />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={<Download size={40} className="opacity-40" />}
            title="No records for these filters"
            description={
              search
                ? 'No applications match your search. Try a different application no. or locator name.'
                : 'Adjust the date range, type, or status filters to see matching applications.'
            }
          />
        ) : (
          <>
            {/* Phones: cards, with a sort picker standing in for the clickable column headers. */}
            <div className="sm:hidden">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary shrink-0">Sort by</span>
                <div className="flex-1 min-w-0">
                  <AppSelect
                    compact
                    placeholder="Default"
                    value={sortKey ?? ''}
                    onChange={(v) => {
                      setSortKey((v || null) as typeof sortKey);
                      setSortDir('asc');
                    }}
                    options={MOBILE_SORT_OPTIONS}
                    isClearable
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  disabled={!sortKey}
                  className={cn(
                    'shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg border',
                    sortKey ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'
                  )}
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  aria-label={sortDir === 'asc' ? 'Sorted ascending — switch to descending' : 'Sorted descending — switch to ascending'}
                >
                  {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                </button>
              </div>

              <div className="space-y-2">
                {pg.pageItems.map((r) => {
                  const clickable = canOpenAssessment && Boolean(navigate);
                  const Tag: any = clickable ? 'button' : 'div';
                  return (
                    <Tag
                      key={r.id}
                      type={clickable ? 'button' : undefined}
                      className={cn(
                        'w-full text-left rounded-xl p-3 block',
                        clickable && 'cursor-pointer active:bg-[var(--selected-bg)] transition-colors'
                      )}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
                      }}
                      onClick={clickable ? () => navigate!(`/assessment?applicationId=${r.id}&tab=Compliance`) : undefined}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold leading-snug break-words" style={{ color: 'var(--text)' }}>
                            {r.proponent_name || '—'}
                          </div>
                          <div className="mt-0.5 text-[11px] text-secondary">
                            {r.application_no} · {r.is_renewal ? 'Renewal' : 'New'}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <StatusBadge status={r.status} />
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-secondary truncate">{r.application_type_name || '—'}</span>
                        <span className="shrink-0 text-secondary">Submitted {fmtDate(r.submitted_at)}</span>
                      </div>
                    </Tag>
                  );
                })}
              </div>
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <SortableHeader label="Application" sortKey="application_no" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHeader label="Locator" sortKey="proponent_name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHeader label="Type" sortKey="application_type_name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHeader label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableHeader
                      label="Submitted"
                      sortKey="submitted_at"
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={toggleSort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((r) => {
                    const clickable = canOpenAssessment && Boolean(navigate);
                    return (
                      <tr
                        key={r.id}
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                        className={clickable ? 'cursor-pointer hover:bg-[var(--selected-bg)] transition-colors' : undefined}
                        onClick={clickable ? () => navigate!(`/assessment?applicationId=${r.id}&tab=Compliance`) : undefined}
                        title={clickable ? 'Open in Assessment' : undefined}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-semibold" style={{ color: 'var(--text)' }}>{r.application_no}</div>
                          <div className="text-[11px] text-secondary">{r.is_renewal ? 'Renewal' : 'New'}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary">{r.proponent_name || '—'}</td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary">{r.application_type_name}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary text-right">{fmtDate(r.submitted_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <DataTableControls
              page={page}
              totalPages={pg.totalPages}
              totalItems={sortedRows.length}
              showingFrom={pg.showingFrom}
              showingTo={pg.showingTo}
              visiblePageNumbers={pg.visiblePageNumbers}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50, 100]}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, { bg: string; color: string }> = {
  APPROVED: { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  FOR_APPROVAL: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
  UNDER_REVIEW: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
  SUBMITTED: { bg: 'rgba(148,163,184,0.14)', color: '#94a3b8' },
  RESUBMITTED: { bg: 'rgba(148,163,184,0.14)', color: '#94a3b8' },
  RETURNED: { bg: 'rgba(245,158,11,0.14)', color: '#f59e0b' },
  DISAPPROVED: { bg: 'rgba(220,38,38,0.14)', color: '#fca5a5' },
  REJECTED: { bg: 'rgba(220,38,38,0.14)', color: '#fca5a5' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_TONE[status] || STATUS_TONE.SUBMITTED;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function SortableHeader<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align,
}: {
  label: string;
  sortKey: K;
  activeKey: K | null;
  dir: 'asc' | 'desc';
  onSort: (key: K) => void;
  align?: 'left' | 'right';
}) {
  const active = activeKey === sortKey;
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={cn('px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn('inline-flex items-center gap-1 cursor-pointer hover:text-current', align === 'right' && 'flex-row-reverse')}
      >
        {label}
        <Icon size={11} className={active ? 'opacity-100' : 'opacity-40'} />
      </button>
    </th>
  );
}

function FieldLabel({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1 min-w-0', className)}>
      <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{label}</div>
      {children}
    </div>
  );
}


function StatTile({
  label,
  value,
  tone,
  onClick,
  title,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  onClick?: () => void;
  title?: string;
  loading?: boolean;
}) {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        'rounded-xl px-2.5 sm:px-3 py-2.5 sm:py-3 flex flex-col justify-between gap-1 shadow-sm text-left w-full h-full min-w-0',
        onClick && 'cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-md'
      )}
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <span className="text-[9px] sm:text-[10px] font-semibold text-secondary uppercase tracking-wide sm:tracking-widest leading-tight">
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-[22px] w-12 rounded" />
      ) : (
        <span className="text-lg font-bold leading-tight" style={{ color: tone || 'var(--text)' }}>
          {value}
        </span>
      )}
    </Tag>
  );
}

function ChartCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass-card p-3.5 sm:p-4 !border-transparent min-w-0" style={{ backgroundColor: 'var(--surface)' }}>
      {/* Fixed header height so a card with a toggle lines up with those without. */}
      <div className="flex items-center justify-between gap-2 min-h-[22px] mb-2">
        <h4 className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="flex items-center justify-center text-[11px] text-secondary" style={{ height: CHART_BODY_HEIGHT }}>
      No data for the selected filters
    </div>
  );
}

// ---- Loading skeletons, shaped like the charts they stand in for -----------

function StatusSkeleton() {
  const group = (rows: number) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between h-[14px]">
        <Skeleton className="h-2.5 w-20 rounded" />
        <Skeleton className="h-2.5 w-12 rounded" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[84px_1fr_32px] items-center gap-2 h-[20px]">
          <Skeleton className="h-2.5 w-16 rounded" />
          <Skeleton className="h-2 rounded-full" />
          <Skeleton className="h-2.5 w-5 rounded justify-self-end" />
        </div>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col justify-between" style={{ height: CHART_BODY_HEIGHT }}>
      {group(IN_PROGRESS_STATUSES.length)}
      <div className="h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
      {group(OUTCOME_STATUSES.length)}
    </div>
  );
}

function TypeSkeleton() {
  return (
    <div className="flex gap-[3px]" style={{ height: CHART_BODY_HEIGHT }}>
      <Skeleton className="flex-[4] h-full rounded-md" />
      <div className="flex-[3] flex flex-col gap-[3px]">
        <Skeleton className="flex-[3] rounded-md" />
        <Skeleton className="flex-[1] rounded-md" />
      </div>
      <div className="flex-[3] flex flex-col gap-[3px]">
        <div className="flex-[1] flex gap-[3px]">
          <Skeleton className="flex-1 rounded-md" />
          <Skeleton className="flex-1 rounded-md" />
        </div>
        <Skeleton className="flex-[1] rounded-md" />
        <Skeleton className="flex-[2] rounded-md" />
      </div>
    </div>
  );
}

const TREND_SKELETON_HEIGHTS = [18, 30, 22, 40, 34, 55, 46, 62, 38, 50, 70, 44];

function TrendSkeleton() {
  return (
    <div className="flex items-end gap-1.5 sm:gap-2 pl-6 pb-5 pt-4" style={{ height: CHART_BODY_HEIGHT }}>
      {TREND_SKELETON_HEIGHTS.map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-t" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

// ---- Applications by Status: in-progress vs outcomes -----------------------

function StatusSplit({ counts, onPick }: { counts: Record<string, number>; onPick: (status: string) => void }) {
  const outcomeTotal = OUTCOME_STATUSES.reduce((sum, st) => sum + (counts[st] || 0), 0);
  const approvalRate = outcomeTotal ? Math.round(((counts.APPROVED || 0) / outcomeTotal) * 100) : null;
  return (
    <div className="flex flex-col justify-between" style={{ height: CHART_BODY_HEIGHT }}>
      <StatusGroup
        title="In progress"
        aside={`${IN_PROGRESS_STATUSES.reduce((sum, st) => sum + (counts[st] || 0), 0)} open`}
        statuses={IN_PROGRESS_STATUSES}
        counts={counts}
        onPick={onPick}
      />
      <div className="h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
      <StatusGroup
        title="Outcomes"
        aside={
          approvalRate !== null ? (
            <span>
              <span className="text-sm font-bold" style={{ color: STATUS_TONE.APPROVED.color }}>
                {approvalRate}%
              </span>{' '}
              approved
            </span>
          ) : null
        }
        statuses={OUTCOME_STATUSES}
        counts={counts}
        onPick={onPick}
      />
    </div>
  );
}

/** Horizontal bars scaled to the group's own max. Zero-count statuses stay
 * listed (dimmed) so the layout doesn't jump around as filters change. */
function StatusGroup({
  title,
  aside,
  statuses,
  counts,
  onPick,
}: {
  title: string;
  aside: React.ReactNode;
  statuses: string[];
  counts: Record<string, number>;
  onPick: (status: string) => void;
}) {
  const mounted = useHasMounted();
  const max = Math.max(0, ...statuses.map((st) => counts[st] || 0));
  const groupTotal = statuses.reduce((sum, st) => sum + (counts[st] || 0), 0);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[10px] text-secondary">
        <span className="font-semibold uppercase tracking-wider">{title}</span>
        <span>{aside}</span>
      </div>
      {statuses.map((st, i) => {
        const n = counts[st] || 0;
        const color = STATUS_TONE[st]?.color || CHART_COLORS[0];
        return (
          <button
            key={st}
            type="button"
            disabled={n === 0}
            onClick={() => onPick(st)}
            title={n ? `${STATUS_LABELS[st]}: ${n} (${Math.round((n / groupTotal) * 100)}% of ${title.toLowerCase()}) — filter the table` : undefined}
            className={cn(
              'group w-full grid grid-cols-[84px_1fr_32px] items-center gap-2 h-[20px] text-left',
              n ? 'cursor-pointer' : 'opacity-40 cursor-default'
            )}
          >
            <span className="text-[10px] text-secondary truncate group-enabled:group-hover:underline">{STATUS_LABELS[st]}</span>
            <span className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-subtle)' }}>
              <motion.span
                className="block h-full rounded-full"
                style={{ backgroundColor: color }}
                initial={false}
                animate={{ width: mounted && n ? `${Math.max(3, (n / max) * 100)}%` : '0%' }}
                transition={{ duration: 1, delay: i * 0.06, ease: 'easeOut' }}
              />
            </span>
            <span className="text-[11px] font-semibold text-right tabular-nums" style={{ color: 'var(--text)' }}>
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Applications by Type: treemap ----------------------------------------

type TypeTileDatum = { code: string; name: string; total: number; pct: number; color: string; isOther?: boolean };

/** Custom treemap cell: a tinted tile with a solid accent edge, labelled with
 * as much as fits — name over count, then a one-line "name · count" for short
 * wide strips, then the count alone. Types too small for any label are folded
 * into "Other" upstream (MIN_TYPE_TILE_AREA). recharts clones this element
 * with the node's geometry plus the datum's own fields. */
function TypeTile(props: any) {
  const { x, y, width, height, depth, index, name, total, pct, color, isOther, code, onPick } = props;
  const mounted = useHasMounted();
  if (depth !== 1 || !(width > 0) || !(height > 0)) return null;
  const w = Math.max(0, width - 3);
  const h = Math.max(0, height - 3);
  const CHAR_W = 5.6;
  const fit = (text: string, room: number) => {
    const maxChars = Math.max(3, Math.floor(room / CHAR_W));
    return text && text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
  };
  const label = fit(name, w - 12);
  // One-line room for the name after " · <count>"; a 2-letter stub is noise,
  // so below ~6 characters the tile falls back to the count alone.
  const inlineRoom = w - 12 - CHAR_W * (String(total).length + 3);
  const showName = w > 60 && h > 34;
  const showInline = !showName && h >= 12 && inlineRoom >= CHAR_W * 6;
  const showCount = w > 16 && h > 12;
  return (
    // Entry: tiles fade/scale in one after another, largest first (the same
    // motion fade the Dashboard uses) — recharts' own treemap animation
    // squeezes tiles mid-way, overlapping their labels.
    <motion.g
      style={{ cursor: 'pointer' }}
      onClick={() => onPick?.({ code, name, total, pct, color, isOther })}
      initial={false}
      animate={mounted ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.5, delay: (Number(index) || 0) * 0.06, ease: 'easeOut' }}
    >
      <rect x={x + 1.5} y={y + 1.5} width={w} height={h} rx={6} style={{ fill: color, fillOpacity: 0.2 }} />
      <rect x={x + 1.5} y={y + 1.5} width={Math.min(3, w)} height={h} rx={1.5} style={{ fill: color }} />
      {showName ? (
        <>
          <text x={x + 10} y={y + 17} style={{ fill: 'var(--text)', fontSize: 10, fontWeight: 600 }}>
            {label}
          </text>
          <text x={x + 10} y={y + 31} style={{ fill: 'var(--text-muted)', fontSize: 10 }}>
            {total} · {pct < 1 ? '<1' : Math.round(pct)}%
          </text>
        </>
      ) : showInline ? (
        <text x={x + 10} y={y + 1.5 + h / 2} dominantBaseline="central" style={{ fontSize: 9 }}>
          <tspan style={{ fill: 'var(--text)', fontWeight: 600 }}>{fit(name, inlineRoom)}</tspan>
          <tspan style={{ fill: 'var(--text-muted)' }}> · {total}</tspan>
        </text>
      ) : showCount ? (
        <text
          x={x + 1.5 + w / 2 + 1}
          y={y + 1.5 + h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fill: 'var(--text)', fontSize: 10, fontWeight: 600 }}
        >
          {total}
        </text>
      ) : null}
    </motion.g>
  );
}

function TypeTooltip({ active, payload }: any) {
  const d: TypeTileDatum | undefined = payload?.[0]?.payload;
  if (!active || !d?.name) return null;
  return (
    <div style={{ ...CHART_TOOLTIP_PROPS.contentStyle, padding: '6px 10px' }}>
      <div style={CHART_TOOLTIP_PROPS.labelStyle}>{d.name}</div>
      <div style={CHART_TOOLTIP_PROPS.itemStyle}>
        {d.total} applications ({d.pct < 1 ? '<1' : Math.round(d.pct)}%)
        {d.isOther ? ' · click to list' : ''}
      </div>
    </div>
  );
}

/** In-card overlay listing the types folded into the "Other" tile. */
function OtherTypesPanel({
  items,
  grandTotal,
  onClose,
  onPick,
}: {
  items: { code: string; name: string; total: number }[];
  grandTotal: number;
  onClose: () => void;
  onPick: (code: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col rounded-lg border"
      style={{ backgroundColor: 'var(--tooltip-bg)', borderColor: 'var(--tooltip-border)' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--tooltip-border)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">Other types ({items.length})</span>
        <button type="button" onClick={onClose} className="p-0.5 rounded cursor-pointer text-secondary" aria-label="Close">
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {items.map((t) => (
          <button
            key={t.code}
            type="button"
            onClick={() => onPick(t.code)}
            className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-[11px] cursor-pointer hover:bg-[var(--border-subtle)]"
            style={{ color: 'var(--text)' }}
            title={`Filter the table to ${t.name}`}
          >
            <span className="truncate">{t.name}</span>
            <span className="text-secondary tabular-nums shrink-0">
              {t.total} · {grandTotal ? Math.max(1, Math.round((t.total / grandTotal) * 100)) : 0}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Application volume: gap-filled area (months) / columns (years) -------

function TrendChart({
  points,
  onPick,
  isPhone,
}: {
  points: TrendPoint[];
  onPick: (p: TrendPoint) => void;
  isPhone: boolean;
}) {
  // Label only the peak so a spike reads as a number, not just a shape.
  // (Matched by value — Bar's LabelList doesn't pass an index.)
  const peak = Math.max(...points.map((p) => p.total));
  const peakLabel = (p: any) =>
    Number(p.value) === peak && peak > 0 ? (
      <PeakLabel x={Number(p.x) + (Number(p.width) || 0) / 2} y={Number(p.y) - 6} value={p.value} />
    ) : null;
  const margin = { top: 16, right: isPhone ? 12 : 8, left: -20, bottom: 0 };
  const xAxis = (
    <XAxis
      dataKey="label"
      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
      interval="preserveStartEnd"
      minTickGap={isPhone ? 16 : 10}
      tickLine={false}
    />
  );
  const yAxis = <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} axisLine={false} tickLine={false} />;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />;

  // Clicks are handled at the chart level off the hovered column, so the whole
  // month/year column is a target — not just the dot or bar (a tiny bar is
  // hard to hit, and recharts' hover dot sits on top of the data dot and
  // swallowed its clicks).
  const pickHovered = (state: any) => {
    const i = Number(state?.activeTooltipIndex ?? state?.activeIndex);
    const p = Number.isInteger(i) ? points[i] : undefined;
    if (p) onPick(p);
  };
  const chartEvents = { onClick: pickHovered, style: { cursor: 'pointer' } };
  // recharts draws the line in but shows every dot at once, leaving dots
  // floating ahead of the line — so dots wait out the draw. (A timer, not
  // onAnimationEnd: that also fires for recharts' zero-size first pass.)
  const [lineDrawn, setLineDrawn] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setLineDrawn(true), AREA_DRAW_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <ResponsiveContainer width="100%" height={CHART_BODY_HEIGHT}>
      {points[0].unit === 'year' ? (
        <BarChart data={points} margin={margin} {...chartEvents}>
          {grid}
          {xAxis}
          {yAxis}
          {/* Hover shades the whole year column — a tint of the text color, so
              it's a light band in dark mode and a dark one in light mode. */}
          <Tooltip
            {...CHART_TOOLTIP_PROPS}
            cursor={{ fill: 'var(--text)', fillOpacity: 0.08, radius: 4 }}
            formatter={(v: any) => [v, 'Applications']}
          />
          <Bar dataKey="total" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} maxBarSize={28}>
            <LabelList dataKey="total" content={peakLabel} />
          </Bar>
        </BarChart>
      ) : (
        <AreaChart data={points} margin={margin} {...chartEvents}>
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {grid}
          {xAxis}
          {yAxis}
          <Tooltip
            {...CHART_TOOLTIP_PROPS}
            cursor={{ stroke: 'var(--text-muted)', strokeDasharray: '3 3' }}
            formatter={(v: any) => [v, 'Applications']}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke={CHART_COLORS[0]}
            strokeWidth={2}
            fill="url(#volumeFill)"
            dot={<FadeDot r={points.length > 12 ? 2.5 : 3.5} visible={lineDrawn} />}
            animationDuration={AREA_DRAW_MS}
            activeDot={{ r: 5 }}
          >
            <LabelList dataKey="total" content={peakLabel} />
          </Area>
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}

/** Area dot kept hidden while the line draws, then faded in — rendering dots
 * only after the draw made them pop in all at once. Also fades from 0 on
 * mount, since recharts re-creates its dots when the draw ends. */
function FadeDot({ cx, cy, r, visible }: any) {
  const mounted = useHasMounted();
  if (cx == null || cy == null) return null;
  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r={r}
      fill={CHART_COLORS[0]}
      stroke="none"
      initial={false}
      animate={{ opacity: visible && mounted ? 1 : 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    />
  );
}

/** Peak value label. recharts only mounts chart labels once its draw
 * finishes, so this fades in from that point instead of popping in. */
function PeakLabel({ x, y, value }: { x: number; y: number; value: React.ReactNode }) {
  const mounted = useHasMounted();
  return (
    <motion.text
      x={x}
      y={y}
      textAnchor="middle"
      style={{ fill: 'var(--text)', fontSize: 10, fontWeight: 600 }}
      initial={false}
      animate={{ opacity: mounted ? 1 : 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {value}
    </motion.text>
  );
}

// A part-to-whole "ribbon": one horizontal bar split into segments sized by
// share of the total, deliberately unlike the axis-based bar/donut charts
// above it. Percentages use flex-basis + the browser's default flex-shrink,
// so the 2px inter-segment gaps (the surface-color spacer separating marks)
// don't skew the proportions — shrink is distributed in proportion to each
// segment's own basis, preserving relative size.
function ProportionRibbon({
  items,
  toneMap,
  loading,
}: {
  items: { key: string; label: string; total: number }[];
  toneMap: Record<string, { color: string }>;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 rounded-md" />
        <div className="flex justify-center gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-2.5 w-16 rounded" />
          ))}
        </div>
      </div>
    );
  }
  // Separate component so its entry animation starts when the data arrives,
  // not when the skeleton first mounted.
  return <RibbonBody items={items} toneMap={toneMap} />;
}

function RibbonBody({
  items,
  toneMap,
}: {
  items: { key: string; label: string; total: number }[];
  toneMap: Record<string, { color: string }>;
}) {
  const total = items.reduce((sum, it) => sum + it.total, 0);
  const mounted = useHasMounted();

  if (total === 0) {
    return (
      <div className="space-y-2">
        <div className="h-6 rounded-md" style={{ backgroundColor: 'var(--border-subtle)' }} />
        <div className="text-[11px] text-secondary text-center">No data for the selected filters</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex h-6 gap-[2px]" style={{ backgroundColor: 'var(--surface)' }}>
        {items.map((it, i) => {
          const pct = (it.total / total) * 100;
          return (
            <motion.div
              key={it.key}
              className={cn(
                'relative group h-full',
                i === 0 && 'rounded-l-md',
                i === items.length - 1 && 'rounded-r-md'
              )}
              style={{ backgroundColor: toneMap[it.key]?.color || CHART_COLORS[i % CHART_COLORS.length] }}
              initial={false}
              animate={{ flexBasis: mounted ? `${pct}%` : '0%' }}
              transition={{ duration: 1, ease: 'easeOut' }}
            >
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block whitespace-nowrap z-10 pointer-events-none"
                style={{ ...CHART_TOOLTIP_PROPS.contentStyle, padding: '4px 8px' }}
              >
                <span style={CHART_TOOLTIP_PROPS.labelStyle}>{it.label}</span>
                <span style={CHART_TOOLTIP_PROPS.itemStyle}>
                  {' '}
                  : {it.total} ({Math.round(pct)}%)
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
        {items.map((it, i) => (
          <span key={it.key} className="inline-flex items-center gap-1.5 text-[10px] text-secondary">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: toneMap[it.key]?.color || CHART_COLORS[i % CHART_COLORS.length] }}
            />
            {it.label} ({it.total})
          </span>
        ))}
      </div>
    </div>
  );
}
