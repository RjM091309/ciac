import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  ShieldCheck,
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

const MENU_KEY = 'compliance:inspections';

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const STATUS_ORDER = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const RESULTS = ['PASSED', 'PASSED_WITH_FINDINGS', 'FAILED'];
const RESULT_LABELS: Record<string, string> = {
  PASSED: 'Passed',
  PASSED_WITH_FINDINGS: 'Passed w/ Findings',
  FAILED: 'Failed',
};
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];
const ACTION_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'OVERDUE'];

type InspectionRow = {
  id: number;
  proponent_id: number;
  proponent_name: string | null;
  inspection_type_id: number | null;
  inspection_type_name: string | null;
  inspection_type_code: string | null;
  title: string;
  scheduled_date: string | null;
  conducted_date: string | null;
  assigned_inspector_id: number | null;
  inspector_name: string | null;
  inspector_username: string | null;
  status: string;
  result: string | null;
  total_findings: number;
  open_findings: number;
  open_actions: number;
  overdue_actions: number;
};

type FindingRow = {
  id: number;
  category: string | null;
  severity: string | null;
  description: string;
  recommendation: string | null;
  status: string;
};

type ActionRow = {
  id: number;
  finding_id: number | null;
  finding_description: string | null;
  action_required: string;
  responsible_party: string | null;
  due_date: string | null;
  status: string;
  completed_date: string | null;
  remarks: string | null;
};

type DocRow = {
  id: number;
  doc_kind: string;
  file_name: string;
  storage_path: string;
  created_at: string | null;
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
  inspection: InspectionRow & { summary: string | null; application_id: number | null; contract_id: number | null };
  findings: FindingRow[];
  corrective_actions: ActionRow[];
  documents: DocRow[];
  activity: ActivityRow[];
};

type Summary = {
  by_status: Record<string, number>;
  by_result: Record<string, number>;
  total: number;
  overdue_actions: number;
  open_findings: number;
  by_proponent: {
    proponent_id: number;
    proponent_name: string;
    total_inspections: number;
    completed_inspections: number;
    failed_inspections: number;
    last_inspection_date: string | null;
    open_findings: number;
    open_actions: number;
    overdue_actions: number;
  }[];
};

type Meta = {
  inspectors: { id: number; full_name: string | null; username: string }[];
  proponents: { id: number; business_name: string }[];
  types: { id: number; code: string; name: string }[];
};

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadge(status: string) {
  switch (status) {
    case 'COMPLETED':
      return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
    case 'CANCELLED':
      return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
    case 'IN_PROGRESS':
      return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
    default:
      return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
  }
}

function resultBadge(result: string | null) {
  if (result === 'PASSED') return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
  if (result === 'FAILED') return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  if (result === 'PASSED_WITH_FINDINGS')
    return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
  return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
}

function actionBadge(status: string) {
  if (status === 'DONE') return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
  if (status === 'OVERDUE') return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  if (status === 'IN_PROGRESS')
    return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
  return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
}

function isOverdue(a: ActionRow) {
  if (a.status === 'DONE' || !a.due_date) return false;
  const d = new Date(a.due_date);
  return !Number.isNaN(d.getTime()) && d < new Date();
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

const inputCls = 'rounded-lg border px-2.5 py-1.5 text-[13px] font-normal outline-none bg-[var(--surface)] text-[var(--text)]';
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

export function ComplianceInspections() {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const perms = {
    canAdd: fullAccess || perm.can_add,
    canEdit: fullAccess || perm.can_edit,
    canDelete: fullAccess || perm.can_delete,
  };

  const [tab, setTab] = useState<'inspections' | 'monitor'>('inspections');
  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [meta, setMeta] = useState<Meta>({ inspectors: [], proponents: [], types: [] });
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('typeId', typeFilter);
    if (search.trim()) params.set('search', search.trim());
    const [listJson, summaryJson] = await Promise.all([
      apiFetch(`/api/inspections?${params.toString()}`),
      apiFetch('/api/inspections/summary'),
    ]);
    setRows(listJson.data || []);
    setSummary(summaryJson.data || null);
  }, [statusFilter, typeFilter, search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const metaJson = await apiFetch('/api/inspections/meta');
        if (!cancelled) setMeta(metaJson.data || { inspectors: [], proponents: [], types: [] });
        await loadList();
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, search]);

  const pg = usePagination(rows, pageSize, page);

  const refresh = useCallback(async () => {
    try {
      await loadList();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [loadList]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatTile icon={ClipboardCheck} label="Total" value={summary?.total ?? '—'} />
        <StatTile icon={CalendarClock} label="Scheduled" value={summary?.by_status?.SCHEDULED ?? '—'} tone="#f59e0b" />
        <StatTile icon={ClipboardList} label="In Progress" value={summary?.by_status?.IN_PROGRESS ?? '—'} tone="#3b82f6" />
        <StatTile icon={ShieldCheck} label="Completed" value={summary?.by_status?.COMPLETED ?? '—'} tone="#10b981" />
        <StatTile icon={FileText} label="Open Findings" value={summary?.open_findings ?? '—'} tone="#f59e0b" />
        <StatTile icon={AlertTriangle} label="Overdue Actions" value={summary?.overdue_actions ?? '—'} tone="#ef4444" />
      </div>

      <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {(
          [
            ['inspections', 'Inspections'],
            ['monitor', 'Compliance Monitor'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px transition-colors',
              tab === k ? 'border-[var(--text)] text-[var(--text)]' : 'border-transparent text-secondary hover:text-[var(--text)]'
            )}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto">
          {perms.canAdd && tab === 'inspections' ? (
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold mb-1"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              onClick={() => setCreating(true)}
            >
              <Plus size={13} className="inline mr-1" /> New Inspection
            </button>
          ) : null}
        </div>
      </div>

      {tab === 'monitor' ? (
        <MonitorTab summary={summary} loading={loading} onOpenProponent={(pid) => {
          setTypeFilter('');
          setStatusFilter('');
          setSearch('');
          setTab('inspections');
          // proponent filter is applied server-side via a dedicated fetch
          apiFetch(`/api/inspections?proponentId=${pid}`)
            .then((j) => setRows(j.data || []))
            .catch((e) => toast.error((e as Error).message));
        }} />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <input
              className={cn(inputCls, 'w-full sm:w-64')}
              style={inputStyle}
              placeholder="Search inspection / proponent…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="w-full sm:w-44">
              <AppSelect
                compact
                placeholder="All statuses"
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
              />
            </div>
            <div className="w-full sm:w-52">
              <AppSelect
                compact
                placeholder="All types"
                value={typeFilter}
                onChange={setTypeFilter}
                options={meta.types.map((t) => ({ value: String(t.id), label: t.name }))}
              />
            </div>
          </div>

          <div
            className="rounded-xl border overflow-hidden shadow-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            {loading ? (
              <div className="p-4">
                <TableSkeleton rows={6} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck size={40} className="opacity-40" />}
                title="No inspections"
                description="Schedule an inspection to start tracking locator compliance."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr
                      className="text-[11px] uppercase tracking-wide text-secondary"
                      style={{ backgroundColor: 'var(--control-bg)' }}
                    >
                      <th className="px-3 py-2.5 font-semibold">Inspection</th>
                      <th className="px-3 py-2.5 font-semibold">Proponent</th>
                      <th className="px-3 py-2.5 font-semibold">Type</th>
                      <th className="px-3 py-2.5 font-semibold">Inspector</th>
                      <th className="px-3 py-2.5 font-semibold">Scheduled</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold">Result</th>
                      <th className="px-3 py-2.5 font-semibold">Findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.pageItems.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t cursor-pointer hover:bg-[var(--selected-bg)] transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <td className="px-3 py-2.5 font-semibold">{r.title}</td>
                        <td className="px-3 py-2.5">{r.proponent_name || '—'}</td>
                        <td className="px-3 py-2.5 text-[12px]">{r.inspection_type_name || r.inspection_type_code || '—'}</td>
                        <td className="px-3 py-2.5 text-[12px]">{r.inspector_name || r.inspector_username || '—'}</td>
                        <td className="px-3 py-2.5 text-[12px]">{fmtDate(r.scheduled_date)}</td>
                        <td className="px-3 py-2.5">
                          <Badge label={STATUS_LABELS[r.status] || r.status} styles={statusBadge(r.status)} />
                        </td>
                        <td className="px-3 py-2.5">
                          {r.result ? <Badge label={RESULT_LABELS[r.result] || r.result} styles={resultBadge(r.result)} /> : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[12px]">
                          {r.open_findings > 0 ? (
                            <span style={{ color: '#ef4444' }}>{r.open_findings} open</span>
                          ) : (
                            <span className="text-secondary">{r.total_findings || 0}</span>
                          )}
                          {r.overdue_actions > 0 ? (
                            <span className="ml-1" style={{ color: '#ef4444' }}>
                              · {r.overdue_actions} overdue
                            </span>
                          ) : null}
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
              loading={loading}
            />
          </div>
        </>
      )}

      <AnimatePresence>
        {selectedId != null ? (
          <InspectionDetail
            inspectionId={selectedId}
            meta={meta}
            perms={perms}
            onClose={() => setSelectedId(null)}
            onMutated={refresh}
          />
        ) : null}
        {creating ? (
          <NewInspection
            meta={meta}
            onClose={() => setCreating(false)}
            onCreated={async (id) => {
              setCreating(false);
              await refresh();
              setSelectedId(id);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div
      className="rounded-xl border px-3 py-2.5 shadow-sm"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-secondary">
        <Icon size={12} style={{ color: tone }} /> {label}
      </div>
      <div className="text-lg font-bold mt-0.5" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}

function MonitorTab({
  summary,
  loading,
  onOpenProponent,
}: {
  summary: Summary | null;
  loading: boolean;
  onOpenProponent: (proponentId: number) => void;
}) {
  if (loading) return <TableSkeleton rows={6} />;
  const rows = summary?.by_proponent || [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={40} className="opacity-40" />}
        title="No compliance data"
        description="Once inspections are recorded, per-locator compliance standing shows here."
      />
    );
  }
  return (
    <div
      className="rounded-xl border overflow-x-auto shadow-sm"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr
            className="text-[11px] uppercase tracking-wide text-secondary"
            style={{ backgroundColor: 'var(--control-bg)' }}
          >
            <th className="px-3 py-2.5 font-semibold">Locator</th>
            <th className="px-3 py-2.5 font-semibold text-right">Inspections</th>
            <th className="px-3 py-2.5 font-semibold text-right">Completed</th>
            <th className="px-3 py-2.5 font-semibold text-right">Failed</th>
            <th className="px-3 py-2.5 font-semibold text-right">Open Findings</th>
            <th className="px-3 py-2.5 font-semibold text-right">Open Actions</th>
            <th className="px-3 py-2.5 font-semibold text-right">Overdue</th>
            <th className="px-3 py-2.5 font-semibold">Last Inspection</th>
            <th className="px-3 py-2.5 font-semibold">Standing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const standing =
              r.overdue_actions > 0 || r.failed_inspections > 0
                ? { label: 'At Risk', styles: resultBadge('FAILED') }
                : r.open_findings > 0 || r.open_actions > 0
                  ? { label: 'Monitoring', styles: resultBadge('PASSED_WITH_FINDINGS') }
                  : { label: 'Compliant', styles: resultBadge('PASSED') };
            return (
              <tr
                key={r.proponent_id}
                className="border-t cursor-pointer hover:bg-[var(--selected-bg)]"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => onOpenProponent(r.proponent_id)}
              >
                <td className="px-3 py-2.5 font-semibold">{r.proponent_name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.total_inspections}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.completed_inspections}</td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.failed_inspections ? '#ef4444' : undefined }}>
                  {r.failed_inspections}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.open_findings}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.open_actions}</td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.overdue_actions ? '#ef4444' : undefined }}>
                  {r.overdue_actions}
                </td>
                <td className="px-3 py-2.5 text-[12px]">{fmtDate(r.last_inspection_date)}</td>
                <td className="px-3 py-2.5">
                  <Badge label={standing.label} styles={standing.styles} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Perms = { canAdd: boolean; canEdit: boolean; canDelete: boolean };
type RunFn = (fn: () => Promise<unknown>, successMsg?: string) => Promise<void>;

const DETAIL_TABS = ['Overview', 'Findings', 'Corrective Actions', 'Reports', 'Activity'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function InspectionDetail({
  inspectionId,
  meta,
  perms,
  onClose,
  onMutated,
}: {
  inspectionId: number;
  meta: Meta;
  perms: Perms;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>('Overview');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const json = await apiFetch(`/api/inspections/${inspectionId}`);
    setData(json.data);
  }, [inspectionId]);

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

  const i = data?.inspection;

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
              {i ? i.title : 'Inspection'}
            </div>
            <div className="text-[11px] text-secondary">
              {i ? `${i.proponent_name || '—'} · ${i.inspection_type_name || i.inspection_type_code || 'Inspection'}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {i ? <Badge label={STATUS_LABELS[i.status] || i.status} styles={statusBadge(i.status)} /> : null}
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
          {DETAIL_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors',
                tab === t ? 'border-[var(--text)] text-[var(--text)]' : 'border-transparent text-secondary hover:text-[var(--text)]'
              )}
            >
              {t}
              {t === 'Findings' && data?.findings.length ? ` (${data.findings.length})` : ''}
              {t === 'Corrective Actions' && data?.corrective_actions.length ? ` (${data.corrective_actions.length})` : ''}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading || !data ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-secondary" />
            </div>
          ) : tab === 'Overview' ? (
            <OverviewTab data={data} meta={meta} perms={perms} busy={busy} run={run} />
          ) : tab === 'Findings' ? (
            <FindingsTab data={data} perms={perms} busy={busy} run={run} />
          ) : tab === 'Corrective Actions' ? (
            <ActionsTab data={data} perms={perms} busy={busy} run={run} />
          ) : tab === 'Reports' ? (
            <ReportsTab data={data} perms={perms} busy={busy} run={run} />
          ) : (
            <ActivityTab data={data} />
          )}
        </div>
      </motion.div>
    </div>
  );
}

function OverviewTab({
  data,
  meta,
  perms,
  busy,
  run,
}: {
  data: DetailPayload;
  meta: Meta;
  perms: Perms;
  busy: boolean;
  run: RunFn;
}) {
  const i = data.inspection;
  const [inspectorId, setInspectorId] = useState(i.assigned_inspector_id ? String(i.assigned_inspector_id) : '');
  const [result, setResult] = useState(i.result || 'PASSED');
  const [summary, setSummary] = useState(i.summary || '');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <InfoCell label="Status" value={STATUS_LABELS[i.status] || i.status} />
        <InfoCell label="Result" value={i.result ? RESULT_LABELS[i.result] || i.result : '—'} />
        <InfoCell label="Scheduled" value={fmtDate(i.scheduled_date)} />
        <InfoCell label="Conducted" value={fmtDate(i.conducted_date)} />
      </div>

      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wide text-secondary mb-2">Assign inspector</div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <AppSelect
              compact
              placeholder="Select inspector…"
              value={inspectorId}
              onChange={setInspectorId}
              options={meta.inspectors.map((e) => ({ value: String(e.id), label: e.full_name || e.username }))}
            />
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit || !inspectorId}
            onClick={() =>
              run(
                () =>
                  apiFetch(`/api/inspections/${i.id}/assign`, {
                    method: 'PATCH',
                    body: JSON.stringify({ inspector_id: Number(inspectorId) }),
                  }),
                'Inspector assigned'
              )
            }
          >
            <UserCheck size={13} className="inline mr-1" /> Assign
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-3 flex flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
        <div className="w-full text-[11px] font-bold uppercase tracking-wide text-secondary mb-1">Status</div>
        {['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'].map((s) => (
          <button
            key={s}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[12px] font-semibold border disabled:opacity-40',
              i.status === s && 'ring-1 ring-[var(--text)]'
            )}
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            disabled={busy || !perms.canEdit || i.status === s}
            onClick={() =>
              run(
                () => apiFetch(`/api/inspections/${i.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: s }) }),
                `Status: ${STATUS_LABELS[s]}`
              )
            }
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Complete inspection</div>
        <Field label="Result">
          <AppSelect
            compact
            isClearable={false}
            value={result}
            onChange={setResult}
            options={RESULTS.map((r) => ({ value: r, label: RESULT_LABELS[r] }))}
          />
        </Field>
        <Field label="Summary">
          <textarea
            className={cn(inputCls, 'min-h-[64px] resize-y')}
            style={inputStyle}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit}
            onClick={() =>
              run(
                () =>
                  apiFetch(`/api/inspections/${i.id}/result`, {
                    method: 'PATCH',
                    body: JSON.stringify({ result, summary: summary.trim() }),
                  }),
                'Inspection completed'
              )
            }
          >
            Mark completed
          </button>
        </div>
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

function FindingsTab({ data, perms, busy, run }: { data: DetailPayload; perms: Perms; busy: boolean; run: RunFn }) {
  const id = data.inspection.id;
  const [form, setForm] = useState({ category: '', severity: '', description: '', recommendation: '' });

  const add = () =>
    run(async () => {
      await apiFetch(`/api/inspections/${id}/findings`, {
        method: 'POST',
        body: JSON.stringify({
          category: form.category.trim() || null,
          severity: form.severity || null,
          description: form.description.trim(),
          recommendation: form.recommendation.trim() || null,
        }),
      });
      setForm({ category: '', severity: '', description: '', recommendation: '' });
    }, 'Finding recorded');

  return (
    <div className="flex flex-col gap-3">
      {data.findings.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} className="opacity-40" />}
          title="No findings"
          description="Record inspection findings and recommendations here."
        />
      ) : (
        data.findings.map((f) => (
          <div key={f.id} className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {f.category ? <span className="text-[11px] font-semibold">{f.category}</span> : null}
                {f.severity ? <span className="text-[10px] text-secondary">· {f.severity}</span> : null}
                <Badge
                  label={f.status}
                  styles={
                    f.status === 'RESOLVED'
                      ? resultBadge('PASSED')
                      : f.status === 'WAIVED'
                        ? { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' }
                        : resultBadge('PASSED_WITH_FINDINGS')
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
                          apiFetch(`/api/inspections/findings/${f.id}`, {
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
                      run(() => apiFetch(`/api/inspections/findings/${f.id}`, { method: 'DELETE' }), 'Finding deleted')
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="text-[13px] mt-1">{f.description}</div>
            {f.recommendation ? (
              <div className="text-[12px] text-secondary mt-1">
                <span className="font-semibold">Recommendation: </span>
                {f.recommendation}
              </div>
            ) : null}
          </div>
        ))
      )}

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Add finding</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              <input
                className={inputCls}
                style={inputStyle}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Structural, Documentary"
              />
            </Field>
            <Field label="Severity">
              <AppSelect
                compact
                value={form.severity}
                onChange={(v) => setForm((f) => ({ ...f, severity: v }))}
                options={SEVERITIES.map((s) => ({ value: s, label: s }))}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              className={cn(inputCls, 'min-h-[56px] resize-y')}
              style={inputStyle}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field label="Recommendation">
            <textarea
              className={cn(inputCls, 'min-h-[48px] resize-y')}
              style={inputStyle}
              value={form.recommendation}
              onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))}
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
    </div>
  );
}

function ActionsTab({ data, perms, busy, run }: { data: DetailPayload; perms: Perms; busy: boolean; run: RunFn }) {
  const id = data.inspection.id;
  const [form, setForm] = useState({ action_required: '', responsible_party: '', due_date: '', finding_id: '' });

  const add = () =>
    run(async () => {
      await apiFetch(`/api/inspections/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          action_required: form.action_required.trim(),
          responsible_party: form.responsible_party.trim() || null,
          due_date: form.due_date || null,
          finding_id: form.finding_id ? Number(form.finding_id) : null,
        }),
      });
      setForm({ action_required: '', responsible_party: '', due_date: '', finding_id: '' });
    }, 'Corrective action added');

  return (
    <div className="flex flex-col gap-3">
      {data.corrective_actions.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={40} className="opacity-40" />}
          title="No corrective actions"
          description="Track what the locator must fix and by when."
        />
      ) : (
        data.corrective_actions.map((a) => {
          const overdue = isOverdue(a);
          return (
            <div key={a.id} className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <Badge label={overdue ? 'OVERDUE' : a.status} styles={actionBadge(overdue ? 'OVERDUE' : a.status)} />
                <div className="flex items-center gap-1.5">
                  {perms.canEdit && a.status !== 'DONE' ? (
                    <>
                      <button
                        className="rounded px-2 py-0.5 text-[11px] border disabled:opacity-40"
                        style={{ borderColor: 'var(--border)' }}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              apiFetch(`/api/inspections/actions/${a.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'IN_PROGRESS' }),
                              }),
                            'Marked in progress'
                          )
                        }
                      >
                        In progress
                      </button>
                      <button
                        className="rounded px-2 py-0.5 text-[11px] border disabled:opacity-40"
                        style={{ borderColor: 'var(--border)' }}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              apiFetch(`/api/inspections/actions/${a.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'DONE' }),
                              }),
                            'Marked done'
                          )
                        }
                      >
                        Done
                      </button>
                    </>
                  ) : null}
                  {perms.canDelete ? (
                    <button
                      className="text-secondary hover:text-red-500 disabled:opacity-40"
                      disabled={busy}
                      onClick={() =>
                        run(() => apiFetch(`/api/inspections/actions/${a.id}`, { method: 'DELETE' }), 'Action removed')
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="text-[13px] mt-1">{a.action_required}</div>
              <div className="text-[11px] text-secondary mt-1 flex flex-wrap gap-x-3">
                {a.responsible_party ? <span>Responsible: {a.responsible_party}</span> : null}
                <span style={{ color: overdue ? '#ef4444' : undefined }}>Due: {fmtDate(a.due_date)}</span>
                {a.completed_date ? <span>Completed: {fmtDate(a.completed_date)}</span> : null}
                {a.finding_description ? <span>Finding: {a.finding_description.slice(0, 60)}</span> : null}
              </div>
            </div>
          );
        })
      )}

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Add corrective action</div>
          <Field label="Action required">
            <textarea
              className={cn(inputCls, 'min-h-[56px] resize-y')}
              style={inputStyle}
              value={form.action_required}
              onChange={(e) => setForm((f) => ({ ...f, action_required: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Responsible party">
              <input
                className={inputCls}
                style={inputStyle}
                value={form.responsible_party}
                onChange={(e) => setForm((f) => ({ ...f, responsible_party: e.target.value }))}
              />
            </Field>
            <Field label="Due date">
              <input
                type="date"
                className={inputCls}
                style={inputStyle}
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </Field>
          </div>
          {data.findings.length ? (
            <Field label="Link to finding (optional)">
              <AppSelect
                compact
                value={form.finding_id}
                onChange={(v) => setForm((f) => ({ ...f, finding_id: v }))}
                options={data.findings.map((f) => ({ value: String(f.id), label: f.description.slice(0, 60) }))}
              />
            </Field>
          ) : null}
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.action_required.trim()}
              onClick={add}
            >
              <Plus size={13} className="inline mr-1" /> Add
            </button>
          </div>
          <span className="hidden">{ACTION_STATUSES.join(',')}</span>
        </div>
      ) : null}
    </div>
  );
}

function ReportsTab({ data, perms, busy, run }: { data: DetailPayload; perms: Perms; busy: boolean; run: RunFn }) {
  const id = data.inspection.id;
  const [form, setForm] = useState({ doc_kind: 'REPORT', file_name: '', storage_path: '' });

  const add = () =>
    run(async () => {
      await apiFetch(`/api/inspections/${id}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          doc_kind: form.doc_kind,
          file_name: form.file_name.trim(),
          storage_path: form.storage_path.trim(),
        }),
      });
      setForm({ doc_kind: 'REPORT', file_name: '', storage_path: '' });
    }, 'Document recorded');

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-secondary">
        File references (path or link) — this system stores document metadata, not the binary.
      </div>
      {data.documents.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} className="opacity-40" />}
          title="No documents"
          description="Attach inspection report and supporting document references."
        />
      ) : (
        <div className="rounded-xl border divide-y" style={{ borderColor: 'var(--border)' }}>
          {data.documents.map((d) => (
            <div key={d.id} className="p-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {d.doc_kind === 'REPORT' ? '📄 ' : '📎 '}
                  {d.file_name}
                </div>
                <div className="text-[11px] text-secondary truncate">{d.storage_path}</div>
              </div>
              {perms.canDelete ? (
                <button
                  className="text-secondary hover:text-red-500 disabled:opacity-40 shrink-0"
                  disabled={busy}
                  onClick={() =>
                    run(() => apiFetch(`/api/inspections/documents/${d.id}`, { method: 'DELETE' }), 'Document removed')
                  }
                >
                  <Trash2 size={13} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Add document reference</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kind">
              <AppSelect
                compact
                isClearable={false}
                value={form.doc_kind}
                onChange={(v) => setForm((f) => ({ ...f, doc_kind: v }))}
                options={[
                  { value: 'REPORT', label: 'Inspection Report' },
                  { value: 'SUPPORTING', label: 'Supporting Document' },
                ]}
              />
            </Field>
            <Field label="File name">
              <input
                className={inputCls}
                style={inputStyle}
                value={form.file_name}
                onChange={(e) => setForm((f) => ({ ...f, file_name: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Path / link">
            <input
              className={inputCls}
              style={inputStyle}
              value={form.storage_path}
              onChange={(e) => setForm((f) => ({ ...f, storage_path: e.target.value }))}
              placeholder="\\server\share\report.pdf or https://…"
            />
          </Field>
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.file_name.trim() || !form.storage_path.trim()}
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

function ActivityTab({ data }: { data: DetailPayload }) {
  if (data.activity.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={40} className="opacity-40" />}
        title="No activity"
        description="Inspection actions are logged here."
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
          <div className="text-[10px] text-secondary mt-0.5">{act.actor_name || act.actor_username || 'System'}</div>
        </li>
      ))}
    </ol>
  );
}

function NewInspection({
  meta,
  onClose,
  onCreated,
}: {
  meta: Meta;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [form, setForm] = useState({
    proponent_id: '',
    inspection_type_id: '',
    title: '',
    scheduled_date: '',
    assigned_inspector_id: '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const json = await apiFetch('/api/inspections', {
        method: 'POST',
        body: JSON.stringify({
          proponent_id: Number(form.proponent_id),
          inspection_type_id: form.inspection_type_id ? Number(form.inspection_type_id) : null,
          title: form.title.trim(),
          scheduled_date: form.scheduled_date || null,
          assigned_inspector_id: form.assigned_inspector_id ? Number(form.assigned_inspector_id) : null,
        }),
      });
      toast.success('Inspection scheduled');
      onCreated(json.data.inspection.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center px-3">
      <motion.div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 w-full max-w-md rounded-2xl border shadow-2xl p-4 flex flex-col gap-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold">New Inspection</div>
          <button className="text-[var(--text-muted)]" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <Field label="Proponent">
          <AppSelect
            compact
            placeholder="Select proponent…"
            value={form.proponent_id}
            onChange={(v) => setForm((f) => ({ ...f, proponent_id: v }))}
            options={meta.proponents.map((p) => ({ value: String(p.id), label: p.business_name }))}
          />
        </Field>
        <Field label="Inspection type">
          <AppSelect
            compact
            placeholder="Select type…"
            value={form.inspection_type_id}
            onChange={(v) => setForm((f) => ({ ...f, inspection_type_id: v }))}
            options={meta.types.map((t) => ({ value: String(t.id), label: t.name }))}
          />
        </Field>
        <Field label="Title">
          <input
            className={inputCls}
            style={inputStyle}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Annual Safety Inspection 2026"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Scheduled date">
            <input
              type="date"
              className={inputCls}
              style={inputStyle}
              value={form.scheduled_date}
              onChange={(e) => setForm((f) => ({ ...f, scheduled_date: e.target.value }))}
            />
          </Field>
          <Field label="Inspector (optional)">
            <AppSelect
              compact
              value={form.assigned_inspector_id}
              onChange={(v) => setForm((f) => ({ ...f, assigned_inspector_id: v }))}
              options={meta.inspectors.map((e) => ({ value: String(e.id), label: e.full_name || e.username }))}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            className="rounded-lg px-3 py-2 text-sm font-semibold border"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !form.proponent_id || !form.title.trim()}
            onClick={submit}
          >
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
