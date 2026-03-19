import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, RotateCcw, Search, UserX } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';

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
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

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

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const roleStr = u.roles?.length ? u.roles.map((r) => r.name).join(', ') : '';
      const statusStr = u.is_active === 1 ? 'active' : 'inactive';
      return (
        (u.username || '').toLowerCase().includes(q) ||
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        roleStr.toLowerCase().includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [users, searchQuery]);

  const totalPages = useMemo(() => {
    const count = Math.max(1, Math.ceil(filteredUsers.length / Math.max(1, pageSize)));
    return count;
  }, [filteredUsers.length, pageSize]);

  const pagedUsers = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, page, pageSize, totalPages]);

  const showingRange = useMemo(() => {
    if (filteredUsers.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    const from = (safePage - 1) * pageSize + 1;
    const to = Math.min(filteredUsers.length, safePage * pageSize);
    return { from, to };
  }, [filteredUsers.length, page, pageSize, totalPages]);

  const visiblePageNumbers = useMemo(() => {
    const current = Math.min(Math.max(1, page), totalPages);
    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [page, totalPages]);

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: String(r.id), label: r.name })),
    [roles]
  );
  const canSubmit = useMemo(() => {
    const username = form.username.trim();
    const email = form.email.trim();
    const fullName = form.full_name.trim();
    const password = form.password.trim();
    const roleId = form.role_id;

    if (!username) return false;

    if (!editing) {
      // For create mode, require required fields and at least one input activity.
      const hasAnyInput = Boolean(username || email || fullName || password || roleId);
      return hasAnyInput && Boolean(password);
    }

    const originalUsername = (editing.username || '').trim();
    const originalEmail = (editing.email || '').trim();
    const originalFullName = (editing.full_name || '').trim();
    const originalRoleId = editing.roles?.[0]?.id ? String(editing.roles[0].id) : roles[0]?.id ? String(roles[0].id) : '';

    const hasChanged =
      username !== originalUsername ||
      email !== originalEmail ||
      fullName !== originalFullName ||
      roleId !== originalRoleId ||
      Boolean(password);

    return hasChanged;
  }, [editing, form.email, form.full_name, form.password, form.role_id, form.username, roles]);

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

      setUsers(
        (uJson.data || []).map((u: any) => ({
          ...u,
          is_active: Number(u?.is_active) ? 1 : 0,
        }))
      );
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

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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

  async function reactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/reactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reactivate failed');
      await loadAll();
      toast.success('User reactivated successfully');
      setConfirmReactivateId(null);
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
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm cursor-pointer"
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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <div className="relative group w-full sm:w-72">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
                  size={14}
                />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
                  style={{
                    backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
                  }}
                />
              </div>
            </div>
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Username', 'Full Name', 'Email', 'Role', 'Status', 'Actions'].map((col) => (
                    <th
                      key={col}
                      className={cn(
                        'px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b',
                        col === 'Actions' && 'text-right pr-2'
                      )}
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((u) => (
                  <tr key={u.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {u.username}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{u.full_name || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{u.email || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">
                      {u.roles && u.roles.length ? u.roles.map((r) => r.name).join(', ') : '-'}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={
                          u.is_active === 1
                            ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
                            : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' }
                        }
                      >
                        {u.is_active === 1 ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2 pr-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className={cn(
                            'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                            saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                          )}
                          onClick={() => openEdit(u)}
                          disabled={saving}
                          aria-label={`Edit ${u.username}`}
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        {u.is_active === 1 ? (
                          <button
                            className={cn(
                              'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                            )}
                            onClick={() => setConfirmDeactivateId(u.id)}
                            disabled={saving}
                            aria-label={`Deactivate ${u.username}`}
                            title="Deactivate"
                          >
                            <UserX size={14} />
                          </button>
                        ) : (
                          <button
                            className={cn(
                              'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                            )}
                            onClick={() => setConfirmReactivateId(u.id)}
                            disabled={saving}
                            aria-label={`Reactivate ${u.username}`}
                            title="Reactivate"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-xs text-secondary" colSpan={6}>
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <DataTableControls
              page={page}
              totalPages={totalPages}
              totalItems={filteredUsers.length}
              showingFrom={showingRange.from}
              showingTo={showingRange.to}
              visiblePageNumbers={visiblePageNumbers}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100, 200]}
              onPageSizeChange={(value) => setPageSize(value)}
              onPageChange={(p) => setPage(p)}
              loading={loading}
            />
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
        saveDisabled={!canSubmit}
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

      <ConfirmModal
        open={confirmReactivateId !== null}
        title="Reactivate user?"
        description="This user will regain access to the system."
        confirmText="Reactivate"
        loading={saving}
        onCancel={() => setConfirmReactivateId(null)}
        onConfirm={() => {
          if (confirmReactivateId !== null) {
            void reactivate(confirmReactivateId);
          }
        }}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-3 flex flex-col gap-1 shadow-sm"
      style={{
        backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)',
      }}
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

