import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pencil, Plus, RotateCcw, Settings2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';

const MENU_KEY = 'settings:property-types';

type PropertyTypeRow = { id: number; name: string; is_active: number };

/** Can the signed-in user open the Type of Property maintenance at all. */
export function useCanManagePropertyTypes(): boolean {
  const { fullAccess, sidebarPermissions } = useControlPanelAccess();
  return fullAccess || Boolean(sidebarPermissions[MENU_KEY]);
}

/**
 * Type of Property (File Maintenance) in a pop-up, opened from the Property
 * Schedule's settings button: add, rename, deactivate / reactivate. Same API
 * and permissions (settings:property-types) as the full page; every change is
 * in the Audit Log. `onChanged` lets the caller reload its dropdown.
 */
export function PropertyTypesModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const canAdd = fullAccess || perm.can_add;
  const canEdit = fullAccess || perm.can_edit;
  const canDelete = fullAccess || perm.can_delete;

  const [items, setItems] = useState<PropertyTypeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/property-types', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load the types of property');
      setItems(Array.isArray(json?.data) ? json.data : []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load the types of property');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setNewName('');
    setEditId(null);
    void load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  async function call(url: string, method: string, body: unknown, success: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');
      toast.success(success);
      await load();
      onChanged?.();
      return true;
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const name = newName.trim();
    if (!name) return;
    if (await call('/api/property-types', 'POST', { name }, 'Type of property added')) setNewName('');
  }

  async function rename(id: number) {
    const name = editName.trim();
    if (!name) return;
    if (await call(`/api/property-types/${id}`, 'PUT', { name }, 'Type of property updated')) setEditId(null);
  }

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-start justify-center px-3 pt-[8vh]">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,.45)' }} onClick={busy ? undefined : onClose} />
      <div
        className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Type of Property"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--input-border)' }}>
          <div className="flex items-center gap-2">
            <Settings2 size={15} style={{ color: 'var(--text)' }} />
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                Type of Property
              </div>
              <div className="text-[10px] text-secondary">File Maintenance — the Property Schedule's options</div>
            </div>
          </div>
          <button type="button" className="rounded-md p-1 text-secondary hover:bg-[var(--hover-bg)]" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="py-6 text-center text-xs text-secondary">Loading…</div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-xs text-secondary">No types of property yet.</div>
          ) : (
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--input-border)' }}>
              {items.map((item) => {
                const active = Number(item.is_active) === 1;
                const editingThis = editId === item.id;
                return (
                  <li key={item.id} className="flex items-center gap-2 py-2" style={{ borderColor: 'var(--input-border)' }}>
                    {editingThis ? (
                      <input
                        autoFocus
                        className="app-form-control app-form-control-sm h-8 flex-1 uppercase"
                        value={editName}
                        disabled={busy}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename(item.id);
                          if (e.key === 'Escape') setEditId(null);
                        }}
                      />
                    ) : (
                      <span className="flex-1 truncate text-[12px] font-medium" style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}>
                        {item.name}
                      </span>
                    )}
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={
                        active
                          ? { backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: '#15803d' }
                          : { backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }
                      }
                    >
                      {active ? 'Active' : 'Inactive'}
                    </span>
                    {editingThis ? (
                      <button
                        type="button"
                        className="rounded-md p-1 hover:bg-[var(--hover-bg)]"
                        style={{ color: 'var(--text)' }}
                        disabled={busy || !editName.trim()}
                        onClick={() => void rename(item.id)}
                        title="Save"
                        aria-label="Save"
                      >
                        <Check size={14} />
                      </button>
                    ) : canEdit ? (
                      <button
                        type="button"
                        className="rounded-md p-1 text-secondary hover:bg-[var(--hover-bg)]"
                        disabled={busy}
                        onClick={() => {
                          setEditId(item.id);
                          setEditName(item.name);
                        }}
                        title={`Rename ${item.name}`}
                        aria-label={`Rename ${item.name}`}
                      >
                        <Pencil size={13} />
                      </button>
                    ) : null}
                    {active ? (
                      canDelete ? (
                        <button
                          type="button"
                          className="rounded-md p-1 text-red-500 hover:bg-[var(--hover-bg)]"
                          disabled={busy}
                          onClick={() => void call(`/api/property-types/${item.id}/deactivate`, 'PATCH', undefined, 'Type of property deactivated')}
                          title={`Deactivate ${item.name} — kept on rows that already use it`}
                          aria-label={`Deactivate ${item.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null
                    ) : canEdit ? (
                      <button
                        type="button"
                        className="rounded-md p-1 text-secondary hover:bg-[var(--hover-bg)]"
                        disabled={busy}
                        onClick={() => void call(`/api/property-types/${item.id}/reactivate`, 'PATCH', undefined, 'Type of property reactivated')}
                        title={`Reactivate ${item.name}`}
                        aria-label={`Reactivate ${item.name}`}
                      >
                        <RotateCcw size={13} />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {canAdd ? (
          <div className="flex items-center gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--input-border)' }}>
            <input
              className="app-form-control app-form-control-sm h-9 flex-1 uppercase placeholder:normal-case"
              placeholder="New type of property"
              value={newName}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-[12px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !newName.trim()}
              onClick={() => void add()}
            >
              <Plus size={13} /> Add
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
