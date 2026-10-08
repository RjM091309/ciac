import React, { useEffect, useState } from 'react';
import { Building2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';

type Department = { id: number; code: string; name: string; is_active: number | boolean };

/** Department maintenance (dbo.department, /api/departments) from User
 * Management — the list behind the user form's Department dropdown. Same
 * look and flow as RolesPanel. */
export function DepartmentsPanel({
  onChanged,
  canAdd = true,
  canEdit = true,
  canDelete = true,
}: {
  onChanged: () => void;
  /** User Management's Control Panel permissions (same as the server checks). */
  canAdd?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ code: '', name: '' });
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/departments', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load departments');
      setRows(json.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  function startCreate() {
    setEditing(null);
    setForm({ code: '', name: '' });
  }

  function startEdit(d: Department) {
    setEditing(d);
    setForm({ code: d.code || '', name: d.name || '' });
  }

  async function save() {
    const code = form.code.trim();
    const name = form.name.trim();
    if (!code || !name) {
      toast.error('Code and name are required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/departments/${editing.id}` : '/api/departments', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code, name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save department');
      toast.success(editing ? 'Department updated' : 'Department added');
      startCreate();
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(id: number, active: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`/api/departments/${id}/${active ? 'reactivate' : 'deactivate'}`, {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to update department');
      toast.success(active ? 'Department restored' : 'Department deactivated');
      setConfirmDeactivateId(null);
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update department');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
        onClick={() => setOpen(true)}
      >
        <Building2 size={13} />
        Manage Departments
      </button>

      <SidePanel
        open={open}
        title="Manage Departments"
        subtitle="Departments a user can belong to"
        onClose={() => setOpen(false)}
        onSave={() => void save()}
        saving={saving}
        saveDisabled={!form.code.trim() || !form.name.trim()}
        hideSave={editing ? !canEdit : !canAdd}
        saveLabel={editing ? 'Save Changes' : 'Add Department'}
      >
        <div className="space-y-4">
          {(editing ? canEdit : canAdd) ? (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-[140px_minmax(0,1fr)] gap-3">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">Code</div>
              <input
                className="app-input"
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. PD"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">Department name</div>
              <input
                className="app-input"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Property Department"
              />
            </div>
          </div>
          {editing && (
            <button
              type="button"
              onClick={startCreate}
              className="text-[11px] font-medium text-secondary hover:text-primary cursor-pointer"
            >
              Cancel edit — add a new department instead
            </button>
          )}
          </>
          ) : null}

          <div className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            {loading ? (
              <div className="p-4 text-xs text-secondary">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="p-4 text-xs text-secondary">No departments yet.</div>
            ) : (
              rows.map((d) => {
                const active = Number(d.is_active) === 1 || d.is_active === true;
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
                        {d.name} {!active && <span className="text-secondary font-normal">(inactive)</span>}
                      </div>
                      <div className="text-[11px] text-secondary truncate">{d.code}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canEdit ? (
                      <button
                        className="p-1.5 rounded-md text-secondary hover:text-[var(--text)] cursor-pointer"
                        onClick={() => startEdit(d)}
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      ) : null}
                      {active ? (
                        canDelete && (
                        <button
                          className="p-1.5 rounded-md text-secondary hover:text-rose-500 cursor-pointer"
                          onClick={() => setConfirmDeactivateId(d.id)}
                          title="Deactivate"
                        >
                          <Trash2 size={13} />
                        </button>
                        )
                      ) : (
                        canEdit && (
                        <button
                          className="p-1.5 rounded-md text-secondary hover:text-emerald-500 cursor-pointer"
                          onClick={() => void setActive(d.id, true)}
                          title="Restore"
                        >
                          <RotateCcw size={13} />
                        </button>
                        )
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
        open={confirmDeactivateId !== null}
        title="Deactivate this department?"
        description="It won't be offered for new users. Users already in it keep it until changed."
        confirmText="Deactivate"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateId(null)}
        onConfirm={() => {
          if (confirmDeactivateId !== null) void setActive(confirmDeactivateId, false);
        }}
      />
    </>
  );
}
