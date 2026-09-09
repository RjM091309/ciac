import React, { useEffect, useMemo, useState } from 'react';
import { Search, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { DatePicker } from '../ui/DatePicker';

type AuditLogRow = {
  id: number;
  actor_id: number | null;
  actor_username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
};

function api(path: string) {
  return path;
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Login succeeded',
  LOGIN_FAILED: 'Login failed',
  LOGOUT: 'Logged out',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  USER_PASSWORD_RESET: 'Password reset',
  USER_DEACTIVATED: 'User deactivated',
  USER_REACTIVATED: 'User reactivated',
  USER_SUSPENDED: 'User suspended',
  USER_UNSUSPENDED: 'User reinstated',
  USER_SESSIONS_REVOKED: 'Sessions revoked',
  USER_TOTP_RESET: 'Authenticator reset',
  ROLE_CREATED: 'Role created',
  ROLE_UPDATED: 'Role updated',
  ROLE_DEACTIVATED: 'Role retired',
  ROLE_REACTIVATED: 'Role restored',
  PERMISSIONS_CHANGED: 'Permissions changed',
};

function actionTone(action: string): 'good' | 'bad' | 'neutral' {
  if (action === 'LOGIN_FAILED' || action.includes('DEACTIVATED') || action.includes('SUSPENDED') || action.includes('REVOKED')) {
    return 'bad';
  }
  if (action === 'LOGIN_SUCCESS' || action.includes('CREATED') || action.includes('REACTIVATED') || action.includes('RESTORED') || action.includes('UNSUSPENDED')) {
    return 'good';
  }
  return 'neutral';
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** TOR items 10-12: a compliance-facing view over dbo.audit_logs — login
 * attempts, account changes, and permission changes, filterable and paged
 * server-side. Admin-only. */
export function AuditLog() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<string[]>([]);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    fetch(api('/api/audit-logs/actions'), { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => setActions(Array.isArray(json?.data) ? json.data : []))
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actorFilter.trim()) params.set('actor', actorFilter.trim());
      if (actionFilter) params.set('action', actionFilter);
      if (fromDate) params.set('from', fromDate.toISOString());
      if (toDate) params.set('to', toDate.toISOString());
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await fetch(api(`/api/audit-logs?${params.toString()}`), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load audit log');
      setRows(json.data || []);
      setTotal(Number(json.total || 0));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, actorFilter, actionFilter, fromDate, toDate]);

  useEffect(() => {
    setPage(1);
  }, [actorFilter, actionFilter, fromDate, toDate]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / Math.max(1, pageSize))), [total, pageSize]);
  const showingRange = useMemo(() => {
    if (total === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    return { from: (safePage - 1) * pageSize + 1, to: Math.min(total, safePage * pageSize) };
  }, [total, page, pageSize, totalPages]);
  const visiblePageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, 4, 5];
    if (page >= totalPages - 2) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [page - 2, page - 1, page, page + 1, page + 2];
  }, [page, totalPages]);

  const actionOptions = useMemo(() => actions.map((a) => ({ value: a, label: ACTION_LABELS[a] || a })), [actions]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert size={16} style={{ color: 'var(--text)' }} />
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Audit Log
          </h3>
        </div>
        <p className="text-[11px] text-secondary mb-4">
          Logins, account changes, and permission changes — for monitoring and compliance review.
        </p>

        <div className="flex flex-col lg:flex-row lg:items-center gap-2 mb-4">
          <div className="relative group w-full lg:w-56">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search by username..."
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
          <div className="w-full lg:w-56">
            <AppSelect
              options={actionOptions}
              value={actionFilter}
              onChange={setActionFilter}
              placeholder="All actions"
              isClearable
              compact
            />
          </div>
          <div className="w-full lg:w-44">
            <DatePicker mode="single" fullWidth value={fromDate} onChange={setFromDate} placeholder="From date" />
          </div>
          <div className="w-full lg:w-44">
            <DatePicker mode="single" fullWidth value={toDate} onChange={setToDate} placeholder="To date" />
          </div>
        </div>

        {loading ? (
          <div className="py-2">
            <TableSkeleton columns={6} rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No matching activity" description="Try widening your filters or date range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['When', 'Actor', 'Action', 'Entity', 'IP Address', 'Details'].map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tone = actionTone(row.action);
                  const badgeStyle =
                    tone === 'bad'
                      ? { backgroundColor: 'rgba(239,68,68,.14)', color: 'rgba(239,68,68,.95)' }
                      : tone === 'good'
                        ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
                        : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' };
                  return (
                    <tr key={row.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{formatDate(row.created_at)}</td>
                      <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                        {row.actor_username || '—'}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={badgeStyle}
                        >
                          {ACTION_LABELS[row.action] || row.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-secondary">
                        {row.entity_type ? `${row.entity_type}${row.entity_id != null ? ` #${row.entity_id}` : ''}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{row.ip_address || '—'}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary max-w-[240px] truncate" title={row.details ? JSON.stringify(row.details) : ''}>
                        {row.details ? JSON.stringify(row.details) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <DataTableControls
              page={page}
              totalPages={totalPages}
              totalItems={total}
              showingFrom={showingRange.from}
              showingTo={showingRange.to}
              visiblePageNumbers={visiblePageNumbers}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100, 200]}
              onPageSizeChange={setPageSize}
              onPageChange={setPage}
              loading={loading}
            />
          </div>
        )}
      </div>
    </div>
  );
}
