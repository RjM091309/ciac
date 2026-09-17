import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, ClipboardList, FileText, History, Loader2, MessageSquare, ScrollText, Send, Table2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';
import { getStatusBadgeStyles } from '../dashboard/statusBadge';
import { applicationTypeLabel } from '../../lib/applicationTypes';
import { clearLocatorSetupSkipAndReload } from '../../lib/locatorSetup';

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

type ApplicationRow = {
  id: number;
  application_no: string;
  application_type: string;
  is_renewal: boolean | number;
  status: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string | null;
  current_officer_id: number | null;
  requirements_total?: number;
  requirements_verified?: number;
};

type RequirementRow = {
  id: number;
  requirement_id: number;
  requirement_code: string | null;
  requirement_name: string | null;
  requirement_description: string | null;
  status: string;
  remarks: string | null;
  is_mandatory: number | boolean;
  acknowledged_at?: string | null;
  acknowledged_by?: number | null;
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

type DocumentRow = {
  id: number;
  file_name: string;
  original_file_name: string | null;
  storage_path: string;
  content_type: string | null;
  requirement_id: number | null;
  requirement_code: string | null;
  requirement_name: string | null;
  created_at: string | null;
  /** Upload order within this requirement — 1 for the first submission, 2+
   * for a reupload after a rejection, and so on. */
  version?: number | string | null;
};

type StatusHistoryRow = {
  id: number;
  from_status: string | null;
  to_status: string;
  remarks: string | null;
  changed_at: string;
};

type ContractRow = {
  id: number;
  contract_no: string;
  issue_date: string | null;
  effective_start: string | null;
  effective_end: string | null;
} | null;

type PermitRow = {
  id: number;
  permit_type: string;
  permit_no: string;
  issuing_authority: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  effective_status: string;
};

const PERMIT_TYPE_LABELS: Record<string, string> = {
  ENVIRONMENTAL: 'Environmental',
  FIRE: 'Fire Safety',
  OCCUPANCY: 'Occupancy',
  SANITARY: 'Sanitary',
  AUTHORITY_TO_OPERATE: 'Authority to Operate',
};

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusPill({ status }: { status: string }) {
  const b = getStatusBadgeStyles(status);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border"
      style={{ backgroundColor: b.bg, color: b.color, borderColor: b.border }}
    >
      {status}
    </span>
  );
}

const PRIMARY_BTN =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

// ---------- List ----------

// Locators no longer file their own applications here — Assessment Officer
// creates the application on their behalf (see ApplicationsWorkflow.tsx's
// New Application modal); a locator's only self-service actions are viewing
// their own applications and uploading documents against them.
function ApplicationsList({ navigate }: { navigate: Navigate }) {
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proponents/me/applications', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load applications');
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const needsProfileSetup = Boolean(error && /no proponent profile/i.test(error));

  return (
    <div>
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
        </div>
      ) : error ? (
        <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <EmptyState
            title="Couldn't load your applications"
            description={
              needsProfileSetup
                ? "You skipped the business profile setup — finish it to unlock the rest of the portal."
                : error
            }
            action={
              needsProfileSetup ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors cursor-pointer"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={clearLocatorSetupSkipAndReload}
                >
                  Complete your business profile
                </button>
              ) : undefined
            }
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <EmptyState
            title="No applications yet"
            description="Applications filed on your behalf will show up here — upload requirements once one appears."
          />
        </div>
      ) : (
        <div className="rounded-2xl p-0 sm:p-4 sm:p-5 sm:border sm:border-transparent sm:shadow-[0_1px_2px_0_rgb(0_0_0_/_0.05)] sm:bg-[var(--surface)]">
          {/* Mobile: card list — a <table> forces horizontal scrolling on narrow screens. */}
          <div className="sm:hidden space-y-2.5">
            {rows.map((app) => {
              const total = Number(app.requirements_total || 0);
              const verified = Number(app.requirements_verified || 0);
              const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
              return (
                <div
                  key={app.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/me/applications?applicationId=${app.id}`)}
                  className="rounded-xl border p-3 cursor-pointer active:brightness-95"
                  style={{
                    borderColor: 'var(--border-subtle)',
                    backgroundColor: 'var(--surface)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {app.application_no}
                    </span>
                    <StatusPill status={app.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-secondary">
                    <span className="truncate">
                      {applicationTypeLabel(app.application_type)} · {Number(app.is_renewal) ? 'Renewal' : 'New'}
                    </span>
                    <span className="shrink-0">{fmtDate(app.submitted_at || app.created_at)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--control-bg)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--text)' }} />
                    </div>
                    <span className="shrink-0 text-[10px] text-secondary">{verified}/{total} reqs</span>
                    <ChevronRight size={14} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tablet/desktop: table. */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Application No.', 'Type', 'Track', 'Status', 'Requirements', 'Filed', ''].map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((app) => {
                  const total = Number(app.requirements_total || 0);
                  const verified = Number(app.requirements_verified || 0);
                  const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
                  return (
                    <tr
                      key={app.id}
                      className="border-b last:border-b-0 cursor-pointer hover:bg-[var(--selected-bg)] transition-colors"
                      style={{ borderColor: 'var(--border-subtle)' }}
                      onClick={() => navigate(`/me/applications?applicationId=${app.id}`)}
                    >
                      <td className="px-3 py-2.5 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                        {app.application_no}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-secondary">{applicationTypeLabel(app.application_type)}</td>
                      <td className="px-3 py-2.5 text-[11px] text-secondary">{Number(app.is_renewal) ? 'Renewal' : 'New'}</td>
                      <td className="px-3 py-2.5 text-[11px]">
                        <StatusPill status={app.status} />
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-secondary w-44">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--control-bg)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--text)' }} />
                          </div>
                          <span className="shrink-0 text-[10px]">{verified}/{total}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-secondary">{fmtDate(app.submitted_at || app.created_at)}</td>
                      <td className="px-3 py-2.5 text-[11px] text-secondary text-right">View →</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Detail ----------

type DetailData = {
  application: ApplicationRow;
  requirements: RequirementRow[];
  documents: DocumentRow[];
  history: StatusHistoryRow[];
  contract: ContractRow;
  permits: PermitRow[];
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: Table2 },
  { id: 'requirements', label: 'Requirements', icon: ClipboardList },
  { id: 'history', label: 'History', icon: History },
  { id: 'contract', label: 'Contract', icon: ScrollText },
] as const;

type TabId = (typeof TABS)[number]['id'];

function Card({
  children,
  mobileFlat,
}: {
  children: React.ReactNode;
  /** Skip the card chrome on mobile — for tabs whose content is already a
   * list of individually-boxed cards there, so it doesn't nest card-in-card. */
  mobileFlat?: boolean;
}) {
  if (mobileFlat) {
    return (
      <div className="rounded-2xl p-0 sm:p-4 sm:p-5 sm:border sm:border-transparent sm:shadow-[0_1px_2px_0_rgb(0_0_0_/_0.05)] sm:bg-[var(--surface)]">
        {children}
      </div>
    );
  }
  return (
    <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-secondary">{label}</span>
      <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function ApplicationDetail({
  applicationId,
  navigate,
  focusRequirementId,
}: {
  applicationId: number;
  navigate: Navigate;
  focusRequirementId?: number | null;
}) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [uploading, setUploading] = useState(false);
  const [uploadRequirementId, setUploadRequirementId] = useState('');
  const [busy, setBusy] = useState<'submit' | null>(null);
  const [threadRequirement, setThreadRequirement] = useState<RequirementRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = `/api/proponents/me/applications/${applicationId}`;
      const [aRes, rRes, dRes, hRes, cRes, pRes] = await Promise.all([
        fetch(base, { credentials: 'include' }),
        fetch(`${base}/requirements`, { credentials: 'include' }),
        fetch(`${base}/documents`, { credentials: 'include' }),
        fetch(`${base}/status-history`, { credentials: 'include' }),
        fetch(`${base}/contract`, { credentials: 'include' }),
        fetch(`${base}/permits`, { credentials: 'include' }),
      ]);
      const aJson = await aRes.json().catch(() => ({}));
      if (!aRes.ok) throw new Error(aJson?.message || 'Application not found');
      const [rJson, dJson, hJson, cJson, pJson] = await Promise.all([rRes.json(), dRes.json(), hRes.json(), cRes.json(), pRes.json()]);
      setData({
        application: aJson.data,
        requirements: Array.isArray(rJson.data) ? rJson.data : [],
        documents: Array.isArray(dJson.data) ? dJson.data : [],
        history: Array.isArray(hJson.data) ? hJson.data : [],
        contract: cJson.data || null,
        permits: Array.isArray(pJson.data) ? pJson.data : [],
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to load application');
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    load();
  }, [load]);

  // Deep-link from a notification: jump straight to the Requirements tab
  // and open that row's thread instead of leaving the locator to hunt for
  // which one it was about.
  useEffect(() => {
    if (!focusRequirementId || !data) return;
    const target = data.requirements.find((r) => r.id === focusRequirementId);
    if (target) {
      setTab('requirements');
      setThreadRequirement(target);
    }
    // Only run once per (applicationId, focusRequirementId) landing — the
    // effect deliberately excludes `data` from deps beyond this initial run
    // so re-fetches (e.g. after acknowledging) don't reopen the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequirementId, Boolean(data)]);

  // After an upload, the requirement it's attached to (and the application's
  // overall progress count on the Overview tab) can change status server-side
  // too — refetch all three in place instead of just documents, so the page
  // reflects it immediately without the user needing to hit refresh, and
  // without the full-page `load()` spinner (no setLoading(true) here).
  const reloadAfterUpload = useCallback(async () => {
    try {
      const base = `/api/proponents/me/applications/${applicationId}`;
      const [aRes, rRes, dRes] = await Promise.all([
        fetch(base, { credentials: 'include' }),
        fetch(`${base}/requirements`, { credentials: 'include' }),
        fetch(`${base}/documents`, { credentials: 'include' }),
      ]);
      const [aJson, rJson, dJson] = await Promise.all([aRes.json().catch(() => ({})), rRes.json().catch(() => ({})), dRes.json().catch(() => ({}))]);
      setData((prev) =>
        prev
          ? {
              ...prev,
              application: aRes.ok ? aJson.data : prev.application,
              requirements: rRes.ok && Array.isArray(rJson.data) ? rJson.data : prev.requirements,
              documents: dRes.ok && Array.isArray(dJson.data) ? dJson.data : prev.documents,
            }
          : prev
      );
    } catch {
      /* non-critical */
    }
  }, [applicationId]);

  async function uploadDoc(file: File) {
    if (!uploadRequirementId) {
      toast.error('Select which requirement this document is for first.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files are allowed.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('requirement_id', uploadRequirementId);

    async function attempt() {
      const res = await fetch(`/api/proponents/me/applications/${applicationId}/documents`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Upload failed');
    }

    try {
      try {
        await attempt();
      } catch (e: any) {
        // A raw "Failed to fetch" means the request never got a response
        // (dropped connection, dev-server reload mid-upload) rather than a
        // real rejection from the server — worth one silent retry before
        // bothering the user with it.
        if (e?.message !== 'Failed to fetch') throw e;
        await new Promise((r) => setTimeout(r, 1200));
        await attempt();
      }
      toast.success('Document uploaded.');
      setUploadRequirementId('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await reloadAfterUpload();
    } catch (e: any) {
      const message =
        e?.message === 'Failed to fetch'
          ? "Couldn't reach the server — check your connection and try again."
          : e?.message || 'Upload failed';
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  async function submitApplication() {
    setBusy('submit');
    try {
      const res = await fetch(`/api/applications/${applicationId}/submit`, {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Submission failed');
      toast.success('Application submitted.');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Submission failed');
    } finally {
      setBusy(null);
    }
  }

  const backButton = (
    <button
      onClick={() => navigate('/me/applications')}
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-secondary hover:text-[var(--text)] transition-colors cursor-pointer mb-3"
    >
      <ArrowLeft size={14} /> All applications
    </button>
  );

  if (loading) {
    return (
      <div>
        {backButton}
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        {backButton}
        <Card>
          <EmptyState title="Couldn't load this application" description={error || 'Not found.'} />
        </Card>
      </div>
    );
  }

  const { application: app, requirements, documents, history, contract, permits } = data;

  // History tab: status changes and document uploads merged into one
  // chronological trail (both already come back newest-first) instead of
  // requiring the locator to cross-reference two separate tabs.
  type TimelineEntry =
    | { kind: 'status'; id: string; at: string; from_status: string | null; to_status: string; remarks: string | null }
    | { kind: 'document'; id: string; at: string; docId: number; file_name: string; requirement_code: string | null; requirement_name: string | null; version: number | null };
  const timeline: TimelineEntry[] = [
    ...history.map((h): TimelineEntry => ({
      kind: 'status',
      id: `s-${h.id}`,
      at: h.changed_at,
      from_status: h.from_status,
      to_status: h.to_status,
      remarks: h.remarks,
    })),
    ...documents.map((d): TimelineEntry => ({
      kind: 'document',
      id: `d-${d.id}`,
      at: d.created_at || '',
      docId: d.id,
      file_name: d.original_file_name || d.file_name,
      requirement_code: d.requirement_code,
      requirement_name: d.requirement_name,
      version: d.version != null ? Number(d.version) : null,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const status = String(app.status || '').toUpperCase();
  const isDraft = status === 'DRAFT';
  const isReturned = status === 'RETURNED';
  const reqTotal = requirements.length;
  const reqVerified = requirements.filter((r) => String(r.status).toUpperCase() === 'VERIFIED').length;
  const reqPct = reqTotal > 0 ? Math.round((reqVerified / reqTotal) * 100) : 0;
  const mandatoryMissing = requirements.filter(
    (r) => Number(r.is_mandatory) && !documents.some((d) => Number(d.requirement_id) === Number(r.requirement_id)),
  ).length;

  return (
    <div className="space-y-4">
      {backButton}

      <div
        className="rounded-2xl px-4 py-4 sm:px-5 sm:py-5 !border-transparent flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{
          backgroundColor: 'var(--surface)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
        }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold tracking-tight truncate" style={{ color: 'var(--text)' }}>
              {app.application_no}
            </h3>
            <StatusPill status={app.status} />
          </div>
          <p className="text-xs text-secondary">
            {applicationTypeLabel(app.application_type)} · {Number(app.is_renewal) ? 'Renewal' : 'New'} ·{' '}
            {isDraft ? `created ${fmtDate(app.created_at)}` : `filed ${fmtDate(app.submitted_at || app.created_at)}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-secondary">Requirements</div>
          <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>{reqVerified}/{reqTotal} verified ({reqPct}%)</div>
        </div>
      </div>

      {(isDraft || isReturned) && (
        <div
          className="rounded-xl px-4 py-3.5 border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--surface) 92%, transparent)',
            borderColor: getStatusBadgeStyles(app.status).border,
          }}
        >
          <div className="min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              {isDraft ? 'Draft — not yet submitted' : 'Returned — changes requested'}
            </p>
            <p className="text-[11px] text-secondary mt-0.5">
              {mandatoryMissing > 0
                ? `Upload the required document${mandatoryMissing === 1 ? '' : 's'} for ${mandatoryMissing} mandatory requirement${mandatoryMissing === 1 ? '' : 's'} before ${isDraft ? 'submitting' : 'resubmitting'}.`
                : isDraft
                  ? 'All mandatory documents are attached. You can submit this application.'
                  : 'Address the remarks in the History tab, then resubmit.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className={PRIMARY_BTN}
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy !== null}
              onClick={submitApplication}
            >
              {busy === 'submit' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {isDraft ? 'Submit application' : 'Resubmit'}
            </button>
          </div>
        </div>
      )}

      <div
        className="flex items-center gap-1 rounded-full p-1 w-full"
        style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 82%, transparent)' }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[11px] font-semibold cursor-pointer transition-colors"
              style={{
                backgroundColor: active ? 'var(--nav-active-bg)' : 'transparent',
                color: active ? 'var(--nav-active-text)' : 'var(--text-muted)',
              }}
            >
              <Icon size={13} className="shrink-0" /> <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:gap-5">
            <Info label="Application No." value={app.application_no} />
            <Info label="Type" value={applicationTypeLabel(app.application_type)} />
            <Info label="Track" value={Number(app.is_renewal) ? 'Renewal' : 'New'} />
            <Info label="Status" value={<StatusPill status={app.status} />} />
            <Info label="Submitted" value={isDraft ? 'Not yet submitted' : fmtDate(app.submitted_at || app.created_at)} />
            <Info label="Last Updated" value={fmtDate(app.updated_at)} />
          </div>
        </Card>
      )}

      {tab === 'requirements' && (
        <Card mobileFlat>
          {/* Triggered by each row's Upload/Reupload button, which sets uploadRequirementId first. */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadDoc(f);
            }}
          />
          <p className="text-[10px] text-secondary mb-3">
            PDF only · up to 10 MB. Use Upload/Reupload on a row below.
          </p>

          {requirements.length === 0 ? (
            <EmptyState title="No requirements" description="No requirement checklist has been attached to this application yet." />
          ) : (
            <>
              {/* Mobile: card list — a 6-column <table> forces horizontal scrolling on narrow screens. */}
              <div className="sm:hidden space-y-2.5">
                {requirements.map((r) => {
                  const doc = documents.find((d) => d.requirement_id === r.requirement_id);
                  return (
                    <div
                      key={r.id}
                      className="rounded-xl border p-3"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        backgroundColor: 'var(--surface)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                            {r.requirement_code ? `${r.requirement_code} — ` : ''}{r.requirement_name || 'Requirement'}
                          </div>
                          {r.requirement_description ? (
                            <div className="text-[11px] text-secondary mt-0.5">{r.requirement_description}</div>
                          ) : null}
                        </div>
                        <StatusPill status={r.status} />
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-secondary">
                        <span>{Number(r.is_mandatory) ? 'Mandatory' : 'Optional'}</span>
                        {doc ? (
                          <span className="truncate max-w-[60%]" title={doc.original_file_name || doc.file_name}>
                            {doc.original_file_name || doc.file_name}
                            {Number(doc.version) > 1 ? ` (v${Number(doc.version)})` : ''}
                          </span>
                        ) : (
                          <span className="opacity-60">Not uploaded</span>
                        )}
                      </div>

                      {r.remarks ? (
                        <div className="mt-1.5 text-[11px] text-secondary">
                          <span className="font-semibold" style={{ color: 'var(--text)' }}>Remarks:</span> {r.remarks}
                        </div>
                      ) : null}

                      <div className="mt-2.5 flex items-center gap-2 pt-2.5 border-t flex-wrap" style={{ borderColor: 'var(--border-subtle)' }}>
                        {doc ? (
                          <button
                            onClick={() => window.open(`/api/documents/${doc.id}/download?view=1`, '_blank')}
                            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border"
                            style={{ color: 'var(--text)', borderColor: 'var(--border-subtle)' }}
                          >
                            <FileText size={13} /> View
                          </button>
                        ) : null}
                        {r.status !== 'VERIFIED' ? (
                          <button
                            onClick={() => {
                              setUploadRequirementId(String(r.requirement_id));
                              fileInputRef.current?.click();
                            }}
                            disabled={uploading}
                            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border"
                            style={{ color: 'var(--nav-active-bg)', borderColor: 'var(--border-subtle)' }}
                          >
                            <Upload size={13} /> {doc ? 'Reupload' : 'Upload'}
                          </button>
                        ) : null}
                        <button
                          onClick={() => setThreadRequirement(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border"
                          style={{ color: 'var(--text)', borderColor: 'var(--border-subtle)' }}
                        >
                          <MessageSquare size={13} /> Discuss
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tablet/desktop: table. */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr>
                      {['Requirement', 'Mandatory', 'Status', 'Document', 'Remarks', 'Actions'].map((c) => (
                        <th key={c} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {requirements.map((r) => {
                      // Most recent first (documents ordered DESC by id) — after a
                      // reject-and-reupload, this is the latest file for the row.
                      const doc = documents.find((d) => d.requirement_id === r.requirement_id);
                      return (
                        <tr key={r.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                          <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                            <span className="font-semibold">{r.requirement_code ? `${r.requirement_code} — ` : ''}{r.requirement_name || 'Requirement'}</span>
                            {r.requirement_description ? <div className="text-secondary mt-0.5">{r.requirement_description}</div> : null}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-secondary">{Number(r.is_mandatory) ? 'Yes' : 'No'}</td>
                          <td className="px-3 py-2 text-[11px]"><StatusPill status={r.status} /></td>
                          <td className="px-3 py-2 text-[11px] text-secondary max-w-[180px]">
                            {doc ? (
                              <>
                                <span className="block truncate" title={doc.original_file_name || doc.file_name}>
                                  {doc.original_file_name || doc.file_name}
                                </span>
                                {Number(doc.version) > 1 ? (
                                  <span className="block text-[10px] opacity-70">
                                    V{Number(doc.version)} — reuploaded after rejection
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="opacity-60">Not uploaded</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-secondary">{r.remarks || '—'}</td>
                          <td className="px-3 py-2 text-[11px]">
                            <div className="flex items-center gap-2.5 whitespace-nowrap">
                              {doc ? (
                                <button
                                  onClick={() => window.open(`/api/documents/${doc.id}/download?view=1`, '_blank')}
                                  className="cursor-pointer"
                                  style={{ color: 'var(--text)' }}
                                  title="View submitted PDF"
                                  aria-label="View submitted PDF"
                                >
                                  <FileText size={14} />
                                </button>
                              ) : null}
                              {r.status !== 'VERIFIED' ? (
                                <button
                                  onClick={() => {
                                    setUploadRequirementId(String(r.requirement_id));
                                    fileInputRef.current?.click();
                                  }}
                                  disabled={uploading}
                                  className="cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                  style={{ color: 'var(--nav-active-bg)' }}
                                  title={doc ? 'Reupload document' : 'Upload document'}
                                  aria-label={doc ? 'Reupload document' : 'Upload document'}
                                >
                                  <Upload size={14} />
                                </button>
                              ) : null}
                              <button
                                onClick={() => setThreadRequirement(r)}
                                className="cursor-pointer"
                                style={{ color: 'var(--text)' }}
                                title="Discuss this requirement"
                                aria-label="Discuss this requirement"
                              >
                                <MessageSquare size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          {timeline.length === 0 ? (
            <EmptyState title="No history" description="No status changes or document uploads have been recorded for this application yet." />
          ) : (
            <ol className="relative border-l ml-2" style={{ borderColor: 'var(--border-subtle)' }}>
              {timeline.map((entry) =>
                entry.kind === 'status' ? (
                  <li key={entry.id} className="ml-4 pb-4 last:pb-0">
                    <span
                      className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: getStatusBadgeStyles(entry.to_status).color }}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      {entry.from_status ? <span className="text-[11px] text-secondary">{entry.from_status} →</span> : null}
                      <StatusPill status={entry.to_status} />
                      <span className="text-[10px] text-secondary">{fmtDateTime(entry.at)}</span>
                    </div>
                    {entry.remarks ? <div className="text-[11px] text-secondary mt-1">{entry.remarks}</div> : null}
                  </li>
                ) : (
                  <li key={entry.id} className="ml-4 pb-4 last:pb-0">
                    <span
                      className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: 'var(--text-muted)' }}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        <Upload size={10} /> Document uploaded{entry.version && entry.version > 1 ? ` (V${entry.version})` : ''}
                      </span>
                      <span className="text-[10px] text-secondary">{fmtDateTime(entry.at)}</span>
                    </div>
                    <button
                      onClick={() => window.open(`/api/documents/${entry.docId}/download?view=1`, '_blank')}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold mt-1 cursor-pointer hover:underline"
                      style={{ color: 'var(--text)' }}
                    >
                      <FileText size={12} />
                      {entry.file_name}
                      {(entry.requirement_code || entry.requirement_name) ? (
                        <span className="text-secondary font-normal">
                          · {entry.requirement_code || entry.requirement_name}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              )}
            </ol>
          )}
        </Card>
      )}

      {tab === 'contract' && (
        <div className="space-y-4">
          <Card>
            <h4 className="text-sm font-bold mb-4" style={{ color: 'var(--text)' }}>Contract</h4>
            {!contract ? (
              <EmptyState title="No contract yet" description="No executed contract has been recorded for this application." />
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:gap-5">
                <Info label="Contract No." value={contract.contract_no} />
                <Info label="Issue Date" value={fmtDate(contract.issue_date)} />
                <Info label="Effective Start" value={fmtDate(contract.effective_start)} />
                <Info label="Effective End" value={fmtDate(contract.effective_end)} />
              </div>
            )}
          </Card>
          <Card mobileFlat>
            <h4 className="text-sm font-bold mb-4" style={{ color: 'var(--text)' }}>Permits</h4>
            {permits.length === 0 ? (
              <EmptyState title="No permits" description="No permits are linked to this application yet." />
            ) : (
              <>
                {/* Mobile: card list — a <table> forces horizontal scrolling on narrow screens. */}
                <div className="sm:hidden space-y-2.5">
                  {permits.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-xl border p-3"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        backgroundColor: 'var(--surface)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                          {PERMIT_TYPE_LABELS[p.permit_type] || p.permit_type}
                        </span>
                        <StatusPill status={p.effective_status} />
                      </div>
                      <div className="mt-1 text-[11px] text-secondary">{p.permit_no}</div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-secondary">
                        <span className="truncate">{p.issuing_authority || '—'}</span>
                        <span className="shrink-0">Expires {fmtDate(p.expiry_date)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tablet/desktop: table. */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead>
                      <tr>
                        {['Type', 'Permit No.', 'Authority', 'Expiry', 'Status'].map((c) => (
                          <th key={c} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {permits.map((p) => (
                        <tr key={p.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                          <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{PERMIT_TYPE_LABELS[p.permit_type] || p.permit_type}</td>
                          <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{p.permit_no}</td>
                          <td className="px-3 py-2 text-[11px] text-secondary">{p.issuing_authority || '—'}</td>
                          <td className="px-3 py-2 text-[11px] text-secondary">{fmtDate(p.expiry_date)}</td>
                          <td className="px-3 py-2 text-[11px]"><StatusPill status={p.effective_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {threadRequirement ? (
        <RequirementThreadModal
          requirement={threadRequirement}
          onClose={() => setThreadRequirement(null)}
          onAcknowledged={(updated) => {
            setData((prev) =>
              prev
                ? { ...prev, requirements: prev.requirements.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) }
                : prev
            );
            setThreadRequirement((prev) => (prev ? { ...prev, ...updated } : prev));
          }}
        />
      ) : null}
    </div>
  );
}

/** Per-requirement reply thread + "mark as addressed" — the only in-system
 * two-way channel between a Locator and staff (previously a Locator could
 * only ever receive a one-line `remarks` string, never respond to it). */
function RequirementThreadModal({
  requirement,
  onClose,
  onAcknowledged,
}: {
  requirement: RequirementRow;
  onClose: () => void;
  onAcknowledged: (updated: RequirementRow) => void;
}) {
  const [comments, setComments] = useState<RequirementComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [acking, setAcking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/applications/requirements/${requirement.id}/comments`, { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      setComments(res.ok && Array.isArray(json.data) ? json.data : []);
    } catch {
      setComments([]);
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
      const res = await fetch(`/api/applications/requirements/${requirement.id}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to send reply');
      setComments(Array.isArray(json.data) ? json.data : []);
      setMessage('');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  }

  async function acknowledge() {
    if (acking) return;
    setAcking(true);
    try {
      const res = await fetch(`/api/applications/requirements/${requirement.id}/acknowledge`, {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to acknowledge');
      onAcknowledged(json.data);
      toast.success('Marked as addressed');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to acknowledge');
    } finally {
      setAcking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl flex flex-col max-h-[85vh]"
        style={{ backgroundColor: 'var(--surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-secondary">Requirement thread</div>
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
              {requirement.requirement_code ? `${requirement.requirement_code} — ` : ''}{requirement.requirement_name || 'Requirement'}
            </div>
          </div>
          <button onClick={onClose} className="cursor-pointer shrink-0" style={{ color: 'var(--text-muted)' }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {requirement.remarks ? (
            <div className="text-[11px] rounded-lg p-2.5" style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)' }}>
              <span className="font-semibold" style={{ color: 'var(--text)' }}>Latest remarks:</span> {requirement.remarks}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center py-6 text-secondary text-xs gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : comments.length === 0 ? (
            <div className="text-[11px] text-secondary text-center py-4">No replies yet. Say something below.</div>
          ) : (
            comments.map((c) => {
              const isMine = String(c.author_role || '').toLowerCase() === 'proponent';
              return (
                <div key={c.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] rounded-xl px-3 py-2"
                    style={{
                      backgroundColor: isMine ? 'var(--nav-active-bg)' : 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
                      color: isMine ? 'var(--nav-active-text)' : 'var(--text)',
                    }}
                  >
                    <div className="text-[10px] opacity-70 mb-0.5">{isMine ? 'You' : c.author_name || 'Staff'}</div>
                    <div className="text-[12px] whitespace-pre-wrap">{c.message}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
          {requirement.status === 'REJECTED' ? (
            <button
              onClick={acknowledge}
              disabled={acking || Boolean(requirement.acknowledged_at)}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer border disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ color: 'var(--text)', borderColor: 'var(--border-subtle)' }}
            >
              <CheckCircle2 size={13} />
              {requirement.acknowledged_at ? 'Marked as addressed' : acking ? 'Marking…' : 'Mark as addressed'}
            </button>
          ) : null}
          <div className="flex items-center gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendReply();
              }}
              placeholder="Type a reply…"
              className="flex-1 rounded-lg border px-3 py-2 text-[12px] bg-transparent outline-none"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
            />
            <button
              onClick={sendReply}
              disabled={sending || !message.trim()}
              className="inline-flex items-center justify-center rounded-lg p-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              aria-label="Send reply"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Entry ----------

export function ProponentApplications({ locationSearch, navigate }: { locationSearch: string; navigate: Navigate }) {
  const applicationId = useMemo(() => {
    const raw = new URLSearchParams(locationSearch || '').get('applicationId');
    const n = Number(raw);
    return raw && Number.isFinite(n) ? n : null;
  }, [locationSearch]);

  // A "your requirement was rejected/replied to" notification deep-links
  // here with &requirementId=... so the exact row opens pre-focused instead
  // of dumping the user on the application's Overview tab to go hunting.
  const focusRequirementId = useMemo(() => {
    const raw = new URLSearchParams(locationSearch || '').get('requirementId');
    const n = Number(raw);
    return raw && Number.isFinite(n) ? n : null;
  }, [locationSearch]);

  return applicationId ? (
    <ApplicationDetail applicationId={applicationId} navigate={navigate} focusRequirementId={focusRequirementId} />
  ) : (
    <ApplicationsList navigate={navigate} />
  );
}
