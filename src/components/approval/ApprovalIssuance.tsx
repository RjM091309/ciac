import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Coins,
  FileSignature,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Stamp,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeleton';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';
import { requestNotificationsRefresh } from '../../lib/notificationRefresh';

const MENU_KEY = 'approval:queue';

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Awaiting Start',
  IN_PROGRESS: 'In Progress',
  APPROVED: 'Approved',
  DISAPPROVED: 'Disapproved',
  RETURNED: 'Returned',
};
const APPROVAL_STATUS_ORDER = ['PENDING', 'IN_PROGRESS', 'APPROVED', 'DISAPPROVED', 'RETURNED'];
const CHARGE_TYPES = ['RENTAL', 'PROCESSING_FEE', 'TAX', 'PENALTY', 'OTHER'];

type ApprovalRow = {
  application_id: number;
  application_no: string;
  application_type: string;
  application_type_name: string;
  is_renewal: number | boolean;
  application_status: string;
  proponent_name: string | null;
  approval_id: number | null;
  approval_status: string;
  current_level_no: number | null;
  current_level_name: string | null;
  current_assignee_name: string | null;
  current_assignee_username: string | null;
  decision: string | null;
  decision_summary: string | null;
  decided_at: string | null;
  assessment_recommendation: string | null;
  charges_total: number;
  days_in_approval: number | null;
  total_steps: number;
  approved_steps: number;
  issuance_count: number;
};

type StepRow = {
  id: number;
  approval_id: number;
  level_no: number;
  level_name: string;
  assigned_to: number | null;
  assignee_name: string | null;
  assignee_username: string | null;
  decision: string;
  action: string | null;
  endorsed_to_office: string | null;
  remarks: string | null;
  acted_by_name: string | null;
  acted_by_username: string | null;
  acted_at: string | null;
};

type ContractRow = {
  id: number;
  contract_no: string;
  issue_date: string | null;
  effective_start: string | null;
  effective_end: string | null;
  document_id: number | null;
  has_certificate?: boolean;
} | null;

type ChargeRow = {
  id: number;
  charge_type: string;
  description: string;
  rate_basis: string | null;
  quantity: number | null;
  unit_rate: number | null;
  amount: number;
  remarks: string | null;
};

type StatusHistoryRow = {
  id: number;
  from_status: string | null;
  to_status: string;
  remarks: string | null;
  changed_at: string | null;
};

type ActivityRow = {
  id: number;
  action: string;
  detail: string | null;
  actor_name: string | null;
  actor_username: string | null;
  created_at: string | null;
};

type FindingRow = {
  id: number;
  finding_type: string;
  category: string;
  severity: string | null;
  requirement_id: number | null;
  requirement_code?: string | null;
  requirement_name?: string | null;
  description: string;
  status: string;
  created_at: string | null;
};

type DetailPayload = {
  approval: ApprovalRow;
  steps: StepRow[];
  current_step: StepRow | null;
  activity: ActivityRow[];
  status_history: StatusHistoryRow[];
  contract: ContractRow;
  documents: { id: number; file_name: string; original_file_name: string | null }[];
  charges: ChargeRow[];
  findings: FindingRow[];
};

type Summary = {
  by_status: Record<string, number>;
  total: number;
  in_progress: number;
  awaiting_start: number;
  approved: number;
  issued: number;
  avg_days_to_decide: number | null;
};

type Approver = { id: number; full_name: string | null; username: string };
type Level = { id: number; level_no: number; name: string; role_hint: string | null; is_active: number | boolean };

function peso(n: number | null | undefined) {
  const v = Number(n || 0);
  return `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusBadge(status: string) {
  switch (status) {
    case 'APPROVED':
      return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
    case 'DISAPPROVED':
      return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
    case 'RETURNED':
      return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
    case 'IN_PROGRESS':
      return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
    default:
      return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
  }
}

function stepDecisionBadge(decision: string) {
  if (decision === 'APPROVED') return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
  if (decision === 'DISAPPROVED') return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  if (decision === 'RETURNED') return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
  if (decision === 'SKIPPED') return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
  return { bg: 'rgba(59,130,246,.10)', color: '#3b82f6', border: 'rgba(59,130,246,.30)' };
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json;
}

/** Uploads a file against the application and returns the new document id. */
async function uploadApplicationDocument(applicationId: number, file: File) {
  const form = new FormData();
  form.append('application_id', String(applicationId));
  form.append('file', file);
  const res = await fetch('/api/applications/documents', { method: 'POST', credentials: 'include', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to upload file');
  return Number(json.data?.id);
}

function Badge({ label, styles }: { label: string; styles: { bg: string; color: string; border: string } }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border whitespace-nowrap"
      style={{ backgroundColor: styles.bg, color: styles.color, borderColor: styles.border }}
    >
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-secondary">
      {label}
      {children}
    </label>
  );
}

const inputCls =
  'rounded-lg border px-2.5 py-1.5 text-[13px] font-normal outline-none bg-[var(--surface)] text-[var(--text)]';
const inputStyle = { borderColor: 'var(--input-border)' } as React.CSSProperties;

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

export function ApprovalIssuance({
  locationSearch = '',
  navigate,
}: {
  locationSearch?: string;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
} = {}) {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const canAdd = fullAccess || perm.can_add;
  const canEdit = fullAccess || perm.can_edit;
  const canDelete = fullAccess || perm.can_delete;

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  // One cached fetch of the whole queue + summary + approvers, then filter
  // client-side. Revisits paint instantly from sessionStorage while revalidating,
  // and typing in the search box no longer round-trips to the server.
  const { data, isLoading, isRevalidating, refresh } = useSessionStorageCachedResource<{
    rows: ApprovalRow[];
    summary: Summary | null;
    approvers: Approver[];
  }>({
    cacheKey: 'ciac.approvals_queue.v1',
    ttlMs: 5 * 60 * 1000,
    fetcher: async () => {
      const [listJson, summaryJson, apJson] = await Promise.all([
        apiFetch('/api/approvals'),
        apiFetch('/api/approvals/summary'),
        apiFetch('/api/approvals/approvers'),
      ]);
      return {
        rows: listJson.data || [],
        summary: summaryJson.data || null,
        approvers: apJson.data || [],
      };
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to load approvals'),
  });

  const allRows = data?.rows ?? [];
  const summary = data?.summary ?? null;
  const approvers = data?.approvers ?? [];
  const loading = isLoading;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (statusFilter && (r.approval_status || 'PENDING') !== statusFilter) return false;
      if (term) {
        const hay = `${r.application_no ?? ''} ${r.proponent_name ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [allRows, statusFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  // Deep-link from a notification's "View" button (?applicationId=...): jump
  // straight to that application's detail drawer, then strip the query params
  // so a refresh/back doesn't re-trigger it.
  const consumedNotificationQueryRef = useRef('');
  useEffect(() => {
    if (!navigate) return;
    const search = String(locationSearch || '').trim();
    if (!search || consumedNotificationQueryRef.current === search) return;
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const rawId = Number(params.get('applicationId') || '');
    if (!Number.isFinite(rawId) || rawId <= 0) return;
    consumedNotificationQueryRef.current = search;
    setSelectedId(rawId);
    params.delete('applicationId');
    params.delete('notificationId');
    params.delete('focus');
    const cleaned = params.toString();
    navigate(`/approval${cleaned ? `?${cleaned}` : ''}`, { replace: true });
  }, [locationSearch, navigate]);

  const pg = usePagination(rows, pageSize, page);

  const refreshAfterMutation = useCallback(async () => {
    try {
      await refresh({ showLoading: false });
      requestNotificationsRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [refresh]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mt-3">
        <StatTile label="Total" value={summary?.total ?? '—'} />
        <StatTile label="Awaiting Start" value={summary?.awaiting_start ?? '—'} tone="#94a3b8" />
        <StatTile label="In Progress" value={summary?.in_progress ?? '—'} tone="#3b82f6" />
        <StatTile label="Approved" value={summary?.approved ?? '—'} tone="#10b981" />
        <StatTile label="Issued Docs" value={summary?.issued ?? '—'} tone="#0ea5e9" />
        <StatTile label="Avg Days" value={summary?.avg_days_to_decide ?? '—'} tone="#f59e0b" />
      </div>

      <div className="flex items-center justify-end gap-2">
        {canEdit ? (
          <button
            className="rounded-lg px-3 py-2 text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            onClick={() => setSetupOpen(true)}
          >
            <Stamp size={15} />
            Workflow Setup
          </button>
        ) : null}
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <div className="relative group w-full sm:w-72">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search application / locator..."
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
          <div className="w-full sm:w-48">
            <AppSelect
              compact
              placeholder="All statuses"
              value={statusFilter}
              onChange={setStatusFilter}
              options={APPROVAL_STATUS_ORDER.map((s) => ({ value: s, label: APPROVAL_STATUS_LABELS[s] }))}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-2">
            <TableSkeleton columns={7} rows={6} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Stamp size={40} className="opacity-40" />}
            title="No applications for approval"
            description="Applications endorsed by assessment appear here to be routed through the approval hierarchy and issued their approval documents."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Application</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Locator</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Approval Status</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Current Level</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Progress</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Issued</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Days</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((r) => (
                  <tr
                    key={r.application_id}
                    className="cursor-pointer hover:bg-[var(--selected-bg)] transition-colors"
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
                    onClick={() => setSelectedId(r.application_id)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-semibold" style={{ color: 'var(--text)' }}>{r.application_no}</div>
                      <div className="text-[11px] text-secondary">
                        {r.is_renewal ? 'Renewal' : 'New'} · {r.application_type_name}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-secondary">{r.proponent_name || '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge
                        label={APPROVAL_STATUS_LABELS[r.approval_status] || r.approval_status}
                        styles={statusBadge(r.approval_status)}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-secondary">
                      {r.approval_status === 'IN_PROGRESS'
                        ? r.current_level_name || `Level ${r.current_level_no ?? '—'}`
                        : '—'}
                      {r.current_assignee_name || r.current_assignee_username ? (
                        <div className="text-[10px] text-secondary">
                          {r.current_assignee_name || r.current_assignee_username}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-secondary tabular-nums">
                      {r.total_steps ? `${r.approved_steps}/${r.total_steps}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-secondary tabular-nums">{r.issuance_count || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] tabular-nums">
                      {r.days_in_approval == null ? (
                        <span className="text-secondary">—</span>
                      ) : (
                        <span style={{ color: r.days_in_approval > 7 ? '#ef4444' : undefined }}>
                          {r.days_in_approval}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DataTableControls
          page={page}
          totalPages={pg.totalPages}
          totalItems={rows.length}
          showingFrom={pg.showingFrom}
          showingTo={pg.showingTo}
          visiblePageNumbers={pg.visiblePageNumbers}
          pageSize={pageSize}
          pageSizeOptions={[10, 20, 50, 100]}
          onPageSizeChange={setPageSize}
          onPageChange={setPage}
          loading={loading || isRevalidating}
        />
      </div>

      <AnimatePresence>
        {selectedId != null ? (
          <ApprovalDetail
            applicationId={selectedId}
            approvers={approvers}
            perms={{ canAdd, canEdit, canDelete }}
            onClose={() => setSelectedId(null)}
            onMutated={refreshAfterMutation}
          />
        ) : null}
        {setupOpen ? (
          <WorkflowSetup canEdit={canEdit} onClose={() => setSetupOpen(false)} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div
      className="rounded-xl px-3 py-3 flex flex-col gap-1 shadow-sm"
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{label}</span>
      <span className="text-base sm:text-lg font-bold leading-tight" style={{ color: tone || 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

const TABS = ['Overview', 'Approval Chain', 'Findings', 'Charges', 'Contract', 'History'] as const;
type Tab = (typeof TABS)[number];

type RunFn = (fn: () => Promise<unknown>, successMsg?: string) => Promise<void>;

function ApprovalDetail({
  applicationId,
  approvers,
  perms,
  onClose,
  onMutated,
}: {
  applicationId: number;
  approvers: Approver[];
  perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean };
  onClose: () => void;
  onMutated: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('Approval Chain');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const json = await apiFetch(`/api/approvals/${applicationId}`);
    setData(json.data);
  }, [applicationId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const run = useCallback<RunFn>(
    async (fn, successMsg) => {
      setBusy(true);
      try {
        await fn();
        await load();
        onMutated();
        if (successMsg) toast.success(successMsg);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load, onMutated]
  );

  const a = data?.approval;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <motion.div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 h-full w-full max-w-3xl border-l shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              {a ? a.application_no : 'Approval'}
            </div>
            <div className="text-[11px] text-secondary">
              {a ? `${a.proponent_name || '—'} · ${a.is_renewal ? 'Renewal' : 'New'} ${a.application_type_name}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {a ? (
              <Badge
                label={APPROVAL_STATUS_LABELS[a.approval_status] || a.approval_status}
                styles={statusBadge(a.approval_status)}
              />
            ) : null}
            <button
              className="rounded-lg p-1 border"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-4 pt-2 border-b flex gap-1 overflow-x-auto" style={{ borderColor: 'var(--border-subtle)' }}>
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors',
                tab === t
                  ? 'border-[var(--text)] text-[var(--text)]'
                  : 'border-transparent text-secondary hover:text-[var(--text)]'
              )}
            >
              {t}
              {t === 'Approval Chain' && data?.steps.length ? ` (${data.steps.length})` : ''}
              {t === 'Findings' && data?.findings.length ? ` (${data.findings.length})` : ''}
              {t === 'Charges' && data?.charges.length ? ` (${data.charges.length})` : ''}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading || !data ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-secondary" />
            </div>
          ) : tab === 'Overview' ? (
            <OverviewTab data={data} perms={perms} busy={busy} run={run} />
          ) : tab === 'Approval Chain' ? (
            <ChainTab data={data} approvers={approvers} perms={perms} busy={busy} run={run} />
          ) : tab === 'Findings' ? (
            <FindingsReadOnlyTab data={data} />
          ) : tab === 'Charges' ? (
            <ChargesTab data={data} perms={perms} busy={busy} run={run} />
          ) : tab === 'Contract' ? (
            <ContractTab data={data} canEdit={perms.canEdit} busy={busy} run={run} />
          ) : (
            <HistoryTab data={data} />
          )}
        </div>
      </motion.div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="text-[10px] uppercase tracking-wide text-secondary">{label}</div>
      <div className="font-semibold text-[13px]">{value}</div>
    </div>
  );
}

function OverviewTab({
  data,
  perms,
  busy,
  run,
}: {
  data: DetailPayload;
  perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean };
  busy: boolean;
  run: RunFn;
}) {
  const a = data.approval;
  const settled = ['APPROVED', 'DISAPPROVED', 'RETURNED'].includes(a.approval_status);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <InfoCell label="Application status" value={a.application_status} />
        <InfoCell label="Assessment" value={a.assessment_recommendation || '—'} />
        <InfoCell label="Charges assessed" value={peso(a.charges_total)} />
        <InfoCell label="Days in approval" value={a.days_in_approval == null ? '—' : String(a.days_in_approval)} />
        <InfoCell
          label="Levels cleared"
          value={a.total_steps ? `${a.approved_steps}/${a.total_steps}` : '—'}
        />
        <InfoCell label="Decision" value={a.decision || '—'} />
      </div>

      {a.assessment_recommendation && a.assessment_recommendation !== 'ENDORSE' ? (
        <div
          className="rounded-lg border px-3 py-2 text-[12px]"
          style={{ borderColor: 'rgba(245,158,11,.38)', backgroundColor: 'rgba(245,158,11,.10)', color: '#f59e0b' }}
        >
          Assessment recommended <b>{a.assessment_recommendation}</b>, not ENDORSE. Confirm before routing this for approval.
        </div>
      ) : null}

      {settled && perms.canEdit ? (
        <div className="rounded-xl border p-3 flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold border disabled:opacity-40"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
            disabled={busy}
            onClick={() =>
              run(() => apiFetch(`/api/approvals/${a.application_id}/reopen`, { method: 'PATCH' }), 'Approval reopened')
            }
          >
            <RotateCcw size={13} className="inline mr-1" /> Reopen (admin)
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChainTab({
  data,
  approvers,
  perms,
  busy,
  run,
}: {
  data: DetailPayload;
  approvers: Approver[];
  perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean };
  busy: boolean;
  run: RunFn;
}) {
  const current = data.current_step;
  const [remarks, setRemarks] = useState('');
  if (data.steps.length === 0) {
    return (
      <EmptyState
        icon={<Stamp size={40} className="opacity-40" />}
        title="Not routed yet"
        description="This application hasn't reached the approval workflow yet — the routing ladder starts automatically once Assessment endorses it."
      />
    );
  }

  const act = (action: string) => {
    if (!current) return;
    run(
      () =>
        apiFetch(`/api/approvals/steps/${current.id}/act`, {
          method: 'PATCH',
          body: JSON.stringify({ action, remarks: remarks.trim() || null }),
        }),
      `Level ${action.toLowerCase()}d`
    ).then(() => setRemarks(''));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {data.steps.map((s) => {
          const isCurrent = current?.id === s.id;
          return (
            <div
              key={s.id}
              className={cn('rounded-xl border p-3', isCurrent && 'ring-1 ring-[var(--text)]')}
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] font-semibold">
                  Level {s.level_no} · {s.level_name}
                </div>
                <Badge label={s.decision} styles={stepDecisionBadge(s.decision)} />
              </div>
              <div className="text-[11px] text-secondary mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {s.assignee_name || s.assignee_username ? <span>Assignee: {s.assignee_name || s.assignee_username}</span> : null}
                {s.endorsed_to_office ? <span>Endorsed to: {s.endorsed_to_office}</span> : null}
                {s.acted_at ? (
                  <span>
                    {s.action} by {s.acted_by_name || s.acted_by_username || '—'} · {fmtDate(s.acted_at)}
                  </span>
                ) : null}
              </div>
              {s.remarks ? <div className="text-[12px] mt-1">{s.remarks}</div> : null}
            </div>
          );
        })}
      </div>

      {current && perms.canEdit ? (
        <div className="rounded-xl border p-3 flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <Field label="Remarks / basis">
            <textarea
              className={cn(inputCls, 'min-h-[64px] resize-y')}
              style={inputStyle}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="State the basis for this decision…"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'rgba(16,185,129,.16)', color: '#10b981', border: '1px solid rgba(16,185,129,.38)' }}
              disabled={busy}
              onClick={() => act('APPROVE')}
            >
              <CheckCircle2 size={13} className="inline mr-1" /> Approve level
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'rgba(245,158,11,.16)', color: '#f59e0b', border: '1px solid rgba(245,158,11,.38)' }}
              disabled={busy}
              onClick={() => act('RETURN')}
            >
              <RotateCcw size={13} className="inline mr-1" /> Return to locator
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'rgba(239,68,68,.16)', color: '#ef4444', border: '1px solid rgba(239,68,68,.38)' }}
              disabled={busy}
              onClick={() => act('DISAPPROVE')}
            >
              <X size={13} className="inline mr-1" /> Disapprove
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The Assessment Officer's feedback on the Locator's documentary
 * compliance (recorded in Assessment's own Findings tab) — read-only here so
 * the Account Officer has that context before deciding. Assessment's
 * Compliance tab itself (verify/reject + the reply thread) stays scoped to
 * just the Locator and Assessment; this is the one piece meant to carry
 * forward into the approval decision. */
function FindingsReadOnlyTab({ data }: { data: DetailPayload }) {
  if (data.findings.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle size={40} className="opacity-40" />}
        title="No findings recorded"
        description="Assessment didn't flag anything on this application's documentary compliance."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {data.findings.map((f) => (
        <div key={f.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-[12px]">
            {f.requirement_name ? (
              <span className="font-semibold" style={{ color: 'var(--text)' }}>{f.requirement_name}: </span>
            ) : null}
            {f.description}
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap mt-2.5 pt-2.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <Badge
                label={f.finding_type}
                styles={{ bg: 'rgba(99,102,241,.14)', color: '#6366f1', border: 'rgba(99,102,241,.38)' }}
              />
              <Badge label={f.category} styles={{ bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.38)' }} />
              {f.severity ? (
                <Badge
                  label={f.severity}
                  styles={
                    f.severity === 'HIGH'
                      ? { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' }
                      : f.severity === 'MEDIUM'
                        ? { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' }
                        : { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' }
                  }
                />
              ) : null}
              <Badge
                label={f.status}
                styles={
                  f.status === 'RESOLVED'
                    ? { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' }
                    : f.status === 'WAIVED'
                      ? { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' }
                      : { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' }
                }
              />
            </div>
            <span className="text-[10px] text-secondary shrink-0 whitespace-nowrap">{fmtDateTime(f.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChargesTab({
  data,
  perms,
  busy,
  run,
}: {
  data: DetailPayload;
  perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean };
  busy: boolean;
  run: RunFn;
}) {
  const appId = data.approval.application_id;
  const [form, setForm] = useState({
    charge_type: 'RENTAL',
    description: '',
    quantity: '',
    unit_rate: '',
    amount: '',
    rate_basis: '',
    remarks: '',
  });

  const preview = useMemo(() => {
    if (form.amount) return Number(form.amount) || 0;
    const q = Number(form.quantity);
    const r = Number(form.unit_rate);
    if (Number.isFinite(q) && Number.isFinite(r) && form.quantity && form.unit_rate) return Math.round(q * r * 100) / 100;
    return 0;
  }, [form]);

  const add = () =>
    run(async () => {
      await apiFetch(`/api/approvals/${appId}/charges`, {
        method: 'POST',
        body: JSON.stringify({
          charge_type: form.charge_type,
          description: form.description.trim(),
          quantity: form.quantity ? Number(form.quantity) : null,
          unit_rate: form.unit_rate ? Number(form.unit_rate) : null,
          amount: form.amount ? Number(form.amount) : undefined,
          rate_basis: form.rate_basis.trim() || null,
          remarks: form.remarks.trim() || null,
        }),
      });
      setForm({ charge_type: 'RENTAL', description: '', quantity: '', unit_rate: '', amount: '', rate_basis: '', remarks: '' });
    }, 'Charge added');

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-secondary">
        Assessed here by the Account Officer (Level 1 review).
      </div>
      <div className="rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-secondary">
              <th className="px-2.5 py-2">Type</th>
              <th className="px-2.5 py-2">Description</th>
              <th className="px-2.5 py-2 text-right">Qty</th>
              <th className="px-2.5 py-2 text-right">Rate</th>
              <th className="px-2.5 py-2 text-right">Amount</th>
              {perms.canDelete ? <th className="px-2.5 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {data.charges.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2.5 py-4 text-center text-secondary">
                  No charges assessed yet.
                </td>
              </tr>
            ) : (
              data.charges.map((c) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-2.5 py-2">{c.charge_type.replace('_', ' ')}</td>
                  <td className="px-2.5 py-2">
                    {c.description}
                    {c.rate_basis ? <div className="text-[10px] text-secondary">{c.rate_basis}</div> : null}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{c.quantity ?? '—'}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{c.unit_rate ?? '—'}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{peso(c.amount)}</td>
                  {perms.canDelete ? (
                    <td className="px-2.5 py-2 text-right">
                      <button
                        className="text-secondary hover:text-red-500 disabled:opacity-40"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => apiFetch(`/api/approvals/charges/${c.id}`, { method: 'DELETE' }),
                            'Charge removed'
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td colSpan={4} className="px-2.5 py-2 text-right text-[11px] uppercase tracking-wide text-secondary">
                Total assessed
              </td>
              <td className="px-2.5 py-2 text-right font-bold tabular-nums">{peso(data.approval.charges_total)}</td>
              {perms.canDelete ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary flex items-center gap-1.5">
            <Coins size={12} /> Add charge
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <AppSelect
                compact
                isClearable={false}
                value={form.charge_type}
                onChange={(v) => setForm((f) => ({ ...f, charge_type: v }))}
                options={CHARGE_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))}
              />
            </Field>
            <Field label="Basis (note)">
              <input
                className={inputCls}
                style={inputStyle}
                value={form.rate_basis}
                onChange={(e) => setForm((f) => ({ ...f, rate_basis: e.target.value }))}
                placeholder="e.g. 5000 sqm @ 120/sqm/mo"
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              className={inputCls}
              style={inputStyle}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Quantity">
              <input
                className={inputCls}
                style={inputStyle}
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </Field>
            <Field label="Unit rate">
              <input
                className={inputCls}
                style={inputStyle}
                inputMode="decimal"
                value={form.unit_rate}
                onChange={(e) => setForm((f) => ({ ...f, unit_rate: e.target.value }))}
              />
            </Field>
            <Field label="Amount (override)">
              <input
                className={inputCls}
                style={inputStyle}
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder={preview ? String(preview) : ''}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-secondary">
              Line amount: <span className="font-semibold text-[var(--text)]">{peso(preview)}</span>
            </div>
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.description.trim() || preview <= 0}
              onClick={add}
            >
              <Plus size={13} className="inline mr-1" /> Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ContractTab({
  data,
  canEdit,
  busy,
  run,
}: {
  data: DetailPayload;
  canEdit: boolean;
  busy: boolean;
  run: RunFn;
}) {
  const a = data.approval;
  const c = data.contract;
  const [form, setForm] = useState({
    effective_start: (c?.effective_start || '').slice(0, 10),
    effective_end: (c?.effective_end || '').slice(0, 10),
  });
  const [file, setFile] = useState<File | null>(null);
  const [previewNo, setPreviewNo] = useState<string | null>(null);

  useEffect(() => {
    if (c) return;
    let cancelled = false;
    apiFetch(`/api/approvals/${a.application_id}/contract/next-number`)
      .then((json) => {
        if (!cancelled) setPreviewNo(json?.data?.contract_no || null);
      })
      .catch(() => {
        if (!cancelled) setPreviewNo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [c, a.application_id]);

  const save = () =>
    run(async () => {
      let documentId: number | null = c?.document_id ?? null;
      if (file) documentId = await uploadApplicationDocument(a.application_id, file);
      await apiFetch(`/api/approvals/${a.application_id}/contract`, {
        method: 'PUT',
        body: JSON.stringify({
          effective_start: form.effective_start || null,
          effective_end: form.effective_end || null,
          document_id: documentId,
        }),
      });
      setFile(null);
    }, 'Contract saved');

  return (
    <div className="flex flex-col gap-3">
      {c && (c.document_id || c.has_certificate) ? (
        <div className="rounded-xl border p-3 flex flex-col gap-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
          {c.document_id ? (
            <a
              className="text-[12px] underline text-secondary hover:text-[var(--text)]"
              href={`/api/applications/documents/${c.document_id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              View executed contract file
            </a>
          ) : null}
          {c.has_certificate ? (
            <button
              type="button"
              className="text-[12px] underline text-secondary hover:text-[var(--text)] text-left cursor-pointer"
              onClick={() => window.open(`/api/approvals/contracts/${c.id}/certificate?view=1`, '_blank')}
            >
              View Contract
            </button>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary flex items-center gap-1.5">
            <FileSignature size={12} /> {c ? 'Update contract' : 'Record contract'}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Application type">
              <input
                className={inputCls}
                style={{ ...inputStyle, opacity: 0.65, cursor: 'not-allowed' }}
                value={`${a.is_renewal ? 'Renewal' : 'New'} · ${a.application_type_name}`}
                disabled
                readOnly
              />
            </Field>
            <Field label="Contract no.">
              <input
                className={inputCls}
                style={{ ...inputStyle, opacity: 0.65, cursor: 'not-allowed' }}
                value={c?.contract_no || previewNo || 'Computing next number…'}
                disabled
                readOnly
              />
            </Field>
          </div>
          {!c ? (
            <div className="text-[10px] text-secondary -mt-1">
              Preview only — the final number is assigned when you save.
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Effective start">
              <input
                type="date"
                className={inputCls}
                style={inputStyle}
                value={form.effective_start}
                onChange={(e) => setForm((f) => ({ ...f, effective_start: e.target.value }))}
              />
            </Field>
            <Field label="Effective end">
              <input
                type="date"
                className={inputCls}
                style={inputStyle}
                value={form.effective_end}
                onChange={(e) => setForm((f) => ({ ...f, effective_end: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Executed contract file (optional)">
            <input type="file" className="text-[12px]" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          {c?.document_id ? (
            <a
              className="text-[11px] underline text-secondary hover:text-[var(--text)]"
              href={`/api/applications/documents/${c.document_id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              View current executed contract file
            </a>
          ) : null}
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy}
              onClick={save}
            >
              Save contract
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-secondary">
          {c ? `Contract on file: ${c.contract_no}` : 'No contract recorded for this application yet.'}
        </div>
      )}
    </div>
  );
}

function HistoryTab({ data }: { data: DetailPayload }) {
  const merged = [
    ...data.activity.map((x) => ({
      key: `a-${x.id}`,
      when: x.created_at,
      title: x.action.replace(/_/g, ' '),
      detail: x.detail,
      who: x.actor_name || x.actor_username || 'System',
    })),
    ...data.status_history.map((x) => ({
      key: `s-${x.id}`,
      when: x.changed_at,
      title: `Application ${x.from_status ? `${x.from_status} → ` : ''}${x.to_status}`,
      detail: x.remarks,
      who: 'Application status',
    })),
  ].sort((a, b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime());

  if (merged.length === 0) {
    return (
      <EmptyState
        icon={<Clock3 size={40} className="opacity-40" />}
        title="No history"
        description="Approval actions and application status changes are logged here."
      />
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {merged.map((m) => (
        <li key={m.key} className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex justify-between">
            <span className="font-semibold">{m.title}</span>
            <span className="text-secondary">{fmtDate(m.when)}</span>
          </div>
          {m.detail ? <div className="text-secondary mt-0.5">{m.detail}</div> : null}
          <div className="text-[10px] text-secondary mt-0.5">{m.who}</div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------ Workflow Setup ----------------------------- */

function WorkflowSetup({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', role_hint: '' });

  const load = useCallback(async () => {
    const json = await apiFetch('/api/approvals/levels?includeInactive=1');
    setLevels(json.data || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, msg?: string) => {
      setBusy(true);
      try {
        await fn();
        await load();
        if (msg) toast.success(msg);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  return (
    <div className="fixed inset-0 z-[60]">
      <motion.div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex w-full justify-end p-0 sm:p-0">
        <motion.div
          className="h-full w-full max-w-[44rem] border-l p-4 sm:p-5 flex flex-col shadow-2xl"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-start justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--input-border)' }}>
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                Approval Workflow Setup
              </div>
              <div className="text-xs text-secondary mt-0.5">
                Ordered levels every new approval routes through. Existing approvals keep the ladder they started with.
              </div>
            </div>
            <button
              className="rounded-lg px-2 py-1 text-xs border cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
              onClick={onClose}
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-secondary" />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {levels.map((lvl, idx) => (
                  <div
                    key={lvl.id}
                    className="rounded-xl border p-2.5 flex items-center justify-between gap-2"
                    style={{ borderColor: 'var(--border-subtle)', opacity: lvl.is_active ? 1 : 0.5 }}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate">
                        L{lvl.level_no} · {lvl.name}
                      </div>
                      {lvl.role_hint ? <div className="text-[11px] text-secondary truncate">{lvl.role_hint}</div> : null}
                    </div>
                    {canEdit ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          className="rounded px-2 py-1 text-[11px] border disabled:opacity-40"
                          style={{ borderColor: 'var(--border-subtle)' }}
                          disabled={busy || idx === 0}
                          onClick={() =>
                            run(async () => {
                              const prev = levels[idx - 1];
                              await apiFetch(`/api/approvals/levels/${lvl.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({ level_no: prev.level_no }),
                              });
                              await apiFetch(`/api/approvals/levels/${prev.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({ level_no: lvl.level_no }),
                              });
                            }, 'Reordered')
                          }
                        >
                          ↑
                        </button>
                        <button
                          className="rounded px-2 py-1 text-[11px] border disabled:opacity-40"
                          style={{ borderColor: 'var(--border-subtle)' }}
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                apiFetch(`/api/approvals/levels/${lvl.id}`, {
                                  method: 'PUT',
                                  body: JSON.stringify({ is_active: !lvl.is_active }),
                                }),
                              lvl.is_active ? 'Level disabled' : 'Level enabled'
                            )
                          }
                        >
                          {lvl.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="text-secondary hover:text-red-500 disabled:opacity-40"
                          disabled={busy}
                          onClick={() =>
                            run(() => apiFetch(`/api/approvals/levels/${lvl.id}`, { method: 'DELETE' }), 'Level removed')
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {canEdit ? (
                <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Add level</div>
                  <Field label="Name">
                    <input
                      className={inputCls}
                      style={inputStyle}
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Legal Review"
                    />
                  </Field>
                  <Field label="Role hint (optional)">
                    <input
                      className={inputCls}
                      style={inputStyle}
                      value={form.role_hint}
                      onChange={(e) => setForm((f) => ({ ...f, role_hint: e.target.value }))}
                    />
                  </Field>
                  <div className="flex justify-end">
                    <button
                      className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                      style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                      disabled={busy || !form.name.trim()}
                      onClick={() =>
                        run(
                          () =>
                            apiFetch('/api/approvals/levels', {
                              method: 'POST',
                              body: JSON.stringify({ name: form.name.trim(), role_hint: form.role_hint.trim() || null }),
                            }),
                          'Level added'
                        ).then(() => setForm({ name: '', role_hint: '' }))
                      }
                    >
                      <Plus size={13} className="inline mr-1" /> Add
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
