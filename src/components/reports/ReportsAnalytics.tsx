import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

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

export function ReportsAnalytics() {
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeOptions, setTypeOptions] = useState<{ value: string; label: string }[]>([]);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [rows, setRows] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
  }, [dateFrom, dateTo, typeFilter, statusFilter]);

  const pg = usePagination(rows, pageSize, page);

  const statusChartData = useMemo(() => {
    const src = overview?.applications_by_status || {};
    return STATUS_ORDER.filter((s) => src[s]).map((s) => ({ status: STATUS_LABELS[s], total: src[s] }));
  }, [overview]);

  const typeChartData = useMemo(
    () => (overview?.applications_by_type || []).map((t) => ({ name: t.name, total: t.total })),
    [overview]
  );

  const trendChartData = useMemo(
    () => (overview?.monthly_trend || []).map((m) => ({ month: monthLabel(m.month), total: m.total })),
    [overview]
  );

  function resetFilters() {
    setDateFrom(null);
    setDateTo(null);
    setTypeFilter('');
    setStatusFilter('');
  }

  function exportCsv() {
    if (rows.length === 0) return;
    setExporting('csv');
    try {
      const header = ['Application No.', 'Locator', 'Type', 'New/Renewal', 'Status', 'Submitted', 'Created'];
      const lines = [header.map(csvEscape).join(',')];
      rows.forEach((r) => {
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
    if (rows.length === 0) return;
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
        body: rows.map((r) => [
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
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <FieldLabel label="From">
              <div className="w-full sm:w-44">
                <DatePicker mode="single" fullWidth value={dateFrom} onChange={setDateFrom} placeholder="From date" />
              </div>
            </FieldLabel>
            <FieldLabel label="To">
              <div className="w-full sm:w-44">
                <DatePicker mode="single" fullWidth value={dateTo} onChange={setDateTo} placeholder="To date" />
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
          </div>

          <div className="flex items-center gap-2">
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
              disabled={exporting !== null || rows.length === 0}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold border cursor-pointer',
                (exporting !== null || rows.length === 0) && 'opacity-50 cursor-not-allowed'
              )}
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <FileSpreadsheet size={13} />
              Export Excel
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={exporting !== null || rows.length === 0}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold shadow-sm cursor-pointer',
                (exporting !== null || rows.length === 0) && 'opacity-50 cursor-not-allowed'
              )}
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            >
              <FileText size={13} />
              Export PDF
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <StatTile label="Total Applications" value={overview?.total_applications ?? '—'} />
        <StatTile label="Approved" value={overview?.applications_by_status?.APPROVED ?? 0} tone="#10b981" />
        <StatTile label="For Approval" value={overview?.applications_by_status?.FOR_APPROVAL ?? 0} tone="#3b82f6" />
        <StatTile label="Returned" value={overview?.applications_by_status?.RETURNED ?? 0} tone="#f59e0b" />
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
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="status" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {statusChartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Applications by Type">
          {typeChartData.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Pie data={typeChartData} dataKey="total" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2} stroke="none">
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
                <span key={t.name} className="inline-flex items-center gap-1.5 text-[10px] text-secondary">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  {t.name} ({t.total})
                </span>
              ))}
            </div>
          )}
        </ChartCard>

        <ChartCard title="Monthly Application Volume">
          {trendChartData.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Line type="monotone" dataKey="total" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Applications
          </h3>
          <span className="text-[11px] text-secondary">{rows.length} record{rows.length === 1 ? '' : 's'}</span>
        </div>

        {loading ? (
          <TableSkeleton columns={6} rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Download size={40} className="opacity-40" />}
            title="No records for these filters"
            description="Adjust the date range, type, or status filters to see matching applications."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Application</th>
                    <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Locator</th>
                    <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Type</th>
                    <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Status</th>
                    <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
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
                  ))}
                </tbody>
              </table>
            </div>

            <DataTableControls
              page={page}
              totalPages={pg.totalPages}
              totalItems={rows.length}
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

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{label}</div>
      {children}
    </div>
  );
}


function StatTile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div
      className="rounded-xl px-3 py-3 flex flex-col gap-1 shadow-sm text-left"
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{label}</span>
      <span className="text-base sm:text-lg font-bold leading-tight" style={{ color: tone || 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-4 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
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
