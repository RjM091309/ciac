import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppSelect } from '../ui/AppSelect';
import { DatePicker, parseYmd, toYmd } from '../ui/DatePicker';
import { EmptyState } from '../ui/EmptyState';
import { cn } from '../../lib/utils';
import { csvEscape, downloadBlob } from './reportUtils';
import { downloadWorkbook, xlDate, type XlsxColumn } from './reportExports';
import { fmtDate } from './reportParts';

// Reports & Analytics → Custom Report: the user picks what to report on
// (dataset), which columns, and the filters; the rows show as a preview and
// export to Excel (opens in Office 365) or CSV. Setups can be saved as the
// user's own templates. Server: models/CustomReport.js (columns and filters
// are a fixed catalog; a Level 2 Account Officer sees only their locators).

type ColumnDef = { key: string; label: string; type: 'text' | 'date' | 'number' };
type FilterDef = { key: string; label: string; type: 'select' | 'date'; options?: { value: string; label: string }[] };
type Dataset = { key: string; label: string; description: string; columns: ColumnDef[]; defaults: string[]; filters: FilterDef[] };
type Result = { columns: ColumnDef[]; rows: (string | number | null)[][]; total: number; truncated: boolean };
type Template = { id: number; name: string; dataset: string; config: { columns?: string[]; filters?: Record<string, string>; sort?: Sort | null } };
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

const PREVIEW_ROWS = 200;

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
  const [sort, setSort] = useState<Sort>(null);
  const [columnSearch, setColumnSearch] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [saveName, setSaveName] = useState<string | null>(null);

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
    setSort(null);
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
  }

  async function saveTemplate() {
    const name = (saveName || '').trim();
    if (!name || !dataset) return;
    try {
      const json = await api('/api/reports/custom/templates', {
        method: 'POST',
        body: JSON.stringify({ name, dataset: dataset.key, columns, filters, sort }),
      });
      setTemplates(json.data.templates);
      setTemplateId(String(json.data.id));
      setSaveName(null);
      toast.success(`Template "${name}" saved`);
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    }
  }

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

  function logExport(format: 'xlsx' | 'csv', rowCount: number) {
    const template = templates.find((t) => String(t.id) === templateId)?.name;
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

  const fileBase = () => {
    const t = templates.find((x) => String(x.id) === templateId)?.name;
    return `${(t || dataset?.label || 'Custom Report').replace(/[^A-Za-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
  };

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
      const groups = result.rows.map((r) => ({
        lines: [r.map((v, i) => (result.columns[i].type === 'date' ? xlDate(v as string | null) : v))],
      }));
      const title = (templates.find((x) => String(x.id) === templateId)?.name || dataset.label).toUpperCase();
      const applied = dataset.filters
        .filter((f) => filters[f.key])
        .map((f) => `${f.label}: ${f.options?.find((o) => o.value === filters[f.key])?.label || filters[f.key]}`);
      await downloadWorkbook(`${fileBase()}.xlsx`, title, [
        {
          name: dataset.label,
          subtitle: applied.length ? applied.join(' · ') : `As of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
          columns: cols,
          groups,
          empty: 'No rows match these filters.',
        },
      ]);
      logExport('xlsx', result.rows.length);
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
      ...result.rows.map((r) => r.map((v) => csvEscape(v == null ? '' : v)).join(',')),
    ];
    downloadBlob(`${fileBase()}.csv`, `﻿${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
    logExport('csv', result.rows.length);
    setExporting(null);
  }

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
  const shownRows = result ? result.rows.slice(0, PREVIEW_ROWS) : [];
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const templateName = templates.find((t) => String(t.id) === templateId)?.name;
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
  const filterLabel = (f: FilterDef) => f.options?.find((o) => o.value === filters[f.key])?.label || (f.type === 'date' ? fmtDate(filters[f.key]) : filters[f.key]);

  return (
    <div className="flex flex-col gap-4">
      {/* Templates */}
      <div className="flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center" style={panelStyle}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 12%, transparent)', color: 'var(--nav-active-bg)' }}
          >
            <Save size={15} />
          </span>
          <div className="hidden shrink-0 sm:block">
            <div className="text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>My templates</div>
            <div className="text-[10.5px] text-secondary">{templates.length ? `${templates.length} saved` : 'Save a setup to reuse it'}</div>
          </div>
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <AppSelect
              options={templates.map((t) => ({ value: String(t.id), label: t.name, detail: datasets.find((d) => d.key === t.dataset)?.label || '' }))}
              value={templateId}
              onChange={(v) => (v ? applyTemplate(v) : setTemplateId(''))}
              placeholder={templates.length ? 'Open a saved template…' : 'No saved templates yet'}
              isClearable
            />
          </div>
          {templateId ? (
            <button type="button" className={btn} style={{ borderColor: '#ef444466', color: '#ef4444' }} onClick={() => void deleteTemplate()} title="Delete this template">
              <Trash2 size={13} />
            </button>
          ) : null}
        </div>
        {saveName === null ? (
          <button
            type="button"
            className={btn}
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            disabled={!columns.length}
            onClick={() => setSaveName(templateName || '')}
          >
            <Save size={13} /> Save as template
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="app-input h-9 w-56"
              placeholder="e.g. Quarterly locator list"
              value={saveName}
              maxLength={120}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveTemplate();
                if (e.key === 'Escape') setSaveName(null);
              }}
            />
            <button
              type="button"
              className={btn}
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', borderColor: 'transparent' }}
              disabled={!saveName.trim()}
              onClick={() => void saveTemplate()}
            >
              Save
            </button>
            <button type="button" className={btn} style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={() => setSaveName(null)}>
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        {/* Setup: a sticky sidebar that scrolls on its own. */}
        <div className="flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto scrollbar-hide">
          <div className={panel} style={panelStyle}>
            <StepHead n={1} icon={Database} title="Report on" style={headTint} />
            <div className="flex flex-col gap-1.5 p-3">
              {datasets.map((d) => {
                const on = d.key === datasetKey;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => pickDataset(d.key)}
                    className="flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-[var(--selected-bg)]"
                    style={
                      on
                        ? { borderColor: 'var(--nav-active-bg)', backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 7%, transparent)' }
                        : { borderColor: 'var(--border-subtle)' }
                    }
                  >
                    <span
                      className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2"
                      style={{ borderColor: on ? 'var(--nav-active-bg)' : 'var(--border)' }}
                    >
                      {on ? <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--nav-active-bg)' }} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>
                        {d.label}
                      </span>
                      <span className="block text-[10.5px] leading-snug text-secondary">{d.description}</span>
                    </span>
                  </button>
                );
              })}
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
                  {!available.length ? <span className="text-[11px] text-secondary">{q ? 'No match.' : 'Every column is added.'}</span> : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Result */}
        <div className={cn(panel, 'min-w-0 overflow-hidden')} style={panelStyle}>
          <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
                  {templateName || dataset.label}
                </span>
                {result ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
                    style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 10%, transparent)', color: 'var(--text)' }}
                  >
                    {result.total.toLocaleString('en-US')} row{result.total === 1 ? '' : 's'}
                  </span>
                ) : null}
                {running ? <Loader2 size={13} className="animate-spin text-secondary" /> : null}
              </div>
              <div className="mt-0.5 text-[11px] text-secondary">
                {result
                  ? `${columns.length} column${columns.length === 1 ? '' : 's'}${result.truncated ? ` · only the first ${maxRows.toLocaleString('en-US')} — narrow the filters` : ''}${
                      result.total > PREVIEW_ROWS ? ` · preview shows ${PREVIEW_ROWS}, the export has all` : ''
                    }`
                  : columns.length
                    ? 'Loading…'
                    : 'Choose at least one column'}
              </div>
            </div>
            <div className="flex gap-2">
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
            </div>
          </div>

          {/* Filters: a bar right above the rows they narrow. */}
          {dataset.filters.length ? (
            <div className="flex flex-col gap-2 border-b px-4 py-3" style={headTint}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                {filterSlots.map((slot) =>
                  slot.kind === 'range' ? (
                    <label key={slot.from.key} className="flex min-w-0 flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">{slot.label}</span>
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
                    </label>
                  ) : (
                    <label key={slot.f.key} className="flex min-w-0 flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">{slot.f.label}</span>
                      {slot.f.type === 'select' ? (
                        <AppSelect
                          options={slot.f.options || []}
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
                  ),
                )}
              </div>
              {activeFilters ? (
                <div className="flex flex-wrap gap-1.5">
                  {dataset.filters
                    .filter((f) => filters[f.key])
                    .map((f) => (
                      <span
                        key={f.key}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                        style={{ borderColor: 'var(--nav-active-bg)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                      >
                        <span className="text-secondary">{f.label}:</span> {filterLabel(f)}
                        <button type="button" className="text-secondary hover:text-red-500" onClick={() => setFilters((p) => ({ ...p, [f.key]: '' }))} title="Remove filter">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 p-3">
            {error ? (
              <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: '#ef444455', color: '#ef4444' }}>
                {error}
              </div>
            ) : null}

            {result && result.columns.length ? (
              <div
                className={cn('min-w-0 overflow-auto rounded-xl border max-h-[70vh] custom-scrollbar transition-opacity', running && 'opacity-60')}
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
                        <td className="px-3 py-2 text-right align-top text-[10.5px] tabular-nums text-secondary">{i + 1}</td>
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
                          No rows match these filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : !columns.length ? (
              <EmptyState title="No columns" description="Pick the columns you want on the left." />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Numbered step heading for the setup panels. */
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
