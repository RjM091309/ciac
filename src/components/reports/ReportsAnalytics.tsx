import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileSpreadsheet, FileText, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { DatePicker } from '../ui/DatePicker';
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeleton';

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
  function drillToMonth(ym: string) {
    const [y, m] = String(ym || '').split('-').map(Number);
    if (!y || !m) return;
    setDateFrom(new Date(y, m - 1, 1));
    setDateTo(new Date(y, m, 0));
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

  const statusChartData = useMemo(() => {
    const src = overview?.applications_by_status || {};
    return STATUS_ORDER.filter((s) => src[s]).map((s) => ({ key: s, status: STATUS_LABELS[s], total: src[s] }));
  }, [overview]);

  const typeChartData = useMemo(
    () => (overview?.applications_by_type || []).map((t) => ({ code: t.code, name: t.name, total: t.total })),
    [overview]
  );

  const trendChartData = useMemo(
    () => (overview?.monthly_trend || []).map((m) => ({ key: m.month, month: monthLabel(m.month), total: m.total })),
    [overview]
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
      downloadBlob(`3core-applications-report-${Date.now()}.csv`, `﻿${lines.join('\n')}`, 'text/csv;charset=utf-8;');
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
      doc.text('3CORE — Reports & Analytics', 14, 16);

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

      doc.save(`3core-applications-report-${Date.now()}.pdf`);
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
                  options={typeOptions}
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
        <StatTile
          label="Total Applications"
          value={overview?.total_applications ?? '—'}
          onClick={() => drillToStatus('')}
          title="Show all statuses in the table below"
        />
        <StatTile
          label="Approved"
          value={overview?.applications_by_status?.APPROVED ?? 0}
          tone="#10b981"
          onClick={() => drillToStatus('APPROVED')}
          title="Filter the table to Approved applications"
        />
        <StatTile
          label="For Approval"
          value={overview?.applications_by_status?.FOR_APPROVAL ?? 0}
          tone="#3b82f6"
          onClick={() => drillToStatus('FOR_APPROVAL')}
          title="Filter the table to applications For Approval"
        />
        <StatTile
          label="Returned"
          value={overview?.applications_by_status?.RETURNED ?? 0}
          tone="#f59e0b"
          onClick={() => drillToStatus('RETURNED')}
          title="Filter the table to Returned applications"
        />
        <StatTile
          label="Disapproved / Rejected"
          value={(overview?.applications_by_status?.DISAPPROVED ?? 0) + (overview?.applications_by_status?.REJECTED ?? 0)}
          tone="#ef4444"
        />
        <StatTile label="Contracts Issued" value={overview?.contracts_issued ?? '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Applications by Status">
          {statusChartData.length === 0 ? (
            <ChartEmpty />
          ) : (
            isPhone ? (
              // Phones: horizontal bars so status names read level instead of
              // as squeezed, angled ticks; counts sit at each bar's end since
              // hover tooltips are awkward on touch.
              <ResponsiveContainer width="100%" height={statusChartData.length * 30 + 12}>
                <BarChart data={statusChartData} layout="vertical" margin={{ top: 4, right: 32, left: 0, bottom: 4 }} barCategoryGap={6}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="status"
                    width={92}
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip {...CHART_TOOLTIP_PROPS} />
                  <Bar
                    dataKey="total"
                    radius={[0, 4, 4, 0]}
                    className="cursor-pointer"
                    onClick={(d: any) => d?.key && drillToStatus(d.key)}
                  >
                    {statusChartData.map((d, i) => (
                      <Cell key={i} fill={STATUS_TONE[d.key]?.color || CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                    <LabelList dataKey="total" position="right" style={{ fontSize: 10, fill: 'var(--text)' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="status" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP_PROPS} />
                <Bar
                  dataKey="total"
                  radius={[4, 4, 0, 0]}
                  className="cursor-pointer"
                  onClick={(d: any) => d?.key && drillToStatus(d.key)}
                >
                  {statusChartData.map((d, i) => (
                    <Cell key={i} fill={STATUS_TONE[d.key]?.color || CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            )
          )}
        </ChartCard>

        <ChartCard title="Applications by Type">
          {typeChartData.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height={isPhone ? 180 : 220}>
              <PieChart>
                <Tooltip {...CHART_TOOLTIP_PROPS} />
                <Pie
                  data={typeChartData}
                  dataKey="total"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  stroke="none"
                  className="cursor-pointer"
                  onClick={(d: any) => d?.code && drillToType(d.code)}
                >
                  {typeChartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
          {typeChartData.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
              {typeChartData.map((t, i) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => drillToType(t.code)}
                  className="inline-flex items-center gap-1.5 text-[10px] text-secondary cursor-pointer hover:underline"
                  title={`Filter the table to ${t.name}`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  {t.name} ({t.total})
                </button>
              ))}
            </div>
          )}
        </ChartCard>

        <ChartCard title="Monthly Application Volume">
          {trendChartData.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height={isPhone ? 190 : 220}>
              <LineChart data={trendChartData} margin={{ top: 4, right: isPhone ? 12 : 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  interval={isPhone ? 'preserveStartEnd' : undefined}
                  minTickGap={isPhone ? 16 : undefined}
                />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP_PROPS} />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  dot={<ClickableDot onDotClick={(payload: any) => payload?.key && drillToMonth(payload.key)} />}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="space-y-3">
        <h3 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          Permits & Inspections
        </h3>

        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
          <StatTile label="Total Permits" value={overview ? totalPermits : '—'} />
          <StatTile label="Valid Permits" value={overview?.permits_by_status?.VALID ?? 0} tone={PERMIT_STATUS_TONE.VALID.color} />
          <StatTile label="Expiring Permits" value={overview?.permits_by_status?.EXPIRING ?? 0} tone={PERMIT_STATUS_TONE.EXPIRING.color} />
          <StatTile label="Expired Permits" value={overview?.permits_by_status?.EXPIRED ?? 0} tone={PERMIT_STATUS_TONE.EXPIRED.color} />
          <StatTile label="Total Inspections" value={overview ? totalInspections : '—'} />
          <StatTile label="Failed Inspections" value={overview?.inspections_by_result?.FAILED ?? 0} tone={INSPECTION_RESULT_TONE.FAILED.color} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard title="Permits by Status">
            <ProportionRibbon items={permitStatusChartData} toneMap={PERMIT_STATUS_TONE} />
          </ChartCard>

          <ChartCard title="Inspections by Status">
            <ProportionRibbon items={inspectionStatusChartData} toneMap={INSPECTION_STATUS_TONE} />
          </ChartCard>

          <ChartCard title="Inspections by Result">
            <ProportionRibbon items={inspectionResultChartData} toneMap={INSPECTION_RESULT_TONE} />
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
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  onClick?: () => void;
  title?: string;
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
      <span className="text-lg font-bold leading-tight" style={{ color: tone || 'var(--text)' }}>
        {value}
      </span>
    </Tag>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-3.5 sm:p-4 !border-transparent min-w-0" style={{ backgroundColor: 'var(--surface)' }}>
      <h4 className="text-[11px] font-semibold text-secondary uppercase tracking-widest mb-2">{title}</h4>
      {children}
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="h-[220px] flex items-center justify-center text-[11px] text-secondary">
      No data for the selected filters
    </div>
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
}: {
  items: { key: string; label: string; total: number }[];
  toneMap: Record<string, { color: string }>;
}) {
  const total = items.reduce((sum, it) => sum + it.total, 0);

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
            <div
              key={it.key}
              className={cn(
                'relative group h-full',
                i === 0 && 'rounded-l-md',
                i === items.length - 1 && 'rounded-r-md'
              )}
              style={{ flexBasis: `${pct}%`, backgroundColor: toneMap[it.key]?.color || CHART_COLORS[i % CHART_COLORS.length] }}
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
            </div>
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

function ClickableDot({ cx, cy, payload, onDotClick }: any) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={CHART_COLORS[0]}
      stroke="none"
      style={{ cursor: 'pointer' }}
      onClick={() => onDotClick(payload)}
    />
  );
}
