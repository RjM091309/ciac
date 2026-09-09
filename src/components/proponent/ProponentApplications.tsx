import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardList, Download, FileText, History, Loader2, Pencil, Plus, ScrollText, Send, Table2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { getStatusBadgeStyles } from '../dashboard/statusBadge';
import { APPLICATION_TYPES, applicationTypeLabel } from '../../lib/applicationTypes';

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
          <select
            value={applicationType}
            onChange={(e) => setApplicationType(e.target.value)}
            disabled={saving}
            className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none"
            style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
          >
            {APPLICATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {applicationTypeLabel(t)}
              </option>
            ))}
          </select>
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
      toast.error(e?.message || 'Failed to create application');
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div>
        <h3 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          My Applications
        </h3>
        <p className="text-xs text-secondary">File a new lease application or track an existing one.</p>
      </div>
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
          <EmptyState title="Couldn't load your applications" description={error} />
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
  { id: 'documents', label: 'Documents', icon: FileText },
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

  const reloadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/proponents/me/applications/${applicationId}/documents`, { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.data)) {
        setData((prev) => (prev ? { ...prev, documents: json.data } : prev));
      }
    } catch {
      /* non-critical */
    }
  }, [applicationId]);

  async function uploadDoc(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (uploadRequirementId) fd.append('requirement_id', uploadRequirementId);
      const res = await fetch(`/api/proponents/me/applications/${applicationId}/documents`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Upload failed');
      toast.success('Document uploaded.');
      setUploadRequirementId('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await reloadDocuments();
    } catch (e: any) {
      toast.error(e?.message || 'Upload failed');
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
              {t.id === 'documents' && documents.length ? ` (${documents.length})` : ''}
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
          {requirements.length === 0 ? (
            <EmptyState title="No requirements" description="No requirement checklist has been attached to this application yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr>
                    {['Requirement', 'Mandatory', 'Status', 'Remarks'].map((c) => (
                      <th key={c} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requirements.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                        <span className="font-semibold">{r.requirement_code ? `${r.requirement_code} — ` : ''}{r.requirement_name || 'Requirement'}</span>
                        {r.requirement_description ? <div className="text-secondary mt-0.5">{r.requirement_description}</div> : null}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{Number(r.is_mandatory) ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-2 text-[11px]"><StatusPill status={r.status} /></td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{r.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'documents' && (
        <Card>
          <div
            className="rounded-lg border border-dashed p-4 mb-4 flex flex-col sm:flex-row sm:items-end gap-3"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex-1 space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-secondary">
                Attach to requirement (optional)
              </label>
              <select
                value={uploadRequirementId}
                onChange={(e) => setUploadRequirementId(e.target.value)}
                disabled={uploading}
                className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              >
                <option value="">— No specific requirement —</option>
                {requirements.map((r) => (
                  <option key={r.id} value={String(r.requirement_id)}>
                    {r.requirement_code ? `${r.requirement_code} — ` : ''}{r.requirement_name || 'Requirement'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadDoc(f);
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm cursor-pointer disabled:opacity-60"
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? 'Uploading…' : 'Upload document'}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-secondary mb-3">PDF, JPG, or PNG · up to 10 MB.</p>

          {documents.length === 0 ? (
            <EmptyState title="No documents" description="No supporting documents have been recorded for this application yet." />
          ) : (
            <ul className="space-y-2">
              {documents.map((d) => {
                const isUrl = /^https?:\/\//i.test(d.storage_path || '');
                const name = d.original_file_name || d.file_name;
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>{name}</div>
                      <div className="text-[10px] text-secondary">
                        {(d.requirement_code || d.requirement_name) ? `${d.requirement_code || ''} ${d.requirement_name || ''}`.trim() + ' · ' : ''}
                        {fmtDate(d.created_at)}
                      </div>
                    </div>
                    <a
                      href={isUrl ? d.storage_path : `/api/documents/${d.id}/download`}
                      target={isUrl ? '_blank' : undefined}
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold shrink-0"
                      style={{ color: 'var(--text)' }}
                    >
                      <Download size={12} /> {isUrl ? 'Open' : 'Download'}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          {history.length === 0 ? (
            <EmptyState title="No history" description="No status changes have been recorded for this application yet." />
          ) : (
            <ol className="relative border-l ml-2" style={{ borderColor: 'var(--border-subtle)' }}>
              {history.map((h) => (
                <li key={h.id} className="ml-4 pb-4 last:pb-0">
                  <span
                    className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: getStatusBadgeStyles(h.to_status).color }}
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    {h.from_status ? <span className="text-[11px] text-secondary">{h.from_status} →</span> : null}
                    <StatusPill status={h.to_status} />
                    <span className="text-[10px] text-secondary">{fmtDateTime(h.changed_at)}</span>
                  </div>
                  {h.remarks ? <div className="text-[11px] text-secondary mt-1">{h.remarks}</div> : null}
                </li>
              ))}
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
