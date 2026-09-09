import React, { useEffect, useState } from 'react';
import { Pencil, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';

type Role = { id: number; name: string; description: string | null; is_active: number | boolean };

function api(path: string) {
  return path;
}

/** Role CRUD (TOR: "user role management") — roles previously could only be
 * listed (for the assignment dropdown), never created/edited/retired from
 * the app itself. Admin-only, enforced server-side too. */
export function RolesPanel({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [confirmRetireId, setConfirmRetireId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(api('/api/roles'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load roles');
      setRoles(json.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  function startCreate() {
    setEditing(null);
    setForm({ name: '', description: '' });
  }

  function startEdit(role: Role) {
    setEditing(role);
    setForm({ name: role.name, description: role.description || '' });
  }

  async function save() {
    const name = form.name.trim();
    if (!name) {
      toast.error('Role name is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(api(editing ? `/api/roles/${editing.id}` : '/api/roles'), {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, description: form.description.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save role');
      toast.success(editing ? 'Role updated' : 'Role created');
      startCreate();
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  }

  async function retire(id: number) {
    setSaving(true);
    try {
      const res = await fetch(api(`/api/roles/${id}/deactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to retire role');
      toast.success('Role retired');
      setConfirmRetireId(null);
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to retire role');
    } finally {
      setSaving(false);
    }
  }

  async function restore(id: number) {
    setSaving(true);
    try {
      const res = await fetch(api(`/api/roles/${id}/reactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to restore role');
      toast.success('Role restored');
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to restore role');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold cursor-pointer"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
        onClick={() => setOpen(true)}
      >
        <Settings2 size={13} />
        Manage Roles
      </button>

      <SidePanel
        open={open}
        title="Manage Roles"
        subtitle="Roles used across access control and dashboard permissions"
        onClose={() => setOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!form.name.trim()}
        saveLabel={editing ? 'Save Changes' : 'Add Role'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">Role name</div>
              <input
                className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Account Officer"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">Description</div>
              <input
                className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
          </div>
          {editing && (
            <button
              type="button"
              onClick={startCreate}
              className="text-[11px] font-medium text-secondary hover:text-primary cursor-pointer"
            >
              Cancel edit — add a new role instead
            </button>
          )}

          <div className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            {loading ? (
              <div className="p-4 text-xs text-secondary">Loading…</div>
            ) : roles.length === 0 ? (
              <div className="p-4 text-xs text-secondary">No roles yet.</div>
            ) : (
              roles.map((role) => {
                const active = Number(role.is_active) === 1 || role.is_active === true;
                return (
                  <div
                    key={role.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
                        {role.name} {!active && <span className="text-secondary font-normal">(retired)</span>}
                      </div>
                      {role.description && <div className="text-[11px] text-secondary truncate">{role.description}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        className="p-1.5 rounded-md text-secondary hover:text-[var(--text)] cursor-pointer"
                        onClick={() => startEdit(role)}
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      {active ? (
                        <button
                          className="p-1.5 rounded-md text-secondary hover:text-rose-500 cursor-pointer"
                          onClick={() => setConfirmRetireId(role.id)}
                          title="Retire role"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <button
                          className="p-1.5 rounded-md text-secondary hover:text-emerald-500 cursor-pointer"
                          onClick={() => restore(role.id)}
                          title="Restore role"
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmRetireId !== null}
        title="Retire this role?"
        description="Users already assigned this role keep it, but it won't be selectable for new assignments until restored. Retiring fails if any user still holds it."
        confirmText="Retire"
        danger
        loading={saving}
        onCancel={() => setConfirmRetireId(null)}
        onConfirm={() => {
          if (confirmRetireId !== null) void retire(confirmRetireId);
        }}
      />
    </>
  );
}
