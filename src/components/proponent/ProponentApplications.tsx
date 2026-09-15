import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, FileText, History, Loader2, Pencil, Plus, ScrollText, Send, Table2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';
import { SidePanel } from '../ui/SidePanel';
import { AppSelect } from '../ui/AppSelect';
import { ConfirmModal } from '../ui/ConfirmModal';
import { getStatusBadgeStyles } from '../dashboard/statusBadge';
import { APPLICATION_TYPES, applicationTypeLabel } from '../../lib/applicationTypes';
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
const GHOST_BTN =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold border cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

// ---------- Filing / editing form ----------

function ApplicationForm({
  mode,
  initial,
  saving,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: { application_type: string; is_renewal: boolean };
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: { application_type: string; is_renewal: boolean }) => void;
}) {
  const [applicationType, setApplicationType] = useState(initial?.application_type || APPLICATION_TYPES[0]);
  const [isRenewal, setIsRenewal] = useState(Boolean(initial?.is_renewal));
  const [typeOptions, setTypeOptions] = useState<{ code: string; name: string }[]>(
    APPLICATION_TYPES.map((t) => ({ code: t, name: applicationTypeLabel(t) }))
  );

  useEffect(() => {
    let cancelled = false;
    fetch('/api/application-types', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !Array.isArray(json?.data)) return;
        const active = json.data
          .filter((t: any) => Number(t?.is_active) === 1)
          .map((t: any) => ({ code: String(t.code), name: String(t.name) }));
        if (active.length) setTypeOptions(active);
      })
      .catch(() => {
        // Fetch failed — the static seed list above stays as the fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SidePanel
      open
      title={mode === 'create' ? 'New Application' : 'Edit draft details'}
      subtitle={
        mode === 'create'
          ? 'Saved as a draft — a reference number is issued right away. Upload documents and submit from the next screen.'
          : 'Only unsubmitted drafts can be edited.'
      }
      saving={saving}
      saveLabel={mode === 'create' ? 'Create draft' : 'Save changes'}
      widthClassName="max-w-[28rem]"
      onClose={onCancel}
      onSave={() => onSubmit({ application_type: applicationType, is_renewal: isRenewal })}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-widest text-secondary">Application type</label>
          <AppSelect
            options={typeOptions.map((t) => ({ value: t.code, label: t.name }))}
            value={applicationType}
            onChange={(value) => setApplicationType(value)}
            placeholder="Select application type..."
            isDisabled={saving}
            isClearable={false}
          />
        </div>

        <label
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer"
          style={{ borderColor: 'var(--input-border)' }}
        >
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={isRenewal}
            disabled={saving}
            onChange={(e) => setIsRenewal(e.target.checked)}
          />
          <span style={{ color: 'var(--text)' }}>This is a renewal of an existing lease</span>
        </label>

        {mode === 'edit' ? (
          <p className="text-[11px] text-secondary">
            Switching between New and Renewal rebuilds the requirement checklist, so it's blocked once you've uploaded a
            document.
          </p>
        ) : null}
      </div>
    </SidePanel>
  );
}

// ---------- List ----------

function ApplicationsList({ navigate }: { navigate: Navigate }) {
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

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

  async function createDraft(values: { application_type: string; is_renewal: boolean }) {
    setSaving(true);
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...values, save_as_draft: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to create application');
      const id = json?.data?.id;
      toast.success(`Draft ${json?.data?.application_no || ''} created`);
      setCreating(false);
      if (id) navigate(`/me/applications?applicationId=${id}`);
      else load();
    } catch (e: any) {
      const message = e?.message || 'Failed to create application';
      if (/complete your business profile/i.test(message)) {
        toast.error(message, {
          action: { label: 'Complete profile', onClick: clearLocatorSetupSkipAndReload },
          duration: 10000,
        });
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <div className="flex items-center justify-end gap-3 mb-4">
      <button
        className={PRIMARY_BTN}
        style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
        onClick={() => setCreating(true)}
      >
        <Plus size={14} /> New Application
      </button>
    </div>
  );

  return (
    <div>
      {header}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
        </div>
      ) : error ? (
        <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <EmptyState
            title="Couldn't load your applications"
            description={
              /no proponent profile/i.test(error)
                ? "You skipped the business profile setup — finish it to unlock the rest of the portal."
                : error
            }
            action={
              /no proponent profile/i.test(error) ? (
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
            description="Click “New Application” to file your first lease application."
          />
        </div>
      ) : (
        <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="overflow-x-auto">
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
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--nav-active-bg)' }} />
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

      {creating ? (
        <ApplicationForm mode="create" saving={saving} onCancel={() => setCreating(false)} onSubmit={createDraft} />
      ) : null}
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
  { id: 'contract', label: 'Contract & Permits', icon: ScrollText },
] as const;

type TabId = (typeof TABS)[number]['id'];

function Card({ children }: { children: React.ReactNode }) {
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

function ApplicationDetail({ applicationId, navigate }: { applicationId: number; navigate: Navigate }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [uploading, setUploading] = useState(false);
  const [uploadRequirementId, setUploadRequirementId] = useState('');
  const [busy, setBusy] = useState<'submit' | 'delete' | 'edit' | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  async function saveDraftEdit(values: { application_type: string; is_renewal: boolean }) {
    setBusy('edit');
    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Update failed');
      toast.success('Draft updated.');
      setEditing(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  async function deleteDraft() {
    setBusy('delete');
    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Delete failed');
      toast.success('Draft deleted.');
      navigate('/me/applications');
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed');
      setBusy(null);
      setConfirmDelete(false);
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
            {isDraft ? (
              <>
                <button className={GHOST_BTN} style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }} disabled={busy !== null} onClick={() => setEditing(true)}>
                  <Pencil size={13} /> Edit
                </button>
                <button className={GHOST_BTN} style={{ borderColor: 'var(--border-subtle)', color: '#ef4444' }} disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={13} /> Delete
                </button>
              </>
            ) : null}
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
        className="inline-flex items-center gap-1 rounded-full p-1 overflow-x-auto max-w-full"
        style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 82%, transparent)' }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold cursor-pointer transition-colors whitespace-nowrap"
              style={{
                backgroundColor: active ? 'var(--nav-active-bg)' : 'transparent',
                color: active ? 'var(--nav-active-text)' : 'var(--text-muted)',
              }}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
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
        <Card>
          <div
            className="rounded-lg border border-dashed p-4 mb-4 flex flex-col sm:flex-row sm:items-end gap-3"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex-1 space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-secondary">
                Attach to requirement
              </label>
              <AppSelect
                options={requirements.map((r) => ({
                  value: String(r.requirement_id),
                  label: `${r.requirement_code ? `${r.requirement_code} — ` : ''}${r.requirement_name || 'Requirement'}`,
                }))}
                value={uploadRequirementId}
                onChange={setUploadRequirementId}
                placeholder="Select a requirement…"
                isDisabled={uploading}
                isClearable
              />
            </div>
            <div>
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
              <button
                onClick={() => {
                  if (!uploadRequirementId) {
                    toast.error('Select which requirement this document is for first.');
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? 'Uploading…' : 'Upload document'}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-secondary mb-3">
            PDF only · up to 10 MB. Select a requirement above, or use Reupload on a row below.
          </p>

          {requirements.length === 0 ? (
            <EmptyState title="No requirements" description="No requirement checklist has been attached to this application yet." />
          ) : (
            <div className="overflow-x-auto">
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
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                <Info label="Contract No." value={contract.contract_no} />
                <Info label="Issue Date" value={fmtDate(contract.issue_date)} />
                <Info label="Effective Start" value={fmtDate(contract.effective_start)} />
                <Info label="Effective End" value={fmtDate(contract.effective_end)} />
              </div>
            )}
          </Card>
          <Card>
            <h4 className="text-sm font-bold mb-4" style={{ color: 'var(--text)' }}>Permits</h4>
            {permits.length === 0 ? (
              <EmptyState title="No permits" description="No permits are linked to this application yet." />
            ) : (
              <div className="overflow-x-auto">
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
            )}
          </Card>
        </div>
      )}

      {editing ? (
        <ApplicationForm
          mode="edit"
          initial={{ application_type: app.application_type, is_renewal: Boolean(Number(app.is_renewal)) }}
          saving={busy === 'edit'}
          onCancel={() => setEditing(false)}
          onSubmit={saveDraftEdit}
        />
      ) : null}

      <ConfirmModal
        open={confirmDelete}
        title="Delete this draft?"
        description={`${app.application_no} and its requirement checklist will be permanently removed. This can't be undone.`}
        confirmText="Delete draft"
        danger
        loading={busy === 'delete'}
        onConfirm={deleteDraft}
        onCancel={() => setConfirmDelete(false)}
      />
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

  return applicationId ? (
    <ApplicationDetail applicationId={applicationId} navigate={navigate} />
  ) : (
    <ApplicationsList navigate={navigate} />
  );
}
