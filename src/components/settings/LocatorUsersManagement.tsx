import React, { useEffect, useMemo, useState } from 'react';
import { Ban, KeyRound, LogOut, Pencil, RotateCcw, Search, ShieldCheck, ShieldOff, Smartphone, UserX } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DataTableControls } from '../ui/DataTableControls';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';

type Role = {
  id: number;
  name: string;
  description?: string | null;
  is_active?: number;
};

type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

type UserRow = {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  is_active: number;
  status?: AccountStatus;
  is_locked?: boolean;
  totp_enabled?: number;
  created_at?: string | null;
  updated_at?: string | null;
  roles: { id: number; name: string; description?: string | null }[];
};

type UsersRolesData = {
  users: UserRow[];
  roles: Role[];
};

function api(path: string) {
  return path;
}

// This page is the Locator counterpart to UsersManagement — same `users`
// table and API, filtered to the Locator role only so locator accounts don't
// mix with staff accounts in the same list.
function isLocatorRoleName(name: string) {
  return String(name || '').trim().toUpperCase() === 'PROPONENT';
}

export function LocatorUsersManagement() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [confirmSuspendId, setConfirmSuspendId] = useState<number | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
  const [confirmResetPasswordId, setConfirmResetPasswordId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const { data: usersRoles, isLoading, isRevalidating, refresh } = useSessionStorageCachedResource<UsersRolesData>({
    cacheKey: 'ciac.users_roles.v1',
    ttlMs: 5 * 60 * 1000, // 5 minutes — shares the cache key with UsersManagement since it's the same underlying data
    fetcher: async () => {
      setError(null);
      const [uRes, rRes] = await Promise.all([
        fetch(api('/api/users'), { credentials: 'include' }),
        fetch(api('/api/roles'), { credentials: 'include' }),
      ]);

      const uJson = await uRes.json();
      const rJson = await rRes.json();

      if (!uRes.ok) throw new Error(uJson?.message || 'Failed to load users');
      if (!rRes.ok) throw new Error(rJson?.message || 'Failed to load roles');

      return {
        users: (uJson.data || []).map((u: any) => ({
          ...u,
          is_active: Number(u?.is_active) ? 1 : 0,
          totp_enabled: Number(u?.totp_enabled) ? 1 : 0,
        })),
        roles: rJson.data || [],
      };
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : 'Failed to load data';
      setError(message);
      toast.error(message);
    },
  });

  const allRoles = usersRoles?.roles ?? [];
  const locatorRole = useMemo(() => allRoles.find((r) => isLocatorRoleName(r.name)) || null, [allRoles]);

  const userRows = (Array.isArray(usersRoles?.users) ? usersRoles.users : []).filter((u) =>
    (u.roles || []).some((r) => isLocatorRoleName(r.name))
  );

  const [form, setForm] = useState({
    username: '',
    email: '',
    full_name: '',
  });

  const stats = useMemo(() => {
    const active = userRows.filter((u) => u.is_active === 1).length;
    const suspended = userRows.filter((u) => u.status === 'SUSPENDED').length;
    const inactive = userRows.filter((u) => u.is_active === 0).length;
    return { active, suspended, inactive, total: userRows.length };
  }, [userRows]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return userRows;
    return userRows.filter((u) => {
      const statusStr = u.status === 'SUSPENDED' ? 'suspended' : u.is_active === 1 ? 'active' : 'deactivated inactive';
      return (
        (u.username || '').toLowerCase().includes(q) ||
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [userRows, searchQuery]);

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

  const canSubmit = useMemo(() => {
    const username = form.username.trim();
    const email = form.email.trim();
    const fullName = form.full_name.trim();

    if (!username) return false;
    if (!email) return false;
    if (!locatorRole) return false;

    if (!editing) {
      return Boolean(username && email);
    }

    const originalUsername = (editing.username || '').trim();
    const originalEmail = (editing.email || '').trim();
    const originalFullName = (editing.full_name || '').trim();

    return username !== originalUsername || email !== originalEmail || fullName !== originalFullName;
  }, [editing, form.email, form.full_name, form.username, locatorRole]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function openCreate() {
    setEditing(null);
    setForm({ username: '', email: '', full_name: '' });
    setIsCreateOpen(true);
  }

  function openEdit(u: UserRow) {
    setIsCreateOpen(true);
    setEditing(u);
    setForm({
      username: u.username || '',
      email: u.email || '',
      full_name: u.full_name || '',
    });
  }

  async function save() {
    if (!locatorRole) {
      toast.error('No Locator role found — set it up in Manage Roles first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        username: form.username.trim(),
        email: form.email.trim(),
        full_name: form.full_name.trim() || null,
        role_id: locatorRole.id,
      };
      // No password field on this form: the backend generates one and emails
      // it when none is supplied, same as an admin-triggered reset.

      if (!payload.username) throw new Error('Username is required');
      if (!payload.email) throw new Error('Email is required');

      const res = await fetch(api(editing ? `/api/users/${editing.id}` : '/api/users'), {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');

      setIsCreateOpen(false);
      await refresh({ showLoading: false });
      if (!editing) {
        if (json.emailSent) {
          toast.success(json.message || 'Locator account created — a temporary password was emailed.');
        } else {
          toast.warning(json.message || 'Locator account created, but the email could not be sent.');
        }
      } else {
        toast.success('Locator account updated successfully');
      }
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
      await refresh({ showLoading: false });
      toast.success('Locator account deactivated successfully');
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
      await refresh({ showLoading: false });
      toast.success('Locator account reactivated successfully');
      setConfirmReactivateId(null);
    } catch (e: any) {
      const message = e?.message || 'Reactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function suspend(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/suspend`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Suspend failed');
      await refresh({ showLoading: false });
      toast.success('Locator account suspended');
      setConfirmSuspendId(null);
    } catch (e: any) {
      const message = e?.message || 'Suspend failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function unsuspend(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/unsuspend`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Unsuspend failed');
      await refresh({ showLoading: false });
      toast.success('Locator account reinstated');
    } catch (e: any) {
      const message = e?.message || 'Unsuspend failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function revokeSessions(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/revoke-sessions`), { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to revoke sessions');
      toast.success('Active sessions revoked — the locator must log in again');
      setConfirmRevokeId(null);
    } catch (e: any) {
      const message = e?.message || 'Failed to revoke sessions';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  /** Generates a temp password server-side, emails it, and forces the
   * locator to set their own password on next login. */
  async function resetPassword(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/reset-password`), { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to reset password');
      if (json.emailSent) {
        toast.success(json.message || 'Password reset — a new temporary password was emailed.');
      } else {
        toast.warning(json.message || 'Password reset, but the email could not be sent.');
      }
      setConfirmResetPasswordId(null);
    } catch (e: any) {
      const message = e?.message || 'Failed to reset password';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-3">
        <StatCard label="Active Accounts" value={String(stats.active)} />
        <StatCard label="Total Accounts" value={String(stats.total)} />
        <StatCard label="Suspended" value={String(stats.suspended)} />
        <StatCard label="Deactivated" value={String(stats.inactive)} />
      </div>

      <div
        className="glass-card p-4 sm:p-5 !border-transparent"
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Locator Account List
          </h3>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            onClick={openCreate}
            disabled={!locatorRole}
            title={locatorRole ? undefined : 'No Locator role found — set it up in Manage Roles first.'}
          >
            + New Record
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div className="relative group w-full sm:w-72">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search locator accounts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-2">
            <TableSkeleton columns={5} rows={5} />
          </div>
        ) : filteredUsers.length === 0 ? (
          <EmptyState
            title="No locator accounts found"
            description={
              searchQuery
                ? 'Try adjusting your search filters.'
                : 'There are no locator accounts to show here yet. Create one to get started.'
            }
            action={
              !searchQuery ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={openCreate}
                  disabled={!locatorRole}
                >
                  Create Locator Account
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Username', 'Full Name', 'Email', '2FA', 'Status', 'Actions'].map((col) => (
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
                    <td className="px-3 py-2 text-[11px]">
                      {u.totp_enabled === 1 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }}
                        >
                          <ShieldCheck size={11} /> On
                        </span>
                      ) : (
                        <span className="text-secondary">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={
                          u.status === 'SUSPENDED'
                            ? { backgroundColor: 'rgba(245,158,11,.14)', color: 'rgba(245,158,11,.95)' }
                            : u.is_active === 1
                              ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
                              : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' }
                        }
                      >
                        {u.status === 'SUSPENDED' ? 'Suspended' : u.is_active === 1 ? 'Active' : 'Deactivated'}
                      </span>
                      {u.is_locked && (
                        <span
                          className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: 'rgba(239,68,68,.14)', color: 'rgba(239,68,68,.95)' }}
                          title="Locked out from repeated failed login attempts"
                        >
                          Locked
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 pr-2">
                      <div className="flex items-center justify-end gap-1.5">
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
                        <button
                          className={cn(
                            'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                            saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                          )}
                          onClick={() => setConfirmResetPasswordId(u.id)}
                          disabled={saving}
                          aria-label={`Reset password for ${u.username}`}
                          title="Reset password (emails a new temporary password)"
                        >
                          <KeyRound size={14} />
                        </button>
                        {u.is_active === 1 ? (
                          <>
                            <button
                              className={cn(
                                'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                                saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                              )}
                              onClick={() => setConfirmSuspendId(u.id)}
                              disabled={saving}
                              aria-label={`Suspend ${u.username}`}
                              title="Suspend (temporary hold)"
                            >
                              <Ban size={14} />
                            </button>
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
                            <button
                              className={cn(
                                'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                                saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                              )}
                              onClick={() => setConfirmRevokeId(u.id)}
                              disabled={saving}
                              aria-label={`Revoke sessions for ${u.username}`}
                              title="Revoke active sessions"
                            >
                              <LogOut size={14} />
                            </button>
                          </>
                        ) : u.status === 'SUSPENDED' ? (
                          <button
                            className={cn(
                              'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                            )}
                            onClick={() => void unsuspend(u.id)}
                            disabled={saving}
                            aria-label={`Reinstate ${u.username}`}
                            title="Lift suspension"
                          >
                            <RotateCcw size={14} />
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
              loading={isLoading || isRevalidating}
            />
          </div>
        )}
      </div>

      <SidePanel
        open={isCreateOpen}
        title={editing ? 'Edit Locator Account' : 'New Locator Account'}
        subtitle="Users table, locked to the Locator role"
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
              type="email"
              required
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </Field>
        </div>

        {editing ? (
          <TotpSection user={editing} onChanged={() => refresh({ showLoading: false })} />
        ) : (
          <p className="mt-4 text-[11px] text-secondary">
            A temporary password will be generated and emailed to the locator on save — they'll set their own on
            first login. Reopen this account afterward to set up their Google Authenticator.
          </p>
        )}
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate this locator account?"
        description="This locator will no longer be able to access the portal unless reactivated."
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
        title="Reactivate this locator account?"
        description="This locator will regain access to the portal."
        confirmText="Reactivate"
        loading={saving}
        onCancel={() => setConfirmReactivateId(null)}
        onConfirm={() => {
          if (confirmReactivateId !== null) {
            void reactivate(confirmReactivateId);
          }
        }}
      />

      <ConfirmModal
        open={confirmSuspendId !== null}
        title="Suspend this locator account?"
        description="A temporary hold — easier to lift than a deactivation. The locator can't log in, and any active session ends immediately."
        confirmText="Suspend"
        danger
        loading={saving}
        onCancel={() => setConfirmSuspendId(null)}
        onConfirm={() => {
          if (confirmSuspendId !== null) void suspend(confirmSuspendId);
        }}
      />

      <ConfirmModal
        open={confirmRevokeId !== null}
        title="Revoke active sessions?"
        description="Ends this locator's current login everywhere immediately, without waiting for it to expire on its own. They'll need to sign in again."
        confirmText="Revoke"
        danger
        loading={saving}
        onCancel={() => setConfirmRevokeId(null)}
        onConfirm={() => {
          if (confirmRevokeId !== null) void revokeSessions(confirmRevokeId);
        }}
      />

      <ConfirmModal
        open={confirmResetPasswordId !== null}
        title="Reset this locator's password?"
        description="A new temporary password is generated and emailed to the locator. They'll be required to set their own password the next time they sign in."
        confirmText="Reset & Email"
        danger
        loading={saving}
        onCancel={() => setConfirmResetPasswordId(null)}
        onConfirm={() => {
          if (confirmResetPasswordId !== null) void resetPassword(confirmResetPasswordId);
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

function TotpSection({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(user.totp_enabled === 1);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(user.totp_enabled === 1);
    setConfirming(false);
  }, [user.id, user.totp_enabled]);

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch(api(`/api/users/${user.id}/totp/reset`), {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to reset authenticator');
      setEnabled(false);
      setConfirming(false);
      toast.success('Authenticator reset — the locator sets it up again on next login');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reset authenticator');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-5 rounded-lg border p-3 sm:p-4 space-y-3"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone size={15} className="text-secondary" />
          <span className="text-[11px] font-semibold text-secondary uppercase tracking-widest">
            Two-factor authentication
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={
            enabled
              ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
              : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' }
          }
        >
          {enabled ? <ShieldCheck size={11} /> : <ShieldOff size={11} />}
          {enabled ? 'Enrolled' : 'Not enrolled'}
        </span>
      </div>

      {enabled ? (
        <div className="space-y-2">
          <p className="text-[11px] text-secondary">
            This locator set up their authenticator and is asked for a 6-digit code at every login. Reset it if they
            lost their device — they will be walked through setup again on their next login.
          </p>
          {confirming ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: '#dc2626', color: '#fff' }}
              >
                <ShieldOff size={13} />
                {busy ? 'Resetting…' : 'Confirm reset'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="text-[11px] font-medium text-secondary hover:text-primary cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold border cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}
            >
              <ShieldOff size={13} />
              Reset authenticator
            </button>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-secondary">
          This locator will set up their authenticator app themselves the next time they log in. Nothing to do here.
        </p>
      )}
    </div>
  );
}
