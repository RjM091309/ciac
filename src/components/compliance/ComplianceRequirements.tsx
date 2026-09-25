import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, RotateCcw, Search, UserX } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DataTableControls } from '../ui/DataTableControls';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { AppSelect } from '../ui/AppSelect';

const MENU_KEY = 'compliance:inspections';

/** The three tabs of the locator compliance checklist (legacy BRIDGE screen). */
const CATEGORIES = [
  { value: 'COMPLIANCE', label: 'Compliance' },
  { value: 'PERMITS', label: 'Applicable Permits and Clearances' },
  { value: 'PERFORMANCE', label: 'Performance Commitment' },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

type RequirementRow = {
  id: number;
  code: string;
  name: string;
  category: string;
  sort_order: number;
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

/** The Compliance Requirements tab of Compliance & Inspection: maintains the
 * requirements listed under each of the Compliance / Permits and Clearances /
 * Performance Commitment tabs of a locator. `onChanged` runs after any save so
 * the page can refresh what depends on the list. */
export function ComplianceRequirementsManagement({ onChanged }: { onChanged?: () => void } = {}) {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const canAdd = fullAccess || perm.can_add;
  const canEdit = fullAccess || perm.can_edit;
  const canDelete = fullAccess || perm.can_delete;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RequirementRow[]>([]);
  const [editing, setEditing] = useState<RequirementRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'COMPLIANCE',
    sort_order: '',
    description: '',
  });


  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const inCategory = categoryFilter ? items.filter((i) => i.category === categoryFilter) : items;
    if (!q) return inCategory;
    return inCategory.filter((i) => {
      const statusStr = i.is_active === 1 ? 'active' : 'inactive';
      return (
        (i.code || '').toLowerCase().includes(q) ||
        (i.name || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (CATEGORY_LABEL[i.category] || '').toLowerCase().includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [items, searchQuery, categoryFilter]);
  const canSubmit = useMemo(() => {
    const code = form.code.trim();
    const name = form.name.trim();
    const description = form.description.trim();

    if (!code || !name) return false;

    if (!editing) {
      const hasAnyInput = Boolean(code || name || description);
      return hasAnyInput;
    }

    return (
      name !== (editing.name || '').trim() ||
      description !== (editing.description || '').trim() ||
      form.category !== editing.category ||
      form.sort_order.trim() !== String(editing.sort_order ?? '')
    );
  }, [editing, form.code, form.description, form.name, form.category, form.sort_order]);

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
      const res = await fetch(api('/api/compliance-requirements'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load compliance requirements');
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
  }, [searchQuery, pageSize, categoryFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function openCreate() {
    setEditing(null);
    setForm({ code: '', name: '', category: categoryFilter || 'COMPLIANCE', sort_order: '', description: '' });
    setIsCreateOpen(true);
  }

  function openEdit(item: RequirementRow) {
    setIsCreateOpen(true);
    setEditing(item);
    setForm({
      code: item.code || '',
      name: item.name || '',
      category: item.category || 'COMPLIANCE',
      sort_order: String(item.sort_order ?? ''),
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
        category: form.category,
        sort_order: form.sort_order.trim() ? Number(form.sort_order) : 0,
        description: form.description.trim() || null,
      };
      // The code is fixed once created: saved locator checklist values refer to it.
      if (editing) delete payload.code;
      if (!editing && !payload.code) throw new Error('Code is required');
      if (!payload.name) throw new Error('Name is required');

      const res = await fetch(api(editing ? `/api/compliance-requirements/${editing.id}` : '/api/compliance-requirements'), {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');

      setIsCreateOpen(false);
      await loadAll();
      onChanged?.();
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
      const res = await fetch(api(`/api/compliance-requirements/${id}/deactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      await loadAll();
      onChanged?.();
      toast.success('Requirement deactivated successfully');
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
      const res = await fetch(api(`/api/compliance-requirements/${id}/reactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reactivate failed');
      await loadAll();
      onChanged?.();
      toast.success('Requirement reactivated successfully');
    } catch (e: any) {
      setError(e?.message || 'Reactivate failed');
      toast.error(e?.message || 'Reactivate failed');
    } finally {
      setSaving(false);
    }
  }

  function renderStatusBadge(item: (typeof pagedItems)[number]) {
    return (
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
    );
  }

  function renderItemActions(item: (typeof pagedItems)[number]) {
    return (
      <>
        {canEdit ? (
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
        ) : null}
        {item.is_active === 1 ? (
          canDelete ? (
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
          ) : null
        ) : canEdit ? (
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
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">

      <div className="glass-card p-3 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Compliance Requirements List
          </h3>
          {canAdd ? (
            <button
              className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm cursor-pointer"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              onClick={openCreate}
            >
              + New Record
            </button>
          ) : null}
        </div>

        {error && (
          <div className="mb-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-2">
            <TableSkeleton columns={7} rows={5} />
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            title="No compliance requirements found"
            description={
              searchQuery || categoryFilter
                ? 'Try adjusting your search filters.'
                : 'There are no compliance requirements yet. Create one to get started.'
            }
            action={
              !searchQuery && !categoryFilter && canAdd ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={openCreate}
                >
                  Create Requirement
                </button>
              ) : undefined
            }
          />
        ) : (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
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
              <div className="w-full sm:w-72">
                <AppSelect
                  compact
                  placeholder="All categories"
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={CATEGORIES}
                />
              </div>
            </div>
            {/* Phones: one card per requirement instead of a 7-column table */}
            <div className="sm:hidden space-y-2">
              {pagedItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl p-3"
                  style={{
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold leading-snug break-words" style={{ color: 'var(--text)' }}>
                        {item.name}
                      </div>
                      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary break-all">
                        {CATEGORY_LABEL[item.category] || item.category} · {item.code}
                      </div>
                    </div>
                    <div className="shrink-0">{renderStatusBadge(item)}</div>
                  </div>
                  <div className="mt-1.5 flex items-end justify-between gap-2">
                    <p className="min-w-0 flex-1 text-[11px] text-secondary break-words">{item.description || 'No description'}</p>
                    <div className="shrink-0 flex items-center gap-0.5 -mr-1.5 -mb-1">{renderItemActions(item)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Category', 'Order', 'Code', 'Name', 'Description', 'Status', 'Actions'].map((col) => (
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
                    <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--text)' }}>
                      {CATEGORY_LABEL[item.category] || item.category}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary tabular-nums">{item.sort_order}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {item.code}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {item.name}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{item.description || '-'}</td>
                    <td className="px-3 py-2 text-[11px]">
                      {renderStatusBadge(item)}
                    </td>
                    <td className="px-3 py-2 pr-2">
                      <div className="flex items-center justify-end gap-2">
                        {renderItemActions(item)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
        title={editing ? 'Edit Compliance Requirement' : 'New Compliance Requirement'}
        subtitle="Listed under a locator's compliance tabs in Compliance & Inspection"
        onClose={() => setIsCreateOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!canSubmit}
      >
        <div className="grid grid-cols-1 gap-3">
          <Field label="Category">
            <AppSelect
              compact
              isClearable={false}
              value={form.category}
              onChange={(v) => setForm((p) => ({ ...p, category: v || 'COMPLIANCE' }))}
              options={CATEGORIES}
            />
          </Field>
          <Field label="Code">
            <input
              className="app-input"
              value={form.code}
              onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
              disabled={Boolean(editing)}
              placeholder="e.g. BUSINESS_PERMIT"
            />
            {editing ? <p className="text-[10px] text-secondary">The code can't be changed once created.</p> : null}
          </Field>
          <Field label="Name">
            <input
              className="app-input"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>
          <Field label="Order">
            <input
              className="app-input"
              inputMode="numeric"
              value={form.sort_order}
              onChange={(e) => setForm((p) => ({ ...p, sort_order: e.target.value.replace(/[^0-9]/g, '') }))}
              placeholder="Lower numbers are listed first"
            />
          </Field>
          <Field label="Description">
            <textarea
              className="app-input min-h-24 resize-y"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate requirement?"
        description="It will no longer be listed on locators' compliance tabs. Values already recorded are kept and come back if you re-activate it."
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
        description="It will be listed on locators' compliance tabs again."
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{label}</div>
      {children}
    </div>
  );
}
