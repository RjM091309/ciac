import React, { useEffect, useMemo, useState } from 'react';
import { FileCheck, ListChecks, Pencil, Search, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
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
};

type CategoryRow = {
  id: number;
  name: string;
  is_active: number;
};

type ChecklistData = {
  items: RequirementRow[];
  categories: CategoryRow[];
};

function api(path: string) {
  return path;
}

type ApplicationTypeKey = 'new' | 'renewal';

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-3 flex flex-col gap-1 shadow-sm"
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
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
    <label className="flex items-center gap-2 rounded-lg border border-solid border-[var(--input-border)] px-3 py-2 text-xs cursor-pointer transition-all hover:border-[var(--nav-active-bg)] hover:bg-white/5">
      <input type="checkbox" className="cursor-pointer" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ color: 'var(--text)' }} className="cursor-pointer">
        {label}
      </span>
    </label>
  );
}

export function MasterChecklist() {
  const [activeTab, setActiveTab] = useState<ApplicationTypeKey>('new');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RequirementRow | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [mandatoryFilter, setMandatoryFilter] = useState<'' | 'required' | 'optional'>('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  // Same cache key/shape as Requirements Management: this page and that one
  // both read and write the same underlying requirements table, just grouped
  // by application type here instead of shown as a flat list there.
  const { data, isLoading, refresh } = useSessionStorageCachedResource<ChecklistData>({
    cacheKey: 'ciac.requirements.categories_and_items.v1',
    ttlMs: 5 * 60 * 1000,
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
        categories: (cJson.data || []).map((c: any) => ({ ...c, is_active: Number(c?.is_active) ? 1 : 0 })),
      };
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : 'Failed to load checklist';
      setError(message);
      toast.error(message);
    },
  });

  const allItems = data?.items ?? [];
  const categories = data?.categories ?? [];
  const categoryOptions = useMemo(() => categories.map((c) => ({ value: String(c.id), label: c.name })), [categories]);

  const activeItems = useMemo(() => allItems.filter((i) => i.is_active === 1), [allItems]);
  const newChecklist = useMemo(() => activeItems.filter((i) => i.for_new === 1), [activeItems]);
  const renewalChecklist = useMemo(() => activeItems.filter((i) => i.for_renewal === 1), [activeItems]);
  const currentList = activeTab === 'new' ? newChecklist : renewalChecklist;
  const requiredCount = currentList.filter((i) => i.is_mandatory === 1).length;
  const optionalCount = currentList.length - requiredCount;

  const sortedList = useMemo(() => {
    return [...currentList].sort((a, b) => {
      const catA = a.category_name || 'Uncategorized';
      const catB = b.category_name || 'Uncategorized';
      if (catA !== catB) return catA.localeCompare(catB);
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [currentList]);

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedList.filter((item) => {
      if (categoryFilter && String(item.category_id ?? '') !== categoryFilter) return false;
      if (mandatoryFilter === 'required' && item.is_mandatory !== 1) return false;
      if (mandatoryFilter === 'optional' && item.is_mandatory === 1) return false;
      if (!q) return true;
      return (
        (item.code || '').toLowerCase().includes(q) ||
        (item.name || '').toLowerCase().includes(q) ||
        (item.category_name || '').toLowerCase().includes(q)
      );
    });
  }, [sortedList, searchQuery, categoryFilter, mandatoryFilter]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredList.length / Math.max(1, pageSize))), [filteredList.length, pageSize]);

  const pagedList = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, page, pageSize, totalPages]);

  const showingRange = useMemo(() => {
    if (filteredList.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    return { from: (safePage - 1) * pageSize + 1, to: Math.min(filteredList.length, safePage * pageSize) };
  }, [filteredList.length, page, pageSize, totalPages]);

  const visiblePageNumbers = useMemo(() => {
    const current = Math.min(Math.max(1, page), totalPages);
    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter, mandatoryFilter, pageSize, activeTab]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    category_id: '',
    for_new: true,
    for_renewal: true,
    is_mandatory: true,
  });

  const canSubmit = useMemo(() => {
    const code = form.code.trim();
    const name = form.name.trim();
    if (!code || !name) return false;
    if (!editing) return true;

    const originalCode = (editing.code || '').trim();
    const originalName = (editing.name || '').trim();
    const originalDescription = (editing.description || '').trim();
    const originalCategoryId = editing.category_id != null ? String(editing.category_id) : '';
    return (
      code !== originalCode ||
      name !== originalName ||
      form.description.trim() !== originalDescription ||
      form.category_id !== originalCategoryId ||
      form.for_new !== (Number(editing.for_new) === 1) ||
      form.for_renewal !== (Number(editing.for_renewal) === 1) ||
      form.is_mandatory !== (Number(editing.is_mandatory) === 1)
    );
  }, [editing, form]);

  function openCreate() {
    setEditing(null);
    setForm({
      code: '',
      name: '',
      description: '',
      category_id: '',
      for_new: activeTab === 'new',
      for_renewal: activeTab === 'renewal',
      is_mandatory: true,
    });
    setIsFormOpen(true);
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
    setIsFormOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id ? Number(form.category_id) : null,
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
      setIsFormOpen(false);
      await refresh({ showLoading: false });
      toast.success(editing ? 'Requirement updated successfully' : 'Requirement added to checklist');
    } catch (e: any) {
      const message = e?.message || 'Save failed';
      setError(message);
      toast.error(message);
      // Category list may be stale (cached client-side); refresh so a bad
      // selection doesn't keep getting offered on the next attempt.
      await refresh({ showLoading: false });
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: number) {
    setSaving(true);
    try {
      const res = await fetch(api(`/api/requirements/${id}/deactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      await refresh({ showLoading: false });
      toast.success('Requirement removed from checklist');
      setConfirmDeactivateId(null);
    } catch (e: any) {
      toast.error(e?.message || 'Deactivate failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
        <StatCard label="Total Active Requirements" value={String(activeItems.length)} />
        <StatCard label="New Locator Checklist" value={String(newChecklist.length)} />
        <StatCard label="Renewal Checklist" value={String(renewalChecklist.length)} />
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <div>
            <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              Master Checklist
            </h3>
            <p className="text-[11px] text-secondary">Add, edit, or remove requirements per application type.</p>
          </div>
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

        <div
          role="tablist"
          aria-label="Checklist by application type"
          className="flex rounded-xl border p-1 mb-4"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
        >
          {(
            [
              { key: 'new' as const, label: 'New Locator' },
              { key: 'renewal' as const, label: 'Renewal' },
            ]
          ).map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className="flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors cursor-pointer"
              style={
                activeTab === tab.key
                  ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                  : { backgroundColor: 'transparent', color: 'var(--text)' }
              }
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="py-2">
            <TableSkeleton columns={3} rows={5} />
          </div>
        ) : currentList.length === 0 ? (
          <EmptyState
            title="No requirements in this checklist yet"
            description={`Add a requirement for ${activeTab === 'new' ? 'new locator' : 'renewal'} applications to get started.`}
            action={
              <button
                className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors cursor-pointer"
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                onClick={openCreate}
              >
                Add Requirement
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="flex flex-col lg:flex-row lg:items-center gap-2 mb-3">
              <div className="relative group w-full lg:w-64">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
                  size={14}
                />
                <input
                  type="text"
                  placeholder="Search checklist..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
                />
              </div>
              <div className="w-full sm:w-48">
                <AppSelect
                  options={categoryOptions}
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  placeholder="All categories"
                  isClearable
                  compact
                />
              </div>
              <div className="w-full sm:w-40">
                <AppSelect
                  options={[
                    { value: 'required', label: 'Required' },
                    { value: 'optional', label: 'Optional' },
                  ]}
                  value={mandatoryFilter}
                  onChange={(v) => setMandatoryFilter(v as '' | 'required' | 'optional')}
                  placeholder="All statuses"
                  isClearable
                  compact
                />
              </div>
              <div className="flex items-center gap-4 text-[11px] text-secondary lg:ml-auto shrink-0">
                <span className="inline-flex items-center gap-1.5">
                  <ListChecks size={13} className="text-emerald-400" /> {requiredCount} required
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <FileCheck size={13} className="text-secondary" /> {optionalCount} optional
                </span>
              </div>
            </div>

            {filteredList.length === 0 ? (
              <EmptyState
                title="No matching requirements"
                description="Try adjusting your search or filters."
              />
            ) : (
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Code', 'Name', 'Category', 'Status', 'Actions'].map((col) => (
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
                {pagedList.map((item) => (
                  <tr key={item.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                      {item.code}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {item.name}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{item.category_name || 'Uncategorized'}</td>
                    <td className="px-3 py-2 text-[11px]">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={
                          item.is_mandatory === 1
                            ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
                            : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' }
                        }
                      >
                        {item.is_mandatory === 1 ? 'Required' : 'Optional'}
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
                        <button
                          className={cn(
                            'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                            saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                          )}
                          onClick={() => setConfirmDeactivateId(item.id)}
                          disabled={saving}
                          aria-label={`Remove ${item.name}`}
                          title="Remove from checklist"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}

            <DataTableControls
              page={page}
              totalPages={totalPages}
              totalItems={filteredList.length}
              showingFrom={showingRange.from}
              showingTo={showingRange.to}
              visiblePageNumbers={visiblePageNumbers}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100, 200]}
              onPageSizeChange={setPageSize}
              onPageChange={setPage}
              loading={isLoading}
            />
          </div>
        )}
      </div>

      <SidePanel
        open={isFormOpen}
        title={editing ? 'Edit Requirement' : 'New Requirement'}
        subtitle="Requirements master table"
        onClose={() => setIsFormOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!canSubmit}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Code">
            <input
              className="app-form-control"
              value={form.code}
              onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
            />
          </Field>
          <Field label="Name">
            <input
              className="app-form-control"
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
              className="app-form-control"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <CheckToggle
              label="For New Locator"
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
        title="Remove from checklist?"
        description="This requirement will be marked inactive and hidden from both checklists. You can restore it later."
        confirmText="Remove"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateId(null)}
        onConfirm={() => {
          if (confirmDeactivateId !== null) void deactivate(confirmDeactivateId);
        }}
      />
    </div>
  );
}
