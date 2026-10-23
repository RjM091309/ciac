import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardCheck, FileText, History, Loader2, ShieldCheck, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';
import { noLocatorProfileMessage } from '../../lib/locatorProfile';
import { useLiveRefresh } from '../../lib/liveData';
import { ListSkeleton } from '../ui/PortalSkeletons';

// Locator portal "Compliance" page: the locator's own compliance checklist
// (with uploads and every earlier file kept as history), its inspections with
// findings and corrective actions, and the same standing staff see on the
// Compliance & Inspection board. Review (Complied / Not complied) is done by
// the Compliance Officer — this page only uploads and reads.

type ComplianceDocument = {
  id: number;
  item_code: string;
  original_file_name: string | null;
  file_name: string;
  validity_from: string | null;
  validity_to: string | null;
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | string;
  review_remarks: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
  // 0 = uploaded for you by the Compliance Officer (walk-in / emailed copy).
  uploaded_by_locator?: number | boolean;
};

type ComplianceItem = {
  code: string;
  group: string;
  name: string;
  validity_from: string | null;
  validity_to: string | null;
  status: 'PENDING' | 'SUBMITTED' | 'COMPLIED' | 'NOT_COMPLIED' | string;
  remarks: string | null;
  date_submitted: string | null;
  // Set per locator by the Compliance Officer; only REQUIRED items count.
  applicability?: 'REQUIRED' | 'NOT_APPLICABLE' | string;
  applicability_reason?: string | null;
  documents: ComplianceDocument[];
};

const isRequired = (i: ComplianceItem) => !i.applicability || i.applicability === 'REQUIRED';

type Inspection = {
  id: number;
  title: string;
  inspection_type_name: string | null;
  scheduled_date: string | null;
  conducted_date: string | null;
  status: string;
  result: string | null;
  summary: string | null;
};

type Finding = {
  id: number;
  inspection_id: number;
  severity: string | null;
  description: string;
  recommendation: string | null;
  status: string;
};

type CorrectiveAction = {
  id: number;
  inspection_id: number;
  action_required: string;
  due_date: string | null;
  status: string;
  completed_date: string | null;
};

type Overview = {
  standing: 'COMPLIANT' | 'MONITORING' | 'AT_RISK';
  items: ComplianceItem[];
  inspections: Inspection[];
  findings: Finding[];
  actions: CorrectiveAction[];
};

// Same wording as the staff Compliance & Inspection page.
const GROUP_LABEL: Record<string, string> = {
  COMPLIANCE: 'Compliance',
  PERMITS: 'Permits & Clearances',
  PERFORMANCE: 'Performance Commitment',
};
const ITEM_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: 'Pending', color: '#94a3b8', bg: 'rgba(148,163,184,.14)' },
  SUBMITTED: { label: 'Submitted', color: '#3b82f6', bg: 'rgba(59,130,246,.14)' },
  COMPLIED: { label: 'Complied', color: '#10b981', bg: 'rgba(16,185,129,.14)' },
  NOT_COMPLIED: { label: 'Not complied', color: '#ef4444', bg: 'rgba(239,68,68,.14)' },
};
const DOC_STATUS: Record<string, { label: string; color: string }> = {
  SUBMITTED: { label: 'Under review', color: '#3b82f6' },
  ACCEPTED: { label: 'Accepted', color: '#10b981' },
  REJECTED: { label: 'Rejected', color: '#ef4444' },
};
const STANDING: Record<Overview['standing'], { label: string; color: string; bg: string; hint: string }> = {
  COMPLIANT: { label: 'No issues', color: '#10b981', bg: 'rgba(16,185,129,.14)', hint: 'No open findings or corrective actions from inspections.' },
  MONITORING: { label: 'Monitoring', color: '#f59e0b', bg: 'rgba(245,158,11,.14)', hint: 'You have open findings or corrective actions to address.' },
  AT_RISK: { label: 'At Risk', color: '#ef4444', bg: 'rgba(239,68,68,.14)', hint: 'A failed inspection or overdue corrective action needs attention.' },
};
const INSPECTION_STATUS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const RESULT: Record<string, { label: string; color: string }> = {
  PASSED: { label: 'Passed', color: '#10b981' },
  PASSED_WITH_FINDINGS: { label: 'Passed w/ Findings', color: '#f59e0b' },
  FAILED: { label: 'Failed', color: '#ef4444' },
};

const MAX_UPLOAD_MB = 50;
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
const FLOAT_ITEM: React.CSSProperties = { backgroundColor: 'var(--surface)', boxShadow: 'var(--float-shadow)' };

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function validityState(to: string | null): 'expired' | 'expiring' | null {
  if (!to) return null;
  const end = new Date(to);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = (end.getTime() - today.getTime()) / 86_400_000;
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return null;
}

function Pill({ label, color, bg }: { label: string; color: string; bg?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ color, backgroundColor: bg ?? 'transparent', border: bg ? undefined : `1px solid ${color}` }}
    >
      {label}
    </span>
  );
}

function Card({ title, icon: Icon, right, children }: { title: string; icon: any; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-0 sm:p-5 sm:bg-[var(--surface)] sm:[box-shadow:var(--float-shadow)]">
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <Icon size={16} style={{ color: 'var(--text)' }} />
        <h4 className="text-sm font-bold" style={{ color: 'var(--text)' }}>{title}</h4>
        {right ? <div className="ml-auto">{right}</div> : null}
      </div>
      {children}
    </div>
  );
}

const fileUrl = (d: ComplianceDocument) => `/api/proponents/me/compliance/documents/${d.id}/download?view=1`;

export function ProponentCompliance() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Direct upload, like an application's requirements: the row's Upload
  // button opens the file picker and the file goes up as soon as it's picked.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<ComplianceItem | null>(null);
  const [uploadingCode, setUploadingCode] = useState<string | null>(null);
  function startUpload(item: ComplianceItem) {
    if (uploadingCode) return;
    uploadTarget.current = item;
    fileInputRef.current?.click();
  }
  async function uploadFile(file: File) {
    const item = uploadTarget.current;
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!item) return;
    const name = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) return void toast.error('Only PDF, Word or Excel documents are allowed.');
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return void toast.error(`File is too large (max ${MAX_UPLOAD_MB} MB).`);
    setUploadingCode(item.code);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/proponents/me/compliance/${encodeURIComponent(item.code)}/documents`, {
        method: 'POST',
        credentials: 'include',
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Upload failed');
      toast.success(`${item.name} submitted for review.`);
      reload();
    } catch (e: any) {
      toast.error(e?.message || 'Upload failed');
    } finally {
      setUploadingCode(null);
    }
  }
  const uploadLabel = (item: ComplianceItem) =>
    uploadingCode === item.code ? 'Uploading…' : item.status === 'COMPLIED' ? 'Upload renewed file' : item.documents.length ? 'Reupload' : 'Upload';
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const [liveTick, setLiveTick] = useState(0);
  useLiveRefresh(() => setLiveTick((t) => t + 1));
  const reload = () => setLiveTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/proponents/me/compliance', { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.message || 'Failed to load compliance');
        setData(json.data);
        setError(null);
      } catch (e: any) {
        if (!cancelled && liveTick === 0) setError(e?.message || 'Failed to load compliance');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  // Applicable items go in the grouped checklist; ones marked Not applicable
  // (per locator, by the Compliance Officer) are listed separately below.
  const notRequired = useMemo(() => (data?.items || []).filter((i) => !isRequired(i)), [data]);
  const groups = useMemo(() => {
    const map = new Map<string, ComplianceItem[]>();
    for (const item of (data?.items || []).filter(isRequired)) {
      const list = map.get(item.group) || [];
      list.push(item);
      map.set(item.group, list);
    }
    return Array.from(map.entries());
  }, [data]);

  const counts = useMemo(() => {
    // Not-applicable items don't count toward your compliance.
    const items = (data?.items || []).filter(isRequired);
    return {
      total: items.length,
      complied: items.filter((i) => i.status === 'COMPLIED').length,
      submitted: items.filter((i) => i.status === 'SUBMITTED').length,
      notComplied: items.filter((i) => i.status === 'NOT_COMPLIED').length,
      expired: items.filter((i) => validityState(i.validity_to) === 'expired').length,
      expiring: items.filter((i) => validityState(i.validity_to) === 'expiring').length,
    };
  }, [data]);

  if (loading) return <ListSkeleton columns={5} rows={4} />;

  if (error || !data) {
    const noProfile = /no proponent profile/i.test(error || '');
    return (
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <EmptyState title="Couldn't load compliance" description={noProfile ? noLocatorProfileMessage() : error || ''} />
      </div>
    );
  }

  const standing = STANDING[data.standing] || STANDING.COMPLIANT;
  const submittedPct = counts.total ? Math.round(((counts.submitted + counts.complied) / counts.total) * 100) : 0;
  const compliedPct = counts.total ? Math.round((counts.complied / counts.total) * 100) : 0;
  // Applicable items the locator has to act on: not uploaded yet, marked Not
  // complied, or expired / expiring (a newer file under review doesn't count).
  const todo = (data.items || [])
    .filter(isRequired)
    .map((item) => {
      const v = validityState(item.validity_to);
      if (item.status === 'NOT_COMPLIED') return { item, reason: 'Not complied — upload a corrected document', color: '#ef4444' };
      if (item.status === 'SUBMITTED') return null;
      if (v === 'expired') return { item, reason: `Expired on ${fmtDate(item.validity_to)} — upload the renewed document`, color: '#ef4444' };
      if (v === 'expiring') return { item, reason: `Expires on ${fmtDate(item.validity_to)} — upload the renewed document`, color: '#f59e0b' };
      if (item.status === 'PENDING' && !item.documents.length) return { item, reason: 'Not submitted yet', color: 'var(--text-muted)' };
      return null;
    })
    .filter((x): x is { item: ComplianceItem; reason: string; color: string } => Boolean(x));
  const docState =
    todo.some((t) => t.color === '#ef4444')
      ? { label: 'Needs action', color: '#ef4444' }
      : counts.total > 0 && counts.complied === counts.total
        ? { label: 'Complete', color: '#10b981' }
        : { label: 'In progress', color: '#3b82f6' };
  const openActions = data.actions.filter((a) => a.status !== 'DONE');
  const openFindings = data.findings.filter((f) => f.status === 'OPEN');

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Documents first (what the locator works on), inspections apart. */}
      <div className="rounded-2xl p-4 sm:p-5" style={FLOAT_ITEM}>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: `${docState.color}24`, color: docState.color }}
          >
            <ClipboardCheck size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-secondary">Compliance documents</div>
            <div className="text-lg font-bold" style={{ color: docState.color }}>{docState.label}</div>
            <div className="text-[11px] text-secondary">
              {counts.complied} of {counts.total} complied
              {todo.length ? ` · ${todo.length} need${todo.length === 1 ? 's' : ''} your action` : ''}
            </div>
          </div>
          <div
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ border: '1px solid var(--border-subtle)' }}
            title={standing.hint}
          >
            <ShieldCheck size={15} style={{ color: standing.color }} />
            <div className="leading-tight">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-secondary">Inspections</div>
              <div className="text-[12px] font-bold" style={{ color: standing.color }}>{standing.label}</div>
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Complied', value: `${compliedPct}%`, sub: `${counts.complied} of ${counts.total}`, color: '#10b981' },
            { label: 'Under review', value: String(counts.submitted), color: counts.submitted ? '#3b82f6' : undefined },
            { label: 'Need your action', value: String(todo.length), color: todo.length ? '#ef4444' : undefined },
            {
              label: 'Expired / Expiring',
              value: `${counts.expired} / ${counts.expiring}`,
              color: counts.expired ? '#ef4444' : counts.expiring ? '#f59e0b' : undefined,
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl px-3 py-2" style={{ border: '1px solid var(--border-subtle)' }}>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary">{s.label}</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums" style={{ color: s.color || 'var(--text)' }}>{s.value}</div>
              {s.sub ? <div className="text-[10px] text-secondary">{s.sub}</div> : null}
            </div>
          ))}
        </div>
      </div>

      {/* What the locator needs to do, before the full checklist. */}
      {todo.length ? (
        <Card title="To do" icon={AlertTriangle} right={<span className="text-[11px] font-bold tabular-nums">{todo.length}</span>}>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
            {todo.map(({ item, reason, color }, idx) => (
              <div
                key={item.code}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3"
                style={{ borderTop: idx === 0 ? undefined : '1px solid var(--border-subtle)' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{item.name}</div>
                  <div className="text-[11px] font-semibold" style={{ color }}>{reason}</div>
                  {item.status === 'NOT_COMPLIED' && item.remarks ? (
                    <div className="mt-0.5 text-[11px] text-secondary">Officer's remarks: {item.remarks}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => startUpload(item)}
                  disabled={Boolean(uploadingCode)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border shrink-0"
                  style={{ color: 'var(--nav-active-bg)', borderColor: 'var(--border-subtle)' }}
                >
                  {uploadingCode === item.code ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {uploadLabel(item)}
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Checklist */}
      <Card title="Compliance Checklist" icon={ClipboardCheck}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
          }}
        />
        <p className="text-[11px] text-secondary mb-3">
          Upload each document here. The Compliance Officer reviews it and marks it Complied or Not complied. Earlier
          uploads are kept under History. PDF, Word or Excel · up to {MAX_UPLOAD_MB} MB.
        </p>
        {groups.length === 0 ? (
          <EmptyState title="No compliance requirements" description="No compliance requirements are set up yet." />
        ) : (
          <div className="space-y-4">
            {groups.map(([group, items]) => {
              const required = items.filter(isRequired);
              const done = required.filter((i) => i.status === 'COMPLIED').length;
              return (
                <div key={group}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-secondary">{GROUP_LABEL[group] || group}</div>
                    <div className="text-[11px] font-semibold tabular-nums" style={{ color: done === required.length ? '#10b981' : 'var(--text)' }}>
                      {done}/{required.length}
                    </div>
                  </div>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    {items.map((item, idx) => {
                      const st = ITEM_STATUS[item.status] || ITEM_STATUS.PENDING;
                      const vState = validityState(item.validity_to);
                      const latest = item.documents[0] || null;
                      const showHistory = historyFor === item.code;
                      const notApplicable = item.applicability === 'NOT_APPLICABLE';
                      return (
                        <div
                          key={item.code}
                          className="p-3"
                          style={{
                            borderTop: idx === 0 ? undefined : '1px solid var(--border-subtle)',
                            opacity: notApplicable ? 0.55 : 1,
                          }}
                        >
                          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                                {item.name}
                                {!isRequired(item) ? (
                                  <span
                                    className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                                    style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                                  >
                                    Not applicable
                                  </span>
                                ) : null}
                              </div>
                              {!isRequired(item) && item.applicability_reason ? (
                                <div className="mt-0.5 text-[10px] text-secondary">{item.applicability_reason}</div>
                              ) : null}
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-secondary">
                                <span>
                                  Valid until {fmtDate(item.validity_to)}
                                  {vState === 'expired' ? (
                                    <span className="ml-1 font-semibold" style={{ color: '#ef4444' }}>· Expired</span>
                                  ) : vState === 'expiring' ? (
                                    <span className="ml-1 font-semibold" style={{ color: '#f59e0b' }}>· Expiring soon</span>
                                  ) : null}
                                </span>
                                {item.date_submitted ? <span>Submitted {fmtDate(item.date_submitted)}</span> : null}
                              </div>
                              {item.remarks ? (
                                <div className="mt-1 text-[11px] text-secondary">
                                  <span className="font-semibold" style={{ color: 'var(--text)' }}>Officer's remarks:</span> {item.remarks}
                                </div>
                              ) : null}
                              {latest ? (
                                <button
                                  type="button"
                                  onClick={() => window.open(fileUrl(latest), '_blank')}
                                  className="mt-1.5 inline-flex max-w-full items-center gap-1 text-[11px] hover:underline cursor-pointer"
                                  style={{ color: 'var(--text)' }}
                                >
                                  <FileText size={12} className="shrink-0" />
                                  <span className="truncate">{latest.original_file_name || latest.file_name}</span>
                                </button>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {notApplicable ? null : <Pill label={st.label} color={st.color} bg={st.bg} />}
                              {item.documents.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => setHistoryFor(showHistory ? null : item.code)}
                                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] border cursor-pointer"
                                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                                  title="Earlier uploads"
                                >
                                  <History size={12} /> {item.documents.length - 1}
                                </button>
                              ) : null}
                              {notApplicable ? null : (
                              <button
                                type="button"
                                onClick={() => startUpload(item)}
                                disabled={Boolean(uploadingCode)}
                                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border"
                                style={{ color: 'var(--nav-active-bg)', borderColor: 'var(--border-subtle)' }}
                              >
                                {uploadingCode === item.code ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {uploadLabel(item)}
                              </button>
                              )}
                            </div>
                          </div>

                          {showHistory ? (
                            <div className="mt-2 rounded-lg p-2 space-y-1.5" style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 60%, transparent)' }}>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-secondary">Earlier uploads</div>
                              {item.documents.slice(1).map((d) => {
                                const ds = DOC_STATUS[d.status] || DOC_STATUS.SUBMITTED;
                                const dv = validityState(d.validity_to);
                                return (
                                  <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                                    <button
                                      type="button"
                                      onClick={() => window.open(fileUrl(d), '_blank')}
                                      className="inline-flex min-w-0 items-center gap-1 hover:underline cursor-pointer"
                                      style={{ color: 'var(--text)' }}
                                    >
                                      <FileText size={11} className="shrink-0" />
                                      <span className="truncate max-w-[220px]">{d.original_file_name || d.file_name}</span>
                                    </button>
                                    <span className="text-secondary">
                                      Uploaded {fmtDate(d.uploaded_at)}
                                      {Number(d.uploaded_by_locator) ? '' : ' by the Compliance Officer'}
                                    </span>
                                    <span className="text-secondary">
                                      Valid until {fmtDate(d.validity_to)}
                                      {dv === 'expired' ? <span style={{ color: '#ef4444' }}> · Expired</span> : null}
                                    </span>
                                    <span className="font-semibold" style={{ color: ds.color }}>{ds.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {notRequired.length ? (
          <div className="mt-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-secondary">Not applicable to your business</div>
              <span className="text-[11px] font-semibold tabular-nums text-secondary">{notRequired.length}</span>
            </div>
            <p className="text-[11px] text-secondary mb-2">
              Set by the Compliance Officer. You don’t need to submit these, and they don’t count toward your compliance.
            </p>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
              {notRequired.map((item, idx) => {
                const latest = item.documents[0] || null;
                return (
                  <div
                    key={item.code}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3"
                    style={{ borderTop: idx === 0 ? undefined : '1px solid var(--border-subtle)', opacity: 0.6 }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                        {item.name}
                        <span
                          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                          style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                        >
                          Not applicable
                        </span>
                        <span className="text-[10px] font-normal text-secondary">{GROUP_LABEL[item.group] || item.group}</span>
                      </div>
                      {item.applicability_reason ? (
                        <div className="mt-0.5 text-[11px] text-secondary">{item.applicability_reason}</div>
                      ) : null}
                      {latest ? (
                        <button
                          type="button"
                          onClick={() => window.open(fileUrl(latest), '_blank')}
                          className="mt-1 inline-flex max-w-full items-center gap-1 text-[11px] hover:underline cursor-pointer"
                          style={{ color: 'var(--text)' }}
                        >
                          <FileText size={12} className="shrink-0" />
                          <span className="truncate">{latest.original_file_name || latest.file_name}</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </Card>

      {/* Inspections */}
      <Card title="Inspections" icon={ShieldCheck}>
        {data.inspections.length === 0 ? (
          <EmptyState title="No inspections yet" description="Inspections scheduled for your business will appear here." />
        ) : (
          <div className="space-y-2">
            {data.inspections.map((i) => {
              const r = i.result ? RESULT[i.result] : null;
              const findings = data.findings.filter((f) => f.inspection_id === i.id);
              const actions = data.actions.filter((a) => a.inspection_id === i.id);
              return (
                <div key={i.id} className="rounded-xl p-3" style={{ border: '1px solid var(--border-subtle)' }}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{i.title}</div>
                      <div className="text-[10px] text-secondary">
                        {i.inspection_type_name || 'Inspection'} · {i.conducted_date ? `Conducted ${fmtDate(i.conducted_date)}` : `Scheduled ${fmtDate(i.scheduled_date)}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill label={INSPECTION_STATUS[i.status] || i.status} color="var(--text-muted)" />
                      {r ? <Pill label={r.label} color={r.color} /> : null}
                    </div>
                  </div>
                  {i.summary ? <div className="mt-1.5 text-[11px] text-secondary">{i.summary}</div> : null}
                  {findings.length ? (
                    <div className="mt-2 space-y-1">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-secondary">Findings</div>
                      {findings.map((f) => (
                        <div key={f.id} className="text-[11px]" style={{ color: 'var(--text)' }}>
                          <span className="font-semibold">{f.severity ? `[${f.severity}] ` : ''}</span>
                          {f.description}
                          {f.recommendation ? <span className="text-secondary"> — {f.recommendation}</span> : null}
                          <span className="ml-1 text-[10px] font-semibold" style={{ color: f.status === 'OPEN' ? '#f59e0b' : '#10b981' }}>
                            {f.status === 'OPEN' ? 'Open' : 'Resolved'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {actions.length ? (
                    <div className="mt-2 space-y-1">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-secondary">Corrective actions</div>
                      {actions.map((a) => {
                        const overdue = a.status !== 'DONE' && validityState(a.due_date) === 'expired';
                        return (
                          <div key={a.id} className="flex flex-wrap items-center gap-x-2 text-[11px]" style={{ color: 'var(--text)' }}>
                            <span>{a.action_required}</span>
                            <span className="text-secondary">· due {fmtDate(a.due_date)}</span>
                            <span
                              className="text-[10px] font-semibold"
                              style={{ color: a.status === 'DONE' ? '#10b981' : overdue ? '#ef4444' : '#f59e0b' }}
                            >
                              {a.status === 'DONE' ? 'Done' : overdue ? 'Overdue' : 'Pending'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {openFindings.length || openActions.length ? (
          <div className="mt-3 flex items-center gap-1.5 text-[11px]" style={{ color: '#f59e0b' }}>
            <AlertTriangle size={13} /> {openFindings.length} open finding(s) · {openActions.length} pending corrective action(s)
          </div>
        ) : null}
      </Card>

    </div>
  );
}
