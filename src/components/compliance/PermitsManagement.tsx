import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';

const PERMIT_TYPES = [
  { value: 'ENVIRONMENTAL', label: 'Environmental' },
  { value: 'FIRE', label: 'Fire Safety' },
  { value: 'OCCUPANCY', label: 'Occupancy' },
  { value: 'SANITARY', label: 'Sanitary' },
  { value: 'AUTHORITY_TO_OPERATE', label: 'Authority to Operate' },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(PERMIT_TYPES.map((t) => [t.value, t.label]));

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
};

type Option = { value: string; label: string };

type Bundle = { permits: PermitRow[]; proponents: Option[]; applications: Option[] };

const EMPTY_FORM = {
  proponent_id: '',
  application_id: '',
  permit_type: 'ENVIRONMENTAL',
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

export function PermitsManagement() {
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<PermitRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data, isLoading, refresh } = useSessionStorageCachedResource<Bundle>({
    cacheKey: 'ciac.permits_bundle.v1',
    ttlMs: 3 * 60 * 1000,
    fetcher: async () => {
      const [pRes, prRes, aRes] = await Promise.all([
        fetch('/api/permits', { credentials: 'include' }),
        fetch('/api/proponents', { credentials: 'include' }),
        fetch('/api/applications', { credentials: 'include' }),
      ]);
      const [pJson, prJson, aJson] = await Promise.all([pRes.json(), prRes.json(), aRes.json()]);
      if (!pRes.ok) throw new Error(pJson?.message || 'Failed to load permits');
      return {
        permits: pJson.data || [],
        proponents: (prJson.data || []).map((x: any) => ({ value: String(x.id), label: x.business_name })),
        applications: (aJson.data || []).map((x: any) => ({
          value: String(x.id),
          label: `${x.application_no}${x.proponent_name ? ` — ${x.proponent_name}` : ''}`,
        })),
      };
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to load'),
  });

  const permits = data?.permits ?? [];
  const proponentOptions = data?.proponents ?? [];
  const applicationOptions = data?.applications ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return permits;
    return permits.filter((p) =>
      [p.permit_no, p.proponent_name, TYPE_LABEL[p.permit_type], p.issuing_authority, p.effective_status]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [permits, search]);

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

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>Permits</h3>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm cursor-pointer"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            onClick={openCreate}
          >
            + New Permit
          </button>
        </div>

        <div className="relative group w-full sm:w-72 mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search permits..."
            className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)]"
            style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
          />
        </div>

        {isLoading ? (
          <TableSkeleton columns={6} rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No permits" description="Add a permit to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Locator', 'Type', 'Permit No.', 'Authority', 'Expiry', 'Status', 'Actions'].map((c) => (
                    <th key={c} className={cn('px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b', c === 'Actions' && 'text-right pr-2')} style={{ borderColor: 'var(--border-subtle)' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const s = STATUS_STYLE[p.effective_status] || STATUS_STYLE.REVOKED;
                  return (
                    <tr key={p.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{p.proponent_name || `#${p.proponent_id}`}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{TYPE_LABEL[p.permit_type] || p.permit_type}</td>
                      <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{p.permit_no}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{p.issuing_authority || '—'}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{fmt(p.expiry_date)}</td>
                      <td className="px-3 py-2 text-[11px]">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>
                          {p.effective_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 pr-2">
                        <div className="flex items-center justify-end gap-2">
                          <button className="rounded-md p-1.5 text-secondary cursor-pointer" onClick={() => openEdit(p)} title="Edit">
                            <Pencil size={14} />
                          </button>
                          <button className="rounded-md p-1.5 text-secondary cursor-pointer" onClick={() => setConfirmDeleteId(p.id)} title="Remove">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SidePanel
        open={panelOpen}
        title={editing ? 'Edit Permit' : 'New Permit'}
        subtitle="permits table"
        onClose={() => setPanelOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!form.proponent_id || !form.permit_no.trim()}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldLabel label="Locator">
            <AppSelect options={proponentOptions} value={form.proponent_id} onChange={(v) => setForm((p) => ({ ...p, proponent_id: v }))} placeholder="Select locator..." isDisabled={saving} />
          </FieldLabel>
          <FieldLabel label="Application (optional)">
            <AppSelect options={applicationOptions} value={form.application_id} onChange={(v) => setForm((p) => ({ ...p, application_id: v }))} placeholder="Link to application..." isClearable isDisabled={saving} />
          </FieldLabel>
          <FieldLabel label="Permit Type">
            <AppSelect options={PERMIT_TYPES} value={form.permit_type} onChange={(v) => setForm((p) => ({ ...p, permit_type: v || 'ENVIRONMENTAL' }))} isDisabled={saving} />
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
            <Input type="date" value={form.issue_date} onChange={(v) => setForm((p) => ({ ...p, issue_date: v }))} />
          </FieldLabel>
          <FieldLabel label="Expiry Date">
            <Input type="date" value={form.expiry_date} onChange={(v) => setForm((p) => ({ ...p, expiry_date: v }))} />
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
      className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
      style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
