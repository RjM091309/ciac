import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { LANDING_CONFIG } from '../../config/landingConfig';

type Role = {
  id: number;
  name: string;
  description?: string | null;
  is_active?: number;
};

type SidebarPermissionMap = Record<string, boolean>;
type CrudPermissionMap = Record<string, { can_add: boolean; can_edit: boolean; can_delete: boolean }>;

type MenuItem = {
  key: string;
  label: string;
};

function api(path: string) {
  return path;
}

/** Fixed widths so CRUD header labels line up with toggle columns. */
const CRUD_TOGGLE_COLS_CLASS =
  'grid grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.25rem] items-center gap-x-3';

/** Pill switch: thumb stays inside track (flex + translateX only — avoids absolute + conflicting translate bugs). */
function PermissionToggle({
  checked,
  onChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  'aria-label'?: string;
}) {
  /** Track is w-[3.25rem] with px-0.5: inner ≈ 3rem; thumb w-6 → travel 1.5rem */
  const thumbTravel = '1.5rem';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative box-border flex h-7 w-[3.25rem] shrink-0 items-center overflow-hidden rounded-full px-0.5 py-0 transition-[background-color,box-shadow] duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nav-active-bg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
      style={{
        backgroundColor: checked ? 'var(--nav-active-bg)' : 'rgba(148, 163, 184, 0.28)',
        boxShadow: checked ? '0 0 0 1px rgba(255,255,255,0.12) inset' : '0 0 0 1px var(--border-subtle) inset',
      }}
    >
      <Check
        className="pointer-events-none absolute left-1.5 top-1/2 z-0 h-3 w-3 -translate-y-1/2 transition-opacity duration-150"
        strokeWidth={3}
        style={{
          color: 'var(--nav-active-text, #fff)',
          opacity: checked ? 0.95 : 0,
        }}
      />
      <span
        className="pointer-events-none relative z-[1] h-6 w-6 shrink-0 rounded-full bg-white shadow-md transition-transform duration-200 ease-out"
        style={{
          transform: checked ? `translateX(${thumbTravel})` : 'translateX(0)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

export function ControlPanelManagement() {
  const [activeTab, setActiveTab] = useState<'sidebar' | 'crud'>('sidebar');
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sidebarPermissions, setSidebarPermissions] = useState<SidebarPermissionMap>({});
  const [crudPermissions, setCrudPermissions] = useState<CrudPermissionMap>({});

  const isExcludedRole = (role: Role) => String(role.name || '').trim().toLowerCase() === 'admin';

  const sidebarMenuItems: MenuItem[] = useMemo(
    () => Object.entries(LANDING_CONFIG).map(([key, cfg]) => ({ key, label: cfg.title })),
    []
  );
  const sidebarMenuColumns = useMemo(
    () => [
      { offset: 0, items: sidebarMenuItems.slice(0, 10) },
      { offset: 10, items: sidebarMenuItems.slice(10) },
    ],
    [sidebarMenuItems]
  );

  const crudMenuItems: MenuItem[] = useMemo(
    () =>
      Object.entries(LANDING_CONFIG)
        .filter(([, cfg]) => Boolean((cfg as any)?.isCrud))
        .map(([key, cfg]) => ({ key, label: (cfg as any).title })),
    []
  );

  const selectedRole = useMemo(
    () => roles.find((r) => String(r.id) === selectedRoleId) || null,
    [roles, selectedRoleId]
  );

  async function loadRoles() {
    setLoading(true);
    try {
      const res = await fetch(api('/api/roles'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load roles');
      const nextRoles = (json.data || []) as Role[];
      const allowedRoles = nextRoles.filter((r) => !isExcludedRole(r));
      setRoles(allowedRoles);
      if (allowedRoles.length > 0) {
        setSelectedRoleId((prev) => prev || String(allowedRoles[0].id));
      } else {
        setSelectedRoleId('');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  async function loadSidebarPermissions(roleId: string) {
    const res = await fetch(api(`/api/control-panel/sidebar-menu/${roleId}`), { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || 'Failed to load sidebar permissions');
    const next: SidebarPermissionMap = {};
    (json?.data || []).forEach((row: any) => {
      next[String(row.menu_key)] = Number(row.is_enabled) === 1 || row.is_enabled === true;
    });
    setSidebarPermissions(next);
  }

  async function loadCrudPermissions(roleId: string) {
    const res = await fetch(api(`/api/control-panel/menu-crud/${roleId}`), { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || 'Failed to load CRUD permissions');
    const next: CrudPermissionMap = {};
    (json?.data || []).forEach((row: any) => {
      next[String(row.menu_key)] = {
        can_add: Number(row.can_add) === 1 || row.can_add === true,
        can_edit: Number(row.can_edit) === 1 || row.can_edit === true,
        can_delete: Number(row.can_delete) === 1 || row.can_delete === true,
      };
    });
    setCrudPermissions(next);
  }

  useEffect(() => {
    loadRoles();
  }, []);

  useEffect(() => {
    if (!selectedRoleId) return;
    const run = async () => {
      try {
        await Promise.all([loadSidebarPermissions(selectedRoleId), loadCrudPermissions(selectedRoleId)]);
      } catch (e: any) {
        toast.error(e?.message || 'Failed to load control panel data');
      }
    };
    run();
  }, [selectedRoleId]);

  async function saveSidebarPermissions() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const payload = sidebarMenuItems.map((item) => ({
        menu_key: item.key,
        is_enabled: Boolean(sidebarPermissions[item.key]),
      }));
      const res = await fetch(api(`/api/control-panel/sidebar-menu/${selectedRoleId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ permissions: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save sidebar permissions');
      toast.success('Sidebar menu permissions saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save sidebar permissions');
    } finally {
      setSaving(false);
    }
  }

  async function saveCrudPermissions() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const payload = crudMenuItems.map((item) => ({
        menu_key: item.key,
        can_add: Boolean(crudPermissions[item.key]?.can_add),
        can_edit: Boolean(crudPermissions[item.key]?.can_edit),
        can_delete: Boolean(crudPermissions[item.key]?.can_delete),
      }));
      const res = await fetch(api(`/api/control-panel/menu-crud/${selectedRoleId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ permissions: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save CRUD permissions');
      toast.success('Menu CRUD permissions saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save CRUD permissions');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="mt-3">
        <div
          role="tablist"
          aria-label="Control Panel Tabs"
          className="flex rounded-xl border p-1"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
        >
          <button
            role="tab"
            aria-selected={activeTab === 'sidebar'}
            className="flex-1 rounded-lg px-3 py-3 flex flex-col gap-1 text-left transition-colors"
            style={
              activeTab === 'sidebar'
                ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                : { backgroundColor: 'transparent', color: 'var(--text)' }
            }
            onClick={() => setActiveTab('sidebar')}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest opacity-80">Sidebar</span>
            <span className="text-base sm:text-lg font-bold leading-tight">Menu Permissions</span>
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'crud'}
            className="flex-1 rounded-lg px-3 py-3 flex flex-col gap-1 text-left transition-colors"
            style={
              activeTab === 'crud'
                ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                : { backgroundColor: 'transparent', color: 'var(--text)' }
            }
            onClick={() => setActiveTab('crud')}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest opacity-80">CRUD</span>
            <span className="text-base sm:text-lg font-bold leading-tight">Permissions</span>
          </button>
        </div>
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        {!selectedRoleId ? (
          <div className="text-xs text-secondary">No role found.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
            <div
              className="rounded-xl border p-3 h-fit"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
            >
              <div className="mb-2 text-[10px] font-semibold text-secondary uppercase tracking-widest">Roles</div>
              <div className="space-y-1.5">
                {roles.map((role) => {
                  const isActive = String(role.id) === selectedRoleId;
                  return (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRoleId(String(role.id))}
                      className="w-full rounded-lg px-2.5 py-2 text-left text-[12px]"
                      style={
                        isActive
                          ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                          : { backgroundColor: 'transparent', color: 'var(--text)' }
                      }
                    >
                      <div className="font-semibold leading-tight">{role.name}</div>
                      <div
                        className="text-[10px] opacity-70 leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                        title={role.description || `ID ${role.id}`}
                      >
                        {role.description || `ID ${role.id}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">
                    {activeTab === 'sidebar' ? 'Sidebar Menu Permissions' : 'Menu CRUD Permissions'}
                  </div>
                  <div className="text-[12px] text-secondary">
                    {activeTab === 'sidebar'
                      ? `Showing sidebar menus for ${selectedRole?.name || 'selected role'}`
                      : `Configure CRUD modules for ${selectedRole?.name || 'selected role'}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="group relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-[12px] font-semibold tracking-wide shadow-md transition-[transform,box-shadow,filter,opacity] duration-200 ease-out hover:brightness-110 hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
                  style={{
                    backgroundColor: 'var(--nav-active-bg)',
                    color: 'var(--nav-active-text)',
                    boxShadow:
                      '0 1px 2px rgba(0,0,0,0.12), 0 4px 14px color-mix(in srgb, var(--nav-active-bg) 45%, transparent)',
                  }}
                  onClick={activeTab === 'sidebar' ? saveSidebarPermissions : saveCrudPermissions}
                  disabled={saving || loading}
                >
                  <span
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 50%)',
                    }}
                  />
                  {saving ? (
                    <Loader2 className="relative h-4 w-4 shrink-0 animate-spin opacity-95" aria-hidden />
                  ) : (
                    <Save className="relative h-4 w-4 shrink-0 opacity-95 transition-transform duration-200 group-hover:scale-105" aria-hidden />
                  )}
                  <span className="relative">{saving ? 'Saving…' : 'Save changes'}</span>
                </button>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {activeTab === 'sidebar' ? (
                  <motion.div
                    key={`sidebar-${selectedRoleId}`}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="space-y-2"
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {sidebarMenuColumns
                        .filter((c) => c.items.length > 0)
                        .map((column, columnIndex) => (
                        <div
                          key={`sidebar-column-${column.offset}`}
                          className="space-y-2 rounded-xl border p-2"
                          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                        >
                          <div className="px-1 text-[10px] font-semibold uppercase tracking-widest text-secondary">
                            {`Menu Items ${column.offset + 1}-${column.offset + column.items.length}`}
                          </div>
                          <div
                            className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2 border rounded-lg text-[10px] font-semibold uppercase tracking-widest text-secondary"
                            style={{ borderColor: 'var(--border-subtle)' }}
                          >
                            <span className="min-w-0">Menu Item</span>
                            <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                              Visible
                            </span>
                          </div>
                          {column.items.map((item) => (
                            <div
                              key={item.key}
                              className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2.5 border rounded-lg transition-colors"
                              style={{ borderColor: 'var(--border-subtle)' }}
                            >
                              <span className="min-w-0 text-[12px]" style={{ color: 'var(--text)' }}>
                                {item.label}
                              </span>
                              <div className="flex min-h-[1.75rem] items-center justify-center">
                                <PermissionToggle
                                  aria-label={`${item.label} sidebar visible`}
                                  checked={Boolean(sidebarPermissions[item.key])}
                                  onChange={(next) =>
                                    setSidebarPermissions((prev) => ({
                                      ...prev,
                                      [item.key]: next,
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={`crud-${selectedRoleId}`}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="space-y-2"
                  >
                    <div
                      className={`${CRUD_TOGGLE_COLS_CLASS} gap-y-1 px-3 py-2 border rounded-lg text-[10px] font-semibold uppercase tracking-widest text-secondary`}
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <span className="min-w-0">Module</span>
                      <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                        Add
                      </span>
                      <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                        Edit
                      </span>
                      <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                        Delete
                      </span>
                    </div>
                    {crudMenuItems.map((item) => {
                      const row = crudPermissions[item.key] || {
                        can_add: false,
                        can_edit: false,
                        can_delete: false,
                      };
                      return (
                        <div
                          key={item.key}
                          className={`group ${CRUD_TOGGLE_COLS_CLASS} gap-y-1 px-3 py-2.5 border rounded-lg transition-colors`}
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          <span className="min-w-0 text-[12px] font-medium" style={{ color: 'var(--text)' }}>
                            {item.label}
                          </span>
                          <div className="flex min-h-[1.75rem] items-center justify-center">
                            <PermissionToggle
                              aria-label={`${item.label} add permission`}
                              checked={row.can_add}
                              onChange={(next) =>
                                setCrudPermissions((prev) => ({
                                  ...prev,
                                  [item.key]: {
                                    can_add: next,
                                    can_edit: prev[item.key]?.can_edit || false,
                                    can_delete: prev[item.key]?.can_delete || false,
                                  },
                                }))
                              }
                            />
                          </div>
                          <div className="flex min-h-[1.75rem] items-center justify-center">
                            <PermissionToggle
                              aria-label={`${item.label} edit permission`}
                              checked={row.can_edit}
                              onChange={(next) =>
                                setCrudPermissions((prev) => ({
                                  ...prev,
                                  [item.key]: {
                                    can_add: prev[item.key]?.can_add || false,
                                    can_edit: next,
                                    can_delete: prev[item.key]?.can_delete || false,
                                  },
                                }))
                              }
                            />
                          </div>
                          <div className="flex min-h-[1.75rem] items-center justify-center">
                            <PermissionToggle
                              aria-label={`${item.label} delete permission`}
                              checked={row.can_delete}
                              onChange={(next) =>
                                setCrudPermissions((prev) => ({
                                  ...prev,
                                  [item.key]: {
                                    can_add: prev[item.key]?.can_add || false,
                                    can_edit: prev[item.key]?.can_edit || false,
                                    can_delete: next,
                                  },
                                }))
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-secondary pt-2 border-t mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      Turning off a switch hides the matching Add, Edit, or Delete controls for this role in that module.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
