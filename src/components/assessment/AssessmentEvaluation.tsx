import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ClipboardCheck,
  Clock3,
  Coins,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserCheck,
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
const CHARGE_TYPES = ['RENTAL', 'PROCESSING_FEE', 'TAX', 'PENALTY', 'OTHER'];

type AssessmentRow = {
  application_id: number;
  application_no: string;
  application_type: string;
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
  charges_total: number;
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

type RequirementRow = {
  id: number;
  requirement_code: string | null;
  requirement_name: string | null;
  status: string;
  remarks: string | null;
  is_mandatory?: number | boolean;
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
  charges: ChargeRow[];
  activity: ActivityRow[];
  requirements: RequirementRow[];
  documents: { id: number; file_name: string; original_file_name: string | null; requirement_code: string | null }[];
};

type Summary = {
  by_stage: Record<string, number>;
  total: number;
  active: number;
  overdue: number;
  avg_days_to_complete: number | null;
};

type Evaluator = { id: number; full_name: string | null; username: string };

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

export function AssessmentEvaluation() {
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

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (stageFilter && (r.stage || 'UNASSIGNED') !== stageFilter) return false;
      if (evaluatorFilter && String(r.assigned_evaluator_id ?? '') !== evaluatorFilter) return false;
      if (term) {
        const hay = `${r.application_no ?? ''} ${r.proponent_name ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [allRows, stageFilter, evaluatorFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [stageFilter, evaluatorFilter, search]);

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
        <StatTile label="Completed" value={summary?.by_stage?.COMPLETED ?? '—'} tone="#10b981" />
        <StatTile label="Returned" value={summary?.by_stage?.RETURNED ?? '—'} tone="#f59e0b" />
      </div>

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          Evaluation Queue
        </h3>
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
              placeholder="All stages"
              value={stageFilter}
              onChange={setStageFilter}
              options={STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
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
            <TableSkeleton columns={8} rows={6} />
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
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Proponent</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Stage</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Evaluator</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Compliance</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Findings</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Charges</th>
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
                    <td className="px-3 py-2.5 text-right text-[11px] text-secondary tabular-nums">
                      {r.charges_total ? peso(r.charges_total) : '—'}
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

const TABS = ['Overview', 'Compliance', 'Charges', 'Findings', 'Recommendation', 'Activity'] as const;
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
              {a ? `${a.proponent_name || '—'} · ${a.is_renewal ? 'Renewal' : 'New'} ${a.application_type}` : ''}
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
            <OverviewTab data={data} evaluators={evaluators} perms={perms} busy={busy} run={run} />
          ) : tab === 'Compliance' ? (
            <ComplianceTab data={data} canEdit={perms.canEdit} busy={busy} run={run} />
          ) : tab === 'Charges' ? (
            <ChargesTab data={data} perms={perms} busy={busy} run={run} />
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

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <InfoCell label="Application status" value={a.application_status} />
        <InfoCell label="Stage" value={STAGE_LABELS[a.stage] || a.stage} />
        <InfoCell label="Assigned" value={fmtDate(a.assigned_at)} />
        <InfoCell
          label="Days in assessment"
          value={a.days_in_assessment == null ? '—' : String(a.days_in_assessment)}
        />
        <InfoCell label="Charges total" value={peso(a.charges_total)} />
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
              options={evaluators.map((e) => ({ value: String(e.id), label: e.full_name || e.username }))}
            />
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit || !evaluatorId}
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
            disabled={busy || !perms.canEdit || a.stage === s}
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
  const setReq = (id: number, status: string) =>
    run(
      () =>
        apiFetch(`/api/assessments/requirements/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }),
      `Requirement ${status.toLowerCase()}`
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-secondary">
        Documentary requirements pulled from the application. Regulatory items are captured under Findings.
      </div>
      {data.requirements.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} className="opacity-40" />}
          title="No requirements"
          description="This application has no requirement checklist yet."
        />
      ) : (
        <div className="rounded-xl border divide-y" style={{ borderColor: 'var(--border)' }}>
          {data.requirements.map((r) => (
            <div key={r.id} className="p-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {r.requirement_code ? `${r.requirement_code} · ` : ''}
                  {r.requirement_name || `Requirement #${r.id}`}
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
                      className="rounded px-2 py-1 text-[11px] border disabled:opacity-40"
                      style={{ borderColor: 'var(--border)' }}
                      disabled={busy || r.status === 'VERIFIED'}
                      onClick={() => setReq(r.id, 'VERIFIED')}
                    >
                      Verify
                    </button>
                    <button
                      className="rounded px-2 py-1 text-[11px] border disabled:opacity-40"
                      style={{ borderColor: 'var(--border)' }}
                      disabled={busy || r.status === 'REJECTED'}
                      onClick={() => setReq(r.id, 'REJECTED')}
                    >
                      Reject
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
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
  const appId = data.assessment.application_id;
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
      await apiFetch(`/api/assessments/${appId}/charges`, {
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
      <div className="rounded-xl border" style={{ borderColor: 'var(--border)' }}>
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
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
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
                            () => apiFetch(`/api/assessments/charges/${c.id}`, { method: 'DELETE' }),
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
            <tr className="border-t" style={{ borderColor: 'var(--border)' }}>
              <td colSpan={4} className="px-2.5 py-2 text-right text-[11px] uppercase tracking-wide text-secondary">
                Total assessed
              </td>
              <td className="px-2.5 py-2 text-right font-bold tabular-nums">{peso(data.assessment.charges_total)}</td>
              {perms.canDelete ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
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
            <div key={f.id} className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge label={f.finding_type} styles={findingBadge(f.finding_type)} />
                  <span className="text-[10px] text-secondary">{f.category}</span>
                  {f.severity ? <span className="text-[10px] text-secondary">· {f.severity}</span> : null}
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
                <div className="flex items-center gap-1.5 shrink-0">
                  {perms.canEdit && f.status === 'OPEN' ? (
                    <button
                      className="rounded px-2 py-0.5 text-[11px] border disabled:opacity-40"
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
                  {perms.canDelete ? (
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
              <div className="text-[13px] mt-1">{f.description}</div>
            </div>
          ))}
        </div>
      )}

      {perms.canAdd ? (
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
  const openFindings = data.findings.filter((f) => f.status === 'OPEN').length;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border p-3 text-[12px]" style={{ borderColor: 'var(--border)' }}>
        <div className="flex justify-between">
          <span className="text-secondary">Charges assessed</span>
          <span className="font-semibold">{peso(a.charges_total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-secondary">Open findings</span>
          <span className="font-semibold" style={{ color: openFindings ? '#ef4444' : undefined }}>
            {openFindings}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-secondary">Requirements verified</span>
          <span className="font-semibold">
            {data.requirements.filter((r) => r.status === 'VERIFIED').length}/{data.requirements.length}
          </span>
        </div>
      </div>

      {a.recommendation ? (
        <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border)' }}>
          Current recommendation: <span className="font-bold">{a.recommendation}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {[
          { v: 'ENDORSE', label: 'Endorse to Approval', hint: 'Application moves to FOR_APPROVAL.' },
          { v: 'RETURN', label: 'Return to Proponent', hint: 'Application status becomes RETURNED; proponent is notified.' },
          { v: 'DISAPPROVE', label: 'Recommend Disapproval', hint: 'Application status becomes DISAPPROVED.' },
        ].map((o) => (
          <label
            key={o.v}
            className={cn(
              'rounded-xl border p-2.5 flex gap-2 cursor-pointer',
              rec === o.v && 'ring-1 ring-[var(--text)]'
            )}
            style={{ borderColor: 'var(--border)' }}
          >
            <input type="radio" name="rec" checked={rec === o.v} onChange={() => setRec(o.v)} className="mt-0.5" />
            <div>
              <div className="text-[13px] font-semibold">{o.label}</div>
              <div className="text-[11px] text-secondary">{o.hint}</div>
            </div>
          </label>
        ))}
      </div>

      <Field label="Summary / basis">
        <textarea
          className={cn(inputCls, 'min-h-[80px] resize-y')}
          style={inputStyle}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="State the basis for this recommendation…"
        />
      </Field>

      <button
        className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
        style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
        disabled={busy || !canEdit}
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
        Submit recommendation
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
            <span className="text-secondary">{fmtDate(act.created_at)}</span>
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
