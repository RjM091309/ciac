import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileSpreadsheet, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';
import { csvEscape, downloadBlob, usePagination } from './reportUtils';

type Stockholder = { name: string; nationality: string | null; subscribed: number; paid: number; ownership: number };
type Company = {
  proponent_id: number;
  ref_no: string | null;
  business_name: string;
  total: number;
  nationalities: { nationality: string; count: number }[];
  stockholders: Stockholder[];
};
type Data = {
  companies: Company[];
  companies_without: number;
  nationalities: { nationality: string; stockholders: number; companies: number }[];
};

const NOT_SPECIFIED = 'NOT SPECIFIED';
// Same series colors as the Applications report's charts.
const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#6366f1'];
const colorOf = (nationality: string, index: number) => (nationality === NOT_SPECIFIED ? '#9ca3af' : PALETTE[index % PALETTE.length]);
const label = (n: string) => (n === NOT_SPECIFIED ? 'Not specified' : n);

/** How many stockholders each locator has, and their nationalities — from
 * the Stockholders Information tab of each locator's profile. */
export function StockholdersReport() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [nationality, setNationality] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/reports/stockholders', { credentials: 'include' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) throw new Error(json?.message || 'Failed to load the report');
        if (!cancelled) setData(json.data);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A nationality filter narrows each company to just those stockholders
  // (count, chips, rows and the export), not only to the companies that have one.
  const companies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.companies || [])
      .map((c) => {
        if (!nationality) return c;
        const stockholders = c.stockholders.filter((s) => (s.nationality || NOT_SPECIFIED) === nationality);
        return { ...c, stockholders, total: stockholders.length, nationalities: c.nationalities.filter((n) => n.nationality === nationality) };
      })
      .filter((c) => {
        if (!c.total) return false;
        if (!q) return true;
        return [c.business_name, c.ref_no, ...c.stockholders.map((s) => s.name)].some((v) => String(v || '').toLowerCase().includes(q));
      });
  }, [data, search, nationality]);
  useEffect(() => setPage(1), [search, nationality]);
  const pg = usePagination(companies, pageSize, page);

  const totals = useMemo(() => {
    const all = data?.companies || [];
    return {
      companies: all.length,
      stockholders: all.reduce((n, c) => n + c.total, 0),
      nationalities: (data?.nationalities || []).filter((n) => n.nationality !== NOT_SPECIFIED).length,
      without: data?.companies_without ?? 0,
    };
  }, [data]);

  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function exportCsv() {
    if (!companies.length) return;
    const header = ['Ref No.', 'Locator', 'Stockholders in company', 'Stockholder', 'Nationality', 'Subscribed', 'Paid', 'Ownership %'];
    const lines = [header.map(csvEscape).join(',')];
    for (const c of companies) {
      for (const s of c.stockholders) {
        lines.push(
          [c.ref_no || '', c.business_name, c.total, s.name, s.nationality || 'Not specified', s.subscribed, s.paid, s.ownership].map(csvEscape).join(',')
        );
      }
    }
    // UTF-8 BOM so Excel doesn't mangle special characters on open.
    downloadBlob(`ciac-stockholders-report-${Date.now()}.csv`, `﻿${lines.join('\n')}`, 'text/csv;charset=utf-8;');
    // For the audit log — the file is built here, so the server wouldn't know.
    fetch('/api/reports/export-log', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report: 'stockholders',
        format: 'csv',
        rowCount: lines.length - 1,
        filters: { search: search.trim() || undefined, nationality: nationality || undefined },
      }),
    }).catch(() => {});
    toast.success('Report exported for Excel');
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Tile label="Companies with stockholders" value={totals.companies} loading={loading} />
        <Tile label="Stockholders" value={totals.stockholders} loading={loading} />
        <Tile label="Nationalities" value={totals.nationalities} loading={loading} />
        <Tile label="No stockholder info" value={totals.without} loading={loading} tone="#f59e0b" />
      </div>

      {/* Stockholders per nationality: one bar split by share, then a card
          each; a card filters the list below. */}
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              By nationality
            </div>
            <div className="text-[11px] text-secondary">Share of all stockholders · click a nationality to filter the list</div>
          </div>
          {nationality ? (
            <button type="button" onClick={() => setNationality('')} className="text-[11px] font-semibold underline text-secondary hover:text-[var(--text)]">
              Show all
            </button>
          ) : null}
        </div>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-3 w-full rounded-full" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
              ))}
            </div>
          </div>
        ) : !data?.nationalities.length ? (
          <div className="text-[12px] text-secondary">No stockholders recorded yet.</div>
        ) : (
          <>
            <div className="flex h-3 w-full rounded-full overflow-hidden gap-0.5 mb-4" role="img" aria-label="Share of stockholders by nationality">
              {data.nationalities.map((n, i) => (
                <div
                  key={n.nationality}
                  title={`${label(n.nationality)}: ${n.stockholders}`}
                  className="h-full transition-opacity"
                  style={{
                    width: `${(n.stockholders / Math.max(1, totals.stockholders)) * 100}%`,
                    backgroundColor: colorOf(n.nationality, i),
                    opacity: nationality && nationality !== n.nationality ? 0.25 : 1,
                  }}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {data.nationalities.map((n, i) => {
                const active = nationality === n.nationality;
                const share = Math.round((n.stockholders / Math.max(1, totals.stockholders)) * 100);
                return (
                  <button
                    key={n.nationality}
                    type="button"
                    onClick={() => setNationality((cur) => (cur === n.nationality ? '' : n.nationality))}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all min-w-0',
                      active ? 'shadow-sm' : 'hover:bg-[var(--control-bg)]/40',
                      nationality && !active && 'opacity-50'
                    )}
                    style={{ borderColor: active ? colorOf(n.nationality, i) : 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(n.nationality, i) }} />
                      <span className="text-[11px] font-bold uppercase tracking-wide truncate" style={{ color: 'var(--text)' }}>
                        {label(n.nationality)}
                      </span>
                      <span className="ml-auto text-[11px] font-semibold text-secondary tabular-nums">{share}%</span>
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-1">
                      <span className="text-xl font-bold leading-none tabular-nums" style={{ color: 'var(--text)' }}>
                        {n.stockholders}
                      </span>
                      <span className="text-[11px] text-secondary">{n.stockholders === 1 ? 'person' : 'people'}</span>
                    </div>
                    <div className="text-[10px] text-secondary mt-0.5">
                      in {n.companies} {n.companies === 1 ? 'company' : 'companies'}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="glass-card p-3 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <div className="relative group w-full sm:w-72">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search locator / ref no. / stockholder…"
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
          <div className="min-w-0 w-full sm:w-48">
            <AppSelect
              compact
              isClearable
              placeholder="All nationalities"
              value={nationality}
              onChange={(v) => setNationality(v || '')}
              options={(data?.nationalities || []).map((n) => ({ value: n.nationality, label: label(n.nationality) }))}
            />
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading || !companies.length}
            className="sm:ml-auto inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold border disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <FileSpreadsheet size={14} /> Export Excel
          </button>
        </div>

        {loading ? (
          <TableSkeleton rows={6} />
        ) : !companies.length ? (
          <EmptyState
            icon={<Users size={40} className="opacity-40" />}
            title="No stockholders"
            description={data?.companies.length ? 'Try adjusting your search or filter.' : "No locator has stockholders on its profile yet."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['', 'Ref No.', 'Locator', 'Stockholders', 'Nationalities'].map((col, i) => (
                    <th key={i} className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((c) => {
                  const expanded = open.has(c.proponent_id);
                  return (
                    <React.Fragment key={c.proponent_id}>
                      <tr
                        className="cursor-pointer hover:bg-[var(--control-bg)]/40"
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                        onClick={() => toggle(c.proponent_id)}
                      >
                        <td className="pl-3 py-2 w-6 text-secondary">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{c.ref_no || '—'}</td>
                        <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                          {c.business_name}
                        </td>
                        <td className="px-3 py-2 text-[12px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                          {c.total}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {c.nationalities.map((n) => (
                              <span
                                key={n.nationality}
                                className="rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                                style={{ borderColor: 'var(--border-subtle)', color: n.nationality === NOT_SPECIFIED ? 'var(--text-muted)' : 'var(--text)' }}
                              >
                                {label(n.nationality)} · {n.count}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td />
                          <td colSpan={4} className="px-3 pb-3">
                            <table className="w-full text-[11px] rounded-lg overflow-hidden" style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)' }}>
                              <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-secondary">
                                  <th className="px-3 py-1.5 text-left">Stockholder</th>
                                  <th className="px-3 py-1.5 text-left">Nationality</th>
                                  <th className="px-3 py-1.5 text-right">Subscribed</th>
                                  <th className="px-3 py-1.5 text-right">Paid</th>
                                  <th className="px-3 py-1.5 text-right">Ownership %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {c.stockholders.map((s, i) => (
                                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                    <td className="px-3 py-1.5" style={{ color: 'var(--text)' }}>
                                      {s.name}
                                    </td>
                                    <td className="px-3 py-1.5 text-secondary">{s.nationality || 'Not specified'}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">{s.subscribed.toLocaleString()}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">{s.paid.toLocaleString()}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">{s.ownership.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <DataTableControls
          page={page}
          totalPages={pg.totalPages}
          totalItems={companies.length}
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
          loading={loading}
        />
      </div>
    </div>
  );
}

function Tile({ label, value, tone, loading }: { label: string; value: React.ReactNode; tone?: string; loading?: boolean }) {
  return (
    <div
      className="rounded-xl px-2.5 sm:px-3 py-2.5 sm:py-3 flex flex-col justify-between gap-1 shadow-sm min-w-0"
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <span className="text-[9px] sm:text-[10px] font-semibold text-secondary uppercase tracking-wide sm:tracking-widest leading-tight">{label}</span>
      {loading ? (
        <Skeleton className="h-[22px] w-12 rounded" />
      ) : (
        <span className="text-lg font-bold leading-tight" style={{ color: tone || 'var(--text)' }}>
          {value}
        </span>
      )}
    </div>
  );
}
