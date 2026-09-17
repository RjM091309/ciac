import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { EmptyState } from '../ui/EmptyState';
import { ConfirmModal } from '../ui/ConfirmModal';
import { TableSkeleton } from '../ui/Skeleton';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';
import { requestNotificationsRefresh } from '../../lib/notificationRefresh';

const MENU_KEY = 'assessment:queue';

const STAGE_LABELS: Record<string, string> = {
  UNASSIGNED: 'Unassigned',
  ASSIGNED: 'Assigned',
  IN_REVIEW: 'In Review',
  FOR_RECOMMENDATION: 'For Recommendation',
  COMPLETED: 'Completed',
  RETURNED: 'Returned',
};
const STAGE_ORDER = ['UNASSIGNED', 'ASSIGNED', 'IN_REVIEW', 'FOR_RECOMMENDATION', 'COMPLETED', 'RETURNED'];
const FINDING_TYPES = ['FINDING', 'COMMENT', 'REMARK', 'DEFICIENCY', 'RECOMMENDATION'];
const FINDING_CATEGORIES = ['DOCUMENTARY', 'REGULATORY', 'FINANCIAL', 'TECHNICAL', 'OTHER'];
const FINDING_STATUSES = ['OPEN', 'RESOLVED', 'WAIVED'];

type AssessmentRow = {
  application_id: number;
  application_no: string;
  application_type: string;
  application_type_name: string;
  is_renewal: number | boolean;
  application_status: string;
  proponent_name: string | null;
  assessment_id: number | null;
  stage: string;
  assigned_evaluator_id: number | null;
  evaluator_name: string | null;
  evaluator_username: string | null;
  assigned_at: string | null;
  recommendation: string | null;
  recommended_at: string | null;
  days_in_assessment: number | null;
  total_findings: number;
  open_findings: number;
  requirements_total: number;
  requirements_verified: number;
};

type FindingRow = {
  id: number;
  finding_type: string;
  category: string;
  severity: string | null;
  requirement_id: number | null;
  requirement_code: string | null;
  requirement_name: string | null;
  description: string;
  status: string;
  created_at: string | null;
};

type RequirementRow = {
  id: number;
  requirement_id: number;
  requirement_code: string | null;
  requirement_name: string | null;
  status: string;
  remarks: string | null;
  is_mandatory?: number | boolean;
  acknowledged_at?: string | null;
};

type RequirementComment = {
  id: number;
  application_requirement_id: number;
  author_id: number;
  author_role: string | null;
  message: string;
  created_at: string;
  author_name?: string | null;
  author_username?: string | null;
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
  assessment: AssessmentRow;
  findings: FindingRow[];
  activity: ActivityRow[];
  requirements: RequirementRow[];
  documents: {
    id: number;
    file_name: string;
    original_file_name: string | null;
    requirement_id: number | null;
    requirement_code: string | null;
    /** Upload order within this requirement — 1 for the first submission,
     * 2+ for a reupload after a rejection. */
    version?: number | string | null;
  }[];
};

type Summary = {
  by_stage: Record<string, number>;
  total: number;
  active: number;
  overdue: number;
  avg_days_to_complete: number | null;
};

type Evaluator = { id: number; full_name: string | null; username: string };

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

function stageBadge(stage: string) {
  switch (stage) {
    case 'COMPLETED':
      return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
    case 'RETURNED':
      return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
    case 'IN_REVIEW':
    case 'FOR_RECOMMENDATION':
      return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
    case 'ASSIGNED':
      return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
    default:
      return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
  }
}

function findingBadge(type: string) {
  if (type === 'DEFICIENCY') return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  if (type === 'RECOMMENDATION') return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
  return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
}

function severityBadge(severity: string | null) {
  if (severity === 'HIGH') return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  if (severity === 'MEDIUM') return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
  return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
}

function findingStatusBadge(status: string) {
  return status === 'RESOLVED'
    ? { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' }
    : status === 'WAIVED'
      ? { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' }
      : { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json;
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

export function AssessmentEvaluation({
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

  const [stageFilter, setStageFilter] = useState('');
  const [evaluatorFilter, setEvaluatorFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);

  // One cached fetch of the whole queue + summary + evaluators, then filter
  // client-side. Revisits paint instantly from sessionStorage while revalidating,
  // and typing in the search box no longer round-trips to the server.
  const { data, isLoading, isRevalidating, refresh } = useSessionStorageCachedResource<{
    rows: AssessmentRow[];
    summary: Summary | null;
    evaluators: Evaluator[];
  }>({
    cacheKey: 'ciac.assessments_queue.v1',
    ttlMs: 5 * 60 * 1000,
    fetcher: async () => {
      const [listJson, summaryJson, evJson] = await Promise.all([
        apiFetch('/api/assessments'),
        apiFetch('/api/assessments/summary'),
        apiFetch('/api/assessments/evaluators'),
      ]);
      return {
        rows: listJson.data || [],
        summary: summaryJson.data || null,
        evaluators: evJson.data || [],
      };
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to load assessments'),
  });

  const allRows = data?.rows ?? [];
  const summary = data?.summary ?? null;
  const evaluators = data?.evaluators ?? [];
  const loading = isLoading;

  const evaluatorOptions = useMemo(
    () => evaluators.map((e) => ({ value: String(e.id), label: e.full_name || e.username })),
    [evaluators]
  );

  // Completed applications move to their own "Completed" popup instead of
  // cluttering the working queue — the queue is for what's still in motion.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if ((r.stage || 'UNASSIGNED') === 'COMPLETED') return false;
      if (stageFilter && (r.stage || 'UNASSIGNED') !== stageFilter) return false;
      if (evaluatorFilter && String(r.assigned_evaluator_id ?? '') !== evaluatorFilter) return false;
      if (term) {
        const hay = `${r.application_no ?? ''} ${r.proponent_name ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [allRows, stageFilter, evaluatorFilter, search]);

  const completedRows = useMemo(
    () =>
      allRows
        .filter((r) => (r.stage || 'UNASSIGNED') === 'COMPLETED')
        .sort((a, b) => new Date(b.recommended_at || 0).getTime() - new Date(a.recommended_at || 0).getTime()),
    [allRows]
  );

  useEffect(() => {
    setPage(1);
  }, [stageFilter, evaluatorFilter, search]);

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
    navigate(`/assessment${cleaned ? `?${cleaned}` : ''}`, { replace: true });
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
      {/* Monitoring stat bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mt-3">
        <StatTile label="Total" value={summary?.total ?? '—'} />
        <StatTile label="Unassigned" value={summary?.by_stage?.UNASSIGNED ?? '—'} tone="#94a3b8" />
        <StatTile label="Active" value={summary?.active ?? '—'} tone="#3b82f6" />
        <StatTile label="Overdue" value={summary?.overdue ?? '—'} tone="#ef4444" />
        <StatTile
          label="Completed"
          value={summary?.by_stage?.COMPLETED ?? '—'}
          tone="#10b981"
          onClick={() => setCompletedOpen(true)}
        />
        <StatTile label="Returned" value={summary?.by_stage?.RETURNED ?? '—'} tone="#f59e0b" />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded-lg px-3 py-2 text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
          style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
          onClick={() => setCompletedOpen(true)}
        >
          <CheckCircle2 size={15} />
          Completed ({summary?.by_stage?.COMPLETED ?? 0})
        </button>
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
              placeholder="All stages"
              value={stageFilter}
              onChange={setStageFilter}
              options={STAGE_ORDER.filter((s) => s !== 'COMPLETED').map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
            />
          </div>
          <div className="w-full sm:w-48">
            <AppSelect
              compact
              placeholder="All evaluators"
              value={evaluatorFilter}
              onChange={setEvaluatorFilter}
              options={evaluatorOptions}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-2">
            <TableSkeleton columns={7} rows={6} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck size={40} className="opacity-40" />}
            title="No applications to assess"
            description="Submitted applications appear here for review, compliance evaluation, and charge assessment."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Application</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Locator</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Stage</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Evaluator</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Compliance</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Findings</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Working Days</th>
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
                      <Badge label={STAGE_LABELS[r.stage] || r.stage} styles={stageBadge(r.stage)} />
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-secondary">{r.evaluator_name || r.evaluator_username || '—'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-secondary">
                      {r.requirements_verified}/{r.requirements_total} verified
                    </td>
                    <td className="px-3 py-2.5 text-[11px]">
                      {r.open_findings > 0 ? (
                        <span style={{ color: '#ef4444' }}>{r.open_findings} open</span>
                      ) : (
                        <span className="text-secondary">{r.total_findings || 0}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[11px] tabular-nums">
                      {r.days_in_assessment == null ? (
                        <span className="text-secondary">—</span>
                      ) : (
                        <span style={{ color: r.days_in_assessment > 5 ? '#ef4444' : undefined }}>
                          {r.days_in_assessment}
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
          <AssessmentDetail
            applicationId={selectedId}
            evaluators={evaluators}
            perms={{ canAdd, canEdit, canDelete }}
            onClose={() => setSelectedId(null)}
            onMutated={refreshAfterMutation}
          />
        ) : null}
        {completedOpen ? (
          <CompletedQueueModal
            rows={completedRows}
            onClose={() => setCompletedOpen(false)}
            onSelect={(id) => {
              setCompletedOpen(false);
              setSelectedId(id);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function CompletedQueueModal({
  rows,
  onClose,
  onSelect,
}: {
  rows: AssessmentRow[];
  onClose: () => void;
  onSelect: (applicationId: number) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      `${r.application_no ?? ''} ${r.proponent_name ?? ''}`.toLowerCase().includes(term)
    );
  }, [rows, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        className="relative z-10 w-full max-w-2xl max-h-[80vh] rounded-2xl border shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.2 }}
      >
        <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
              <CheckCircle2 size={15} style={{ color: '#10b981' }} />
              Completed Assessments
            </div>
            <div className="text-[11px] text-secondary">
              Endorsed, returned, or disapproved applications that have finished this stage.
            </div>
          </div>
          <button
            className="rounded-lg p-1 border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pt-3">
          <div className="relative group">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
            />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search application / locator..."
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={40} className="opacity-40" />}
              title="No completed assessments"
              description={rows.length === 0 ? 'Nothing has been endorsed yet.' : 'No match for that search.'}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((r) => (
                <button
                  key={r.application_id}
                  className="w-full text-left rounded-xl border p-2.5 hover:bg-[var(--selected-bg)] transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                  onClick={() => onSelect(r.application_id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[13px] truncate" style={{ color: 'var(--text)' }}>
                        {r.application_no}
                      </div>
                      <div className="text-[11px] text-secondary truncate">
                        {r.proponent_name || '—'} · {r.is_renewal ? 'Renewal' : 'New'} {r.application_type_name}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge
                        label={r.recommendation || 'ENDORSE'}
                        styles={
                          r.recommendation === 'DISAPPROVE'
                            ? { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' }
                            : { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' }
                        }
                      />
                      <div className="text-[10px] text-secondary mt-1">{fmtDate(r.recommended_at)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={cn(
        'rounded-xl px-3 py-3 flex flex-col gap-1 shadow-sm text-left',
        onClick && 'cursor-pointer hover:ring-1 hover:ring-[var(--text)] transition-shadow'
      )}
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
      onClick={onClick}
    >
      <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{label}</span>
      <span className="text-base sm:text-lg font-bold leading-tight" style={{ color: tone || 'var(--text)' }}>
        {value}
      </span>
    </Tag>
  );
}

const TABS = ['Overview', 'Compliance', 'Findings', 'Recommendation', 'Activity Log'] as const;
type Tab = (typeof TABS)[number];

function AssessmentDetail({
  applicationId,
  evaluators,
  perms,
  onClose,
  onMutated,
}: {
  applicationId: number;
  evaluators: Evaluator[];
  perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean };
  onClose: () => void;
  onMutated: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('Overview');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const json = await apiFetch(`/api/assessments/${applicationId}`);
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

  const run = useCallback(
    async (fn: () => Promise<unknown>, successMsg?: string) => {
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

  const a = data?.assessment;

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
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              {a ? a.application_no : 'Assessment'}
            </div>
            <div className="text-[11px] text-secondary">
              {a ? `${a.proponent_name || '—'} · ${a.is_renewal ? 'Renewal' : 'New'} ${a.application_type_name}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {a ? <Badge label={STAGE_LABELS[a.stage] || a.stage} styles={stageBadge(a.stage)} /> : null}
            <button
              className="rounded-lg p-1 border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-4 pt-2 border-b flex gap-1 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
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
              {t === 'Findings' && data?.findings.length ? ` (${data.findings.length})` : ''}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading || !data ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-secondary" />
            </div>
          ) : tab === 'Overview' ? (
            <OverviewTab data={data} evaluators={evaluators} perms={perms} busy={busy} run={run} />
          ) : tab === 'Compliance' ? (
            <ComplianceTab data={data} canEdit={perms.canEdit} busy={busy} run={run} />
          ) : tab === 'Findings' ? (
            <FindingsTab data={data} perms={perms} busy={busy} run={run} />
          ) : tab === 'Recommendation' ? (
            <RecommendationTab data={data} canEdit={perms.canEdit} busy={busy} run={run} />
          ) : (
            <ActivityTab data={data} />
          )}
        </div>
      </motion.div>
    </div>
  );
}

type RunFn = (fn: () => Promise<unknown>, successMsg?: string) => Promise<void>;

function OverviewTab({
  data,
  evaluators,
  perms,
  busy,
  run,
}: {
  data: DetailPayload;
  evaluators: Evaluator[];
  perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean };
  busy: boolean;
  run: RunFn;
}) {
  const a = data.assessment;
  const [evaluatorId, setEvaluatorId] = useState(a.assigned_evaluator_id ? String(a.assigned_evaluator_id) : '');
  const isAdminReopen = perms.canEdit; // reopen also server-guarded to admin
  // Once COMPLETED/RETURNED, Reopen is the one deliberate way back in — the
  // evaluator assignment and raw stage buttons must not offer a side door
  // around it (same gate as the Recommendation and Findings tabs).
  const isClosed = a.stage === 'COMPLETED' || a.stage === 'RETURNED';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <InfoCell label="Application status" value={a.application_status} />
        <InfoCell label="Stage" value={STAGE_LABELS[a.stage] || a.stage} />
        <InfoCell label="Assigned" value={fmtDate(a.assigned_at)} />
        <InfoCell
          label="Working days"
          value={a.days_in_assessment == null ? '—' : String(a.days_in_assessment)}
        />
        <InfoCell
          label="Documents verified"
          value={`${a.requirements_verified}/${a.requirements_total}`}
        />
        <InfoCell label="Recommendation" value={a.recommendation || '—'} />
      </div>

      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wide text-secondary mb-2">Assign evaluator</div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <AppSelect
              compact
              placeholder="Select evaluator…"
              value={evaluatorId}
              onChange={setEvaluatorId}
              isDisabled={isClosed}
              options={evaluators.map((e) => ({ value: String(e.id), label: e.full_name || e.username }))}
            />
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit || !evaluatorId || isClosed}
            onClick={() =>
              run(
                () =>
                  apiFetch(`/api/assessments/${a.application_id}/assign`, {
                    method: 'PATCH',
                    body: JSON.stringify({ evaluator_id: Number(evaluatorId) }),
                  }),
                'Evaluator assigned'
              )
            }
          >
            <UserCheck size={13} className="inline mr-1" /> Assign
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-3 flex flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
        <div className="w-full text-[11px] font-bold uppercase tracking-wide text-secondary mb-1">Move stage</div>
        {['ASSIGNED', 'IN_REVIEW', 'FOR_RECOMMENDATION'].map((s) => (
          <button
            key={s}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[12px] font-semibold border disabled:opacity-40',
              a.stage === s && 'ring-1 ring-[var(--text)]'
            )}
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            disabled={busy || !perms.canEdit || a.stage === s || isClosed}
            onClick={() =>
              run(
                () =>
                  apiFetch(`/api/assessments/${a.application_id}/stage`, {
                    method: 'PATCH',
                    body: JSON.stringify({ stage: s }),
                  }),
                `Moved to ${STAGE_LABELS[s]}`
              )
            }
          >
            {STAGE_LABELS[s]}
          </button>
        ))}
        {(a.stage === 'COMPLETED' || a.stage === 'RETURNED') && isAdminReopen ? (
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold border disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            disabled={busy}
            onClick={() =>
              run(
                () => apiFetch(`/api/assessments/${a.application_id}/reopen`, { method: 'PATCH' }),
                'Assessment reopened'
              )
            }
          >
            <RotateCcw size={13} className="inline mr-1" /> Reopen
          </button>
        ) : null}
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wide text-secondary">{label}</div>
      <div className="font-semibold text-[13px]">{value}</div>
    </div>
  );
}

function ComplianceTab({
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
  const [confirmTarget, setConfirmTarget] = useState<{ id: number; status: 'VERIFIED' | 'REJECTED'; label: string } | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [threadRequirement, setThreadRequirement] = useState<RequirementRow | null>(null);
  const [addingRequirement, setAddingRequirement] = useState(false);

  const setReq = (id: number, status: string, remarks?: string) =>
    run(
      () =>
        apiFetch(`/api/assessments/requirements/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status, remarks: remarks?.trim() || null }),
        }),
      `Requirement ${status.toLowerCase()}`
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-secondary">
          Documentary requirements pulled from the application. Regulatory items are captured under Findings.
        </div>
        {canEdit ? (
          <button
            className="shrink-0 inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-semibold border cursor-pointer"
            style={{ borderColor: 'var(--border)' }}
            onClick={() => setAddingRequirement(true)}
          >
            <Plus size={13} /> Request additional requirement
          </button>
        ) : null}
      </div>
      {data.requirements.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} className="opacity-40" />}
          title="No requirements"
          description="This application has no requirement checklist yet."
        />
      ) : (
        <div className="rounded-xl border divide-y" style={{ borderColor: 'var(--border)' }}>
          {data.requirements.map((r) => {
            // Most recent first (listDocumentsByApplication orders DESC by id) —
            // if a requirement was rejected and re-uploaded, this is the latest one.
            const doc = data.documents.find((d) => d.requirement_id === r.requirement_id);
            const hasDocument = Boolean(doc);
            return (
            <div
              key={r.id}
              className="p-2.5 flex items-center justify-between gap-2 transition-opacity"
              style={{
                backgroundColor: hasDocument ? 'var(--surface)' : 'transparent',
                opacity: hasDocument ? 1 : 0.5,
              }}
              title={hasDocument ? undefined : 'No document uploaded yet'}
            >
              <div
                className={hasDocument ? 'min-w-0 cursor-pointer' : 'min-w-0'}
                onClick={hasDocument ? () => window.open(`/api/documents/${doc!.id}/download?view=1`, '_blank') : undefined}
                title={hasDocument ? 'Click to view the submitted PDF' : undefined}
              >
                <div className={`text-[13px] font-medium truncate ${hasDocument ? 'hover:underline' : ''}`}>
                  {r.requirement_code ? `${r.requirement_code} · ` : ''}
                  {r.requirement_name || `Requirement #${r.id}`}
                  {hasDocument ? <FileText size={12} className="inline-block ml-1.5 -mt-0.5 opacity-60" /> : null}
                  {hasDocument && Number(doc!.version) > 1 ? (
                    <span
                      className="ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold align-middle"
                      style={{ backgroundColor: 'rgba(245,158,11,.14)', color: '#f59e0b' }}
                      title="Reuploaded after a rejection"
                    >
                      V{Number(doc!.version)}
                    </span>
                  ) : null}
                </div>
                {r.remarks ? <div className="text-[11px] text-secondary truncate">{r.remarks}</div> : null}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge
                  label={r.status}
                  styles={
                    r.status === 'VERIFIED'
                      ? { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' }
                      : r.status === 'REJECTED'
                        ? { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' }
                        : { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' }
                  }
                />
                {canEdit ? (
                  <>
                    <button
                      className="rounded px-2 py-1 text-[11px] border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ borderColor: 'var(--border)' }}
                      disabled={busy || r.status === 'VERIFIED' || r.status === 'REJECTED'}
                      title={r.status === 'REJECTED' ? 'Waiting for the locator to reupload — this auto-returns to Pending once they do' : undefined}
                      onClick={() =>
                        setConfirmTarget({
                          id: r.id,
                          status: 'VERIFIED',
                          label: `${r.requirement_code ? `${r.requirement_code} · ` : ''}${r.requirement_name || `Requirement #${r.id}`}`,
                        })
                      }
                    >
                      Verify
                    </button>
                    <button
                      className="rounded px-2 py-1 text-[11px] border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ borderColor: 'var(--border)' }}
                      disabled={busy || r.status === 'REJECTED' || r.status === 'VERIFIED'}
                      onClick={() => {
                        setRejectRemarks('');
                        setConfirmTarget({
                          id: r.id,
                          status: 'REJECTED',
                          label: `${r.requirement_code ? `${r.requirement_code} · ` : ''}${r.requirement_name || `Requirement #${r.id}`}`,
                        });
                      }}
                    >
                      Reject
                    </button>
                  </>
                ) : null}
                <button
                  className="rounded px-2 py-1 text-[11px] border cursor-pointer inline-flex items-center gap-1"
                  style={{ borderColor: 'var(--border)' }}
                  onClick={() => setThreadRequirement(r)}
                  title="Discuss with the Locator"
                >
                  <MessageSquare size={12} /> Discuss
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {threadRequirement ? (
        <RequirementThreadModal requirement={threadRequirement} onClose={() => setThreadRequirement(null)} />
      ) : null}

      {addingRequirement ? (
        <AddCustomRequirementModal
          applicationId={data.assessment.application_id}
          onClose={() => setAddingRequirement(false)}
          onAdded={() => {
            setAddingRequirement(false);
            void run(async () => {}, 'Requirement requested');
          }}
        />
      ) : null}

      <ConfirmModal
        open={confirmTarget !== null}
        title={confirmTarget?.status === 'VERIFIED' ? 'Verify this requirement?' : 'Reject this requirement?'}
        description={
          confirmTarget
            ? confirmTarget.status === 'VERIFIED'
              ? `Marks "${confirmTarget.label}" as verified.`
              : `Marks "${confirmTarget.label}" as rejected — the locator will need to resubmit it.`
            : undefined
        }
        confirmText={confirmTarget?.status === 'VERIFIED' ? 'Verify' : 'Reject'}
        danger={confirmTarget?.status === 'REJECTED'}
        loading={busy}
        confirmDisabled={confirmTarget?.status === 'REJECTED' && !rejectRemarks.trim()}
        onCancel={() => {
          setConfirmTarget(null);
          setRejectRemarks('');
        }}
        onConfirm={async () => {
          if (!confirmTarget) return;
          await setReq(confirmTarget.id, confirmTarget.status, confirmTarget.status === 'REJECTED' ? rejectRemarks : undefined);
          setConfirmTarget(null);
          setRejectRemarks('');
        }}
      >
        {confirmTarget?.status === 'REJECTED' ? (
          <div className="mt-3">
            <label className="text-[11px] font-medium text-secondary">
              Reason for rejection <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              autoFocus
              className="mt-1 w-full rounded-lg border px-2.5 py-2 text-xs resize-none"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)', color: 'var(--text)' }}
              rows={3}
              placeholder="Tell the locator what's missing or wrong so they can fix and resubmit…"
              value={rejectRemarks}
              onChange={(e) => setRejectRemarks(e.target.value)}
            />
            <div className="mt-1 text-[10px] text-secondary">Sent to the locator by email along with an in-app notification.</div>
          </div>
        ) : null}
      </ConfirmModal>
    </div>
  );
}

/** Per-requirement reply thread — proxies to the same comments workflow the
 * Locator's own portal reads/posts, so both sides see the same messages. */
function RequirementThreadModal({ requirement, onClose }: { requirement: RequirementRow; onClose: () => void }) {
  const [comments, setComments] = useState<RequirementComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiFetch(`/api/assessments/requirements/${requirement.id}/comments`);
      setComments(Array.isArray(json.data) ? json.data : []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requirement.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendReply() {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const json = await apiFetch(`/api/assessments/requirements/${requirement.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ message: trimmed }),
      });
      setComments(Array.isArray(json.data) ? json.data : []);
      setMessage('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl flex flex-col max-h-[80vh]"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-secondary">Requirement thread</div>
            <div className="text-sm font-semibold truncate">
              {requirement.requirement_code ? `${requirement.requirement_code} · ` : ''}
              {requirement.requirement_name || `Requirement #${requirement.id}`}
            </div>
          </div>
          <button onClick={onClose} className="cursor-pointer shrink-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-secondary text-xs gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : comments.length === 0 ? (
            <div className="text-[11px] text-secondary text-center py-4">No replies yet.</div>
          ) : (
            comments.map((c) => {
              const isStaff = String(c.author_role || '').toLowerCase() !== 'proponent';
              return (
                <div key={c.id} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] rounded-xl px-3 py-2"
                    style={{
                      backgroundColor: isStaff ? 'var(--nav-active-bg, #111827)' : 'var(--control-bg, #1f2937)',
                      color: isStaff ? 'var(--nav-active-text, #fff)' : 'var(--text)',
                    }}
                  >
                    <div className="text-[10px] opacity-70 mb-0.5">
                      {isStaff ? c.author_name || 'Staff' : c.author_name || 'Locator'}
                    </div>
                    <div className="text-[12px] whitespace-pre-wrap">{c.message}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendReply();
            }}
            placeholder="Reply to the locator…"
            className="flex-1 rounded-lg border px-3 py-2 text-[12px] bg-transparent outline-none"
            style={{ borderColor: 'var(--border)' }}
          />
          <button
            onClick={sendReply}
            disabled={sending || !message.trim()}
            className="inline-flex items-center justify-center rounded-lg p-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border"
            style={{ borderColor: 'var(--border)' }}
            aria-label="Send reply"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Attaches a one-off requirement to just this application, outside the
 * pre-seeded catalog checklist (e.g. "please also submit an updated fire
 * safety certificate") — see Workflow.addCustomRequirementToApplication. */
function AddCustomRequirementModal({
  applicationId,
  onClose,
  onAdded,
}: {
  applicationId: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isMandatory, setIsMandatory] = useState(true);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await apiFetch(`/api/assessments/${applicationId}/requirements/custom`, {
        method: 'POST',
        body: JSON.stringify({ name: trimmed, description: description.trim() || null, is_mandatory: isMandatory }),
      });
      onAdded();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl p-4 space-y-3"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold">Request additional requirement</div>
          <button onClick={onClose} className="cursor-pointer" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="text-[11px] text-secondary">
          Attaches a one-off item to this application's checklist only — it won't appear on any other application.
        </p>
        <div>
          <label className="text-[11px] font-medium text-secondary">Name *</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Updated Fire Safety Certificate"
            className="mt-1 w-full rounded-lg border px-2.5 py-2 text-xs"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-secondary">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional details for the locator"
            className="mt-1 w-full rounded-lg border px-2.5 py-2 text-xs resize-none"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-secondary">
          <input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} />
          Mandatory
        </label>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button className="rounded px-3 py-1.5 text-[12px] border cursor-pointer" style={{ borderColor: 'var(--border)' }} onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded px-3 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--nav-active-bg, #111827)', color: 'var(--nav-active-text, #fff)' }}
            disabled={saving || !name.trim()}
            onClick={submit}
          >
            {saving ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FindingsTab({
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
  const appId = data.assessment.application_id;
  // Once the assessment is COMPLETED (recommendation submitted) or RETURNED,
  // it's no longer "open" — new findings shouldn't be added until an admin
  // reopens it (same gate as the Recommendation tab's own form).
  const isClosed = data.assessment.stage === 'COMPLETED' || data.assessment.stage === 'RETURNED';
  const [form, setForm] = useState({
    finding_type: 'FINDING',
    category: 'DOCUMENTARY',
    severity: '',
    description: '',
  });

  const add = () =>
    run(async () => {
      await apiFetch(`/api/assessments/${appId}/findings`, {
        method: 'POST',
        body: JSON.stringify({
          finding_type: form.finding_type,
          category: form.category,
          severity: form.severity || null,
          description: form.description.trim(),
        }),
      });
      setForm({ finding_type: 'FINDING', category: 'DOCUMENTARY', severity: '', description: '' });
    }, 'Finding recorded');

  return (
    <div className="flex flex-col gap-3">
      {data.findings.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} className="opacity-40" />}
          title="No findings yet"
          description="Record findings, deficiencies, remarks and recommendations here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.findings.map((f) => (
            <div key={f.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-[13px] flex-1 min-w-0">{f.description}</div>
                <div className="flex items-center gap-2 shrink-0">
                  {perms.canEdit && f.status === 'OPEN' && !isClosed ? (
                    <button
                      className="rounded px-2 py-0.5 text-[11px] border disabled:opacity-40 whitespace-nowrap"
                      style={{ borderColor: 'var(--border)' }}
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            apiFetch(`/api/assessments/findings/${f.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'RESOLVED' }),
                            }),
                          'Finding resolved'
                        )
                      }
                    >
                      Resolve
                    </button>
                  ) : null}
                  {perms.canDelete && !isClosed ? (
                    <button
                      className="text-secondary hover:text-red-500 disabled:opacity-40"
                      disabled={busy}
                      onClick={() =>
                        run(() => apiFetch(`/api/assessments/findings/${f.id}`, { method: 'DELETE' }), 'Finding deleted')
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap mt-2.5 pt-2.5 border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <Badge label={f.finding_type} styles={findingBadge(f.finding_type)} />
                  <Badge label={f.category} styles={{ bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.38)' }} />
                  {f.severity ? <Badge label={f.severity} styles={severityBadge(f.severity)} /> : null}
                  <Badge label={f.status} styles={findingStatusBadge(f.status)} />
                </div>
                <span className="text-[10px] text-secondary shrink-0 whitespace-nowrap">{fmtDateTime(f.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {perms.canAdd && !isClosed ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Add finding</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Type">
              <AppSelect
                compact
                isClearable={false}
                value={form.finding_type}
                onChange={(v) => setForm((f) => ({ ...f, finding_type: v }))}
                options={FINDING_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <Field label="Category">
              <AppSelect
                compact
                isClearable={false}
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                options={FINDING_CATEGORIES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <Field label="Severity">
              <AppSelect
                compact
                value={form.severity}
                onChange={(v) => setForm((f) => ({ ...f, severity: v }))}
                options={['LOW', 'MEDIUM', 'HIGH'].map((t) => ({ value: t, label: t }))}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              className={cn(inputCls, 'min-h-[64px] resize-y')}
              style={inputStyle}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.description.trim()}
              onClick={add}
            >
              <Plus size={13} className="inline mr-1" /> Record
            </button>
          </div>
        </div>
      ) : null}
      {/* keep FINDING_STATUSES referenced for future edit UI */}
      <span className="hidden">{FINDING_STATUSES.join(',')}</span>
    </div>
  );
}

function RecommendationTab({
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
  const a = data.assessment;
  const [rec, setRec] = useState(a.recommendation || 'ENDORSE');
  const [summary, setSummary] = useState('');
  // A recommendation, once submitted, is final until an admin explicitly
  // reopens the assessment (which clears a.recommendation back to null) —
  // the form must not look editable in between.
  const alreadySubmitted = Boolean(a.recommendation);
  const openFindings = data.findings.filter((f) => f.status === 'OPEN').length;
  const totalReq = data.requirements.length;
  const verifiedReq = data.requirements.filter((r) => r.status === 'VERIFIED').length;
  const pendingReq = data.requirements.filter((r) => r.status === 'PENDING').length;
  const rejectedReq = data.requirements.filter((r) => r.status === 'REJECTED').length;
  const allVerified = totalReq > 0 && verifiedReq === totalReq;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="rounded-xl border p-3 text-[12px]"
        style={{ borderColor: allVerified ? 'rgba(16,185,129,.4)' : 'var(--border)' }}
      >
        <div className="flex justify-between">
          <span className="text-secondary">Open findings</span>
          <span className="font-semibold" style={{ color: openFindings ? '#ef4444' : undefined }}>
            {openFindings}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-secondary">Requirements verified</span>
          <span className="font-semibold" style={{ color: allVerified ? '#10b981' : undefined }}>
            {verifiedReq}/{totalReq}
          </span>
        </div>
      </div>

      {allVerified ? (
        <div
          className="rounded-lg border px-3 py-2 text-[12px] flex items-center gap-2"
          style={{ borderColor: 'rgba(16,185,129,.4)', backgroundColor: 'rgba(16,185,129,.1)', color: '#10b981' }}
        >
          <CheckCircle2 size={14} className="shrink-0" />
          <span>All requirements verified — ready to endorse to the Approval & Issuance workflow.</span>
        </div>
      ) : (
        <div
          className="rounded-lg border px-3 py-2 text-[12px] flex items-center gap-2"
          style={{ borderColor: 'rgba(245,158,11,.4)', backgroundColor: 'rgba(245,158,11,.1)', color: '#f59e0b' }}
        >
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            {pendingReq > 0 ? `${pendingReq} pending` : ''}
            {pendingReq > 0 && rejectedReq > 0 ? ', ' : ''}
            {rejectedReq > 0 ? `${rejectedReq} rejected` : ''} in Compliance — check that tab before endorsing.
          </span>
        </div>
      )}

      {a.recommendation ? (
        <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border)' }}>
          Current recommendation: <span className="font-bold">{a.recommendation}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {[
          {
            v: 'ENDORSE',
            label: 'Endorse to Approval',
            hint: 'Application moves to FOR_APPROVAL for multi-level review; the locator gets an email once their business status is decided.',
          },
          { v: 'RETURN', label: 'Return to Locator', hint: 'Application status becomes RETURNED; locator is notified by email.' },
          { v: 'DISAPPROVE', label: 'Recommend Disapproval', hint: 'Application status becomes DISAPPROVED; locator is notified by email.' },
        ].map((o) => (
          <label
            key={o.v}
            className={cn(
              'rounded-xl border p-2.5 flex gap-2',
              rec === o.v && 'ring-1 ring-[var(--text)]',
              alreadySubmitted ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            style={{ borderColor: 'var(--border)' }}
          >
            <input
              type="radio"
              name="rec"
              checked={rec === o.v}
              onChange={() => setRec(o.v)}
              disabled={alreadySubmitted}
              className="mt-0.5"
            />
            <div>
              <div className="text-[13px] font-semibold">{o.label}</div>
              <div className="text-[11px] text-secondary">{o.hint}</div>
            </div>
          </label>
        ))}
      </div>

      <Field label="Summary / basis">
        <textarea
          className={cn(inputCls, 'min-h-[80px] resize-y disabled:opacity-60 disabled:cursor-not-allowed')}
          style={inputStyle}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          disabled={alreadySubmitted}
          placeholder="State the basis for this recommendation…"
        />
      </Field>

      <button
        className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
        style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
        disabled={busy || !canEdit || alreadySubmitted}
        title={alreadySubmitted ? 'Already submitted — an admin must reopen the assessment to change it' : undefined}
        onClick={() =>
          run(
            () =>
              apiFetch(`/api/assessments/${a.application_id}/recommendation`, {
                method: 'POST',
                body: JSON.stringify({ recommendation: rec, summary: summary.trim() }),
              }),
            'Recommendation submitted'
          )
        }
      >
        {alreadySubmitted ? 'Recommendation submitted' : 'Submit recommendation'}
      </button>
    </div>
  );
}

function ActivityTab({ data }: { data: DetailPayload }) {
  if (data.activity.length === 0) {
    return (
      <EmptyState
        icon={<Clock3 size={40} className="opacity-40" />}
        title="No activity"
        description="Assessment actions are logged here."
      />
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {data.activity.map((act) => (
        <li key={act.id} className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border)' }}>
          <div className="flex justify-between">
            <span className="font-semibold">{act.action.replace(/_/g, ' ')}</span>
            <span className="text-secondary">{fmtDateTime(act.created_at)}</span>
          </div>
          {act.detail ? <div className="text-secondary mt-0.5">{act.detail}</div> : null}
          <div className="text-[10px] text-secondary mt-0.5">
            {act.actor_name || act.actor_username || 'System'}
          </div>
        </li>
      ))}
    </ol>
  );
}
