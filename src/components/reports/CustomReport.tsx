import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  CalendarClock,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Mail,
  Plus,
  Printer,
  Save,
  Share2,
  Sigma,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppSelect } from '../ui/AppSelect';
import { DatePicker, parseYmd, toYmd } from '../ui/DatePicker';
import { EmptyState } from '../ui/EmptyState';
import { DataTableControls } from '../ui/DataTableControls';
import { cn } from '../../lib/utils';
import { csvEscape, downloadBlob } from './reportUtils';
import { downloadPdf, downloadWorkbook, xlDate, type PdfSection, type XlsxColumn, type XlsxGroup, type XlsxSheet } from './reportExports';
import { fmtDate } from './reportParts';
import { QuickTotal, defaultTotalsConfig, type TotalsConfig } from './QuickTotal';
import { MonthPicker } from '../ui/MonthPicker';
import { ConfirmModal } from '../ui/ConfirmModal';

// Reports & Analytics → Custom Report: the user picks what to report on
// (dataset), which columns, and the filters; the rows show as a preview and
// export to Excel (opens in Office 365) or CSV. Setups can be saved as the
// user's own templates. Server: models/CustomReport.js (columns and filters
// are a fixed catalog; a Level 2 Account Officer sees only their locators).

type ColumnDef = { key: string; label: string; type: 'text' | 'date' | 'number'; /** Heading under Columns → Add a column. */ group?: string };
type FilterDef = { key: string; label: string; type: 'select' | 'date'; options?: { value: string; label: string }[] };
type Dataset = { key: string; label: string; description: string; columns: ColumnDef[]; defaults: string[]; filters: FilterDef[] };
// missing: blank rows per column among the filtered rows (Missing filter aside).
type Result = { columns: ColumnDef[]; rows: (string | number | null)[][]; total: number; truncated: boolean; missing?: Record<string, number> };
type Template = {
  id: number;
  name: string;
  dataset: string;
  config: {
    columns?: string[];
    filters?: Record<string, string>;
    sort?: Sort | null;
    /** Opens in List or Totals; Totals' sentence ("Total … by … as of …"). */
    mode?: 'list' | 'totals';
    totals?: TotalsConfig | null;
  };
  /** Other Reports users can open it. */
  shared: boolean;
  /** The user's own (only the owner can change or delete it). */
  mine: boolean;
  owner: string | null;
  /** Recurring every month: emailed to the Account Officers, recur_from–recur_to ('YYYY-MM'). */
  recurring?: boolean;
  recur_from?: string | null;
  recur_to?: string | null;
  last_sent_month?: string | null;
  last_sent_at?: string | null;
};
const monthText = (ym?: string | null) =>
  ym ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
type Sort = { key: string; dir: 'asc' | 'desc' } | null;

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json;
}


/** Number columns that make sense to add up (not percentages). */
const summable = (c: ColumnDef) => c.type === 'number' && !/%|days left|months/i.test(c.label);
const fmtNum = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function cellText(v: string | number | null, type: ColumnDef['type']) {
  if (v == null || v === '') return '—';
  if (type === 'date') return fmtDate(String(v));
  if (type === 'number' && typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(v);
}

export function CustomReport() {
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [maxRows, setMaxRows] = useState(10000);
  const [datasetKey, setDatasetKey] = useState('locators');
  const [columns, setColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  // List (the rows) or Totals ("Total ___ by ___ as of [year]").
  const [mode, setMode] = useState<'list' | 'totals'>('list');
  const [totalsConfig, setTotalsConfig] = useState<TotalsConfig>(defaultTotalsConfig);
  // Columns → Add a column: the groups opened (all show while searching).
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  // "More filters" opened (the ones past the first four).
  const [moreFilters, setMoreFilters] = useState(false);
  const [sort, setSort] = useState<Sort>(null);
  const [columnSearch, setColumnSearch] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | 'pdf' | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [saveName, setSaveName] = useState<string | null>(null);
  const [saveShared, setSaveShared] = useState(false);
  // Recurring every month (emailed to the Account Officers from–to).
  const [saveRecurring, setSaveRecurring] = useState(false);
  const [saveFrom, setSaveFrom] = useState(thisMonth());
  const [saveTo, setSaveTo] = useState('');
  const [recipients, setRecipients] = useState<{ name: string; email: string; own_only: boolean }[] | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Summary: rows counted by one column ('' = off).
  const [groupBy, setGroupBy] = useState('');
  // Results table: a quick search over the rows, and pages.
  const [rowSearch, setRowSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const dataset = useMemo(() => datasets?.find((d) => d.key === datasetKey) || null, [datasets, datasetKey]);
  const colDef = useCallback((key: string) => dataset?.columns.find((c) => c.key === key), [dataset]);

  useEffect(() => {
    api('/api/reports/custom/catalog')
      .then((json) => {
        setDatasets(json.data);
        setMaxRows(json.maxRows || 10000);
        const first = json.data.find((d: Dataset) => d.key === 'locators') || json.data[0];
        if (first) {
          setDatasetKey(first.key);
          setColumns(first.defaults);
        }
      })
      .catch((e) => setError(e.message));
    api('/api/reports/custom/templates')
      .then((json) => setTemplates(json.data || []))
      .catch(() => setTemplates([]));
  }, []);

  function pickDataset(key: string) {
    const d = datasets?.find((x) => x.key === key);
    if (!d) return;
    setDatasetKey(key);
    setColumns(d.defaults);
    setFilters({});
    setOpenGroups([]);
    setSort(null);
    setGroupBy('');
    setTemplateId('');
  }

  // Re-run (debounced) whenever the setup changes.
  const runSeq = useRef(0);
  useEffect(() => {
    if (!dataset || !columns.length) {
      setResult(null);
      return;
    }
    const seq = ++runSeq.current;
    setRunning(true);
    const t = window.setTimeout(() => {
      api('/api/reports/custom/run', {
        method: 'POST',
        body: JSON.stringify({ dataset: dataset.key, columns, filters, sort }),
      })
        .then((json) => {
          if (seq !== runSeq.current) return;
          setResult(json.data);
          setError(null);
        })
        .catch((e) => {
          if (seq === runSeq.current) setError(e.message);
        })
        .finally(() => {
          if (seq === runSeq.current) setRunning(false);
        });
    }, 350);
    return () => window.clearTimeout(t);
  }, [dataset, columns, filters, sort]);

  const toggleColumn = (key: string) =>
    setColumns((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const moveColumn = (key: string, by: -1 | 1) =>
    setColumns((cur) => {
      const i = cur.indexOf(key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => String(x.id) === id);
    const d = t && datasets?.find((x) => x.key === t.dataset);
    if (!t || !d) return;
    setDatasetKey(d.key);
    setColumns((t.config.columns || []).filter((k) => d.columns.some((c) => c.key === k)));
    setFilters(t.config.filters || {});
    setSort(t.config.sort || null);
    setMode(t.config.mode === 'totals' ? 'totals' : 'list');
    setTotalsConfig(t.config.totals ? { ...defaultTotalsConfig(), ...t.config.totals } : defaultTotalsConfig());
  }

  // Saving under an existing name of the user's replaces that template.
  async function saveTemplate(
    name = (saveName || '').trim(),
    shared = saveShared,
    schedule: { recurring: boolean; recur_from: string | null; recur_to: string | null } = {
      recurring: saveRecurring,
      recur_from: saveRecurring ? saveFrom : null,
      recur_to: saveRecurring ? saveTo : null,
    }
  ) {
    if (!name || !dataset) return;
    try {
      const json = await api('/api/reports/custom/templates', {
        method: 'POST',
        body: JSON.stringify({
          name,
          dataset: dataset.key,
          columns,
          filters,
          sort,
          shared,
          ...schedule,
          mode,
          totals: mode === 'totals' ? totalsConfig : null,
        }),
      });
      setTemplates(json.data.templates);
      setTemplateId(String(json.data.id));
      setSaveName(null);
      toast.success(`Template "${name}" saved`);
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    }
  }

  async function sendTest() {
    if (!templateId) return;
    setSendingTest(true);
    try {
      const json = await api(`/api/reports/custom/templates/${templateId}/send-test`, { method: 'POST' });
      toast.success(`Test sent to ${json?.data?.email || 'your email'}`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the test');
    } finally {
      setSendingTest(false);
    }
  }

  // Opens the save form for the current template (same name = replace) to set its schedule.
  function editSchedule() {
    if (!currentTemplate) return;
    setSaveName(currentTemplate.name);
    setSaveShared(currentTemplate.shared);
    setSaveRecurring(true);
    setSaveFrom(currentTemplate.recur_from || thisMonth());
    setSaveTo(currentTemplate.recur_to || '');
  }

  useEffect(() => {
    if (!saveRecurring || recipients) return;
    api('/api/reports/custom/monthly-recipients')
      .then((j) => setRecipients(j.data || []))
      .catch(() => setRecipients([]));
  }, [saveRecurring, recipients]);

  async function deleteTemplate() {
    if (!templateId) return;
    try {
      const json = await api(`/api/reports/custom/templates/${templateId}`, { method: 'DELETE' });
      setTemplates(json.data);
      setTemplateId('');
      toast.success('Template deleted');
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed');
    }
  }

  const currentTemplate = templates.find((t) => String(t.id) === templateId) || null;
  const reportTitle = currentTemplate?.name || dataset?.label || 'Custom Report';

  /** The filters (and search) in force, in words — for the export subtitles. */
  function appliedText() {
    const applied = (dataset?.filters || [])
      .filter((f) => filters[f.key])
      .map((f) => `${f.label}: ${f.options?.find((o) => o.value === filters[f.key])?.label || (f.type === 'date' ? fmtDate(filters[f.key]) : filters[f.key])}`);
    if (rowSearch.trim()) applied.push(`Search: "${rowSearch.trim()}"`);
    const asOf = `As of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    return applied.length ? `${asOf} · ${applied.join(' · ')}` : asOf;
  }

  function logExport(format: 'xlsx' | 'csv' | 'pdf', rowCount: number) {
    const template = currentTemplate?.name;
    fetch('/api/reports/export-log', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report: 'custom',
        format,
        rowCount,
        filters: { dataset: dataset?.key, columns: columns.join(','), template, ...filters },
      }),
    }).catch(() => {});
  }

  const fileBase = () => `${reportTitle.replace(/[^A-Za-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;

  async function exportExcel() {
    if (!result || !dataset) return;
    setExporting('xlsx');
    try {
      const cols: XlsxColumn[] = result.columns.map((c) => ({
        header: c.label,
        width: c.type === 'date' ? 14 : c.type === 'number' ? 14 : Math.min(45, Math.max(14, c.label.length + 4)),
        align: c.type === 'number' ? 'right' : 'left',
        numFmt: c.type === 'date' ? 'mmm d, yyyy' : c.type === 'number' ? '#,##0.##' : undefined,
      }));
      const groups: XlsxGroup[] = searchedRows.map((r) => ({
        lines: [r.map((v, i) => (result.columns[i].type === 'date' ? xlDate(v as string | null) : v))],
      }));
      if (totals) groups.push({ lines: [result.columns.map((c, i) => (summable(c) ? totals[i] : i === 0 ? 'TOTAL' : null))], highlight: true });
      const sheets: XlsxSheet[] = [
        { name: dataset.label, subtitle: appliedText(), columns: cols, groups, empty: 'No rows match these filters.' },
      ];
      if (summary) {
        sheets.push({
          name: 'Summary',
          subtitle: `By ${summary.label} · ${appliedText()}`,
          columns: [
            { header: summary.label, width: 36 },
            { header: 'Count', width: 10, align: 'right' },
            { header: '% of rows', width: 12, align: 'right', numFmt: '0.0%' },
            ...summary.sumCols.map((c) => ({ header: c.label, width: 16, align: 'right' as const, numFmt: '#,##0.##' })),
          ],
          groups: summary.groups.map((g) => ({ lines: [[g.label, g.count, g.count / summary.total, ...g.sums]] })),
        });
      }
      await downloadWorkbook(`${fileBase()}.xlsx`, reportTitle.toUpperCase(), sheets);
      logExport('xlsx', searchedRows.length);
    } catch (e: any) {
      toast.error(e?.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  function exportCsv() {
    if (!result) return;
    setExporting('csv');
    const lines = [
      result.columns.map((c) => csvEscape(c.label)).join(','),
      ...searchedRows.map((r) => r.map((v) => csvEscape(v == null ? '' : v)).join(',')),
    ];
    downloadBlob(`${fileBase()}.csv`, `﻿${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
    logExport('csv', searchedRows.length);
    setExporting(null);
  }

  async function exportPdf() {
    if (!result || !dataset) return;
    setExporting('pdf');
    try {
      const body = searchedRows.map((r) => r.map((v, i) => (v == null || v === '' ? '' : cellText(v, result.columns[i].type))));
      if (totals) body.push(result.columns.map((c, i) => (summable(c) ? fmtNum(totals[i]) : i === 0 ? 'TOTAL' : '')));
      const sections: PdfSection[] = [];
      if (summary) {
        sections.push({
          heading: `Summary by ${summary.label}`,
          columns: [summary.label, 'Count', '% of rows', ...summary.sumCols.map((c) => c.label)],
          body: summary.groups.map((g) => [g.label, String(g.count), `${((g.count / summary.total) * 100).toFixed(1)}%`, ...g.sums.map(fmtNum)]),
          aligns: ['left', 'right', 'right', ...summary.sumCols.map(() => 'right' as const)],
        });
      }
      sections.push({
        heading: `${dataset.label} (${searchedRows.length.toLocaleString('en-US')})`,
        newPage: Boolean(summary),
        columns: result.columns.map((c) => c.label),
        body,
        aligns: result.columns.map((c) => (c.type === 'number' ? 'right' : 'left')),
        empty: 'No rows match these filters.',
      });
      await downloadPdf(`${fileBase()}.pdf`, reportTitle.toUpperCase(), appliedText(), sections);
      logExport('pdf', searchedRows.length);
    } catch (e: any) {
      toast.error(e?.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  // Rows after the quick search (matches the text shown in any cell).
  const searchedRows = useMemo(() => {
    if (!result) return [];
    const needle = rowSearch.trim().toLowerCase();
    if (!needle) return result.rows;
    return result.rows.filter((r) => r.some((v, i) => cellText(v, result.columns[i].type).toLowerCase().includes(needle)));
  }, [result, rowSearch]);
  useEffect(() => setPage(1), [result, rowSearch, pageSize]);

  // Totals row: sums of the number columns that add up (null = none shown).
  const totals = useMemo(() => {
    if (!result || !searchedRows.length || !result.columns.some(summable)) return null;
    return result.columns.map((c, i) => (summable(c) ? searchedRows.reduce((n, r) => n + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0) : 0));
  }, [result, searchedRows]);

  // Summary: the rows counted by one of the shown columns, largest first.
  const summary = useMemo(() => {
    if (!result || !groupBy) return null;
    const gi = result.columns.findIndex((c) => c.key === groupBy);
    if (gi < 0) return null;
    const sumIdx = result.columns.map((c, i) => (summable(c) ? i : -1)).filter((i) => i >= 0);
    const map = new Map<string, { label: string; count: number; sums: number[] }>();
    for (const r of searchedRows) {
      const label = r[gi] == null || r[gi] === '' ? '(blank)' : cellText(r[gi], result.columns[gi].type);
      const g = map.get(label) || { label, count: 0, sums: sumIdx.map(() => 0) };
      g.count += 1;
      sumIdx.forEach((ci, k) => {
        if (typeof r[ci] === 'number') g.sums[k] += r[ci] as number;
      });
      map.set(label, g);
    }
    return {
      label: result.columns[gi].label,
      total: searchedRows.length,
      sumCols: sumIdx.map((i) => result.columns[i]),
      groups: [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    };
  }, [result, searchedRows, groupBy]);
  const totalPages = Math.max(1, Math.ceil(searchedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const visiblePageNumbers = useMemo(() => {
    const start = Math.max(1, safePage - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [safePage, totalPages]);

  if (error && !datasets) {
    return <EmptyState title="Couldn't load the Custom Report" description={error} />;
  }
  if (!datasets || !dataset) {
    return (
      <div className="flex items-center justify-center py-16 text-secondary">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const q = columnSearch.trim().toLowerCase();
  const available = dataset.columns.filter((c) => !columns.includes(c.key) && (!q || c.label.toLowerCase().includes(q)));
  const availableGroups: [string, ColumnDef[]][] = [];
  for (const c of available) {
    const g = c.group || 'Columns';
    const entry = availableGroups.find(([name]) => name === g);
    if (entry) entry[1].push(c);
    else availableGroups.push([g, [c]]);
  }
  const shownRows = searchedRows.slice(pageStart, pageStart + pageSize);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const panel = 'rounded-2xl border flex flex-col';
  const panelStyle = {
    borderColor: 'var(--border-subtle)',
    backgroundColor: 'var(--surface)',
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.05)',
  };
  const headTint = { borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, var(--surface))' };
  const btn =
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold border disabled:opacity-50 disabled:cursor-not-allowed';
  const linkBtn = 'rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-secondary hover:bg-[var(--selected-bg)] hover:text-[var(--text)]';
  // A "… from" / "… to" pair of date filters shows as one range picker.
  type FilterSlot = { kind: 'one'; f: FilterDef } | { kind: 'range'; label: string; from: FilterDef; to: FilterDef };
  const filterSlots: FilterSlot[] = [];
  for (const f of dataset.filters) {
    if (f.type === 'date' && / from$/i.test(f.label)) {
      const to = dataset.filters.find((x) => x.type === 'date' && x.label.toLowerCase() === f.label.replace(/ from$/i, ' to').toLowerCase());
      if (to) {
        filterSlots.push({ kind: 'range', label: f.label.replace(/ from$/i, ''), from: f, to });
        continue;
      }
    }
    if (f.type === 'date' && / to$/i.test(f.label) && filterSlots.some((s) => s.kind === 'range' && s.to.key === f.key)) continue;
    filterSlots.push({ kind: 'one', f });
  }
  // "Missing data in": only the columns that actually have blanks (with how
  // many) — the one already chosen stays listed.
  const filterOptions = (f: FilterDef) => {
    const opts = f.options || [];
    const counts = result?.missing;
    if (f.key !== 'missing' || !counts) return opts;
    return opts
      .filter((o) => counts[o.value] || o.value === filters.missing)
      .map((o) => ({ ...o, label: `${o.label} (${(counts[o.value] || 0).toLocaleString('en-US')})` }));
  };
  // The first four filters always show; the rest under "More filters" — a
  // hidden one that has a value (e.g. from a template) shows anyway.
  const slotKey = (slot: FilterSlot) => (slot.kind === 'range' ? slot.from.key : slot.f.key);
  const filterValueSet = (slot: FilterSlot) =>
    slot.kind === 'range' ? Boolean(filters[slot.from.key] || filters[slot.to.key]) : Boolean(filters[slot.f.key]);
  const MAIN_FILTERS = 4;
  // Totals ignore "Missing data in" (it narrows the List's rows only), so it isn't offered there.
  const modeSlots = mode === 'totals' ? filterSlots.filter((slot) => slotKey(slot) !== 'missing') : filterSlots;
  const shownSlots = modeSlots.filter((slot, i) => i < MAIN_FILTERS || moreFilters || filterValueSet(slot));
  const moreSlots = modeSlots.slice(MAIN_FILTERS);

  return (
    <div className="flex flex-col gap-4">
      <ConfirmModal
        open={confirmDelete}
        danger
        title="Delete template?"
        description={`"${currentTemplate?.name || ''}" will be deleted${currentTemplate?.shared ? ' for everyone it is shared with' : ''}${
          currentTemplate?.recurring ? ', and its monthly email stops' : ''
        }. This can't be undone.`}
        confirmText="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await deleteTemplate();
        }}
      />
      {/* Templates */}
      <div className="flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center" style={panelStyle}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 10%, transparent)', color: 'var(--nav-active-bg)' }}
          >
            <Save size={15} />
          </span>
          <div className="hidden w-32 shrink-0 sm:block">
            <div className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>Templates</div>
            <div className="text-[10.5px] text-secondary">
              {templates.length
                ? `${templates.filter((t) => t.mine).length} mine · ${templates.filter((t) => !t.mine).length} shared`
                : 'Save a setup to reuse it'}
            </div>
          </div>
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <AppSelect
              options={templates.map((t) => {
                const what = datasets.find((d) => d.key === t.dataset)?.label || '';
                return {
                  value: String(t.id),
                  label: t.name,
                  detail: `${t.mine ? `${what}${t.shared ? ' · Shared' : ''}` : `${what} · by ${t.owner || 'another user'}`}${
                    t.config.mode === 'totals' ? ' · Totals' : ''
                  }${t.recurring ? ' · Monthly' : ''}`,
                };
              })}
              value={templateId}
              onChange={(v) => (v ? applyTemplate(v) : setTemplateId(''))}
              placeholder={templates.length ? 'Open a saved template…' : 'No saved templates yet'}
              isClearable
            />
          </div>
          {currentTemplate && !currentTemplate.mine ? (
            <span className="hidden text-[11px] text-secondary md:inline">by {currentTemplate.owner || 'another user'} · save a copy to change it</span>
          ) : null}
        </div>
        {saveName === null ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {/* Delete sits with the template's other actions, set apart (and quieter) than Save. */}
              {currentTemplate?.mine ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-red-50"
                  style={{ borderColor: '#ef444480', color: '#dc2626' }}
                  onClick={() => setConfirmDelete(true)}
                  title={`Delete "${currentTemplate.name}"`}
                >
                  <Trash2 size={13} /> Delete
                </button>
              ) : null}
              <button
                type="button"
                className={btn}
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                disabled={!columns.length}
                onClick={() => {
                  setSaveName(currentTemplate?.mine ? '' : currentTemplate ? `${currentTemplate.name} (copy)` : '');
                  setSaveShared(false);
                  setSaveRecurring(false);
                  setSaveFrom(thisMonth());
                  setSaveTo('');
                }}
              >
                <Plus size={13} /> {currentTemplate ? 'Save as new' : 'Save as template'}
              </button>
              {currentTemplate?.mine ? (
                <button
                  type="button"
                  className={btn}
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', borderColor: 'transparent' }}
                  disabled={!columns.length}
                  onClick={() =>
                    void saveTemplate(currentTemplate.name, currentTemplate.shared, {
                      recurring: Boolean(currentTemplate.recurring),
                      recur_from: currentTemplate.recur_from ?? null,
                      recur_to: currentTemplate.recur_to ?? null,
                    })
                  }
                  title={`Save the current setup into "${currentTemplate.name}"`}
                >
                  <Save size={13} /> Save changes
                </button>
              ) : null}
            </div>

            {/* Monthly email: status of the open template, and its actions. */}
            {currentTemplate && (currentTemplate.mine || currentTemplate.recurring) ? (
              <div
                className="flex basis-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2"
                style={
                  currentTemplate.recurring
                    ? { backgroundColor: 'color-mix(in oklab, #16a34a 7%, var(--surface))', border: '1px solid color-mix(in oklab, #16a34a 22%, transparent)' }
                    : { backgroundColor: 'color-mix(in oklab, var(--control-bg) 50%, var(--surface))', border: '1px solid var(--border-subtle)' }
                }
              >
                <CalendarClock size={14} style={{ color: currentTemplate.recurring ? '#15803d' : 'var(--text-muted)' }} />
                <div className="min-w-0 flex-1 text-[11.5px]">
                  {currentTemplate.recurring ? (
                    <>
                      <span className="font-semibold" style={{ color: '#15803d' }}>
                        Monthly email
                      </span>
                      <span className="text-secondary">
                        {' '}
                        · {monthText(currentTemplate.recur_from)} – {monthText(currentTemplate.recur_to)} · to the Account Officers ·{' '}
                        {currentTemplate.last_sent_month ? `last sent ${monthText(currentTemplate.last_sent_month)}` : 'not sent yet'}
                      </span>
                    </>
                  ) : (
                    <span className="text-secondary">Not emailed monthly — set it up to send this report to the Account Officers every month.</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {currentTemplate.recurring ? (
                    <button
                      type="button"
                      className={linkBtn}
                      disabled={sendingTest}
                      onClick={() => void sendTest()}
                      title="Emails a copy only to you — the email address on your account"
                    >
                      <span className="inline-flex items-center gap-1">
                        {sendingTest ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Send test to me
                      </span>
                    </button>
                  ) : null}
                  {currentTemplate.mine ? (
                    <button type="button" className={linkBtn} onClick={editSchedule}>
                      {currentTemplate.recurring ? 'Edit' : 'Set up monthly email'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex basis-full flex-col gap-3 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
            {/* Name */}
            <div className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-secondary">Template name</span>
              <input
                autoFocus
                className="app-input h-9 w-full sm:max-w-md"
                placeholder="e.g. Monthly locator list"
                value={saveName}
                maxLength={120}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTemplate();
                  if (e.key === 'Escape') setSaveName(null);
                }}
              />
            </div>

            {/* Options: Share / Recurring every month */}
            <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-2">
              <OptionCard
                checked={saveShared}
                onChange={setSaveShared}
                icon={Share2}
                title="Share with other users"
                text="Everyone with access to Reports can open and run it. Only you can change or delete it."
              />
              <OptionCard
                checked={saveRecurring}
                onChange={setSaveRecurring}
                icon={CalendarClock}
                title="Recurring every month"
                text="Emailed as an Excel file to every Account Officer at the start of each month."
              >
                {saveRecurring ? (
                  <div className="mt-2.5 flex flex-col gap-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-secondary">
                      <span className="w-9">From</span>
                      <MonthPicker value={saveFrom} min={thisMonth()} onChange={setSaveFrom} />
                      <span>to</span>
                      <MonthPicker value={saveTo} min={saveFrom || thisMonth()} onChange={setSaveTo} placeholder="Until…" />
                    </div>
                    {saveFrom === thisMonth() ? (
                      <div className="text-[11px] text-amber-700">This month is included — its copy goes out within a few hours of saving.</div>
                    ) : null}
                    <div>
                      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-secondary">Sent to</div>
                      <div className="flex flex-wrap gap-1.5">
                        {recipients === null ? (
                          <span className="text-[11px] text-secondary">Loading…</span>
                        ) : recipients.length ? (
                          recipients.map((r) => (
                            <span
                              key={r.email}
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                              title={r.email}
                            >
                              {r.name}
                              <span className="text-secondary">· {r.own_only ? 'own locators' : 'all locators'}</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-secondary">No active Account Officer with an email.</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </OptionCard>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={() => setSaveName(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btn}
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', borderColor: 'transparent' }}
                disabled={!saveName.trim() || (saveRecurring && (!saveFrom || !saveTo || saveFrom > saveTo))}
                onClick={() => void saveTemplate()}
              >
                <Save size={13} /> Save template
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={cn('grid grid-cols-1 items-start gap-4', mode === 'list' && 'xl:grid-cols-[20rem_minmax(0,1fr)]')}>
        {/* Setup: a sticky sidebar that scrolls on its own. Totals don't use the
            dataset or the columns, so it's hidden there (the table goes full width). */}
        <div
          key={`side-${mode}`}
          className={cn('mode-side flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto scrollbar-hide', mode === 'totals' && 'hidden')}
        >
          <div className={panel} style={panelStyle}>
            <StepHead n={1} icon={Database} title="Report on" style={headTint} />
            <div className="flex flex-col gap-1.5 p-3">
              <AppSelect
                isClearable={false}
                value={datasetKey}
                onChange={(v) => v && pickDataset(String(v))}
                options={datasets.map((d) => ({ value: d.key, label: d.label }))}
              />
              <span className="px-1 text-[10.5px] leading-snug text-secondary">{dataset.description}</span>
            </div>
          </div>

          <div className={panel} style={panelStyle}>
            <StepHead
              n={2}
              icon={SlidersHorizontal}
              title="Columns"
              count={columns.length}
              style={headTint}
              right={
                <span className="flex gap-0.5">
                  <button type="button" className={linkBtn} onClick={() => setColumns(dataset.columns.map((c) => c.key))}>
                    All
                  </button>
                  <button type="button" className={linkBtn} onClick={() => setColumns(dataset.defaults)}>
                    Default
                  </button>
                  <button type="button" className={linkBtn} onClick={() => setColumns([])}>
                    Clear
                  </button>
                </span>
              }
            />
            <div className="flex flex-col gap-2.5 p-3">
              {/* Chosen columns, in the order they'll appear. */}
              {columns.length ? (
                <div className="flex flex-col overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
                  {columns.map((key, i) => (
                    <div
                      key={key}
                      className={cn('group flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-[var(--selected-bg)]', i > 0 && 'border-t')}
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tabular-nums text-secondary"
                        style={{ backgroundColor: 'var(--control-bg)' }}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text)' }}>
                        {colDef(key)?.label || key}
                      </span>
                      <span className="flex items-center opacity-60 group-hover:opacity-100">
                        <button type="button" className="rounded p-0.5 text-secondary hover:text-[var(--text)] disabled:opacity-30" disabled={i === 0} onClick={() => moveColumn(key, -1)} title="Move up">
                          <ChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="rounded p-0.5 text-secondary hover:text-[var(--text)] disabled:opacity-30"
                          disabled={i === columns.length - 1}
                          onClick={() => moveColumn(key, 1)}
                          title="Move down"
                        >
                          <ChevronDown size={13} />
                        </button>
                        <button type="button" className="rounded p-0.5 text-secondary hover:text-red-500" onClick={() => toggleColumn(key)} title="Remove">
                          <X size={13} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed px-3 py-3 text-center text-[11px] text-secondary" style={{ borderColor: 'var(--border-subtle)' }}>
                  No columns yet — add some below.
                </div>
              )}
              <div className="flex flex-col gap-2 rounded-xl p-2.5" style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 45%, transparent)' }}>
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
                  <input
                    className="app-input h-8 w-full pl-8 text-[12px]"
                    placeholder={`Add a column… (${dataset.columns.length - columns.length} more)`}
                    value={columnSearch}
                    onChange={(e) => setColumnSearch(e.target.value)}
                  />
                </div>
                {/* Grouped (Locator, Lease, Capital, …), each opened on a click; a
                    search shows every match. One group only: just the chips. */}
                {availableGroups.length > 1 ? (
                  <div className="flex flex-col">
                    {availableGroups.map(([group, cols]) => {
                      const open = Boolean(q) || openGroups.includes(group);
                      return (
                        <div key={group} className="border-t first:border-t-0" style={{ borderColor: 'var(--border-subtle)' }}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 py-1.5 text-left text-[11px] font-semibold"
                            style={{ color: 'var(--text)' }}
                            onClick={() => setOpenGroups((cur) => (cur.includes(group) ? cur.filter((g) => g !== group) : [...cur, group]))}
                          >
                            {open ? <ChevronUp size={12} className="text-secondary" /> : <ChevronDown size={12} className="text-secondary" />}
                            <span className="flex-1">{group}</span>
                            <span className="rounded-full px-1.5 text-[10px] tabular-nums text-secondary" style={{ backgroundColor: 'var(--control-bg)' }}>
                              {cols.length}
                            </span>
                          </button>
                          {open ? (
                            <div className="flex flex-wrap gap-1.5 pb-2">
                              {cols.map((c) => (
                                <button
                                  key={c.key}
                                  type="button"
                                  onClick={() => toggleColumn(c.key)}
                                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:border-[var(--nav-active-bg)]"
                                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                                >
                                  <Plus size={10} className="text-secondary" /> {c.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {available.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => toggleColumn(c.key)}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:border-[var(--nav-active-bg)]"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                      >
                        <Plus size={10} className="text-secondary" /> {c.label}
                      </button>
                    ))}
                  </div>
                )}
                {!available.length ? <span className="text-[11px] text-secondary">{q ? 'No match.' : 'Every column is added.'}</span> : null}
              </div>
            </div>
          </div>
        </div>

        {/* Result */}
        <div className={cn(panel, 'min-w-0 overflow-hidden')} style={panelStyle}>
          <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* List = the rows; Totals = "Total ___ by ___ as of [year]". */}
                {/* macOS-style segmented control: one white thumb slides (with a little spring) under the chosen side. */}
                <div
                  className="relative grid grid-cols-2 gap-1 rounded-xl p-1"
                  style={{ backgroundColor: 'var(--control-bg)', boxShadow: 'inset 0 1px 2px rgb(0 0 0 / 0.06)' }}
                  role="tablist"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-lg transition-transform duration-[420ms] motion-reduce:transition-none"
                    style={{
                      width: 'calc(50% - 6px)',
                      transform: mode === 'totals' ? 'translateX(calc(100% + 4px))' : 'translateX(0)',
                      transitionTimingFunction: 'cubic-bezier(0.34, 1.36, 0.64, 1)',
                      backgroundColor: 'var(--surface)',
                      boxShadow: '0 1px 3px rgb(0 0 0 / 0.12), 0 0 0 0.5px rgb(0 0 0 / 0.06)',
                    }}
                  />
                  {(
                    [
                      ['list', 'List', 'Every row', FileText],
                      ['totals', 'Totals', 'Sum by group', Sigma],
                    ] as const
                  ).map(([key, label, hint, Icon]) => {
                    const on = mode === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => setMode(key)}
                        className="relative z-10 inline-flex items-center gap-2.5 rounded-lg px-4 py-2 text-left transition-colors duration-300 hover:text-[var(--text)] active:scale-[0.98]"
                        style={{ color: on ? 'var(--text)' : 'var(--text-muted)' }}
                      >
                        <Icon
                          size={17}
                          className="transition-transform duration-300 motion-reduce:transition-none"
                          style={{ transform: on ? 'scale(1.08)' : 'scale(1)' }}
                        />
                        <span className="flex flex-col leading-tight">
                          <span className="text-[14px] font-bold">{label}</span>
                          <span className="text-[10.5px] font-medium opacity-70">{hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {running ? <Loader2 size={13} className="animate-spin text-secondary" /> : null}
              </div>
              {/* Only when it matters: the rows were capped, or the search narrows what's exported. */}
              {mode === 'list' && result && (result.truncated || rowSearch.trim()) ? (
                <div className="mt-0.5 text-[11px]" style={{ color: '#b45309' }}>
                  {[
                    result.truncated ? `Only the first ${maxRows.toLocaleString('en-US')} rows — narrow the filters` : '',
                    rowSearch.trim() ? `${searchedRows.length.toLocaleString('en-US')} match the search — the export has these` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              ) : null}
            </div>
            <div className={cn('flex flex-wrap gap-2', mode === 'totals' && 'hidden')}>
              <button
                type="button"
                className={btn}
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', borderColor: 'transparent' }}
                disabled={!result || running || Boolean(exporting)}
                onClick={() => void exportExcel()}
              >
                {exporting === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Export Excel
              </button>
              <button
                type="button"
                className={btn}
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                disabled={!result || running || Boolean(exporting)}
                onClick={exportCsv}
              >
                <FileText size={14} /> CSV
              </button>
              <button
                type="button"
                className={btn}
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                disabled={!result || running || Boolean(exporting)}
                onClick={() => void exportPdf()}
                title="PDF (landscape A4) — open it to print"
              >
                {exporting === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} PDF
              </button>
            </div>
          </div>

          {/* Filters: the dataset's first four always show; the rest open under
              "More filters" (one of them that has a value stays shown). */}
          {dataset.filters.length ? (
            <div className="flex flex-col gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  >
                    3
                  </span>
                  <Filter size={12} className="text-secondary" /> Filters
                  {activeFilters ? (
                    <span className="rounded-full px-1.5 text-[10px] font-semibold tabular-nums" style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}>
                      {activeFilters}
                    </span>
                  ) : null}
                </span>
                {activeFilters ? (
                  <button type="button" className={linkBtn} onClick={() => setFilters({})}>
                    Clear all
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {shownSlots.map((slot) => {
                  const key = slotKey(slot);
                  const label = slot.kind === 'range' ? slot.label : slot.f.label;
                  return (
                    <label key={key} className="flex min-w-0 flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">{label}</span>
                      {slot.kind === 'range' ? (
                        <DatePicker
                          mode="range"
                          bordered
                          fullWidth
                          placeholder="Any date"
                          value={[parseYmd(filters[slot.from.key]), parseYmd(filters[slot.to.key])]}
                          onChange={(r: [Date | null, Date | null] | null) =>
                            setFilters((p) => ({ ...p, [slot.from.key]: toYmd(r?.[0] ?? null), [slot.to.key]: toYmd(r?.[1] ?? null) }))
                          }
                        />
                      ) : slot.f.type === 'select' ? (
                        <AppSelect
                          options={filterOptions(slot.f)}
                          value={filters[slot.f.key] || ''}
                          onChange={(v) => setFilters((p) => ({ ...p, [slot.f.key]: v || '' }))}
                          placeholder="Any"
                          isClearable
                        />
                      ) : (
                        <DatePicker
                          mode="single"
                          bordered
                          fullWidth
                          placeholder="Any date"
                          value={parseYmd(filters[slot.f.key])}
                          onChange={(d: Date | null) => setFilters((p) => ({ ...p, [slot.f.key]: toYmd(d) }))}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
              {moreSlots.length ? (
                <button
                  type="button"
                  className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-secondary hover:bg-[var(--selected-bg)] hover:text-[var(--text)]"
                  onClick={() => setMoreFilters((v) => !v)}
                >
                  {moreFilters ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {moreFilters ? 'Fewer filters' : `More filters (${moreSlots.length})`}
                </button>
              ) : null}
            </div>
          ) : null}

          <div key={`body-${mode}`} className={mode === 'totals' ? 'mode-swap-right' : 'mode-swap-left'}>
          {mode === 'totals' ? (
            datasetKey === 'locators' ? (
              <QuickTotal
                embedded
                config={totalsConfig}
                onConfigChange={setTotalsConfig}
                filters={Object.fromEntries(Object.entries(filters).filter(([k]) => k !== 'missing'))}
                filterText={(dataset?.filters || [])
                  .filter((f) => f.key !== 'missing' && filters[f.key])
                  .map((f) => `${f.label}: ${f.options?.find((o) => o.value === filters[f.key])?.label || (f.type === 'date' ? fmtDate(filters[f.key]) : filters[f.key])}`)
                  .join(' · ')}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <Sigma size={20} className="text-secondary" />
                <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                  Totals are for Registered Locators
                </div>
                <div className="max-w-sm text-[11.5px] text-secondary">
                  Total investment, employees, leased area, MGL or locators — by nationality, industry, type of property and more.
                </div>
                <button
                  type="button"
                  className={btn}
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', borderColor: 'transparent' }}
                  onClick={() => pickDataset('locators')}
                >
                  Switch to Registered Locators
                </button>
              </div>
            )
          ) : (
          <div className="flex flex-col gap-3 p-3">
            {error ? (
              <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: '#ef444455', color: '#ef4444' }}>
                {error}
              </div>
            ) : null}

            {result && result.columns.length ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  className="app-input h-9 w-full pl-8 pr-8 text-[12px]"
                  placeholder="Search these rows…"
                  value={rowSearch}
                  onChange={(e) => setRowSearch(e.target.value)}
                />
                {rowSearch ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-[var(--text)]"
                    onClick={() => setRowSearch('')}
                    title="Clear search"
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </div>
                <div className="flex items-center gap-2">
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-secondary">
                    <Sigma size={12} /> Summary by
                  </span>
                  <div className="w-52">
                    <AppSelect
                      options={result.columns.filter((c) => c.type === 'text').map((c) => ({ value: c.key, label: c.label }))}
                      value={groupBy}
                      onChange={(v) => setGroupBy(v || '')}
                      placeholder="Off"
                      isClearable
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* Summary: rows counted by the chosen column (plus sums of the number columns). */}
            {summary ? (
              <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2" style={headTint}>
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                    Summary by {summary.label}
                    <span className="ml-1.5 font-normal text-secondary">
                      {summary.groups.length} group{summary.groups.length === 1 ? '' : 's'} · {summary.total.toLocaleString('en-US')} rows
                    </span>
                  </span>
                  <button type="button" className={linkBtn} onClick={() => setGroupBy('')}>
                    Hide
                  </button>
                </div>
                <div className="max-h-72 overflow-auto hover-scrollbar">
                  <table className="w-full text-left text-[12px] border-collapse">
                    <thead className="sticky top-0" style={{ backgroundColor: 'var(--surface)' }}>
                      <tr className="text-[10px] uppercase tracking-wider text-secondary">
                        <th className="border-b px-3 py-2 font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>{summary.label}</th>
                        <th className="border-b px-3 py-2 text-right font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>Count</th>
                        <th className="w-1/3 border-b px-3 py-2 font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>Share</th>
                        {summary.sumCols.map((c) => (
                          <th key={c.key} className="border-b px-3 py-2 text-right font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.groups.map((g) => {
                        const pct = summary.total ? (g.count / summary.total) * 100 : 0;
                        return (
                          <tr key={g.label} className="border-t hover:bg-[var(--selected-bg)]" style={{ borderColor: 'var(--border-subtle)' }}>
                            <td className="px-3 py-1.5" style={{ color: g.label === '(blank)' ? 'var(--text-muted)' : 'var(--text)' }}>
                              {/status|new \/ renewal/i.test(summary.label) && g.label !== '(blank)' ? <StatusPill value={g.label} /> : g.label}
                            </td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
                              {g.count.toLocaleString('en-US')}
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--control-bg)' }}>
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--nav-active-bg)' }} />
                                </div>
                                <span className="w-11 text-right text-[10.5px] tabular-nums text-secondary">{pct.toFixed(1)}%</span>
                              </div>
                            </td>
                            {g.sums.map((n, k) => (
                              <td key={k} className="px-3 py-1.5 text-right tabular-nums" style={{ color: 'var(--text)' }}>
                                {fmtNum(n)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {result && result.columns.length ? (
              <div
                className={cn('min-w-0 overflow-auto rounded-xl border max-h-[70vh] hover-scrollbar transition-opacity', running && 'opacity-60')}
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <table className="w-full text-left text-[12px] border-collapse">
                  <thead className="sticky top-0 z-10" style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 80%, var(--surface))' }}>
                    <tr>
                      <th className="w-10 border-b px-3 py-2.5 text-right text-[10px] font-semibold text-secondary" style={{ borderColor: 'var(--border-subtle)' }}>
                        #
                      </th>
                      {result.columns.map((c) => {
                        const active = sort?.key === c.key;
                        return (
                          <th
                            key={c.key}
                            className={cn(
                              'group px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none border-b hover:text-[var(--text)]',
                              c.type === 'number' && 'text-right'
                            )}
                            style={{ borderColor: 'var(--border-subtle)', color: active ? 'var(--text)' : 'var(--text-muted)' }}
                            onClick={() =>
                              setSort((s) => (s?.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }))
                            }
                            title="Sort"
                          >
                            <span className="inline-flex items-center gap-1">
                              {c.label}
                              {active ? (
                                sort?.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                              ) : (
                                <ArrowUpDown size={10} className="opacity-0 group-hover:opacity-50" />
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((r, i) => (
                      <tr
                        key={i}
                        className="border-t hover:bg-[var(--selected-bg)]"
                        style={{
                          borderColor: 'var(--border-subtle)',
                          backgroundColor: i % 2 ? 'color-mix(in oklab, var(--control-bg) 30%, transparent)' : undefined,
                        }}
                      >
                        <td className="px-3 py-2 text-right align-top text-[10.5px] tabular-nums text-secondary">{pageStart + i + 1}</td>
                        {r.map((v, j) => {
                          const c = result.columns[j];
                          const empty = v == null || v === '';
                          const isStatus = !empty && /status|new \/ renewal/i.test(c.label);
                          return (
                            <td
                              key={j}
                              className={cn(
                                'px-3 py-2 align-top max-w-[22rem]',
                                c.type === 'number' ? 'text-right tabular-nums whitespace-nowrap' : c.type === 'date' ? 'whitespace-nowrap tabular-nums' : '',
                                j === 0 && !empty && 'font-semibold'
                              )}
                              style={{
                                color: empty
                                  ? 'var(--text-muted)'
                                  : c.key === 'days_left' && typeof v === 'number'
                                    ? v < 0
                                      ? '#dc2626'
                                      : v <= 90
                                        ? '#b45309'
                                        : 'var(--text)'
                                    : 'var(--text)',
                                fontWeight: c.key === 'days_left' && typeof v === 'number' && v <= 90 ? 600 : undefined,
                              }}
                            >
                              {isStatus ? <StatusPill value={String(v)} /> : <div className={c.type === 'text' ? 'line-clamp-2' : undefined}>{cellText(v, c.type)}</div>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!shownRows.length ? (
                      <tr>
                        <td colSpan={result.columns.length + 1} className="px-3 py-10 text-center text-[12px] text-secondary">
                          {rowSearch.trim() ? 'No rows match the search.' : 'No rows match these filters.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  {totals ? (
                    <tfoot className="sticky bottom-0" style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 80%, var(--surface))' }}>
                      <tr className="border-t-2" style={{ borderColor: 'var(--border)' }}>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-[10.5px] font-bold text-secondary">Total</td>
                        {result.columns.map((c, i) => (
                          <td
                            key={c.key}
                            className={cn('px-3 py-2 text-[11.5px] font-bold', c.type === 'number' && 'text-right tabular-nums whitespace-nowrap')}
                            style={{ color: 'var(--text)' }}
                          >
                            {summable(c) ? fmtNum(totals[i]) : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            ) : null}
            {result && result.columns.length && searchedRows.length > 0 ? (
              <DataTableControls
                page={safePage}
                totalPages={totalPages}
                totalItems={searchedRows.length}
                showingFrom={pageStart + 1}
                showingTo={Math.min(searchedRows.length, pageStart + pageSize)}
                visiblePageNumbers={visiblePageNumbers}
                pageSize={pageSize}
                pageSizeOptions={[25, 50, 100, 200]}
                onPageSizeChange={(v) => setPageSize(v)}
                onPageChange={(p) => setPage(p)}
              />
            ) : !columns.length ? (
              <EmptyState title="No columns" description="Pick the columns you want on the left." />
            ) : null}
          </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Numbered step heading for the setup panels. */
/** A tickable option tile (the template save form's Share / Recurring). */
function OptionCard({
  checked,
  onChange,
  icon: Icon,
  title,
  text,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border px-3 py-2.5 transition-colors"
      // Plain white either way; the checkbox shows the state (a ticked card
      // only gets a slightly firmer border).
      style={{
        borderColor: checked ? 'var(--input-border)' : 'var(--border-subtle)',
        backgroundColor: 'var(--surface)',
      }}
    >
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>
            <Icon size={13} className="text-secondary" /> {title}
          </span>
          <span className="block text-[11px] leading-snug text-secondary">{text}</span>
        </span>
      </label>
      {children ? <div className="pl-6">{children}</div> : null}
    </div>
  );
}

function StepHead({
  n,
  icon: Icon,
  title,
  count,
  right,
  style,
}: {
  n: number;
  icon: React.ElementType;
  title: string;
  count?: number;
  right?: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5" style={style}>
      <span className="flex items-center gap-2">
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
        >
          {n}
        </span>
        <Icon size={13} className="text-secondary" />
        <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>
          {title}
        </span>
        {count !== undefined ? (
          <span className="rounded-full px-1.5 text-[10px] font-semibold tabular-nums text-secondary" style={{ backgroundColor: 'var(--control-bg)' }}>
            {count}
          </span>
        ) : null}
      </span>
      {right}
    </div>
  );
}

/** Status-like values as a coloured pill (green / red / amber / neutral). */
function StatusPill({ value }: { value: string }) {
  const v = value.toUpperCase();
  const tone = /RENEWAL IN PROCESS/.test(v)
    ? { fg: '#2563eb', bg: 'rgba(59,130,246,.12)' }
    : /^(ACTIVE|APPROVED|CURRENT|COMPLETED|RENEWAL)$/.test(v) || v.includes('APPROVED')
    ? { fg: '#15803d', bg: 'rgba(34,197,94,.14)' }
    : /INACTIVE|EXPIRED|REJECT|DISAPPROV|CANCEL|DECLIN/.test(v)
      ? { fg: '#dc2626', bg: 'rgba(239,68,68,.12)' }
      : /EXPIRING|PENDING|FOR_|FOR |EVALUAT|REVIEW|RETURN|PROCESS|SUBMIT|NEW/.test(v)
        ? { fg: '#b45309', bg: 'rgba(245,158,11,.14)' }
        : { fg: 'var(--text-muted)', bg: 'var(--control-bg)' };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ color: tone.fg, backgroundColor: tone.bg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'currentColor' }} />
      {value.replace(/_/g, ' ')}
    </span>
  );
}
