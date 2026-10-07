import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  Clock3,
  Coins,
  FileSignature,
  Loader2,
  Plus,
  RotateCcw,
  Stamp,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { AppSelect } from '../ui/AppSelect';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DatePicker, parseYmd, toYmd } from '../ui/DatePicker';
import { EmptyState } from '../ui/EmptyState';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { useLiveRefresh } from '../../lib/liveData';

const MENU_KEY = 'approval:queue';

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Awaiting Start',
  IN_PROGRESS: 'In Progress',
  APPROVED: 'Approved',
  DISAPPROVED: 'Disapproved',
  RETURNED: 'Returned',
};
// APPROVED excluded — approved applications are excluded from the queue
// entirely (see the `rows` filter), so it's never a meaningful filter choice.
const CHARGE_TYPES = ['RENTAL', 'PROCESSING_FEE', 'TAX', 'PENALTY', 'OTHER'];

type ApprovalRow = {
  /** Level 2 evaluator and when they submitted their review (Overview tab). */
  evaluator_name?: string | null;
  evaluator_username?: string | null;
  review_submitted_at?: string | null;
  review_summary?: string | null;
  application_id: number;
  application_no: string;
  application_type: string;
  application_type_name: string;
  is_renewal: number | boolean;
  application_status: string;
  proponent_name: string | null;
  approval_id: number | null;
  approval_status: string;
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
  issued_count: number;
};

type StepRow = {
  id: number;
  approval_id: number;
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

type DetailPayload = {
  approval: ApprovalRow;
  steps: StepRow[];
  current_step: StepRow | null;
  activity: ActivityRow[];
  status_history: StatusHistoryRow[];
  contract: ContractRow;
  documents: { id: number; file_name: string; original_file_name: string | null }[];
  charges: ChargeRow[];
};

type Approver = { id: number; full_name: string | null; username: string };

function peso(n: number | null | undefined) {
  const v = Number(n || 0);
  return `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const inputCls = 'app-input';

// The contract is recorded on the Approval tab itself (it must exist before
// Approve), so Level 1 never has to switch tabs to finish.
const TABS = ['Overview', 'Compliance', 'Approval', 'Charges', 'History'] as const;
type Tab = (typeof TABS)[number];

type RunFn = (fn: () => Promise<unknown>, successMsg?: string) => Promise<void>;

export function ApprovalDetail({
  applicationId,
  perms,
  onClose,
  onMutated,
}: {
  applicationId: number;
  perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean };
  onClose: () => void;
  onMutated: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('Approval');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const json = await apiFetch(`/api/approvals/${applicationId}`);
    setData(json.data);
  }, [applicationId]);
  useLiveRefresh(() => load().catch(() => {}));

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
          ) : tab === 'Approval' ? (
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Contract</div>
                <ContractTab data={data} canEdit={perms.canEdit} busy={busy} run={run} />
              </section>
              <section className="flex flex-col gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Decision</div>
                <ChainTab data={data} perms={perms} busy={busy} run={run} />
              </section>
            </div>
          ) : tab === 'Compliance' ? (
            <ComplianceReviewTab applicationId={data.approval.application_id} />
          ) : tab === 'Charges' ? (
            <ChargesTab data={data} perms={perms} busy={busy} run={run} />
          ) : (
            <HistoryTab data={data} />
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** Read-only look at the locator's requirements for Level 1 before deciding:
 * what's verified, what's still missing, and the files they uploaded. The
 * evaluator does the actual verify/reject on the Evaluation/Renewal Queue. */
type ComplianceRequirement = {
  id: number;
  requirement_id: number;
  requirement_code: string | null;
  requirement_name: string | null;
  status: string;
  remarks: string | null;
  is_mandatory?: number | boolean;
};
type ComplianceDocument = {
  id: number;
  file_name: string;
  original_file_name: string | null;
  requirement_id: number | null;
};

const REQ_STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  VERIFIED: { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' },
  REJECTED: { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' },
  PENDING: { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' },
};

function ComplianceReviewTab({ applicationId }: { applicationId: number }) {
  const [data, setData] = useState<{ requirements: ComplianceRequirement[]; documents: ComplianceDocument[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/assessments/${applicationId}`)
      .then((json) => {
        if (!cancelled) setData({ requirements: json.data?.requirements || [], documents: json.data?.documents || [] });
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (error) return <div className="text-[12px] text-secondary">{error}</div>;
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-secondary" />
      </div>
    );
  }

  const docsFor = (requirementId: number) => data.documents.filter((d) => Number(d.requirement_id) === Number(requirementId));
  const total = data.requirements.length;
  const verified = data.requirements.filter((r) => r.status === 'VERIFIED').length;
  const notUploaded = data.requirements.filter((r) => docsFor(r.requirement_id).length === 0).length;
  const rejected = data.requirements.filter((r) => r.status === 'REJECTED').length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <InfoCell label="Verified" value={`${verified}/${total}`} />
        <InfoCell label="Not uploaded" value={String(notUploaded)} />
        <InfoCell label="Rejected" value={String(rejected)} />
      </div>
      {notUploaded > 0 ? (
        <div
          className="rounded-lg border px-3 py-2 text-[12px]"
          style={{ borderColor: '#f59e0b55', backgroundColor: '#f59e0b1a', color: 'var(--text)' }}
        >
          The locator hasn't uploaded {notUploaded} requirement{notUploaded === 1 ? '' : 's'} yet.
        </div>
      ) : null}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
        {data.requirements.length === 0 ? (
          <div className="p-3 text-[12px] text-secondary">No requirements on this application.</div>
        ) : (
          data.requirements.map((r) => {
            const docs = docsFor(r.requirement_id);
            return (
              <div key={r.id} className="px-3 py-2.5 border-b last:border-b-0 flex flex-col gap-1" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                    {r.requirement_code ? `${r.requirement_code} · ` : ''}
                    {r.requirement_name || `Requirement #${r.id}`}
                    {Number(r.is_mandatory) ? <span className="text-secondary font-normal"> · Mandatory</span> : null}
                  </div>
                  <Badge label={r.status} styles={REQ_STATUS_STYLE[r.status] || REQ_STATUS_STYLE.PENDING} />
                </div>
                {docs.length ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {docs.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className="text-[11px] underline text-secondary hover:text-[var(--text)] cursor-pointer"
                        onClick={() => window.open(`/api/documents/${d.id}/download?view=1`, '_blank')}
                      >
                        {d.original_file_name || d.file_name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px]" style={{ color: '#f59e0b' }}>Not uploaded yet</div>
                )}
                {r.remarks ? <div className="text-[11px] text-secondary">Remarks: {r.remarks}</div> : null}
              </div>
            );
          })
        )}
      </div>
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
  // Reopen is requireRole("admin")-gated server-side — perms.canEdit (any
  // role with ordinary edit rights on approval:queue) isn't the same thing,
  // so gate the button on fullAccess (this app's existing "is admin" signal)
  // instead of showing it to everyone and having it 403.
  const { fullAccess: isAdminReopen } = useControlPanelAccess();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <InfoCell label="Evaluator" value={a.evaluator_name || a.evaluator_username || '—'} />
        <InfoCell label="Review submitted" value={a.review_submitted_at ? fmtDateTime(a.review_submitted_at) : '—'} />
        <InfoCell label="Application status" value={a.application_status} />
        <InfoCell label="Assessment" value={a.assessment_recommendation || '—'} />
        <InfoCell label="Charges assessed" value={peso(a.charges_total)} />
        <InfoCell label="Days in approval" value={a.days_in_approval == null ? '—' : String(a.days_in_approval)} />
        <InfoCell label="Decision" value={a.decision || '—'} />
      </div>

      {a.review_summary ? (
        <div className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="text-[10px] uppercase tracking-wider text-secondary mb-1">Evaluator's summary</div>
          <div className="whitespace-pre-wrap" style={{ color: 'var(--text)' }}>{a.review_summary}</div>
        </div>
      ) : null}

      {a.assessment_recommendation && a.assessment_recommendation !== 'ENDORSE' ? (
        <div
          className="rounded-lg border px-3 py-2 text-[12px]"
          style={{ borderColor: 'rgba(245,158,11,.38)', backgroundColor: 'rgba(245,158,11,.10)', color: '#f59e0b' }}
        >
          Assessment recommended <b>{a.assessment_recommendation}</b>, not ENDORSE. Confirm before routing this for approval.
        </div>
      ) : null}

      {settled && isAdminReopen ? (
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
  perms,
  busy,
  run,
}: {
  data: DetailPayload;
  perms: { canAdd: boolean; canEdit: boolean; canDelete: boolean };
  busy: boolean;
  run: RunFn;
}) {
  const current = data.current_step;
  const latest = data.steps.length ? data.steps[data.steps.length - 1] : null;
  // The contract comes first, for new applications and renewals alike (same rule on the server).
  const needsContract = !data.contract;
  const [remarks, setRemarks] = useState('');
  const [overridePrompt, setOverridePrompt] = useState<{ message: string; resolve: (v: boolean) => void } | null>(
    null
  );
  if (data.steps.length === 0) {
    // FOR_APPROVAL with zero steps means routing SHOULD have started
    // (Assessment already endorsed it) but didn't. The self-heal-on-view
    // retry (c_approvals.js's detail endpoint) keeps failing silently in
    // that case, so surface it as an actual problem with a manual retry
    // instead of the same "starts automatically" message a genuinely-not-
    // yet-endorsed application shows.
    const stuck = data.approval.application_status === 'FOR_APPROVAL';
    return (
      <EmptyState
        icon={<Stamp size={40} className="opacity-40" />}
        title={stuck ? 'Routing failed to start' : 'Not routed yet'}
        description={
          stuck
            ? 'This application reached the approval stage, but starting its approval failed. Try again — if it keeps failing, contact an admin.'
            : "This application hasn't reached the approval workflow yet — approval starts automatically once Assessment endorses it."
        }
        action={
          stuck && perms.canEdit ? (
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    apiFetch(`/api/approvals/${data.approval.application_id}/start`, {
                      method: 'POST',
                    }),
                  'Routing started'
                )
              }
            >
              Retry routing
            </button>
          ) : undefined
        }
      />
    );
  }

  // Resolved by the ConfirmModal below — lets `act()` `await` the officer's
  // click instead of blocking on the browser's native confirm().
  const confirmOverride = (message: string) =>
    new Promise<boolean>((resolve) => setOverridePrompt({ message, resolve }));

  const act = (action: string) => {
    if (!current) return;
    const stepId = current.id;
    const remarksValue = remarks.trim() || null;
    run(
      async () => {
        try {
          return await apiFetch(`/api/approvals/steps/${stepId}/act`, {
            method: 'PATCH',
            body: JSON.stringify({ action, remarks: remarksValue }),
          });
        } catch (err) {
          const message = (err as Error).message || '';
          // The one gate that's meant to be overridable, not just blocking —
          // ask the officer to confirm they really want to approve with
          // unverified mandatory requirements, then retry with the explicit
          // override flag instead of silently failing the click.
          if (action === 'APPROVE' && /mandatory requirement/i.test(message)) {
            const proceed = await confirmOverride(message);
            if (proceed) {
              return apiFetch(`/api/approvals/steps/${stepId}/act`, {
                method: 'PATCH',
                body: JSON.stringify({ action, remarks: remarksValue, override_unverified: true }),
              });
            }
          }
          throw err;
        }
      },
      `Application ${action.toLowerCase()}d`
    ).then(() => setRemarks(''));
  };

  return (
    <div className="flex flex-col gap-3">
      <ConfirmModal
        open={!!overridePrompt}
        title="Unverified requirements"
        description={overridePrompt?.message || ''}
        confirmText="Approve anyway"
        cancelText="Cancel"
        danger
        onConfirm={() => {
          overridePrompt?.resolve(true);
          setOverridePrompt(null);
        }}
        onCancel={() => {
          overridePrompt?.resolve(false);
          setOverridePrompt(null);
        }}
      />
      {/* Single-level approval: no step list. While it's pending only the
          decision form shows; once decided, the latest decision. */}
      {!current && latest ? (
        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold">Approval</div>
            <Badge label={latest.decision} styles={stepDecisionBadge(latest.decision)} />
          </div>
          {latest.assignee_name || latest.assignee_username ? (
            <div className="text-[11px] text-secondary mt-1">By: {latest.assignee_name || latest.assignee_username}</div>
          ) : null}
          {latest.remarks ? <div className="text-[12px] mt-1">{latest.remarks}</div> : null}
        </div>
      ) : null}

      {current && perms.canEdit ? (
        <div className="rounded-xl border p-3 flex flex-col gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <Field label="Remarks / basis">
            <textarea
              className={cn(inputCls, 'min-h-[64px] resize-y')}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="State the basis for this decision…"
            />
          </Field>

          {needsContract ? (
            <div
              className="rounded-lg border px-3 py-2 text-[12px]"
              style={{ borderColor: '#f59e0b55', backgroundColor: '#f59e0b1a', color: 'var(--text)' }}
            >
              Save the contract above first — Approve unlocks once it's saved.
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'rgba(16,185,129,.16)', color: '#10b981', border: '1px solid rgba(16,185,129,.38)' }}
              disabled={busy || needsContract}
              title={needsContract ? 'Record the contract on the Contract tab first' : undefined}
              onClick={() => act('APPROVE')}
            >
              <CheckCircle2 size={13} className="inline mr-1" /> Approve
            </button>
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'rgba(59,130,246,.14)', color: '#3b82f6', border: '1px solid rgba(59,130,246,.38)' }}
              disabled={busy}
              title="Undo For Approval — the review goes back to the evaluator (the locator isn't notified)"
              onClick={() =>
                run(
                  () =>
                    apiFetch(`/api/approvals/${data.approval.application_id}/return-to-level2`, {
                      method: 'POST',
                      body: JSON.stringify({ note: remarks.trim() || null }),
                    }),
                  'Returned to Evaluator'
                ).then(() => setRemarks(''))
              }
            >
              <RotateCcw size={13} className="inline mr-1" /> Return to Evaluator
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
        Assessed during Assessment Evaluation.
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
                value={form.rate_basis}
                onChange={(e) => setForm((f) => ({ ...f, rate_basis: e.target.value }))}
                placeholder="e.g. 5000 sqm @ 120/sqm/mo"
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              className={inputCls}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Quantity">
              <input
                className={inputCls}
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </Field>
            <Field label="Unit rate">
              <input
                className={inputCls}
                inputMode="decimal"
                value={form.unit_rate}
                onChange={(e) => setForm((f) => ({ ...f, unit_rate: e.target.value }))}
              />
            </Field>
            <Field label="Amount (override)">
              <input
                className={inputCls}
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
            <Field label="Industry Type">
              <input
                className={inputCls}
                style={{ opacity: 0.65, cursor: 'not-allowed' }}
                value={`${a.is_renewal ? 'Renewal' : 'New'} · ${a.application_type_name}`}
                disabled
                readOnly
              />
            </Field>
            <Field label="Contract no.">
              <input
                className={inputCls}
                style={{ opacity: 0.65, cursor: 'not-allowed' }}
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
              <DatePicker
                mode="single"
                bordered
                fullWidth
                placeholder="Select date"
                value={parseYmd(form.effective_start)}
                onChange={(d: Date | null) => setForm((f) => ({ ...f, effective_start: toYmd(d) }))}
              />
            </Field>
            <Field label="Effective end">
              <DatePicker
                mode="single"
                bordered
                fullWidth
                placeholder="Select date"
                value={parseYmd(form.effective_end)}
                onChange={(d: Date | null) => setForm((f) => ({ ...f, effective_end: toYmd(d) }))}
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
        <li key={m.key} className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border)' }}>
          <div className="flex justify-between">
            <span className="font-semibold">{m.title}</span>
            <span className="text-secondary">{fmtDateTime(m.when)}</span>
          </div>
          {m.detail ? <div className="text-secondary mt-0.5">{m.detail}</div> : null}
          <div className="text-[10px] text-secondary mt-0.5">{m.who}</div>
        </li>
      ))}
    </ol>
  );
}

