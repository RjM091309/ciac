import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSignature,
  FileText,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  Stamp,
  Trash2,
  Upload,
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
const ISSUANCE_TYPES = ['APPROVAL_ORDER', 'NOTICE_OF_AWARD', 'CONTRACT', 'PERMIT', 'OTHER'];

type ApprovalRow = {
  application_id: number;
  application_no: string;
  application_type: string;
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

type IssuanceRow = {
  id: number;
  doc_type: string;
  reference_no: string | null;
  title: string;
  issued_date: string | null;
  document_id: number | null;
  original_file_name: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string | null;
};

type ContractRow = {
  id: number;
  contract_no: string;
  issue_date: string | null;
  effective_start: string | null;
  effective_end: string | null;
  document_id: number | null;
} | null;

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

type DetailPayload = {
  approval: ApprovalRow;
  steps: StepRow[];
  current_step: StepRow | null;
  issuances: IssuanceRow[];
  activity: ActivityRow[];
  status_history: StatusHistoryRow[];
  contract: ContractRow;
  documents: { id: number; file_name: string; original_file_name: string | null }[];
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

export function ApprovalIssuance() {
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

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          Approval Queue
        </h3>
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
              placeholder="Search application / proponent..."
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
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Proponent</th>
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
                        {r.is_renewal ? 'Renewal' : 'New'} · {r.application_type}
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

const TABS = ['Overview', 'Approval Chain', 'Issuance', 'Contract', 'History'] as const;
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
  const [tab, setTab] = useState<Tab>('Overview');
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
              {a ? `${a.proponent_name || '—'} · ${a.is_renewal ? 'Renewal' : 'New'} ${a.application_type}` : ''}
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
              {t === 'Issuance' && data?.issuances.length ? ` (${data.issuances.length})` : ''}
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
          ) : tab === 'Issuance' ? (
            <IssuanceTab data={data} perms={perms} busy={busy} run={run} />
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
  const notStarted = a.approval_status === 'PENDING';
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

      <div className="rounded-xl border p-3 flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="w-full text-[11px] font-bold uppercase tracking-wide text-secondary mb-1">Workflow</div>
        {notStarted ? (
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit}
            onClick={() =>
              run(() => apiFetch(`/api/approvals/${a.application_id}/start`, { method: 'POST' }), 'Approval workflow started')
            }
          >
            <Send size={13} className="inline mr-1" /> Start approval routing
          </button>
        ) : (
          <div className="text-[12px] text-secondary">
            {a.approval_status === 'IN_PROGRESS'
              ? `Currently at "${data.current_step?.level_name || `Level ${a.current_level_no}`}". Act on it in the Approval Chain tab.`
              : `Approval ${APPROVAL_STATUS_LABELS[a.approval_status]?.toLowerCase()}.`}
          </div>
        )}
        {settled && perms.canEdit ? (
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
        ) : null}
      </div>

      <ChainMini steps={data.steps} currentId={data.current_step?.id ?? null} />
    </div>
  );
}

function ChainMini({ steps, currentId }: { steps: StepRow[]; currentId: number | null }) {
  if (steps.length === 0) {
    return (
      <div className="text-[12px] text-secondary rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
        No routing ladder yet — start the approval to snapshot the configured levels.
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((s) => (
        <li
          key={s.id}
          className={cn('rounded-lg border px-3 py-2 text-[12px] flex items-center justify-between gap-2', s.id === currentId && 'ring-1 ring-[var(--text)]')}
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <span>
            <span className="font-semibold">L{s.level_no}</span> · {s.level_name}
            {s.endorsed_to_office ? <span className="text-secondary"> → {s.endorsed_to_office}</span> : null}
          </span>
          <Badge label={s.decision} styles={stepDecisionBadge(s.decision)} />
        </li>
      ))}
    </ol>
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
  const [endorseOffice, setEndorseOffice] = useState('');
  const [assignTo, setAssignTo] = useState('');

  if (data.steps.length === 0) {
    return (
      <EmptyState
        icon={<Stamp size={40} className="opacity-40" />}
        title="Not routed yet"
        description="Start the approval from the Overview tab to create the routing ladder from the configured levels."
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
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">
            Act on “{current.level_name}”
          </div>

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
              <RotateCcw size={13} className="inline mr-1" /> Return to proponent
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

          <div className="border-t pt-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">
              Electronic endorsement to another office
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Field label="Endorse to office">
                <input
                  className={inputCls}
                  style={inputStyle}
                  value={endorseOffice}
                  onChange={(e) => setEndorseOffice(e.target.value)}
                  placeholder="e.g. Legal Services Division"
                />
              </Field>
              <Field label="Also reassign to (optional)">
                <AppSelect
                  compact
                  placeholder="Keep current assignee"
                  value={assignTo}
                  onChange={setAssignTo}
                  options={approvers.map((ap) => ({ value: String(ap.id), label: ap.full_name || ap.username }))}
                />
              </Field>
            </div>
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold border disabled:opacity-40 self-start"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
              disabled={busy || !endorseOffice.trim()}
              onClick={() =>
                run(
                  () =>
                    apiFetch(`/api/approvals/steps/${current.id}/endorse`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        office: endorseOffice.trim(),
                        note: remarks.trim() || null,
                        assign_to_user_id: assignTo ? Number(assignTo) : null,
                      }),
                    }),
                  'Endorsement recorded'
                ).then(() => {
                  setEndorseOffice('');
                  setAssignTo('');
                })
              }
            >
              <Send size={13} className="inline mr-1" /> Record endorsement
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IssuanceTab({
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
  const [form, setForm] = useState({ doc_type: 'APPROVAL_ORDER', title: '', reference_no: '', issued_date: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const approved = a.approval_status === 'APPROVED';

  const add = () =>
    run(async () => {
      let documentId: number | null = null;
      if (file) documentId = await uploadApplicationDocument(a.application_id, file);
      await apiFetch(`/api/approvals/${a.application_id}/issuances`, {
        method: 'POST',
        body: JSON.stringify({
          doc_type: form.doc_type,
          title: form.title.trim(),
          reference_no: form.reference_no.trim() || null,
          issued_date: form.issued_date || null,
          notes: form.notes.trim() || null,
          document_id: documentId,
        }),
      });
      setForm({ doc_type: 'APPROVAL_ORDER', title: '', reference_no: '', issued_date: '', notes: '' });
      setFile(null);
    }, 'Document issued');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-secondary">
          Generate a print-ready approval document, or upload the signed file. {approved ? '' : 'Approval is not yet complete.'}
        </div>
        <button
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border shrink-0"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
          onClick={() => printApprovalDocument(data)}
        >
          <Printer size={12} className="inline mr-1" /> Print approval order
        </button>
      </div>

      {data.issuances.length === 0 ? (
        <EmptyState
          icon={<FileSignature size={40} className="opacity-40" />}
          title="Nothing issued yet"
          description="Recorded approval orders, notices of award, permits and contracts appear here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.issuances.map((i) => (
            <div key={i.id} className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge
                    label={i.doc_type.replace(/_/g, ' ')}
                    styles={{ bg: 'rgba(14,165,233,.12)', color: '#0ea5e9', border: 'rgba(14,165,233,.30)' }}
                  />
                  {i.reference_no ? <span className="text-[10px] text-secondary">{i.reference_no}</span> : null}
                  <span className="text-[10px] text-secondary">· {fmtDate(i.issued_date || i.created_at)}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {i.document_id ? (
                    <a
                      className="text-[11px] underline text-secondary hover:text-[var(--text)]"
                      href={`/api/applications/documents/${i.document_id}/file`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {i.original_file_name || 'File'}
                    </a>
                  ) : null}
                  {perms.canDelete ? (
                    <button
                      className="text-secondary hover:text-red-500 disabled:opacity-40"
                      disabled={busy}
                      onClick={() =>
                        run(() => apiFetch(`/api/approvals/issuances/${i.id}`, { method: 'DELETE' }), 'Issuance removed')
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="text-[13px] font-medium mt-1">{i.title}</div>
              {i.notes ? <div className="text-[11px] text-secondary mt-0.5">{i.notes}</div> : null}
            </div>
          ))}
        </div>
      )}

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary flex items-center gap-1.5">
            <FileText size={12} /> Record / issue document
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <AppSelect
                compact
                isClearable={false}
                value={form.doc_type}
                onChange={(v) => setForm((f) => ({ ...f, doc_type: v }))}
                options={ISSUANCE_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
              />
            </Field>
            <Field label="Reference no.">
              <input
                className={inputCls}
                style={inputStyle}
                value={form.reference_no}
                onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Title">
            <input
              className={inputCls}
              style={inputStyle}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Approval Order for Direct Lease"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Issued date">
              <input
                type="date"
                className={inputCls}
                style={inputStyle}
                value={form.issued_date}
                onChange={(e) => setForm((f) => ({ ...f, issued_date: e.target.value }))}
              />
            </Field>
            <Field label="Signed file (optional)">
              <input
                type="file"
                className="text-[12px]"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </Field>
          </div>
          <Field label="Notes">
            <input
              className={inputCls}
              style={inputStyle}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.title.trim()}
              onClick={add}
            >
              {file ? <Upload size={13} className="inline mr-1" /> : <Plus size={13} className="inline mr-1" />} Issue
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
    contract_no: c?.contract_no || '',
    issue_date: (c?.issue_date || '').slice(0, 10),
    effective_start: (c?.effective_start || '').slice(0, 10),
    effective_end: (c?.effective_end || '').slice(0, 10),
  });
  const [file, setFile] = useState<File | null>(null);

  const save = () =>
    run(async () => {
      let documentId: number | null = c?.document_id ?? null;
      if (file) documentId = await uploadApplicationDocument(a.application_id, file);
      await apiFetch(`/api/approvals/${a.application_id}/contract`, {
        method: 'PUT',
        body: JSON.stringify({
          contract_no: form.contract_no.trim(),
          issue_date: form.issue_date || null,
          effective_start: form.effective_start || null,
          effective_end: form.effective_end || null,
          document_id: documentId,
        }),
      });
      setFile(null);
    }, 'Contract saved');

  return (
    <div className="flex flex-col gap-3">
      {c ? (
        <div className="rounded-xl border p-3 text-[12px] grid grid-cols-2 gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <InfoCell label="Contract no." value={c.contract_no} />
          <InfoCell label="Issued" value={fmtDate(c.issue_date)} />
          <InfoCell label="Effective start" value={fmtDate(c.effective_start)} />
          <InfoCell label="Effective end" value={fmtDate(c.effective_end)} />
          {c.document_id ? (
            <a
              className="text-[12px] underline text-secondary hover:text-[var(--text)] col-span-2"
              href={`/api/applications/documents/${c.document_id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              View executed contract file
            </a>
          ) : null}
        </div>
      ) : (
        <div className="text-[12px] text-secondary">No contract recorded for this application yet.</div>
      )}

      {canEdit ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary flex items-center gap-1.5">
            <FileSignature size={12} /> {c ? 'Update contract' : 'Record contract'}
          </div>
          <Field label="Contract no.">
            <input
              className={inputCls}
              style={inputStyle}
              value={form.contract_no}
              onChange={(e) => setForm((f) => ({ ...f, contract_no: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Issue date">
              <input
                type="date"
                className={inputCls}
                style={inputStyle}
                value={form.issue_date}
                onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
              />
            </Field>
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
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.contract_no.trim() || !form.issue_date}
              onClick={save}
            >
              Save contract
            </button>
          </div>
        </div>
      ) : null}
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

/** Opens a print-ready approval order in a new window from the current data. */
function printApprovalDocument(data: DetailPayload) {
  const a = data.approval;
  const chain = data.steps
    .map(
      (s) =>
        `<tr><td>Level ${s.level_no}</td><td>${escapeHtml(s.level_name)}</td><td>${escapeHtml(s.decision)}</td><td>${
          s.acted_at ? new Date(s.acted_at).toLocaleDateString('en-PH') : '—'
        }</td><td>${escapeHtml(s.acted_by_name || s.acted_by_username || '—')}</td></tr>`
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Approval Order — ${escapeHtml(
    a.application_no
  )}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#111;margin:48px;line-height:1.5}
    h1{font-size:18px;text-align:center;margin-bottom:4px}
    .sub{text-align:center;font-size:12px;color:#555;margin-bottom:28px}
    table{width:100%;border-collapse:collapse;margin:16px 0;font-size:12px}
    td,th{border:1px solid #999;padding:6px 8px;text-align:left}
    .kv{font-size:13px;margin:4px 0}
    .sign{margin-top:64px;display:flex;justify-content:space-between}
    .sign div{width:45%;border-top:1px solid #111;padding-top:6px;font-size:12px;text-align:center}
  </style></head><body>
    <h1>APPROVAL ORDER</h1>
    <div class="sub">Clark International Airport Corporation — BRIDGE System</div>
    <div class="kv"><b>Application No.:</b> ${escapeHtml(a.application_no)}</div>
    <div class="kv"><b>Proponent:</b> ${escapeHtml(a.proponent_name || '—')}</div>
    <div class="kv"><b>Type:</b> ${a.is_renewal ? 'Renewal' : 'New'} — ${escapeHtml(a.application_type)}</div>
    <div class="kv"><b>Assessed charges:</b> ${peso(a.charges_total)}</div>
    <div class="kv"><b>Approval status:</b> ${escapeHtml(APPROVAL_STATUS_LABELS[a.approval_status] || a.approval_status)}</div>
    <div class="kv"><b>Decision date:</b> ${a.decided_at ? new Date(a.decided_at).toLocaleDateString('en-PH') : '—'}</div>
    <p>This certifies that the above application has been reviewed and acted upon through the following approval hierarchy:</p>
    <table><thead><tr><th>Level</th><th>Reviewing authority</th><th>Decision</th><th>Date</th><th>Acted by</th></tr></thead><tbody>${chain}</tbody></table>
    ${a.decision_summary ? `<p><b>Basis:</b> ${escapeHtml(a.decision_summary)}</p>` : ''}
    <div class="sign"><div>Recommending Approval</div><div>Approving Authority</div></div>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    toast.error('Allow pop-ups to print the approval document');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function escapeHtml(s: string) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
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
        className="relative z-10 h-full w-full max-w-lg border-l shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="text-sm font-bold">Approval Workflow Setup</div>
            <div className="text-[11px] text-secondary">
              Ordered levels every new approval routes through. Existing approvals keep the ladder they started with.
            </div>
          </div>
          <button
            className="rounded-lg p-1 border"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
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
  );
}
