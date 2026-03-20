import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, RotateCcw, Search, UserX } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';

type RequirementRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category_id: number | null;
  category_name?: string | null;
  for_new: number;
  for_renewal: number;
  is_mandatory: number;
  is_active: number;
  created_by: number | null;
  updated_by: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CategoryRow = {
  id: number;
  name: string;
  is_active: number;
};

type RequirementsData = {
  items: RequirementRow[];
  categories: CategoryRow[];
};

function api(path: string) {
  return path;
}

export function RequirementsManagement() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RequirementRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const { data: requirementsData, isLoading, isRevalidating, refresh } =
    useSessionStorageCachedResource<RequirementsData>({
      cacheKey: 'ciac.requirements.categories_and_items.v1',
      ttlMs: 5 * 60 * 1000, // 5 minutes
      fetcher: async () => {
        const [rRes, cRes] = await Promise.all([
          fetch(api('/api/requirements'), { credentials: 'include' }),
          fetch(api('/api/requirement-categories'), { credentials: 'include' }),
        ]);

        const rJson = await rRes.json().catch(() => ({}));
        const cJson = await cRes.json().catch(() => ({}));

        if (!rRes.ok) throw new Error(rJson?.message || 'Failed to load requirements');
        if (!cRes.ok) throw new Error(cJson?.message || 'Failed to load requirement categories');

        return {
          items: (rJson.data || []).map((item: any) => ({
            ...item,
            for_new: Number(item?.for_new) ? 1 : 0,
            for_renewal: Number(item?.for_renewal) ? 1 : 0,
            is_mandatory: Number(item?.is_mandatory) ? 1 : 0,
            is_active: Number(item?.is_active) ? 1 : 0,
          })),
          categories: (cJson.data || []).map((c: any) => ({
            ...c,
            is_active: Number(c?.is_active) ? 1 : 0,
          })),
        };
      },
      onError: (e) => {
        const message = e instanceof Error ? e.message : 'Failed to load data';
        setError(message);
        toast.error(message);
      },
    });

  const items = requirementsData?.items ?? [];
  const categories = requirementsData?.categories ?? [];

  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    category_id: '',
    for_new: true,
    for_renewal: true,
    is_mandatory: true,
  });

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: String(c.id), label: c.name })),
    [categories]
  );

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
      const flags = [i.for_new ? 'new' : '', i.for_renewal ? 'renewal' : '', i.is_mandatory ? 'mandatory' : 'optional'].join(' ');
      return (
        (i.code || '').toLowerCase().includes(q) ||
        (i.name || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.category_name || '').toLowerCase().includes(q) ||
        flags.includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [items, searchQuery]);

  const canSubmit = useMemo(() => {
    const code = form.code.trim();
    const name = form.name.trim();
    const description = form.description.trim();
    const categoryId = form.category_id.trim();
    const forNew = form.for_new;
    const forRenewal = form.for_renewal;
    const mandatory = form.is_mandatory;

    if (!code || !name) return false;

    if (!editing) {
      return Boolean(code || name || description || categoryId || forNew || forRenewal || mandatory);
    }

    const originalCode = (editing.code || '').trim();
    const originalName = (editing.name || '').trim();
    const originalDescription = (editing.description || '').trim();
    const originalCategoryId = editing.category_id != null ? String(editing.category_id).trim() : '';
    const originalForNew = Number(editing.for_new) === 1;
    const originalForRenewal = Number(editing.for_renewal) === 1;
    const originalMandatory = Number(editing.is_mandatory) === 1;

    return (
      code !== originalCode ||
      name !== originalName ||
      description !== originalDescription ||
      categoryId !== originalCategoryId ||
      forNew !== originalForNew ||
      forRenewal !== originalForRenewal ||
      mandatory !== originalMandatory
    );
  }, [editing, form.category_id, form.code, form.description, form.for_new, form.for_renewal, form.is_mandatory, form.name]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredItems.length / Math.max(1, pageSize))), [filteredItems.length, pageSize]);

  const pagedItems = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize, totalPages]);

  const showingRange = useMemo(() => {
    if (filteredItems.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    return {
      from: (safePage - 1) * pageSize + 1,
      to: Math.min(filteredItems.length, safePage * pageSize),
    };
  }, [filteredItems.length, page, pageSize, totalPages]);

  const visiblePageNumbers = useMemo(() => {
    const current = Math.min(Math.max(1, page), totalPages);
    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function openCreate() {
    setEditing(null);
    setForm({
      code: '',
      name: '',
      description: '',
      category_id: '',
      for_new: true,
      for_renewal: true,
      is_mandatory: true,
    });
    setIsCreateOpen(true);
  }

  function openEdit(item: RequirementRow) {
    setEditing(item);
    setForm({
      code: item.code || '',
      name: item.name || '',
      description: item.description || '',
      category_id: item.category_id != null ? String(item.category_id) : '',
      for_new: Number(item.for_new) === 1,
      for_renewal: Number(item.for_renewal) === 1,
      is_mandatory: Number(item.is_mandatory) === 1,
    });
    setIsCreateOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id.trim() ? Number(form.category_id) : null,
        for_new: form.for_new ? 1 : 0,
        for_renewal: form.for_renewal ? 1 : 0,
        is_mandatory: form.is_mandatory ? 1 : 0,
      };
      if (!payload.code) throw new Error('Code is required');
      if (!payload.name) throw new Error('Name is required');

      const res = await fetch(api(editing ? `/api/requirements/${editing.id}` : '/api/requirements'), {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');
      setIsCreateOpen(false);
      setError(null);
      await refresh({ showLoading: false });
      toast.success(editing ? 'Requirement updated successfully' : 'Requirement created successfully');
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
      const res = await fetch(api(`/api/requirements/${id}/deactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      setError(null);
      await refresh({ showLoading: false });
      toast.success('Requirement deactivated successfully');
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
      const res = await fetch(api(`/api/requirements/${id}/reactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reactivate failed');
      setError(null);
      await refresh({ showLoading: false });
      toast.success('Requirement reactivated successfully');
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
        <StatCard label="Active Requirements" value={String(stats.active)} />
        <StatCard label="Total Requirements" value={String(stats.total)} />
        <StatCard label="Deactivated" value={String(stats.inactive)} />
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Requirements List
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

        {isLoading ? (
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
                  placeholder="Search requirements..."
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
                  {['Code', 'Name', 'Category', 'Flags', 'Status', 'Actions'].map((col) => (
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
                {pagedItems.map((item) => (
                  <tr key={item.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{item.code}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{item.name}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{item.category_name || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">
                      {[item.for_new ? 'New' : null, item.for_renewal ? 'Renewal' : null, item.is_mandatory ? 'Mandatory' : 'Optional']
                        .filter(Boolean)
                        .join(', ')}
                    </td>
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
                            saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
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
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
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
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
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
                {filteredItems.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-xs text-secondary" colSpan={6}>
                      No requirements found.
                    </td>
                  </tr>
                )}
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
              loading={isLoading || isRevalidating}
            />
          </div>
        )}
      </div>

      <SidePanel
        open={isCreateOpen}
        title={editing ? 'Edit Requirement' : 'New Requirements'}
        subtitle="Requirements master table"
        onClose={() => setIsCreateOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!canSubmit}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <Field label="Category">
            <AppSelect
              options={categoryOptions}
              value={form.category_id}
              onChange={(value) => setForm((p) => ({ ...p, category_id: value || '' }))}
              placeholder="Select category..."
              isClearable
              isDisabled={saving}
            />
          </Field>
          <Field label="Description">
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <CheckToggle
              label="For New"
              checked={form.for_new}
              onChange={(checked) => setForm((p) => ({ ...p, for_new: checked }))}
            />
            <CheckToggle
              label="For Renewal"
              checked={form.for_renewal}
              onChange={(checked) => setForm((p) => ({ ...p, for_renewal: checked }))}
            />
            <CheckToggle
              label="Mandatory"
              checked={form.is_mandatory}
              onChange={(checked) => setForm((p) => ({ ...p, is_mandatory: checked }))}
            />
          </div>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate requirement?"
        description="This requirement will be marked inactive. You can re-activate later."
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
        title="Reactivate requirement?"
        description="This requirement will be marked active again."
        confirmText="Reactivate"
        loading={saving}
        onCancel={() => setConfirmReactivateId(null)}
        onConfirm={() => {
          if (confirmReactivateId !== null) void reactivate(confirmReactivateId);
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

function CheckToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label 
      className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer hover:bg-white/5 transition-all" 
      style={{ borderColor: 'var(--input-border)' }}
    >
      <input 
      type="checkbox" 
      className="cursor-pointer" 
      checked={checked} 
      onChange={(e) => onChange(e.target.checked)} />
      <span style={{ color: 'var(--text)' }} className="cursor-pointer">{label}</span>
    </label>
  );
}
