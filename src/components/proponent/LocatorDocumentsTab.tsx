import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Clock3, FileText, Loader2, Trash2, Upload, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmModal } from '../ui/ConfirmModal';
import { RequirementGroupTabs, useRequirementGroups } from '../ui/RequirementGroupTabs';

// One application_requirements row for this locator, joined with its latest
// upload — see listRequirementDocumentsByProponent in ApplicationWorkflow.js.
type RequirementDocRow = {
  id: number;
  application_id: number;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | string;
  remarks: string | null;
  updated_at: string | null;
  requirement_code: string | null;
  requirement_name: string | null;
  is_mandatory: boolean | number | null;
  application_no: string;
  application_type: string | null;
  application_type_name?: string | null;
  is_renewal: boolean | number | null;
  application_status: string | null;
  application_created_at: string | null;
  reviewed_by_name: string | null;
  document_id: number | null;
  original_file_name: string | null;
  file_name: string | null;
  uploaded_at: string | null;
  document_version: number | null;
  category_id?: number | null;
  category_name?: string | null;
};

// A file uploaded straight onto the locator (dbo.proponent_documents).
type UploadedDocRow = {
  id: number;
  proponent_id: number;
  requirement_id: number | null;
  document_name: string | null;
  requirement_code: string | null;
  original_file_name: string | null;
  file_name: string | null;
  created_at: string | null;
  uploaded_by_name: string | null;
};

// A file queued in New Locator mode — uploaded right after the locator is
// created (see uploadLocatorDocument / ProponentsManagement's save()).
export type PendingLocatorDocument = {
  key: string;
  requirement_id: string;
  document_name: string;
  label: string;
  file: File;
};

type RequirementOption = {
  id: number;
  code: string | null;
  name: string;
  is_mandatory: boolean;
  for_new: boolean;
  for_renewal: boolean;
  // Types of Contract this requirement is limited to — empty = every type.
  contract_type_ids: number[];
  // Requirement Category — groups the checklist into sub-tabs.
  category_id: number | null;
  category_name: string | null;
};

// Same palette as Assessment & Evaluation's requirement badges.
const STATUS_STYLE: Record<string, { color: string; bg: string; Icon: typeof CheckCircle2; label: string }> = {
  VERIFIED: { color: '#10b981', bg: 'rgba(16,185,129,.15)', Icon: CheckCircle2, label: 'Verified' },
  REJECTED: { color: '#ef4444', bg: 'rgba(239,68,68,.15)', Icon: XCircle, label: 'Rejected' },
  PENDING: { color: '#f59e0b', bg: 'rgba(245,158,11,.15)', Icon: Clock3, label: 'Pending' },
};

const NOT_UPLOADED = { color: '#f59e0b', bg: 'rgba(245,158,11,.15)', Icon: Clock3, label: 'Not uploaded' };

// Matches the server's documents-only limit (m_upload.js uploadDocumentOnly).
const MAX_UPLOAD_MB = 50;
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];

/** Client-side pre-check so an oversized or non-document file is rejected
 * right away instead of after uploading (or, for a New Locator, on Save). */
function fileProblem(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `${file.name}: only PDF, Word or Excel documents are allowed.`;
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `${file.name} is too large (max ${MAX_UPLOAD_MB} MB).`;
  }
  return null;
}

// Same table look as the Locator Documents checklist above it.
const TH = 'px-3 py-2 text-left font-semibold uppercase tracking-widest text-[10px] text-secondary border-b';
const TD = 'px-3 py-2 text-[11px] border-b align-top';
const BORDER = { borderColor: 'var(--input-border)' };

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function uploadLocatorDocument(
  proponentId: number,
  doc: Pick<PendingLocatorDocument, 'requirement_id' | 'document_name' | 'file'>,
) {
  const body = new FormData();
  body.append('file', doc.file);
  if (doc.requirement_id) body.append('requirement_id', doc.requirement_id);
  if (doc.document_name) body.append('document_name', doc.document_name);
  const res = await fetch(`/api/proponents/${proponentId}/documents`, { method: 'POST', credentials: 'include', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Upload failed: ${doc.file.name}`);
  return json.data as UploadedDocRow;
}

/** Documents tab on the Locator Information panel:
 * - "Locator Documents": files uploaded straight onto the locator (manual
 *   registrations have no application to upload under). In New Locator mode
 *   (proponentId null) they're queued and uploaded when the locator is saved.
 * - Application documents: read-only, with the status the Assessment Officer
 *   gave each requirement (verify/reject stays in Assessment & Evaluation). */
export function LocatorDocumentsTab({
  proponentId,
  contractTypeId = null,
  pending = [],
  onPendingChange,
}: {
  proponentId: number | null;
  // The locator's Type of Contract — the checklist follows the same
  // restriction rules as filing a New application under that contract type.
  contractTypeId?: number | null;
  pending?: PendingLocatorDocument[];
  onPendingChange?: (next: PendingLocatorDocument[]) => void;
}) {
  const [rows, setRows] = useState<RequirementDocRow[] | null>(null);
  const [uploads, setUploads] = useState<UploadedDocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<RequirementOption[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UploadedDocRow | null>(null);
  // Which row the hidden file input is currently picking for — set by the
  // row's Upload/Reupload button right before it clicks the input (same
  // pattern as the locator portal's requirements tab).
  const [target, setTarget] = useState<{ requirement_id: string; document_name: string; label: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    fetch('/api/proponents/document-requirements', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => setOptions(Array.isArray(json?.data) ? json.data : []))
      .catch(() => setOptions([]));
  }, []);

  const load = useCallback(() => {
    const loadId = ++loadIdRef.current;
    if (!proponentId) {
      setRows([]);
      setUploads([]);
      return;
    }
    setError(null);
    fetch(`/api/proponents/${proponentId}/documents`, { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (loadId !== loadIdRef.current) return;
        if (!json?.success) throw new Error(json?.message || 'Failed to load documents');
        setRows(Array.isArray(json.data?.requirements) ? json.data.requirements : []);
        setUploads(Array.isArray(json.data?.uploads) ? json.data.uploads : []);
      })
      .catch((e) => loadId === loadIdRef.current && setError(e?.message || 'Failed to load documents'));
  }, [proponentId]);

  useEffect(() => {
    setRows(null);
    setUploads([]);
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<number, RequirementDocRow[]>();
    for (const r of rows || []) {
      const list = map.get(r.application_id) || [];
      list.push(r);
      map.set(r.application_id, list);
    }
    return Array.from(map.values());
  }, [rows]);

  // uploads come back newest-first, so the first match per requirement is
  // the current file; the count gives the V2/V3 reupload label.
  const uploadsByRequirement = useMemo(() => {
    const map = new Map<number, { latest: UploadedDocRow; count: number }>();
    for (const u of uploads) {
      if (u.requirement_id == null) continue;
      const hit = map.get(u.requirement_id);
      if (hit) hit.count += 1;
      else map.set(u.requirement_id, { latest: u, count: 1 });
    }
    return map;
  }, [uploads]);
  const otherUploads = useMemo(() => uploads.filter((u) => u.requirement_id == null), [uploads]);
  const otherPending = useMemo(() => pending.filter((p) => !p.requirement_id), [pending]);

  // Same rule ApplicationWorkflow uses when it attaches requirements to a new
  // application: active (server-filtered), For New, and either unrestricted or
  // restricted to this Type of Contract. Without one only unrestricted ones apply.
  const applicable = useMemo(
    () =>
      options.filter(
        (o) =>
          o.for_new &&
          (o.contract_type_ids.length === 0 || (contractTypeId != null && o.contract_type_ids.includes(contractTypeId))),
      ),
    [options, contractTypeId],
  );
  const applicableIds = useMemo(() => new Set(applicable.map((o) => o.id)), [applicable]);
  // Requirement Category sub-tabs over the checklist (shared component).
  const checklistGroups = useRequirementGroups(applicable);
  // Files already uploaded under a requirement that no longer applies (e.g.
  // the Type of Contract changed) stay visible, flagged, rather than silently hidden.
  const notApplicableUploads = useMemo(
    () => (proponentId ? uploads.filter((u) => u.requirement_id != null && !applicableIds.has(u.requirement_id)) : []),
    [proponentId, uploads, applicableIds],
  );

  // Queued files for a requirement that stopped applying are dropped.
  useEffect(() => {
    if (!onPendingChange || !options.length) return;
    const kept = pending.filter((p) => !p.requirement_id || applicableIds.has(Number(p.requirement_id)));
    if (kept.length !== pending.length) onPendingChange(kept);
  }, [applicableIds, options.length, pending, onPendingChange]);

  function pick(next: { requirement_id: string; document_name: string; label: string }) {
    setTarget(next);
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  }

  async function onFilePicked(file: File) {
    if (!target) return;
    const { requirement_id, document_name, label } = target;
    setTarget(null);
    const problem = fileProblem(file);
    if (problem) {
      toast.error(problem);
      return;
    }

    if (!proponentId) {
      // One queued file per requirement — picking again replaces it.
      const kept = requirement_id ? pending.filter((p) => p.requirement_id !== requirement_id) : pending;
      onPendingChange?.([...kept, { key: `${Date.now()}-${Math.random()}`, requirement_id, document_name, label, file }]);
      return;
    }

    setBusyKey(requirement_id || 'other');
    try {
      await uploadLocatorDocument(proponentId, { requirement_id, document_name, file });
      toast.success(`${label} uploaded`);
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Upload failed');
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteUpload(doc: UploadedDocRow) {
    if (!proponentId) return;
    setBusyKey(`del-${doc.id}`);
    try {
      const res = await fetch(`/api/proponents/${proponentId}/documents/${doc.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Delete failed');
      toast.success('Document removed');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed');
    } finally {
      setBusyKey(null);
      setConfirmDelete(null);
    }
  }

  const busy = busyKey !== null;
  const viewUrl = (d: UploadedDocRow) => `/api/proponents/${proponentId}/documents/${d.id}/download?view=1`;

  // One checklist row — used for catalog requirements and "other" documents.
  function renderRow(opts: {
    key: string;
    title: React.ReactNode;
    mandatory: React.ReactNode;
    uploaded: UploadedDocRow | null;
    versions: number;
    queued: PendingLocatorDocument | null;
    onUpload: (() => void) | null;
    uploadDisabled?: boolean;
    rowBusy: boolean;
  }) {
    const { uploaded, queued } = opts;
    return (
      <tr key={opts.key} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
        <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{opts.title}</td>
        <td className="px-3 py-2 text-[11px] text-secondary">{opts.mandatory}</td>
        <td className="px-3 py-2 text-[11px]">
          {uploaded ? (
            <StatusChip text="Uploaded" color="#10b981" bg="rgba(16,185,129,.15)" />
          ) : queued ? (
            <StatusChip text="Queued" color="#3b82f6" bg="rgba(59,130,246,.15)" />
          ) : (
            <StatusChip text="Not uploaded" color="#f59e0b" bg="rgba(245,158,11,.15)" />
          )}
        </td>
        <td className="px-3 py-2 text-[11px] text-secondary max-w-[220px]">
          {uploaded ? (
            <>
              <span className="block truncate" title={uploaded.original_file_name || uploaded.file_name || ''}>
                {uploaded.original_file_name || uploaded.file_name}
              </span>
              {opts.versions > 1 ? <span className="block text-[10px] opacity-70">V{opts.versions} — reuploaded</span> : null}
            </>
          ) : queued ? (
            <span className="block truncate" title={queued.file.name}>{queued.file.name}</span>
          ) : (
            <span className="opacity-60">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">
          {uploaded ? (
            <>
              <div style={{ color: 'var(--text)' }}>{uploaded.uploaded_by_name || '—'}</div>
              <div className="text-[10px]">{fmtDate(uploaded.created_at)}</div>
            </>
          ) : queued ? (
            'Uploads on Save'
          ) : (
            '—'
          )}
        </td>
        <td className="px-3 py-2 text-[11px]">
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            {uploaded ? (
              <button
                type="button"
                onClick={() => window.open(viewUrl(uploaded), '_blank')}
                className="cursor-pointer"
                style={{ color: 'var(--text)' }}
                title="View document"
                aria-label="View document"
              >
                <FileText size={14} />
              </button>
            ) : null}
            {opts.onUpload ? (
              opts.rowBusy ? (
                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--nav-active-bg)' }} />
              ) : (
                <button
                  type="button"
                  onClick={opts.onUpload}
                  disabled={busy || opts.uploadDisabled}
                  className="cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ color: 'var(--nav-active-bg)' }}
                  title={uploaded || queued ? 'Reupload document' : 'Upload document'}
                  aria-label={uploaded || queued ? 'Reupload document' : 'Upload document'}
                >
                  <Upload size={14} />
                </button>
              )
            ) : null}
            {uploaded ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(uploaded)}
                disabled={busy}
                className="cursor-pointer disabled:opacity-40"
                style={{ color: '#ef4444' }}
                title="Delete document"
                aria-label="Delete document"
              >
                <Trash2 size={14} />
              </button>
            ) : queued ? (
              <button
                type="button"
                onClick={() => onPendingChange?.(pending.filter((p) => p.key !== queued.key))}
                className="cursor-pointer"
                style={{ color: '#ef4444' }}
                title="Remove from queue"
                aria-label="Remove from queue"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </td>
      </tr>
    );
  }

  const isUploaded = (o: RequirementOption) =>
    proponentId ? uploadsByRequirement.has(o.id) : pending.some((p) => p.requirement_id === String(o.id));
  const uploadedCount = applicable.filter(isUploaded).length;

  // Once the locator has a filed application its requirements live there
  // (the card below) — the manual checklist would just list them twice.
  const showChecklist = !proponentId || (rows !== null && !error && groups.length === 0);

  return (
    <div className="flex flex-col gap-4">
      {showChecklist ? (
      <div className="rounded-lg border overflow-hidden" style={BORDER}>
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b"
          style={{ backgroundColor: 'var(--control-bg)', ...BORDER }}
        >
          <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            Locator Documents
            <span className="ml-2 font-normal text-secondary">
              PDF, Word or Excel only · up to {MAX_UPLOAD_MB} MB. Use Upload/Reupload on a row below.
              {proponentId ? '' : ' Files upload when you click Save.'}
            </span>
          </div>
          <div className="text-[11px] text-secondary tabular-nums">
            {uploadedCount}/{applicable.length} uploaded
          </div>
        </div>

        {checklistGroups.showTabs ? (
          <div className="px-3 pt-2.5 pb-2 border-b" style={BORDER}>
            <RequirementGroupTabs
              tabs={checklistGroups.tabs}
              activeKey={checklistGroups.current.key}
              onChange={checklistGroups.setActiveKey}
              isDone={isUploaded}
              doneLabel="uploaded"
            />
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFilePicked(f);
          }}
        />

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr>
                {['Requirement', 'Mandatory', 'Status', 'Document', 'Uploaded By', 'Actions'].map((c) => (
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
              {contractTypeId == null ? (
                <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td colSpan={6} className="px-3 py-2 text-[11px]" style={{ color: '#f59e0b', backgroundColor: 'rgba(245,158,11,.08)' }}>
                    No Type of Contract selected — only requirements that apply to every contract type are listed. Pick a
                    Type of Contract on the Profile tab to see the rest.
                  </td>
                </tr>
              ) : null}
              {checklistGroups.current.items.map((o) => {
                const hit = uploadsByRequirement.get(o.id);
                const queued = pending.find((p) => p.requirement_id === String(o.id)) || null;
                return renderRow({
                  key: `req-${o.id}`,
                  title: <span className="font-semibold">{o.code ? `${o.code} — ` : ''}{o.name}</span>,
                  mandatory: o.is_mandatory ? 'Yes' : 'No',
                  uploaded: proponentId ? hit?.latest ?? null : null,
                  versions: hit?.count ?? 0,
                  queued: proponentId ? null : queued,
                  onUpload: () => pick({ requirement_id: String(o.id), document_name: '', label: o.name }),
                  rowBusy: busyKey === String(o.id),
                });
              })}

              {(checklistGroups.isAll ? notApplicableUploads : [])
                .filter((u) => uploadsByRequirement.get(u.requirement_id as number)?.latest.id === u.id)
                .map((u) =>
                  renderRow({
                    key: `na-${u.id}`,
                    title: (
                      <>
                        <span className="font-semibold">{u.requirement_code ? `${u.requirement_code} — ` : ''}{u.document_name}</span>
                        <div className="text-[10px] mt-0.5" style={{ color: '#f59e0b' }}>Not required for this type of contract</div>
                      </>
                    ),
                    mandatory: '—',
                    uploaded: u,
                    versions: uploadsByRequirement.get(u.requirement_id as number)?.count ?? 1,
                    queued: null,
                    onUpload: null,
                    rowBusy: false,
                  }),
                )}

              {(proponentId && checklistGroups.isAll ? otherUploads : []).map((u) =>
                renderRow({
                  key: `other-${u.id}`,
                  title: <span className="font-semibold">{u.document_name || 'Other document'}</span>,
                  mandatory: 'No',
                  uploaded: u,
                  versions: 1,
                  queued: null,
                  onUpload: null,
                  rowBusy: false,
                }),
              )}
              {(!proponentId && checklistGroups.isAll ? otherPending : []).map((p) =>
                renderRow({
                  key: `other-q-${p.key}`,
                  title: <span className="font-semibold">{p.label}</span>,
                  mandatory: 'No',
                  uploaded: null,
                  versions: 0,
                  queued: p,
                  onUpload: null,
                  rowBusy: false,
                }),
              )}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}

      {!proponentId ? null : error ? (
        <div className="text-xs py-4 text-center" style={{ color: '#ef4444' }}>{error}</div>
      ) : !rows ? (
        <div className="text-xs text-secondary py-4 text-center">Loading application documents…</div>
      ) : !groups.length ? (
        null
      ) : (
        <ApplicationDocuments groups={groups} />
      )}

      <ConfirmModal
        open={Boolean(confirmDelete)}
        title="Delete this document?"
        description={`"${confirmDelete?.original_file_name || confirmDelete?.file_name || ''}" will be permanently removed.`}
        confirmText="Delete"
        danger
        loading={busy}
        onConfirm={() => {
          if (confirmDelete) void deleteUpload(confirmDelete);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function StatusChip({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ color, backgroundColor: bg }}
    >
      {text}
    </span>
  );
}

/** Latest application (the current one — usually the newest renewal) open;
 * earlier ones fold into a "Previous applications" list, one click each to
 * expand, so the tab doesn't grow with every renewal. */
function ApplicationDocuments({ groups }: { groups: RequirementDocRow[][] }) {
  const sorted = useMemo(
    () => [...groups].sort((a, b) => Number(b[0].application_id) - Number(a[0].application_id)),
    [groups],
  );
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [latest, ...previous] = sorted;
  const toggle = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      <ApplicationDocumentsCard items={latest} />
      {previous.length ? (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-secondary">
            Previous applications ({previous.length})
          </div>
          {previous.map((items) => {
            const id = Number(items[0].application_id);
            return (
              <ApplicationDocumentsCard
                key={id}
                items={items}
                collapsed={!openIds.has(id)}
                onToggle={() => toggle(id)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ApplicationDocumentsCard({
  items,
  collapsed = false,
  onToggle,
}: {
  items: RequirementDocRow[];
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const head = items[0];
  const verified = items.filter((r) => r.status === 'VERIFIED').length;
  const reqGroups = useRequirementGroups(items);
  return (
    <div className="rounded-lg border overflow-hidden" style={BORDER}>
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${collapsed ? '' : 'border-b'} ${onToggle ? 'cursor-pointer select-none' : ''}`}
        style={{ backgroundColor: 'var(--control-bg)', ...BORDER }}
        onClick={onToggle}
        role={onToggle ? 'button' : undefined}
        aria-expanded={onToggle ? !collapsed : undefined}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
          {head.application_no}
          <span className="ml-2 font-normal text-secondary">
            {head.is_renewal ? 'Renewal' : 'New'} · {head.application_type_name || head.application_type || '—'} · {head.application_status || '—'} · Filed {fmtDate(head.application_created_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-secondary tabular-nums">
          {verified}/{items.length} verified
          {onToggle ? (
            <ChevronDown size={14} className={`transition-transform ${collapsed ? '' : 'rotate-180'}`} />
          ) : null}
        </div>
      </div>
      {collapsed ? null : (
      <>
      {reqGroups.showTabs ? (
        <div className="px-3 pt-2.5 pb-2 border-b" style={BORDER}>
          <RequirementGroupTabs
            tabs={reqGroups.tabs}
            activeKey={reqGroups.current.key}
            onChange={reqGroups.setActiveKey}
            isDone={(r) => r.status === 'VERIFIED'}
            isFlagged={(r) => r.status === 'REJECTED'}
          />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              {['Requirement', 'Document', 'Uploaded', 'Status', 'Remarks', 'Processed By'].map((h) => (
                <th key={h} className={TH} style={{ borderColor: 'var(--border-subtle)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reqGroups.current.items.map((r) => {
              // Nothing uploaded yet reads "Not uploaded", not "Pending" review.
              const s =
                !r.document_id && r.status === 'PENDING'
                  ? NOT_UPLOADED
                  : STATUS_STYLE[r.status] || STATUS_STYLE.PENDING;
              const cell = { borderColor: 'var(--border-subtle)' };
              return (
                <tr key={r.id} className="last:[&>td]:border-b-0">
                  <td className={TD} style={{ ...cell, color: 'var(--text)' }}>
                    {r.requirement_name || r.requirement_code || '—'}
                    {r.is_mandatory ? <span style={{ color: '#ef4444' }}> *</span> : null}
                  </td>
                  <td className={TD} style={cell}>
                    {r.document_id ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:underline text-left cursor-pointer"
                        style={{ color: 'var(--primary, #2563eb)' }}
                        onClick={() => window.open(`/api/documents/${r.document_id}/download?view=1`, '_blank')}
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span className="break-all">{r.original_file_name || r.file_name}</span>
                        {r.document_version && r.document_version > 1 ? (
                          <span className="text-secondary">(V{r.document_version})</span>
                        ) : null}
                      </button>
                    ) : (
                      <span className="text-secondary">Not uploaded</span>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-secondary`} style={cell}>
                    {fmtDate(r.uploaded_at)}
                  </td>
                  <td className={TD} style={cell}>
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                      style={{ color: s.color, backgroundColor: s.bg }}
                    >
                      <s.Icon className="w-3 h-3" />
                      {s.label}
                    </span>
                  </td>
                  <td className={`${TD} text-secondary`} style={cell}>
                    {r.remarks || '—'}
                  </td>
                  <td className={`${TD} whitespace-nowrap`} style={cell}>
                    {r.status !== 'PENDING' && r.reviewed_by_name ? (
                      <>
                        <div style={{ color: 'var(--text)' }}>{r.reviewed_by_name}</div>
                        <div className="text-[10px] text-secondary">{fmtDate(r.updated_at)}</div>
                      </>
                    ) : (
                      <span className="text-secondary">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
