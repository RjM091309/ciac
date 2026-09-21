import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { AppSelect } from '../ui/AppSelect';
import { LANDING_CONFIG } from '../../config/landingConfig';
import { roleDisplayName } from '../../lib/roleDisplay';

type Role = {
  id: number;
  name: string;
  description?: string | null;
  is_active?: number;
};

type SidebarPermissionMap = Record<string, boolean>;
type CrudPermissionMap = Record<string, { can_add: boolean; can_edit: boolean; can_delete: boolean }>;
type WidgetPermissionMap = Record<string, boolean>;

type MenuItem = {
  key: string;
  label: string;
};

function api(path: string) {
  return path;
}

// DBM-08: the officer/proponent dashboard cards an admin can toggle per
// role. Admin's own dashboard is exempt (fullAccess), so this list only ever
// affects what Officer/Proponent accounts see.
const DASHBOARD_WIDGETS: MenuItem[] = [
  { key: 'dashboard:stats', label: 'Stat Cards' },
  { key: 'dashboard:attention', label: 'Needs Attention List (Officer)' },
  { key: 'dashboard:table', label: 'Applications Table' },
];

// The Locator portal's fixed self-service menu (ProponentSidebar) — separate
// from sidebarMenuItems above since it isn't one of the admin/officer AppView
// pages LANDING_CONFIG describes. Reuses the same role_sidebar_menu_permissions
// table/keys, but defaults to visible (fail-open) when unset, unlike the
// fail-closed sidebarMenuItems above — see ProponentSidebar's canView.
const PROPONENT_MENU_ITEMS: MenuItem[] = [
  { key: 'me:applications', label: 'My Applications' },
  { key: 'me:contracts-permits', label: 'Contracts & Permits' },
  { key: 'me:profile', label: 'My Business Profile' },
  { key: 'me:activity', label: 'Activity History' },
];
const PROPONENT_MENU_KEYS = new Set(PROPONENT_MENU_ITEMS.map((item) => item.key));

/** Fixed widths so CRUD header labels line up with toggle columns. Grid only
 * from `sm` up — on phones each module stacks its switches under the name. */
const CRUD_TOGGLE_COLS_CLASS =
  'sm:grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.25rem] sm:items-center gap-x-3';

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

export function ControlPanelManagement({ locationSearch }: { locationSearch?: string } = {}) {
  const [activeTab, setActiveTab] = useState<'sidebar' | 'crud' | 'widgets'>('sidebar');
  const [roles, setRoles] = useState<Role[]>([]);
  // Pre-selects the role named in ?roleId=... (e.g. arriving here via
  // RolesPanel's "Configure in Control Panel" nudge right after creating a
  // role) — loadRoles()'s own `prev || ...` fallback below only picks a
  // default when this is still empty, so a query-param value always wins.
  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    () => new URLSearchParams(locationSearch || '').get('roleId') || ''
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sidebarPermissions, setSidebarPermissions] = useState<SidebarPermissionMap>({});
  const [crudPermissions, setCrudPermissions] = useState<CrudPermissionMap>({});
  const [widgetPermissions, setWidgetPermissions] = useState<WidgetPermissionMap>({});

  const isExcludedRole = (role: Role) => String(role.name || '').trim().toLowerCase() === 'admin';

  const sidebarMenuItems: MenuItem[] = useMemo(
    () => Object.entries(LANDING_CONFIG).map(([key, cfg]) => ({ key, label: cfg.title })),
    []
  );

  // Every CRUD-capable menu, regardless of current Sidebar visibility — this
  // stays the full set so saveCrudPermissions() (below) never drops a
  // hidden menu's already-configured Add/Edit/Delete permissions just
  // because it isn't rendered this session. Re-checking a Sidebar box later
  // brings its previously-saved CRUD row right back.
  const crudMenuItems: MenuItem[] = useMemo(
    () =>
      Object.entries(LANDING_CONFIG)
        .filter(([, cfg]) => Boolean((cfg as any)?.isCrud))
        .map(([key, cfg]) => ({ key, label: (cfg as any).title })),
    []
  );

  // What actually RENDERS as a togglable row — scoped to menus the selected
  // role can even SEE in their sidebar. A CRUD toggle for a menu they don't
  // have Sidebar access to would be dead configuration (they can never
  // reach that screen to use it) and reads as the two tabs disagreeing
  // about what this role can do. Reactive to sidebarPermissions, not just
  // the saved value, so unchecking a Sidebar box drops the row immediately.
  const visibleCrudMenuItems: MenuItem[] = useMemo(
    () => crudMenuItems.filter((item) => Boolean(sidebarPermissions[item.key])),
    [crudMenuItems, sidebarPermissions]
  );

  const selectedRole = useMemo(
    () => roles.find((r) => String(r.id) === selectedRoleId) || null,
    [roles, selectedRoleId]
  );
  const isLocatorRoleSelected = String(selectedRole?.name || '').trim().toUpperCase() === 'PROPONENT';

  // The Locator role's own menu items ride along in the same "Sidebar Menu
  // Permissions" card/columns as everything else — a separate box just for
  // one role read as a stray, disconnected section. Split into 3 evenly-sized
  // columns (instead of a fixed 10/rest split) so a short remainder column
  // doesn't end up mostly empty next to a full one.
  const sidebarMenuColumns = useMemo(() => {
    const items = isLocatorRoleSelected ? [...sidebarMenuItems, ...PROPONENT_MENU_ITEMS] : sidebarMenuItems;
    const perColumn = Math.ceil(items.length / 3) || 1;
    return [
      { offset: 0, items: items.slice(0, perColumn) },
      { offset: perColumn, items: items.slice(perColumn, perColumn * 2) },
      { offset: perColumn * 2, items: items.slice(perColumn * 2) },
    ];
  }, [sidebarMenuItems, isLocatorRoleSelected]);

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

  async function loadWidgetPermissions(roleId: string) {
    const res = await fetch(api(`/api/control-panel/dashboard-widgets/${roleId}`), { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || 'Failed to load dashboard widget permissions');
    const next: WidgetPermissionMap = {};
    (json?.data || []).forEach((row: any) => {
      next[String(row.widget_key)] = Number(row.is_enabled) === 1 || row.is_enabled === true;
    });
    setWidgetPermissions(next);
  }

  useEffect(() => {
    if (!selectedRoleId) return;
    const run = async () => {
      try {
        await Promise.all([
          loadSidebarPermissions(selectedRoleId),
          loadCrudPermissions(selectedRoleId),
          loadWidgetPermissions(selectedRoleId),
        ]);
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
      const payload = [
        ...sidebarMenuItems.map((item) => ({
          menu_key: item.key,
          is_enabled: Boolean(sidebarPermissions[item.key]),
        })),
        // Only part of this role's saved set when it's the Locator role being
        // edited — otherwise saving another role's sidebar would silently
        // wipe the Locator portal menu rows (this save replaces the full set
        // for the role, not just the keys shown on screen).
        ...(isLocatorRoleSelected
          ? PROPONENT_MENU_ITEMS.map((item) => ({
              menu_key: item.key,
              is_enabled: sidebarPermissions[item.key] ?? true,
            }))
          : []),
      ];
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

  async function saveWidgetPermissions() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const payload = DASHBOARD_WIDGETS.map((item) => ({
        widget_key: item.key,
        // Missing key defaults to visible (fail-open) — write that default
        // back explicitly so "no row yet" and "explicitly turned on" agree.
        is_enabled: widgetPermissions[item.key] ?? true,
      }));
      const res = await fetch(api(`/api/control-panel/dashboard-widgets/${selectedRoleId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ permissions: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save dashboard widget permissions');
      toast.success('Dashboard widget permissions saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save dashboard widget permissions');
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
          {(
            [
              ['sidebar', 'Sidebar', 'Menu Permissions', 'Sidebar'],
              ['crud', 'CRUD', 'Permissions', 'CRUD'],
              ['widgets', 'Dashboard', 'Widgets', 'Widgets'],
            ] as const
          ).map(([key, caption, title, shortTitle]) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              className="flex-1 min-w-0 rounded-lg px-2 sm:px-3 py-2 flex flex-col gap-0.5 text-center sm:text-left transition-colors cursor-pointer"
              style={
                activeTab === key
                  ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                  : { backgroundColor: 'transparent', color: 'var(--text)' }
              }
              onClick={() => setActiveTab(key)}
            >
              <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-widest opacity-80">{caption}</span>
              {/* Phones: one short word per tab so all three fit without wrapping. */}
              <span className="sm:hidden text-[12px] font-bold leading-tight tracking-tight">{shortTitle}</span>
              <span className="hidden sm:block text-sm font-bold leading-tight tracking-tight">{title}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        {loading && !roles.length ? (
          <div className="py-2">
            <Skeleton className="h-[200px] w-full rounded-xl" />
          </div>
        ) : !selectedRoleId ? (
          <EmptyState
            title="No roles found"
            description="There are no roles available to manage permissions for."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 sm:gap-4">
            {/* Phones/tablets: a role dropdown instead of the tall role list,
                so the permission switches are visible without scrolling. */}
            <div className="lg:hidden space-y-1">
              <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">Role</div>
              <AppSelect
                value={selectedRoleId}
                onChange={(v) => v && setSelectedRoleId(v)}
                options={roles.map((role) => ({ value: String(role.id), label: roleDisplayName(role.name) }))}
                isClearable={false}
              />
              {selectedRole?.description ? (
                <div className="text-[10px] text-secondary">{selectedRole.description}</div>
              ) : null}
            </div>

            <div
              className="hidden lg:block rounded-xl border p-3 h-fit"
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
                      className="w-full rounded-lg px-2.5 py-2 text-left text-[11px] cursor-pointer"
                      style={
                        isActive
                          ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                          : { backgroundColor: 'transparent', color: 'var(--text)' }
                      }
                    >
                      <div className="font-semibold leading-tight">{roleDisplayName(role.name)}</div>
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

            <div className="min-w-0 sm:rounded-xl sm:border sm:p-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">
                    {activeTab === 'sidebar'
                      ? 'Sidebar Menu Permissions'
                      : activeTab === 'crud'
                        ? 'Menu CRUD Permissions'
                        : 'Dashboard Widget Visibility'}
                  </div>
                  <div className="text-[12px] text-secondary">
                    {activeTab === 'sidebar'
                      ? `Showing sidebar menus for ${selectedRole ? roleDisplayName(selectedRole.name) : 'selected role'}`
                      : activeTab === 'crud'
                        ? `Configure CRUD modules for ${selectedRole ? roleDisplayName(selectedRole.name) : 'selected role'}`
                        : `Choose which dashboard cards ${selectedRole ? roleDisplayName(selectedRole.name) : 'this role'} sees`}
                  </div>
                </div>
                <button
                  type="button"
                  className="group relative inline-flex shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-3 py-1.5 text-[11px] font-semibold tracking-wide shadow-sm transition-[transform,box-shadow,filter,opacity] duration-200 ease-out hover:brightness-110 hover:shadow-md active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
                  style={{
                    backgroundColor: 'var(--nav-active-bg)',
                    color: 'var(--nav-active-text)',
                    boxShadow:
                      '0 1px 2px rgba(0,0,0,0.12), 0 4px 14px color-mix(in srgb, var(--nav-active-bg) 45%, transparent)',
                  }}
                  onClick={
                    activeTab === 'sidebar'
                      ? saveSidebarPermissions
                      : activeTab === 'crud'
                        ? saveCrudPermissions
                        : saveWidgetPermissions
                  }
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
                    <Loader2 className="relative h-3.5 w-3.5 shrink-0 animate-spin opacity-95" aria-hidden />
                  ) : (
                    <Save className="relative h-3.5 w-3.5 shrink-0 opacity-95 transition-transform duration-200 group-hover:scale-105" aria-hidden />
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
                    <div
                      className="space-y-2 rounded-xl border p-2"
                      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                    >
                      <div
                        className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2 border rounded-lg text-[10px] font-semibold uppercase tracking-widest text-secondary"
                        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
                      >
                        <span className="min-w-0">Menu Item</span>
                        <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                          Visible
                        </span>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        {sidebarMenuColumns
                          .filter((c) => c.items.length > 0)
                          .map((column) => (
                          <div key={`sidebar-column-${column.offset}`} className="space-y-2">
                            {column.items.map((item) => {
                              const enabled = PROPONENT_MENU_KEYS.has(item.key)
                                ? sidebarPermissions[item.key] ?? true
                                : Boolean(sidebarPermissions[item.key]);
                              return (
                              <div
                                key={item.key}
                                className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2.5 border rounded-lg transition-colors"
                                style={{
                                  borderColor: 'var(--border-subtle)',
                                  backgroundColor: enabled ? 'var(--surface)' : 'transparent',
                                }}
                              >
                                <span className="min-w-0 text-[11px]" style={{ color: 'var(--text)' }}>
                                  {item.label}
                                </span>
                                <div className="flex min-h-[1.75rem] items-center justify-center">
                                  <PermissionToggle
                                    aria-label={`${item.label} sidebar visible`}
                                    checked={enabled}
                                    onChange={(next) =>
                                      setSidebarPermissions((prev) => ({
                                        ...prev,
                                        [item.key]: next,
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : activeTab === 'crud' ? (
                  <motion.div
                    key={`crud-${selectedRoleId}`}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="space-y-2"
                  >
                    <div
                      className={`hidden sm:grid ${CRUD_TOGGLE_COLS_CLASS} gap-y-1 px-3 py-2 border rounded-lg text-[10px] font-semibold uppercase tracking-widest text-secondary`}
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
                    {visibleCrudMenuItems.length === 0 ? (
                      <p className="text-[11px] text-secondary px-3 py-4 text-center">
                        No CRUD-capable modules are enabled for this role in Sidebar Menu Permissions yet.
                      </p>
                    ) : null}
                    {visibleCrudMenuItems.map((item) => {
                      const row = crudPermissions[item.key] || {
                        can_add: false,
                        can_edit: false,
                        can_delete: false,
                      };
                      return (
                        <div
                          key={item.key}
                          className={`group block sm:grid ${CRUD_TOGGLE_COLS_CLASS} gap-y-1 px-3 py-2.5 border rounded-lg transition-colors`}
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          <span className="min-w-0 text-[11px] font-medium" style={{ color: 'var(--text)' }}>
                            {item.label}
                          </span>
                          {/* Phones: switches sit under the name with their own labels; from sm the wrapper dissolves into the grid columns. */}
                          <div className="mt-2 grid grid-cols-3 gap-2 sm:contents">
                          <div className="flex flex-col sm:flex-row min-h-[1.75rem] items-center justify-center gap-1">
                            <span className="sm:hidden text-[9px] font-semibold uppercase tracking-wider text-secondary">Add</span>
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
                          <div className="flex flex-col sm:flex-row min-h-[1.75rem] items-center justify-center gap-1">
                            <span className="sm:hidden text-[9px] font-semibold uppercase tracking-wider text-secondary">Edit</span>
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
                          <div className="flex flex-col sm:flex-row min-h-[1.75rem] items-center justify-center gap-1">
                            <span className="sm:hidden text-[9px] font-semibold uppercase tracking-wider text-secondary">Delete</span>
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
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-secondary pt-2 border-t mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      Turning off a switch hides the matching Add, Edit, or Delete controls for this role in that module.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key={`widgets-${selectedRoleId}`}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="space-y-2"
                  >
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2 border rounded-lg text-[10px] font-semibold uppercase tracking-widest text-secondary"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <span className="min-w-0">Dashboard Card</span>
                      <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">Visible</span>
                    </div>
                    {DASHBOARD_WIDGETS.map((item) => (
                      <div
                        key={item.key}
                        className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2.5 border rounded-lg transition-colors"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <span className="min-w-0 text-[11px]" style={{ color: 'var(--text)' }}>
                          {item.label}
                        </span>
                        <div className="flex min-h-[1.75rem] items-center justify-center">
                          <PermissionToggle
                            aria-label={`${item.label} visible`}
                            checked={widgetPermissions[item.key] ?? true}
                            onChange={(next) =>
                              setWidgetPermissions((prev) => ({ ...prev, [item.key]: next }))
                            }
                          />
                        </div>
                      </div>
                    ))}
                    <p className="text-[11px] text-secondary pt-2 border-t mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      New cards default to visible until turned off here — this never affects the Administrator role.
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
