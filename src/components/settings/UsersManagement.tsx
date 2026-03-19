import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';

type Role = {
  id: number;
  name: string;
  description?: string | null;
  is_active?: number;
};

type UserRow = {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  is_active: number;
  created_at?: string | null;
  updated_at?: string | null;
  roles: { id: number; name: string; description?: string | null }[];
};

function api(path: string) {
  return path;
}

export function UsersManagement() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);

  const [form, setForm] = useState({
    username: '',
    email: '',
    full_name: '',
    password: '',
    role_id: '',
  });

  const stats = useMemo(() => {
    const active = users.filter((u) => u.is_active === 1).length;
    const inactive = users.filter((u) => u.is_active === 0).length;
    return { active, inactive, total: users.length };
  }, [users]);

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: String(r.id), label: r.name })),
    [roles]
  );

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [uRes, rRes] = await Promise.all([
        fetch(api('/api/users'), { credentials: 'include' }),
        fetch(api('/api/roles'), { credentials: 'include' }),
      ]);

      const uJson = await uRes.json();
      const rJson = await rRes.json();

      if (!uRes.ok) throw new Error(uJson?.message || 'Failed to load users');
      if (!rRes.ok) throw new Error(rJson?.message || 'Failed to load roles');

      setUsers(uJson.data || []);
      setRoles(rJson.data || []);
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
      username: '',
      email: '',
      full_name: '',
      password: '',
      role_id: roles[0]?.id ? String(roles[0].id) : '',
    });
    setIsCreateOpen(true);
  }

  function openEdit(u: UserRow) {
    setIsCreateOpen(true);
    setEditing(u);
    setForm({
      username: u.username || '',
      email: u.email || '',
      full_name: u.full_name || '',
      password: '',
      role_id: u.roles?.[0]?.id ? String(u.roles[0].id) : roles[0]?.id ? String(roles[0].id) : '',
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        username: form.username.trim(),
        email: form.email.trim() || null,
        full_name: form.full_name.trim() || null,
        role_id: form.role_id ? Number(form.role_id) : null,
      };
      if (form.password.trim()) payload.password = form.password;

      if (!payload.username) throw new Error('Username is required');
      if (!editing && !payload.password) throw new Error('Password is required');

      const res = await fetch(api(editing ? `/api/users/${editing.id}` : '/api/users'), {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');

      setIsCreateOpen(false);
      await loadAll();
      toast.success(editing ? 'User updated successfully' : 'User created successfully');
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
      const res = await fetch(api(`/api/users/${id}/deactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      await loadAll();
      toast.success('User deactivated successfully');
      setConfirmDeactivateId(null);
    } catch (e: any) {
      const message = e?.message || 'Deactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
        <StatCard label="Active Users" value={String(stats.active)} />
        <StatCard label="Total Users" value={String(stats.total)} />
        <StatCard label="Deactivated" value={String(stats.inactive)} />
      </div>

      <div
        className="glass-card p-4 sm:p-5 !border-transparent"
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            User Management List
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
          <div className="mb-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}>
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
                  {['Username', 'Full Name', 'Email', 'Role', 'Status', 'Actions'].map((col) => (
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
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {u.username}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{u.full_name || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{u.email || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">
                      {u.roles && u.roles.length ? u.roles.map((r) => r.name).join(', ') : '-'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{u.is_active ? 'Active' : 'Inactive'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          className={cn(
                            'rounded-md px-2 py-1 text-[11px] font-semibold border',
                          )}
                          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                          onClick={() => openEdit(u)}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-md px-2 py-1 text-[11px] font-semibold border"
                          style={{ borderColor: 'rgba(252,165,165,.35)', color: '#fca5a5' }}
                          onClick={() => setConfirmDeactivateId(u.id)}
                          disabled={saving || u.is_active === 0}
                        >
                          Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-xs text-secondary" colSpan={6}>
                      No users found.
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
        title={editing ? 'Edit User' : 'New User'}
        subtitle="Users table + role mapping"
        onClose={() => setIsCreateOpen(false)}
        onSave={save}
        saving={saving}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Username">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.username}
              onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
            />
          </Field>
          <Field label="Role">
            <AppSelect
              options={roleOptions}
              value={form.role_id}
              onChange={(value) => setForm((p) => ({ ...p, role_id: value }))}
              placeholder="Select role..."
              isClearable
              isDisabled={saving}
            />
          </Field>
          <Field label="Full name">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.full_name}
              onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
            />
          </Field>
          <Field label="Email">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </Field>
          <Field label={editing ? 'Password (leave blank to keep)' : 'Password'}>
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              type="password"
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            />
          </Field>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate user?"
        description="This user will no longer be able to access the system unless reactivated."
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
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-3 border flex flex-col gap-1"
      style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}
    >
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

