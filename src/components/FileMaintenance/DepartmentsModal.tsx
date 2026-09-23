import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil, RotateCcw, UserX, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { DataTableControls } from '../ui/DataTableControls';
import { TableSkeleton } from '../ui/Skeleton';

export type DepartmentRow = {
  id: number;
  code: string;
  name: string;
  is_active: number;
};

type Props = {
  open: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  /** Called after any create/edit/(de)activate so the parent can refresh its department dropdown. */
  onChanged: () => void;
};

const inputClass = 'app-input';

export function DepartmentsModal({ open, canAdd, canEdit, canDelete, onClose, onChanged }: Props) {
  const [items, setItems] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [form, setForm] = useState({ code: '', name: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/departments', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load departments');
      setItems((json.data || []).map((d: any) => ({ ...d, is_active: Number(d?.is_active) ? 1 : 0 })));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load departments');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setForm({ code: '', name: '' });
    setSearch('');
    setPage(1);
    void load();
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((d) => d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedItems = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );
  const showingFrom = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const showingTo = Math.min(filtered.length, safePage * pageSize);
  const visiblePageNumbers = useMemo(() => {
    const start = Math.max(1, safePage - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [safePage, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  const canSubmit = useMemo(() => {
    const code = form.code.trim();
    const name = form.name.trim();
    if (!code || !name) return false;
    if (!editing) return true;
    return code !== editing.code || name !== editing.name;
  }, [editing, form]);

  function startEdit(d: DepartmentRow) {
    setEditing(d);
    setForm({ code: d.code, name: d.name });
  }

  function reset() {
    setEditing(null);
    setForm({ code: '', name: '' });
  }

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || 'Request failed');
  }

  async function save() {
    setSaving(true);
    try {
      const payload = { code: form.code.trim(), name: form.name.trim() };
      await call(editing ? `/api/departments/${editing.id}` : '/api/departments', editing ? 'PUT' : 'POST', payload);
      toast.success(editing ? 'Department updated successfully' : 'Department created successfully');
      reset();
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(d: DepartmentRow, active: boolean) {
    setSaving(true);
    try {
      await call(`/api/departments/${d.id}/${active ? 'reactivate' : 'deactivate'}`, 'PATCH');
      toast.success(active ? 'Department reactivated' : 'Department deactivated');
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  const showForm = editing ? canEdit : canAdd;

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3">
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={!saving ? onClose : undefined}
          />
          <motion.div
            className="relative z-10 flex w-full max-w-2xl flex-col rounded-2xl border p-4 sm:p-5"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="flex items-start justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--input-border)' }}>
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  Department
                </div>
                <div className="text-xs text-secondary mt-0.5">Departments an account officer can belong to</div>
              </div>
              <button
                className="rounded-md p-1.5 text-secondary cursor-pointer hover:bg-[var(--hover-bg)]"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {showForm ? (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-[8rem_1fr_auto] items-end gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-secondary uppercase tracking-widest">Code</span>
                  <input
                    className={inputClass}
                    value={form.code}
                    onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-secondary uppercase tracking-widest">Name</span>
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                </label>
                <div className="flex gap-2">
                  {editing ? (
                    <button
                      className="rounded-lg px-3 py-2 text-sm font-semibold border cursor-pointer hover:bg-[var(--hover-bg)]"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                      onClick={reset}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap',
                      saving || !canSubmit ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-90',
                    )}
                    style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                    onClick={save}
                    disabled={saving || !canSubmit}
                  >
                    {saving ? 'Saving…' : editing ? 'Update' : '+ Add'}
                  </button>
                </div>
              </div>
            ) : null}

            <input
              type="text"
              placeholder="Search departments..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-3 h-9 rounded-full px-3 text-xs w-full sm:w-64 focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)]"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />

            <div className="mt-2">
              {loading ? (
                <TableSkeleton columns={4} rows={4} />
              ) : filtered.length === 0 ? (
                <div className="py-6 text-center text-xs text-secondary">
                  {search ? 'No departments match your search.' : 'No departments yet.'}
                </div>
              ) : (
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr>
                      {['Code', 'Name', 'Status', ''].map((col, i) => (
                        <th
                          key={i}
                          className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((d) => (
                      <tr key={d.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                        <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                          {d.code}
                        </td>
                        <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                          {d.name}
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={
                              d.is_active === 1
                                ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
                                : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' }
                            }
                          >
                            {d.is_active === 1 ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {canEdit ? (
                              <button
                                className="rounded-md p-1.5 text-secondary cursor-pointer"
                                onClick={() => startEdit(d)}
                                disabled={saving}
                                title="Edit"
                                aria-label={`Edit ${d.name}`}
                              >
                                <Pencil size={14} />
                              </button>
                            ) : null}
                            {d.is_active === 1 ? (
                              canDelete ? (
                                <button
                                  className="rounded-md p-1.5 text-secondary cursor-pointer"
                                  onClick={() => void setActive(d, false)}
                                  disabled={saving}
                                  title="Deactivate"
                                  aria-label={`Deactivate ${d.name}`}
                                >
                                  <UserX size={14} />
                                </button>
                              ) : null
                            ) : canEdit ? (
                              <button
                                className="rounded-md p-1.5 text-secondary cursor-pointer"
                                onClick={() => void setActive(d, true)}
                                disabled={saving}
                                title="Reactivate"
                                aria-label={`Reactivate ${d.name}`}
                              >
                                <RotateCcw size={14} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {filtered.length > 0 ? (
              <DataTableControls
                page={safePage}
                totalPages={totalPages}
                totalItems={filtered.length}
                showingFrom={showingFrom}
                showingTo={showingTo}
                visiblePageNumbers={visiblePageNumbers}
                pageSize={pageSize}
                pageSizeOptions={[8, 15, 30]}
                onPageSizeChange={(value) => setPageSize(value)}
                onPageChange={(p) => setPage(p)}
                loading={loading}
              />
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
