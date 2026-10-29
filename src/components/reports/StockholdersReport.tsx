import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { EmptyState } from '../ui/EmptyState';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
  /** The locators counted in companies_without. */
  without: { proponent_id: number; ref_no: string | null; business_name: string }[];
  nationalities: { nationality: string; stockholders: number; companies: number }[];
};

const NOT_SPECIFIED = 'NOT SPECIFIED';
// One measure (people), so one colour; Others / Not specified in gray.
const BAR_COLOR = '#3b82f6';
const OTHERS_COLOR = '#6b7280';
const OTHERS = '__others';
const label = (n: string) => (n === NOT_SPECIFIED ? 'Not specified' : n);

/** How many stockholders each locator has, and their nationalities — from
 * the Stockholders tab of each locator's profile. */
export function StockholdersReport({ navigate }: { navigate?: (to: string, opts?: { replace?: boolean }) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [nationality, setNationality] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const isPhone = useIsPhone();
  const [withoutOpen, setWithoutOpen] = useState(false);
  const { fullAccess, sidebarPermissions } = useControlPanelAccess();
  const canOpenLocator = Boolean(navigate) && (fullAccess || Boolean(sidebarPermissions['settings:proponents']));
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

  const pct = (count: number) => {
    const v = (count / Math.max(1, totals.stockholders)) * 100;
    return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`;
  };
  // The biggest nationalities get a column each (fewer on a phone); the
  // rest share one Others column.
  const bars = useMemo(() => {
    const list = data?.nationalities || [];
    const keep = isPhone ? 6 : 12;
    const shown = list.length > keep + 1 ? list.slice(0, keep) : list;
    const rest = list.slice(shown.length);
    const out = shown.map((n) => ({
      key: n.nationality,
      name: label(n.nationality),
      short: shortLabel(label(n.nationality)),
      stockholders: n.stockholders,
      companies: n.companies,
      members: [n.nationality],
    }));
    if (rest.length) {
      out.push({
        key: OTHERS,
        name: `Others (${rest.length})`,
        short: 'Others',
        stockholders: rest.reduce((sum, n) => sum + n.stockholders, 0),
        companies: rest.reduce((sum, n) => sum + n.companies, 0),
        members: rest.map((n) => n.nationality),
      });
    }
    return out;
  }, [data, isPhone]);

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
        <Tile
          label="No stockholder info"
          value={totals.without}
          loading={loading}
          tone="#f59e0b"
          hint={totals.without ? 'View list' : undefined}
          onClick={totals.without ? () => setWithoutOpen(true) : undefined}
        />
      </div>

      {/* Stockholders per nationality: one column each for the biggest, the
          rest folded into Others; a column filters the list below. */}
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div className="min-w-0">
            <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              By nationality
            </div>
            <div className="text-[11px] text-secondary">
              {data ? `${data.nationalities.length} nationalities · ${totals.stockholders} stockholders · ` : ''}click a bar to filter the list
            </div>
          </div>
          {nationality ? (
            <button type="button" onClick={() => setNationality('')} className="shrink-0 text-[11px] font-semibold underline text-secondary hover:text-[var(--text)]">
              Show all
            </button>
          ) : null}
        </div>
        {loading ? (
          <Skeleton className="h-[260px] w-full rounded-xl" />
        ) : !data?.nationalities.length ? (
          <div className="text-[12px] text-secondary">No stockholders recorded yet.</div>
        ) : (
          <>
            <div className="h-[240px] sm:h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars} margin={{ top: 20, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
                  <XAxis
                    dataKey="short"
                    interval={0}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border-subtle)' }}
                    tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    angle={isPhone ? -40 : 0}
                    textAnchor={isPhone ? 'end' : 'middle'}
                    height={isPhone ? 56 : 28}
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                  <Tooltip cursor={{ fill: 'var(--control-bg)', opacity: 0.5 }} content={<NationalityTooltip pct={pct} />} />
                  <Bar
                    dataKey="stockholders"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={44}
                    cursor="pointer"
                    onClick={(entry: any) => {
                      const key = entry?.payload?.key ?? entry?.key;
                      if (key && key !== OTHERS) setNationality((cur) => (cur === key ? '' : key));
                    }}
                  >
                    {bars.map((b) => (
                      <Cell
                        key={b.key}
                        fill={b.key === OTHERS || b.key === NOT_SPECIFIED ? OTHERS_COLOR : BAR_COLOR}
                        fillOpacity={nationality && nationality !== b.key ? 0.3 : 1}
                      />
                    ))}
                    <LabelList dataKey="stockholders" position="top" style={{ fontSize: 10, fontWeight: 700, fill: 'var(--text)' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {bars.some((b) => b.key === OTHERS) ? (
              <div className="text-[10px] text-secondary mt-1">
                Others: {bars.find((b) => b.key === OTHERS)?.members.length} more nationalities — pick one in the nationality filter below.
              </div>
            ) : null}
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
      {withoutOpen && data ? (
        <WithoutStockholdersDialog
          rows={data.without || []}
          onClose={() => setWithoutOpen(false)}
          onOpen={canOpenLocator ? (id) => navigate?.(`/applications/proponents?proponentId=${id}`) : undefined}
        />
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  loading,
  hint,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  loading?: boolean;
  hint?: string;
  onClick?: () => void;
}) {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-xl px-2.5 sm:px-3 py-2.5 sm:py-3 flex flex-col justify-between gap-1 shadow-sm min-w-0 text-left',
        onClick && 'cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-md'
      )}
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <span className="text-[9px] sm:text-[10px] font-semibold text-secondary uppercase tracking-wide sm:tracking-widest leading-tight">{label}</span>
      {loading ? (
        <Skeleton className="h-[22px] w-12 rounded" />
      ) : (
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-bold leading-tight" style={{ color: tone || 'var(--text)' }}>
            {value}
          </span>
          {hint ? <span className="text-[10px] font-semibold underline text-secondary">{hint}</span> : null}
        </span>
      )}
    </Tag>
  );
}

/** The active locators with no stockholders on their profile. */
function WithoutStockholdersDialog({
  rows,
  onClose,
  onOpen,
}: {
  rows: Data['without'];
  onClose: () => void;
  /** Absent without access to Registered Locator. */
  onOpen?: (proponentId: number) => void;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => [r.business_name, r.ref_no].some((v) => String(v || '').toLowerCase().includes(t))) : rows;
  }, [rows, q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,.5)' }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold">No stockholder info ({rows.length})</h3>
            <p className="text-[11px] text-secondary mt-0.5">
              Active locators with nothing on their Stockholders tab{onOpen ? ' · click one to open it in Registered Locator' : ''}.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-secondary" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search locator / ref no…"
              autoFocus
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)]"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
        </div>
        <div className="px-3 pb-4 overflow-y-auto flex-1 custom-scrollbar">
          {shown.length === 0 ? (
            <div className="text-[12px] text-secondary px-2 py-6 text-center">No match.</div>
          ) : (
            shown.map((r) => {
              const body = (
                <>
                  <span className="text-[11px] text-secondary tabular-nums w-28 shrink-0 truncate">{r.ref_no || '—'}</span>
                  <span className="text-[12px] font-semibold truncate flex-1" style={{ color: 'var(--text)' }}>
                    {r.business_name}
                  </span>
                  {onOpen ? <ExternalLink size={13} className="shrink-0 text-secondary" /> : null}
                </>
              );
              return onOpen ? (
                <button
                  key={r.proponent_id}
                  type="button"
                  onClick={() => onOpen(r.proponent_id)}
                  className="w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--control-bg)]/50"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  {body}
                </button>
              ) : (
                <div key={r.proponent_id} className="flex items-center gap-3 px-2 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {body}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Axis label: long names cut so the columns stay readable. */
function shortLabel(name: string) {
  return name.length > 11 ? `${name.slice(0, 10)}…` : name;
}

function useIsPhone() {
  const query = '(max-width: 639px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setPhone(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return phone;
}

function NationalityTooltip({ active, payload, pct }: any) {
  const d = active && payload?.[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border px-3 py-2 text-[11px] shadow-lg" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}>
      <div className="font-bold mb-0.5">{d.name}</div>
      <div className="text-secondary">
        <b style={{ color: 'var(--text)' }}>{d.stockholders}</b> {d.stockholders === 1 ? 'person' : 'people'} · {pct(d.stockholders)} of all
      </div>
      <div className="text-secondary">
        in {d.companies} {d.companies === 1 ? 'company' : 'companies'}
        {d.members.length > 1 ? ' (counted per nationality)' : ''}
      </div>
    </div>
  );
}
