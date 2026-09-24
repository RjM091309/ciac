import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSignature, FileText, Pencil, Search, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';
import { DatePicker, parseYmd, toYmd } from '../ui/DatePicker';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';

const MENU_KEY = 'compliance:permits';

// "CONTRACT" is system-generated only (Contract.js auto-syncs a permit row
// of this type whenever a contract is issued — see server/models/Permit.js)
// — kept as a fixed option alongside whatever Settings -> Compliance Types
// has configured, not one of those configurable entries itself.
const RESERVED_PERMIT_TYPE = { value: 'CONTRACT', label: 'Lease Contract' };

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  VALID: { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  EXPIRING: { bg: 'rgba(245,158,11,0.14)', color: '#f59e0b' },
  EXPIRED: { bg: 'rgba(220,38,38,0.14)', color: '#fca5a5' },
  REVOKED: { bg: 'rgba(148,163,184,0.14)', color: '#94a3b8' },
};

type PermitRow = {
  id: number;
  proponent_id: number;
  proponent_name: string | null;
  application_id: number | null;
  permit_type: string;
  permit_no: string;
  issuing_authority: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  status: string;
  effective_status: string;
  remarks: string | null;
  is_active: number | boolean;
  has_certificate?: boolean;
  has_contract_certificate?: boolean;
};

type Option = { value: string; label: string };

type ApprovedApplication = { id: number; application_no: string; proponent_id: number; proponent_name: string | null };

type Bundle = {
  permits: PermitRow[];
  proponents: Option[];
  approvedApplications: ApprovedApplication[];
  permitTypes: Option[];
};

const EMPTY_FORM = {
  proponent_id: '',
  application_id: '',
  permit_type: '',
  permit_no: '',
  issuing_authority: '',
  issue_date: '',
  expiry_date: '',
  status: 'VALID',
  remarks: '',
};

function fmt(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function dateInput(v: string | null) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
function daysUntil(v: string | null): number | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

type ExpiryFilter = 'THIS_MONTH' | 'NEXT_90' | 'OVERDUE' | null;

export function PermitsManagement({
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
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<PermitRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>(null);

  // Deep-link from the Dashboard's "Needs Attention" widget (?permitId=...):
  // clears any filter that would hide the row, scrolls to it, and highlights
  // it — otherwise landing here just showed the whole unfiltered list with no
  // indication of which permit needed attention.
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const highlightedRowRef = useRef<HTMLDivElement | HTMLTableRowElement | null>(null);
  const consumedHighlightQueryRef = useRef('');
  useEffect(() => {
    const raw = String(locationSearch || '').trim();
    if (!raw || consumedHighlightQueryRef.current === raw) return;
    const params = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`);
    const permitId = Number(params.get('permitId') || '');
    if (!Number.isFinite(permitId) || permitId <= 0) return;
    consumedHighlightQueryRef.current = raw;
    setHighlightId(permitId);
    setExpiryFilter(null);
    setSearch('');
    if (navigate) {
      params.delete('permitId');
      const cleaned = params.toString();
      navigate(`/compliance/permits${cleaned ? `?${cleaned}` : ''}`, { replace: true });
    }
  }, [locationSearch, navigate]);

  // The highlight is a "here's the one you clicked from the dashboard" cue,
  // not a persistent state — the next click anywhere (row action, filter,
  // elsewhere on the page) dismisses it instead of leaving a stale ring on a
  // row the officer has already moved past.
  useEffect(() => {
    if (highlightId == null) return;
    function clear() {
      setHighlightId(null);
    }
    document.addEventListener('click', clear);
    return () => document.removeEventListener('click', clear);
  }, [highlightId]);

  const { data, isLoading, refresh } = useSessionStorageCachedResource<Bundle>({
    cacheKey: 'ciac.permits_bundle.v3',
    ttlMs: 3 * 60 * 1000,
    fetcher: async () => {
      const [pRes, prRes, aRes, ctRes] = await Promise.all([
        fetch('/api/permits', { credentials: 'include' }),
        fetch('/api/proponents', { credentials: 'include' }),
        fetch('/api/applications', { credentials: 'include' }),
        fetch('/api/compliance-types', { credentials: 'include' }),
      ]);
      const [pJson, prJson, aJson, ctJson] = await Promise.all([pRes.json(), prRes.json(), aRes.json(), ctRes.json().catch(() => ({}))]);
      if (!pRes.ok) throw new Error(pJson?.message || 'Failed to load permits');
      const complianceTypeOptions: Option[] = (ctRes.ok && Array.isArray(ctJson?.data) ? ctJson.data : [])
        .filter((t: any) => Number(t?.is_active))
        .map((t: any) => ({ value: String(t.code), label: String(t.name) }));

      // Only an APPROVED application means the locator has actually cleared
      // Assessment + Approval & Issuance — a permit shouldn't be issuable to
      // a business that's still mid-review or was never approved.
      const approvedApplications: ApprovedApplication[] = (Array.isArray(aJson?.data) ? aJson.data : [])
        .filter((a: any) => String(a?.status || '').toUpperCase() === 'APPROVED')
        .map((a: any) => ({
          id: Number(a.id),
          application_no: a.application_no,
          proponent_id: Number(a.proponent_id),
          proponent_name: a.proponent_name ?? null,
        }));
      const approvedProponentIds = new Set(approvedApplications.map((a) => a.proponent_id));
      const proponents: Option[] = (prJson.data || [])
        .filter((x: any) => approvedProponentIds.has(Number(x.id)))
        .map((x: any) => ({ value: String(x.id), label: x.business_name }));

      return {
        permits: pJson.data || [],
        proponents,
        approvedApplications,
        permitTypes: [...complianceTypeOptions, RESERVED_PERMIT_TYPE],
      };
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to load'),
  });

  const permits = data?.permits ?? [];
  useEffect(() => {
    if (highlightId != null) highlightedRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, permits]);
  const proponentOptions = data?.proponents ?? [];
  const approvedApplications = data?.approvedApplications ?? [];
  // Scoped to the currently selected locator (if any) — picking a business
  // with only one approved application further down auto-fills it (see
  // the Locator field's onChange below); with several, this just narrows
  // the list to ones that actually belong to them.
  const applicationOptions = useMemo(
    () =>
      approvedApplications
        .filter((a) => !form.proponent_id || a.proponent_id === Number(form.proponent_id))
        .map((a) => ({
          value: String(a.id),
          label: `${a.application_no}${a.proponent_name ? ` — ${a.proponent_name}` : ''}`,
        })),
    [approvedApplications, form.proponent_id]
  );
  const permitTypeOptions = data?.permitTypes ?? [];
  const typeLabel = useMemo(
    () => Object.fromEntries(permitTypeOptions.map((t) => [t.value, t.label])),
    [permitTypeOptions]
  );

  const expiryStats = useMemo(() => {
    let expiringThisMonth = 0;
    let next90 = 0;
    let overdue = 0;
    for (const p of permits) {
      if (p.effective_status === 'REVOKED') continue;
      const days = daysUntil(p.expiry_date);
      if (days === null) continue;
      if (days < 0) overdue += 1;
      else if (days <= 30) expiringThisMonth += 1;
      if (days >= 0 && days <= 90) next90 += 1;
    }
    return { expiringThisMonth, next90, overdue };
  }, [permits]);

  const filtered = useMemo(() => {
    let base = permits;
    if (expiryFilter) {
      base = base.filter((p) => {
        if (p.effective_status === 'REVOKED') return false;
        const days = daysUntil(p.expiry_date);
        if (days === null) return false;
        if (expiryFilter === 'OVERDUE') return days < 0;
        if (expiryFilter === 'THIS_MONTH') return days >= 0 && days <= 30;
        return days >= 0 && days <= 90;
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) =>
      [p.permit_no, p.proponent_name, typeLabel[p.permit_type], p.issuing_authority, p.effective_status]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [permits, search, expiryFilter, typeLabel]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPanelOpen(true);
  }
  function openEdit(p: PermitRow) {
    setEditing(p);
    setForm({
      proponent_id: String(p.proponent_id),
      application_id: p.application_id ? String(p.application_id) : '',
      permit_type: p.permit_type,
      permit_no: p.permit_no || '',
      issuing_authority: p.issuing_authority || '',
      issue_date: dateInput(p.issue_date),
      expiry_date: dateInput(p.expiry_date),
      status: p.status || 'VALID',
      remarks: p.remarks || '',
    });
    setPanelOpen(true);
  }

  async function save() {
    if (!form.proponent_id) {
      toast.error('Locator is required');
      return;
    }
    if (!form.permit_type) {
      toast.error('Permit type is required');
      return;
    }
    if (!form.permit_no.trim()) {
      toast.error('Permit no. is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        proponent_id: Number(form.proponent_id),
        application_id: form.application_id ? Number(form.application_id) : null,
        permit_type: form.permit_type,
        permit_no: form.permit_no.trim(),
        issuing_authority: form.issuing_authority.trim() || null,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date || null,
        status: form.status,
        remarks: form.remarks.trim() || null,
      };
      const res = await fetch(editing ? `/api/permits/${editing.id}` : '/api/permits', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');
      setPanelOpen(false);
      await refresh({ showLoading: false });
      toast.success(editing ? 'Permit updated' : 'Permit added');
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    setSaving(true);
    try {
      const res = await fetch(`/api/permits/${id}/deactivate`, { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Delete failed');
      setConfirmDeleteId(null);
      await refresh({ showLoading: false });
      toast.success('Permit removed');
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  function renderExpiryHint(p: PermitRow) {
    const days = daysUntil(p.expiry_date);
    if (p.effective_status === 'REVOKED' || days === null) return null;
    return (
      <div className="mt-0.5">
        {days < 0 ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#fca5a5' }}>
            <AlertTriangle size={10} /> {Math.abs(days)}d overdue
          </span>
        ) : (
          <span className="text-[10px] text-secondary">{days}d left</span>
        )}
      </div>
    );
  }

  function renderRowActions(p: PermitRow) {
    return (
      <>
        {p.has_certificate ? (
          <button
            className="rounded-md p-1.5 text-secondary cursor-pointer"
            onClick={() => window.open(`/api/permits/${p.id}/certificate?view=1`, '_blank')}
            title="View permit certificate"
          >
            <FileText size={14} />
          </button>
        ) : null}
        {p.has_contract_certificate ? (
          <button
            className="rounded-md p-1.5 text-secondary cursor-pointer"
            onClick={() => window.open(`/api/permits/${p.id}/contract-certificate?view=1`, '_blank')}
            title="View contract"
          >
            <FileSignature size={14} />
          </button>
        ) : null}
        {canEdit ? (
          <button className="rounded-md p-1.5 text-secondary cursor-pointer" onClick={() => openEdit(p)} title="Edit">
            <Pencil size={14} />
          </button>
        ) : null}
        {canDelete ? (
          <button className="rounded-md p-1.5 text-secondary cursor-pointer" onClick={() => setConfirmDeleteId(p.id)} title="Remove">
            <Trash2 size={14} />
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Background-color pulse, not box-shadow — a box-shadow "ring" on a
          <tr> paints inconsistently (bleeds into the row above/below instead
          of outlining just the one row), so the highlight is a plain
          background wash plus a solid left-edge accent instead. */}
      <style>{`
        @keyframes ciac-permit-highlight-pulse {
          0%, 100% { background-color: rgba(148,163,184,.28); }
          50% { background-color: rgba(148,163,184,.08); }
        }
      `}</style>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <ExpiryStatCard
          label="Expiring This Month"
          value={expiryStats.expiringThisMonth}
          tone="warn"
          active={expiryFilter === 'THIS_MONTH'}
          onClick={() => setExpiryFilter((f) => (f === 'THIS_MONTH' ? null : 'THIS_MONTH'))}
        />
        <ExpiryStatCard
          label="Next 90 Days"
          value={expiryStats.next90}
          active={expiryFilter === 'NEXT_90'}
          onClick={() => setExpiryFilter((f) => (f === 'NEXT_90' ? null : 'NEXT_90'))}
        />
        <ExpiryStatCard
          label="Overdue"
          value={expiryStats.overdue}
          tone="danger"
          active={expiryFilter === 'OVERDUE'}
          onClick={() => setExpiryFilter((f) => (f === 'OVERDUE' ? null : 'OVERDUE'))}
        />
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        {/* Search + New Permit share one row (search first so it stays left on every size). */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative group flex-1 min-w-0 sm:flex-none sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search permits..."
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)]"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
          {canAdd ? (
            <button
              className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-[11px] font-semibold shadow-sm cursor-pointer whitespace-nowrap"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              onClick={openCreate}
            >
              + New Permit
            </button>
          ) : null}
        </div>

        {isLoading ? (
          <TableSkeleton columns={7} rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No permits" description="Add a permit to get started." />
        ) : (
          <>
          {/* Phones: stacked cards instead of an 8-column table */}
          <div className="sm:hidden space-y-2">
            {filtered.map((p) => {
              const s = STATUS_STYLE[p.effective_status] || STATUS_STYLE.REVOKED;
              const isHighlighted = p.id === highlightId;
              return (
                <div
                  key={p.id}
                  ref={isHighlighted ? (highlightedRowRef as React.RefObject<HTMLDivElement>) : undefined}
                  className="rounded-xl p-3"
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderLeft: isHighlighted ? '4px solid #94a3b8' : '1px solid var(--border-subtle)',
                    backgroundColor: isHighlighted ? undefined : 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
                    ...(isHighlighted ? { animation: 'ciac-permit-highlight-pulse 1.6s ease-in-out infinite' } : {}),
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold leading-snug break-words" style={{ color: 'var(--text)' }}>
                        {p.proponent_name || `#${p.proponent_id}`}
                      </div>
                      <div className="mt-0.5 text-[11px] text-secondary">{typeLabel[p.permit_type] || p.permit_type}</div>
                    </div>
                    <span
                      className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: s.bg, color: s.color }}
                    >
                      {p.effective_status}
                    </span>
                  </div>

                  <div className="mt-2 text-[11px] font-semibold break-all" style={{ color: 'var(--text)' }}>
                    {p.permit_no}
                    {p.issuing_authority ? <span className="font-normal text-secondary"> · {p.issuing_authority}</span> : null}
                  </div>

                  <div className="mt-2.5 flex items-end justify-between gap-2">
                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                      <div>
                        <div className="text-[9px] uppercase tracking-wider text-secondary">Issued</div>
                        <div style={{ color: 'var(--text)' }}>{fmt(p.issue_date)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase tracking-wider text-secondary">Expiry</div>
                        <div style={{ color: 'var(--text)' }}>{fmt(p.expiry_date)}</div>
                        {renderExpiryHint(p)}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-0.5 -mr-1.5 -mb-1">{renderRowActions(p)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Locator', 'Type', 'Permit No.', 'Authority', 'Issued', 'Expiry', 'Status', 'Actions'].map((c) => (
                    <th key={c} className={cn('px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b', c === 'Actions' && 'text-right pr-2')} style={{ borderColor: 'var(--border-subtle)' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const s = STATUS_STYLE[p.effective_status] || STATUS_STYLE.REVOKED;
                  const isHighlighted = p.id === highlightId;
                  return (
                    <tr
                      key={p.id}
                      ref={isHighlighted ? (highlightedRowRef as React.RefObject<HTMLTableRowElement>) : undefined}
                      className="border-b last:border-b-0"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        ...(isHighlighted ? { animation: 'ciac-permit-highlight-pulse 1.6s ease-in-out infinite' } : {}),
                      }}
                    >
                      <td
                        className="px-3 py-2 text-[11px]"
                        style={{ color: 'var(--text)', borderLeft: isHighlighted ? '4px solid #94a3b8' : undefined }}
                      >
                        {p.proponent_name || `#${p.proponent_id}`}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{typeLabel[p.permit_type] || p.permit_type}</td>
                      <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{p.permit_no}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{p.issuing_authority || '—'}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{fmt(p.issue_date)}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">
                        {fmt(p.expiry_date)}
                        {renderExpiryHint(p)}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>
                          {p.effective_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 pr-2">
                        <div className="flex items-center justify-end gap-2">{renderRowActions(p)}</div>
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

      <SidePanel
        open={panelOpen}
        title={editing ? 'Edit Permit' : 'New Permit'}
        subtitle="permits table"
        onClose={() => setPanelOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!form.proponent_id || !form.permit_type || !form.permit_no.trim()}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldLabel label="Locator">
            <AppSelect
              options={proponentOptions}
              value={form.proponent_id}
              onChange={(v) => {
                // Auto-fill the linked application when this locator has
                // exactly one approved one — otherwise leave it for the
                // officer to pick, and drop any prior pick that doesn't
                // belong to the newly selected locator.
                const matches = approvedApplications.filter((a) => String(a.proponent_id) === v);
                setForm((p) => ({
                  ...p,
                  proponent_id: v,
                  application_id: matches.length === 1 ? String(matches[0].id) : '',
                }));
              }}
              placeholder="Select locator..."
              isDisabled={saving}
            />
          </FieldLabel>
          <FieldLabel label="Application (optional)">
            <AppSelect options={applicationOptions} value={form.application_id} onChange={(v) => setForm((p) => ({ ...p, application_id: v }))} placeholder="Link to application..." isClearable isDisabled={saving} />
          </FieldLabel>
          <FieldLabel label="Permit Type">
            <AppSelect
              options={permitTypeOptions}
              value={form.permit_type}
              onChange={(v) => setForm((p) => ({ ...p, permit_type: v || '' }))}
              placeholder="Select type..."
              isDisabled={saving}
            />
          </FieldLabel>
          <FieldLabel label="Permit No.">
            <Input value={form.permit_no} onChange={(v) => setForm((p) => ({ ...p, permit_no: v }))} />
          </FieldLabel>
          <FieldLabel label="Issuing Authority">
            <Input value={form.issuing_authority} onChange={(v) => setForm((p) => ({ ...p, issuing_authority: v }))} />
          </FieldLabel>
          <FieldLabel label="Status">
            <AppSelect
              options={[
                { value: 'VALID', label: 'Valid' },
                { value: 'REVOKED', label: 'Revoked' },
              ]}
              value={form.status}
              onChange={(v) => setForm((p) => ({ ...p, status: v || 'VALID' }))}
              isDisabled={saving}
            />
          </FieldLabel>
          <FieldLabel label="Issue Date">
            <DatePicker
              mode="single"
              bordered
              fullWidth
              placeholder="Select date"
              value={parseYmd(form.issue_date)}
              onChange={(d: Date | null) => setForm((p) => ({ ...p, issue_date: toYmd(d) }))}
            />
          </FieldLabel>
          <FieldLabel label="Expiry Date">
            <DatePicker
              mode="single"
              bordered
              fullWidth
              placeholder="Select date"
              value={parseYmd(form.expiry_date)}
              onChange={(d: Date | null) => setForm((p) => ({ ...p, expiry_date: toYmd(d) }))}
            />
          </FieldLabel>
        </div>
        <div className="mt-3">
          <FieldLabel label="Remarks">
            <Input value={form.remarks} onChange={(v) => setForm((p) => ({ ...p, remarks: v }))} />
          </FieldLabel>
        </div>
        <p className="mt-3 text-[11px] text-secondary">
          Status shows as Valid / Expiring / Expired automatically based on the expiry date. Set Revoked to override.
        </p>
      </SidePanel>

      <ConfirmModal
        open={confirmDeleteId !== null}
        title="Remove permit?"
        description="This permit will no longer be visible to the locator."
        confirmText="Remove"
        danger
        loading={saving}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId !== null && void remove(confirmDeleteId)}
      />
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{label}</div>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text' }: { value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <input
      type={type}
      className="app-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ExpiryStatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'warn' | 'danger';
  active: boolean;
  onClick: () => void;
}) {
  const color = tone === 'danger' ? '#fca5a5' : tone === 'warn' ? '#f59e0b' : 'var(--text)';
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-card p-2.5 sm:p-3.5 !border-transparent min-w-0 flex flex-col justify-between text-left cursor-pointer transition-shadow"
      style={{
        backgroundColor: 'var(--surface)',
        boxShadow: active ? `0 0 0 2px ${color}` : undefined,
      }}
      title={active ? 'Click again to clear this filter' : `Filter the table to ${label.toLowerCase()}`}
    >
      <div className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide sm:tracking-widest text-secondary leading-tight">
        {label}
      </div>
      <div className="mt-1 text-xl sm:text-2xl font-bold" style={{ color }}>{value}</div>
    </button>
  );
}
