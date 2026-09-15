import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, FileSignature, FileText, Search } from 'lucide-react';
import { toast } from 'sonner';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';

const TYPE_LABEL: Record<string, string> = {
  ENVIRONMENTAL: 'Environmental',
  FIRE: 'Fire Safety',
  OCCUPANCY: 'Occupancy',
  SANITARY: 'Sanitary',
  AUTHORITY_TO_OPERATE: 'Authority to Operate',
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  VALID: { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  EXPIRING: { bg: 'rgba(245,158,11,0.14)', color: '#f59e0b' },
  EXPIRED: { bg: 'rgba(220,38,38,0.14)', color: '#fca5a5' },
  REVOKED: { bg: 'rgba(148,163,184,0.14)', color: '#94a3b8' },
};

type PermitRow = {
  id: number;
  proponent_id: number;
  proponent_name: string | null;
  application_id: number | null;
  permit_type: string;
  permit_no: string;
  issuing_authority: string | null;
  expiry_date: string | null;
  effective_status: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'REVOKED';
  has_certificate?: boolean;
  has_contract_certificate?: boolean;
};

function fmt(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(v: string | null): number | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'danger' }) {
  const color = tone === 'danger' ? '#fca5a5' : tone === 'warn' ? '#f59e0b' : 'var(--text)';
  return (
    <div className="glass-card p-3.5 !border-transparent flex-1 min-w-[140px]" style={{ backgroundColor: 'var(--surface)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

/**
 * A filtered, expiry-focused view of the SAME permit data as Permit &
 * Contract (PermitsManagement.tsx) — not a separate/mock dataset. Reuses
 * GET /api/permits (now reachable via compliance:expiry too, see
 * r_permits.js) so a role that only has this sidebar entry still sees real
 * numbers, sorted soonest-expiry-first, with the same certificate actions.
 */
export function ExpiryCalendar({ navigate }: { navigate: (to: string) => void }) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useSessionStorageCachedResource<PermitRow[]>({
    cacheKey: 'ciac.permits_bundle.v1_list_only',
    ttlMs: 3 * 60 * 1000,
    fetcher: async () => {
      const res = await fetch('/api/permits', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load permits');
      return json.data || [];
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to load'),
  });

  const permits = data ?? [];

  const upcoming = useMemo(
    () =>
      permits
        .filter((p) => p.effective_status !== 'REVOKED')
        .filter((p) => {
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return [p.permit_no, p.proponent_name, TYPE_LABEL[p.permit_type], p.issuing_authority]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(q));
        })
        .sort((a, b) => {
          const da = a.expiry_date ? new Date(a.expiry_date).getTime() : Infinity;
          const db = b.expiry_date ? new Date(b.expiry_date).getTime() : Infinity;
          return da - db;
        }),
    [permits, search],
  );

  const stats = useMemo(() => {
    let expiringThisMonth = 0;
    let next90 = 0;
    let overdue = 0;
    for (const p of permits) {
      if (p.effective_status === 'REVOKED') continue;
      const days = daysUntil(p.expiry_date);
      if (days === null) continue;
      if (days < 0) overdue += 1;
      else if (days <= 30) expiringThisMonth += 1;
      if (days >= 0 && days <= 90) next90 += 1;
    }
    return { expiringThisMonth, next90, overdue };
  }, [permits]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap gap-3">
        <StatCard label="Expiring This Month" value={stats.expiringThisMonth} tone="warn" />
        <StatCard label="Next 90 Days" value={stats.next90} />
        <StatCard label="Overdue" value={stats.overdue} tone="danger" />
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="relative group w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search expiring permits..."
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)]"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold border cursor-pointer whitespace-nowrap"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
            onClick={() => navigate('/compliance/permits')}
          >
            <CalendarClock size={13} /> Open Permit &amp; Contract
          </button>
        </div>

        {isLoading ? (
          <TableSkeleton columns={6} rows={5} />
        ) : upcoming.length === 0 ? (
          <EmptyState title="Nothing expiring" description="No upcoming or overdue permit expirations." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Locator', 'Permit Type', 'Permit No.', 'Expiry', 'Days Left', 'Status', 'Actions'].map((c) => (
                    <th key={c} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upcoming.map((p) => {
                  const s = STATUS_STYLE[p.effective_status] || STATUS_STYLE.VALID;
                  const days = daysUntil(p.expiry_date);
                  return (
                    <tr key={p.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{p.proponent_name || `#${p.proponent_id}`}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{TYPE_LABEL[p.permit_type] || p.permit_type}</td>
                      <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{p.permit_no}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{fmt(p.expiry_date)}</td>
                      <td className="px-3 py-2 text-[11px]">
                        {days === null ? (
                          '—'
                        ) : days < 0 ? (
                          <span className="inline-flex items-center gap-1 font-semibold" style={{ color: '#fca5a5' }}>
                            <AlertTriangle size={11} /> {Math.abs(days)}d overdue
                          </span>
                        ) : (
                          <span className="text-secondary">{days}d</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>
                          {p.effective_status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {p.has_certificate ? (
                            <button
                              className="rounded-md p-1.5 text-secondary cursor-pointer"
                              onClick={() => window.open(`/api/permits/${p.id}/certificate?view=1`, '_blank')}
                              title="View permit certificate"
                            >
                              <FileText size={14} />
                            </button>
                          ) : null}
                          {p.has_contract_certificate ? (
                            <button
                              className="rounded-md p-1.5 text-secondary cursor-pointer"
                              onClick={() => window.open(`/api/permits/${p.id}/contract-certificate?view=1`, '_blank')}
                              title="View contract"
                            >
                              <FileSignature size={14} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
