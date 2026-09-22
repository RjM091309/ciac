import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, RotateCcw, Search, UserX } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DataTableControls } from '../ui/DataTableControls';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';

const MENU_KEY = 'settings:type-of-contract';

type TypeOfContractRow = {
  id: number;
  name: string;
  is_active: number;
};

const inputClass =
  'w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]';
const inputStyle = { borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' };

export function TypeOfContractManagement() {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const canAdd = fullAccess || perm.can_add;
  const canEdit = fullAccess || perm.can_edit;
  const canDelete = fullAccess || perm.can_delete;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TypeOfContractRow[]>([]);
  const [editing, setEditing] = useState<TypeOfContractRow | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ name: '' });

  const stats = useMemo(() => {
    const active = items.filter((i) => i.is_active === 1).length;
    return { active, inactive: items.length - active, total: items.length };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
      const statusStr = i.is_active === 1 ? 'active' : 'inactive';
      return (i.name || '').toLowerCase().includes(q) || statusStr.includes(q);
    });
  }, [items, searchQuery]);

  const canSubmit = useMemo(() => {
    const name = form.name.trim();
    if (!name) return false;
    if (!editing) return true;
    return name !== (editing.name || '').trim();
  }, [editing, form]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredItems.length / Math.max(1, pageSize))),
    [filteredItems.length, pageSize],
  );

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

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/type-of-contract', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load type of contract');
      setItems((json.data || []).map((item: any) => ({ ...item, is_active: Number(item?.is_active) ? 1 : 0 })));
    } catch (e: any) {
      const message = e?.message || 'Failed to load data';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function openCreate() {
    setEditing(null);
    setForm({ name: '' });
    setIsPanelOpen(true);
  }

  function openEdit(item: TypeOfContractRow) {
    setEditing(item);
    setForm({ name: item.name || '' });
    setIsPanelOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = { name: form.name.trim() };
      if (!payload.name) throw new Error('Name is required');

      const res = await fetch(editing ? `/api/type-of-contract/${editing.id}` : '/api/type-of-contract', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');

      setIsPanelOpen(false);
      await loadAll();
      toast.success(editing ? 'Type of Contract updated successfully' : 'Type of Contract created successfully');
    } catch (e: any) {
      const message = e?.message || 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(id: number, active: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/type-of-contract/${id}/${active ? 'reactivate' : 'deactivate'}`, {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Update failed');
      await loadAll();
      toast.success(active ? 'Type of Contract reactivated successfully' : 'Type of Contract deactivated successfully');
    } catch (e: any) {
      setError(e?.message || 'Update failed');
      toast.error(e?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  function renderStatusBadge(item: TypeOfContractRow) {
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

  function actionButton(label: string, onClick: () => void, icon: React.ReactNode) {
    return (
      <button
        className={cn(
          'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
          saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        )}
        onClick={onClick}
        disabled={saving}
        aria-label={label}
        title={label.split(' ')[0]}
      >
        {icon}
      </button>
    );
  }

  function renderItemActions(item: TypeOfContractRow) {
    return (
      <>
        {canEdit ? actionButton(`Edit ${item.name}`, () => openEdit(item), <Pencil size={14} />) : null}
        {item.is_active === 1
          ? canDelete
            ? actionButton(`Deactivate ${item.name}`, () => setConfirmDeactivateId(item.id), <UserX size={14} />)
            : null
          : canEdit
            ? actionButton(`Reactivate ${item.name}`, () => setConfirmReactivateId(item.id), <RotateCcw size={14} />)
            : null}
      </>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-3">
        <StatCard label="Active Types" value={String(stats.active)} />
        <StatCard label="Total Types" value={String(stats.total)} />
        <StatCard label="Deactivated" value={String(stats.inactive)} />
      </div>

      <div className="glass-card p-3 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Type of Contract List
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
            <TableSkeleton columns={3} rows={5} />
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            title="No type of contract found"
            description={
              searchQuery
                ? 'Try adjusting your search filters.'
                : 'There are no types of contract yet. Create one to get started.'
            }
            action={
              !searchQuery && canAdd ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={openCreate}
                >
                  Create Type of Contract
                </button>
              ) : undefined
            }
          />
        ) : (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <div className="relative group w-full sm:w-72">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
                  size={14}
                />
                <input
                  type="text"
                  placeholder="Search type of contract..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
                />
              </div>
            </div>

            {/* Phones: one card per row instead of a 4-column table */}
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
                    </div>
                    <div className="shrink-0">{renderStatusBadge(item)}</div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-end gap-0.5 -mr-1.5 -mb-1">{renderItemActions(item)}</div>
                </div>
              ))}
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr>
                    {['Name', 'Status', 'Actions'].map((col) => (
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
                        {item.name}
                      </td>
                      <td className="px-3 py-2 text-[11px]">{renderStatusBadge(item)}</td>
                      <td className="px-3 py-2 pr-2">
                        <div className="flex items-center justify-end gap-2">{renderItemActions(item)}</div>
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
        open={isPanelOpen}
        title={editing ? 'Edit Type of Contract' : 'New Type of Contract'}
        subtitle="Type of Contract master table"
        onClose={() => setIsPanelOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!canSubmit}
      >
        <div className="grid grid-cols-1 gap-3">
          <Field label="Name">
            <input
              className={inputClass}
              style={inputStyle}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate type of contract?"
        description="This type of contract will be marked inactive. You can re-activate later."
        confirmText="Deactivate"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateId(null)}
        onConfirm={async () => {
          if (confirmDeactivateId === null) return;
          await setActive(confirmDeactivateId, false);
          setConfirmDeactivateId(null);
        }}
      />

      <ConfirmModal
        open={confirmReactivateId !== null}
        title="Reactivate type of contract?"
        description="This type of contract will be marked active again."
        confirmText="Reactivate"
        loading={saving}
        onCancel={() => setConfirmReactivateId(null)}
        onConfirm={async () => {
          if (confirmReactivateId === null) return;
          await setActive(confirmReactivateId, true);
          setConfirmReactivateId(null);
        }}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-2.5 sm:px-3 py-2.5 sm:py-3 flex flex-col justify-between gap-1 shadow-sm min-w-0"
      style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <span className="text-[9px] sm:text-[10px] font-semibold text-secondary uppercase tracking-wide sm:tracking-widest leading-tight">
        {label}
      </span>
      <span className="text-lg font-bold leading-tight" style={{ color: 'var(--text)' }}>
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
