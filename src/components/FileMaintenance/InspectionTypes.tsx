import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, RotateCcw, Search, UserX } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DataTableControls } from '../ui/DataTableControls';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';

type InspectionTypeRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_active: number;
};

function api(path: string) {
  return path;
}

export function InspectionTypesManagement() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<InspectionTypeRow[]>([]);
  const [editing, setEditing] = useState<InspectionTypeRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
  });

  const stats = useMemo(() => {
    const active = items.filter((i) => i.is_active === 1).length;
    const inactive = items.filter((i) => i.is_active === 0).length;
    return { active, inactive, total: items.length };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
      const statusStr = i.is_active === 1 ? 'active' : 'inactive';
      return (
        (i.code || '').toLowerCase().includes(q) ||
        (i.name || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [items, searchQuery]);
  const canSubmit = useMemo(() => {
    const code = form.code.trim();
    const name = form.name.trim();
    const description = form.description.trim();

    if (!code || !name) return false;

    if (!editing) {
      const hasAnyInput = Boolean(code || name || description);
      return hasAnyInput;
    }

    const originalCode = (editing.code || '').trim();
    const originalName = (editing.name || '').trim();
    const originalDescription = (editing.description || '').trim();

    return code !== originalCode || name !== originalName || description !== originalDescription;
  }, [editing, form.code, form.description, form.name]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredItems.length / Math.max(1, pageSize)));
  }, [filteredItems.length, pageSize]);

  const pagedItems = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize, totalPages]);

  const showingRange = useMemo(() => {
    if (filteredItems.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    const from = (safePage - 1) * pageSize + 1;
    const to = Math.min(filteredItems.length, safePage * pageSize);
    return { from, to };
  }, [filteredItems.length, page, pageSize, totalPages]);

  const visiblePageNumbers = useMemo(() => {
    const current = Math.min(Math.max(1, page), totalPages);
    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [page, totalPages]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(api('/api/inspection-types'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load inspection types');
      setItems(
        (json.data || []).map((item: any) => ({
          ...item,
          is_active: Number(item?.is_active) ? 1 : 0,
        })),
      );
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
    setForm({ code: '', name: '', description: '' });
    setIsCreateOpen(true);
  }

  function openEdit(item: InspectionTypeRow) {
    setIsCreateOpen(true);
    setEditing(item);
    setForm({
      code: item.code || '',
      name: item.name || '',
      description: item.description || '',
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
      };
      if (!payload.code) throw new Error('Code is required');
      if (!payload.name) throw new Error('Name is required');

      const res = await fetch(api(editing ? `/api/inspection-types/${editing.id}` : '/api/inspection-types'), {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');

      setIsCreateOpen(false);
      await loadAll();
      toast.success(editing ? 'Inspection type updated successfully' : 'Inspection type created successfully');
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
      const res = await fetch(api(`/api/inspection-types/${id}/deactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      await loadAll();
      toast.success('Inspection type deactivated successfully');
      setConfirmDeactivateId(null);
    } catch (e: any) {
      setError(e?.message || 'Deactivate failed');
      toast.error(e?.message || 'Deactivate failed');
    } finally {
      setSaving(false);
    }
  }

  async function reactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/inspection-types/${id}/reactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reactivate failed');
      await loadAll();
      toast.success('Inspection type reactivated successfully');
    } catch (e: any) {
      setError(e?.message || 'Reactivate failed');
      toast.error(e?.message || 'Reactivate failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
        <StatCard label="Active Types" value={String(stats.active)} />
        <StatCard label="Total Types" value={String(stats.total)} />
        <StatCard label="Deactivated" value={String(stats.inactive)} />
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Inspection Types List
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
          <div className="py-2">
            <TableSkeleton columns={5} rows={5} />
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            title="No inspection types found"
            description={
              searchQuery 
                ? 'Try adjusting your search filters.' 
                : 'There are no inspection types to show here yet. Create a new inspection type to get started.'
            }
            action={
              !searchQuery ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={openCreate}
                >
                  Create Inspection Type
                </button>
              ) : undefined
            }
          />
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
                  placeholder="Search inspection types..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
                />
              </div>
            </div>
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Code', 'Name', 'Description', 'Status', 'Actions'].map((col) => (
                    <th
                      key={col}
                      className={cn(
                        'px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b',
                        col === 'Actions' && 'text-right pr-2',
                      )}
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((item) => (
                  <tr key={item.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {item.code}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {item.name}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{item.description || '-'}</td>
                    <td className="px-3 py-2 text-[11px]">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={
                          item.is_active === 1
                            ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
                            : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' }
                        }
                      >
                        {item.is_active === 1 ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2 pr-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className={cn(
                            'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                            saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                          )}
                          onClick={() => openEdit(item)}
                          disabled={saving}
                          aria-label={`Edit ${item.name}`}
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        {item.is_active === 1 ? (
                          <button
                            className={cn(
                              'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                            )}
                            onClick={() => setConfirmDeactivateId(item.id)}
                            disabled={saving}
                            aria-label={`Deactivate ${item.name}`}
                            title="Deactivate"
                          >
                            <UserX size={14} />
                          </button>
                        ) : (
                          <button
                            className={cn(
                              'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                            )}
                            onClick={() => setConfirmReactivateId(item.id)}
                            disabled={saving}
                            aria-label={`Reactivate ${item.name}`}
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
              totalItems={filteredItems.length}
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
        title={editing ? 'Edit Inspection Type' : 'New Inspection Type'}
        subtitle="Inspection types master table"
        onClose={() => setIsCreateOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!canSubmit}
      >
        <div className="grid grid-cols-1 gap-3">
          <Field label="Code">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.code}
              onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
            />
          </Field>
          <Field label="Name">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>
          <Field label="Description">
            <textarea
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)] min-h-24 resize-y"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate inspection type?"
        description="This type will be marked inactive. You can re-activate later."
        confirmText="Deactivate"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateId(null)}
        onConfirm={() => {
          if (confirmDeactivateId !== null) void deactivate(confirmDeactivateId);
        }}
      />

      <ConfirmModal
        open={confirmReactivateId !== null}
        title="Reactivate inspection type?"
        description="This type will be marked active again."
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
