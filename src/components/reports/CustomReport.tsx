import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppSelect } from '../ui/AppSelect';
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
  const panel = 'rounded-xl border p-3 flex flex-col gap-2.5';
  const panelStyle = { borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' };
  const btn =
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold border disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col gap-4">
      {/* Templates */}
      <div className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center" style={panelStyle}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Save size={14} className="shrink-0 text-secondary" />
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-secondary">My templates</span>
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
            onClick={() => setSaveName(templates.find((t) => String(t.id) === templateId)?.name || '')}
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Setup */}
        <div className="flex flex-col gap-4">
          <div className={panel} style={panelStyle}>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-secondary">
              <Database size={13} /> 1 · Report on
            </div>
            <div className="grid grid-cols-2 gap-2">
              {datasets.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => pickDataset(d.key)}
                  className="rounded-lg border px-2.5 py-2 text-left transition-colors"
                  style={
                    d.key === datasetKey
                      ? { borderColor: 'var(--nav-active-bg)', backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 8%, transparent)' }
                      : { borderColor: 'var(--border-subtle)' }
                  }
                >
                  <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                    {d.label}
                  </div>
                  <div className="text-[10px] leading-snug text-secondary">{d.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className={panel} style={panelStyle}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-secondary">
                <SlidersHorizontal size={13} /> 2 · Columns <span className="font-semibold normal-case tracking-normal">({columns.length})</span>
              </span>
              <span className="flex gap-2 text-[11px]">
                <button type="button" className="font-semibold text-secondary hover:text-[var(--text)]" onClick={() => setColumns(dataset.columns.map((c) => c.key))}>
                  All
                </button>
                <button type="button" className="font-semibold text-secondary hover:text-[var(--text)]" onClick={() => setColumns(dataset.defaults)}>
                  Default
                </button>
                <button type="button" className="font-semibold text-secondary hover:text-[var(--text)]" onClick={() => setColumns([])}>
                  Clear
                </button>
              </span>
            </div>
            {/* Chosen columns, in the order they'll appear. */}
            {columns.length ? (
              <div className="flex flex-col gap-1">
                {columns.map((key, i) => (
                  <div
                    key={key}
                    className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px]"
                    style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 50%, transparent)' }}
                  >
                    <span className="w-5 text-center text-[10px] font-bold text-secondary tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text)' }}>
                      {colDef(key)?.label || key}
                    </span>
                    <button type="button" className="p-0.5 text-secondary disabled:opacity-30" disabled={i === 0} onClick={() => moveColumn(key, -1)} title="Move up">
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="p-0.5 text-secondary disabled:opacity-30"
                      disabled={i === columns.length - 1}
                      onClick={() => moveColumn(key, 1)}
                      title="Move down"
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button type="button" className="p-0.5 text-secondary hover:text-red-500" onClick={() => toggleColumn(key)} title="Remove">
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-2 text-[11px] text-secondary" style={{ borderColor: 'var(--border-subtle)' }}>
                No columns yet — add some below.
              </div>
            )}
            <div className="relative mt-1">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
              <input
                className="app-input h-8 w-full pl-8 text-[12px]"
                placeholder="Add a column…"
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
                  className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-[var(--selected-bg)]"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                >
                  + {c.label}
                </button>
              ))}
              {!available.length ? <span className="text-[11px] text-secondary">{q ? 'No match.' : 'Every column is added.'}</span> : null}
            </div>
          </div>

          <div className={panel} style={panelStyle}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-secondary">
                <Filter size={13} /> 3 · Filters {activeFilters ? <span className="font-semibold normal-case tracking-normal">({activeFilters})</span> : null}
              </span>
              {activeFilters ? (
                <button type="button" className="text-[11px] font-semibold text-secondary hover:text-[var(--text)]" onClick={() => setFilters({})}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              {dataset.filters.map((f) => (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-secondary">{f.label}</span>
                  {f.type === 'select' ? (
                    <AppSelect
                      options={f.options || []}
                      value={filters[f.key] || ''}
                      onChange={(v) => setFilters((p) => ({ ...p, [f.key]: v || '' }))}
                      placeholder="Any"
                      isClearable
                    />
                  ) : (
                    <input
                      type="date"
                      className="app-input h-9"
                      value={filters[f.key] || ''}
                      onChange={(e) => setFilters((p) => ({ ...p, [f.key]: e.target.value }))}
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border p-3" style={panelStyle}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>
                {templates.find((t) => String(t.id) === templateId)?.name || dataset.label}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-secondary">
                {running ? <Loader2 size={12} className="animate-spin" /> : null}
                {result
                  ? `${result.total.toLocaleString('en-US')} row${result.total === 1 ? '' : 's'}${result.truncated ? ` — only the first ${maxRows.toLocaleString('en-US')}; narrow the filters` : ''}${
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
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
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

          {error ? (
            <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: '#ef444455', color: '#ef4444' }}>
              {error}
            </div>
          ) : null}

          {result && result.columns.length ? (
            <div className={cn('min-w-0 overflow-auto rounded-lg border max-h-[70vh] custom-scrollbar', running && 'opacity-60')} style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-left text-[11px] border-collapse">
                <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--control-bg)' }}>
                  <tr>
                    {result.columns.map((c) => {
                      const active = sort?.key === c.key;
                      return (
                        <th
                          key={c.key}
                          className={cn(
                            'px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none border-b',
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
                            {active ? sort?.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : null}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((r, i) => (
                    <tr key={i} className="border-t hover:bg-[var(--selected-bg)]" style={{ borderColor: 'var(--border-subtle)' }}>
                      {r.map((v, j) => {
                        const c = result.columns[j];
                        return (
                          <td
                            key={j}
                            className={cn('px-2.5 py-1.5 align-top max-w-[22rem]', c.type === 'number' ? 'text-right tabular-nums whitespace-nowrap' : c.type === 'date' ? 'whitespace-nowrap' : '')}
                            style={{ color: v == null || v === '' ? 'var(--text-muted)' : 'var(--text)' }}
                          >
                            <div className={c.type === 'text' ? 'line-clamp-2' : undefined}>{cellText(v, c.type)}</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {!shownRows.length ? (
                    <tr>
                      <td colSpan={result.columns.length} className="px-3 py-8 text-center text-[12px] text-secondary">
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
  );
}
