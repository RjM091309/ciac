import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';

type ProponentRow = {
  id: number;
  user_id: number | null;
  business_name: string;
  registration_no: string | null;
  tin: string | null;
  address: string | null;
  contact_no: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_active: number;
};

type UserOption = {
  id: number;
  username: string;
  full_name: string | null;
  is_active: number;
};

function api(path: string) {
  return path;
}

export function ProponentsManagement() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proponents, setProponents] = useState<ProponentRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [editing, setEditing] = useState<ProponentRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);

  const [form, setForm] = useState({
    user_id: '',
    business_name: '',
    registration_no: '',
    tin: '',
    address: '',
    contact_no: '',
  });

  const stats = useMemo(() => {
    const active = proponents.filter((p) => p.is_active === 1).length;
    const inactive = proponents.filter((p) => p.is_active === 0).length;
    return { active, inactive, total: proponents.length };
  }, [proponents]);

  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        value: String(u.id),
        label: u.full_name ? `${u.full_name} (${u.username})` : u.username,
      })),
    [users],
  );

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [pRes, uRes] = await Promise.all([
        fetch(api('/api/proponents'), { credentials: 'include' }),
        fetch(api('/api/users'), { credentials: 'include' }),
      ]);

      const pJson = await pRes.json();
      const uJson = await uRes.json();

      if (!pRes.ok) throw new Error(pJson?.message || 'Failed to load proponents');
      if (!uRes.ok) throw new Error(uJson?.message || 'Failed to load users');

      setProponents(pJson.data || []);
      setUsers(uJson.data || []);
    } catch (e: any) {
      const message = e?.message || 'Failed to load data';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({
      user_id: '',
      business_name: '',
      registration_no: '',
      tin: '',
      address: '',
      contact_no: '',
    });
    setIsCreateOpen(true);
  }

  function openEdit(p: ProponentRow) {
    setIsCreateOpen(true);
    setEditing(p);
    setForm({
      user_id: p.user_id != null ? String(p.user_id) : '',
      business_name: p.business_name || '',
      registration_no: p.registration_no || '',
      tin: p.tin || '',
      address: p.address || '',
      contact_no: p.contact_no || '',
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        user_id: form.user_id.trim() ? Number(form.user_id) : null,
        business_name: form.business_name.trim(),
        registration_no: form.registration_no.trim() || null,
        tin: form.tin.trim() || null,
        address: form.address.trim() || null,
        contact_no: form.contact_no.trim() || null,
      };

      if (!payload.business_name) throw new Error('Business name is required');

      const res = await fetch(api(editing ? `/api/proponents/${editing.id}` : '/api/proponents'), {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');

      setIsCreateOpen(false);
      await loadAll();
      toast.success(editing ? 'Proponent updated successfully' : 'Proponent created successfully');
    } catch (e: any) {
      const message = e?.message || 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/proponents/${id}/deactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      await loadAll();
      toast.success('Proponent deactivated successfully');
      setConfirmDeactivateId(null);
    } catch (e: any) {
      const message = e?.message || 'Deactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function reactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/proponents/${id}/reactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reactivate failed');
      await loadAll();
      toast.success('Proponent reactivated successfully');
    } catch (e: any) {
      const message = e?.message || 'Reactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
        <StatCard label="Active Proponents" value={String(stats.active)} />
        <StatCard label="Total Proponents" value={String(stats.total)} />
        <StatCard label="Deactivated" value={String(stats.inactive)} />
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Proponent Management List
          </h3>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            onClick={openCreate}
          >
            + New Record
          </button>
        </div>

        {error && (
          <div
            className="mb-3 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-xs text-secondary">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Business Name', 'TIN', 'Registration No.', 'Contact No.', 'Status', 'Actions'].map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proponents.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {p.business_name}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{p.tin || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{p.registration_no || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{p.contact_no || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{p.is_active ? 'Active' : 'Inactive'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          className={cn('rounded-md px-2 py-1 text-[11px] font-semibold border')}
                          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                          onClick={() => openEdit(p)}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        {p.is_active ? (
                          <button
                            className="rounded-md px-2 py-1 text-[11px] font-semibold border"
                            style={{ borderColor: 'rgba(252,165,165,.35)', color: '#fca5a5' }}
                            onClick={() => setConfirmDeactivateId(p.id)}
                            disabled={saving}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="rounded-md px-2 py-1 text-[11px] font-semibold border"
                            style={{ borderColor: 'rgba(52,211,153,.35)', color: '#6ee7b7' }}
                            onClick={() => setConfirmReactivateId(p.id)}
                            disabled={saving}
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {proponents.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-xs text-secondary" colSpan={6}>
                      No proponents found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SidePanel
        open={isCreateOpen}
        title={editing ? 'Edit Proponent' : 'New Proponent'}
        subtitle="Proponents master table"
        onClose={() => setIsCreateOpen(false)}
        onSave={save}
        saving={saving}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Business name">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.business_name}
              onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))}
            />
          </Field>
          <Field label="Linked user (optional)">
            <AppSelect
              options={userOptions}
              value={form.user_id}
              onChange={(value) => setForm((p) => ({ ...p, user_id: value || '' }))}
              placeholder="Select user account..."
              isClearable
              isDisabled={saving}
            />
          </Field>
          <Field label="Registration no">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.registration_no}
              onChange={(e) => setForm((p) => ({ ...p, registration_no: e.target.value }))}
            />
          </Field>
          <Field label="TIN">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.tin}
              onChange={(e) => setForm((p) => ({ ...p, tin: e.target.value }))}
            />
          </Field>
          <Field label="Contact no">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.contact_no}
              onChange={(e) => setForm((p) => ({ ...p, contact_no: e.target.value }))}
            />
          </Field>
          <Field label="Address">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.address}
              onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
            />
          </Field>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate proponent?"
        description="This proponent will be marked inactive. You can re-activate later."
        confirmText="Deactivate"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateId(null)}
        onConfirm={() => {
          if (confirmDeactivateId !== null) {
            void deactivate(confirmDeactivateId);
          }
        }}
      />

      <ConfirmModal
        open={confirmReactivateId !== null}
        title="Reactivate proponent?"
        description="This proponent will be marked active again and can be used in transactions."
        confirmText="Reactivate"
        loading={saving}
        onCancel={() => setConfirmReactivateId(null)}
        onConfirm={() => {
          if (confirmReactivateId !== null) {
            void reactivate(confirmReactivateId);
            setConfirmReactivateId(null);
          }
        }}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-3 border flex flex-col gap-1" style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}>
      <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{label}</span>
      <span className="text-base sm:text-lg font-bold leading-tight" style={{ color: 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{label}</div>
      {children}
    </div>
  );
}

