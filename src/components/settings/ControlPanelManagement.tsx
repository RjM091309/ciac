import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, Loader2, Plus, Save } from 'lucide-react';
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

type CrudFlag = 'can_add' | 'can_edit' | 'can_delete';
const CRUD_FLAGS: readonly (readonly [CrudFlag, string, 'add' | 'edit' | 'delete'])[] = [
  ['can_add', 'Add', 'add'],
  ['can_edit', 'Edit', 'edit'],
  ['can_delete', 'Delete', 'delete'],
];

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


/** Connector-line color — derived from the muted text color since --border is
 * nearly the same shade as --surface in dark mode and would vanish. */
const TREE_LINE = 'color-mix(in oklab, var(--text-muted) 40%, transparent)';

/** Dark rounded node like a flow/graph view: status dot, bold title, muted
 * subtitle, optional trailing control and body. */
function TreeNodeCard({
  title,
  subtitle,
  active,
  trailing,
  children,
  emphasis,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  active?: boolean;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className="rounded-lg border transition-colors"
      style={{
        borderColor: active ? 'color-mix(in oklab, var(--text-muted) 45%, transparent)' : 'var(--border-subtle)',
        backgroundColor: emphasis || active ? 'var(--control-bg)' : 'var(--surface)',
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="h-2 w-2 shrink-0 rounded-full transition-colors"
              style={{ backgroundColor: active ? '#22c55e' : 'color-mix(in oklab, var(--text-muted) 70%, transparent)' }}
            />
            <span
              className={`truncate font-semibold ${emphasis ? 'text-[13px]' : 'text-[12px]'}`}
              style={{ color: 'var(--text)' }}
            >
              {title}
            </span>
          </div>
          {subtitle ? <div className="mt-0.5 pl-4 text-[11px] leading-snug text-secondary">{subtitle}</div> : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Parent node on the left branching into its children on the right (stacks
 * vertically on narrow screens, with the spine running down the left). */
function NodeTree({
  root,
  items,
  nested,
}: {
  root: React.ReactNode;
  items: { key: string; node: React.ReactNode }[];
  /** Second-level branch: root pinned to the top (so a tall root card still
   * lines up with its first child) and a narrower root column. */
  nested?: boolean;
}) {
  return (
    <div className={`flex flex-col lg:flex-row ${nested ? 'lg:items-start' : 'lg:items-center lg:justify-center'}`}>
      <div className={`w-full shrink-0 ${nested ? 'lg:w-[250px]' : 'lg:w-[260px]'}`}>{root}</div>
      {items.length > 0 ? (
        <>
          <div
            aria-hidden
            className={`ml-5 h-3 w-px lg:ml-0 lg:h-px lg:w-6 shrink-0 ${nested ? 'lg:mt-7' : ''}`}
            style={{ backgroundColor: TREE_LINE }}
          />
          <ul className="ml-5 lg:ml-0 min-w-0 flex-1 lg:max-w-3xl">
            {items.map((item, idx) => {
              const first = idx === 0;
              const last = idx === items.length - 1;
              return (
                <li key={item.key} className="relative pl-6 py-1">
                  <span
                    aria-hidden
                    className={`absolute left-0 w-px ${
                      first && last
                        ? 'top-0 h-7 lg:hidden'
                        : first
                          ? 'top-0 bottom-0 lg:top-7'
                          : last
                            ? 'top-0 h-7'
                            : 'top-0 bottom-0'
                    }`}
                    style={{ backgroundColor: TREE_LINE }}
                  />
                  <span aria-hidden className="absolute left-0 top-7 h-px w-6" style={{ backgroundColor: TREE_LINE }} />
                  {item.node}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function ControlPanelManagement({ locationSearch }: { locationSearch?: string } = {}) {
  const [activeTab, setActiveTab] = useState<'sidebar' | 'widgets'>('sidebar');
  // Unlinked (turned-off) items stay collapsed so the tree only shows what's linked.
  const [showUnlinked, setShowUnlinked] = useState(false);
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

  // The Locator role's own menu items ride along as extra branches of the
  // same tree as everything else — a separate box just for one role read as a
  // stray, disconnected section.
  const sidebarTreeItems = useMemo(
    () => (isLocatorRoleSelected ? [...sidebarMenuItems, ...PROPONENT_MENU_ITEMS] : sidebarMenuItems),
    [sidebarMenuItems, isLocatorRoleSelected]
  );

  const rootSummary = useMemo(() => {
    if (activeTab === 'sidebar') {
      const on = sidebarTreeItems.filter((item) =>
        PROPONENT_MENU_KEYS.has(item.key) ? sidebarPermissions[item.key] ?? true : Boolean(sidebarPermissions[item.key])
      ).length;
      const editable = visibleCrudMenuItems.filter((item) => {
        const r = crudPermissions[item.key];
        return r && (r.can_add || r.can_edit || r.can_delete);
      }).length;
      return `${on} of ${sidebarTreeItems.length} menus visible · ${editable} with edit access`;
    }
    const on = DASHBOARD_WIDGETS.filter((item) => widgetPermissions[item.key] ?? true).length;
    return `${on} of ${DASHBOARD_WIDGETS.length} cards visible`;
  }, [activeTab, sidebarTreeItems, sidebarPermissions, visibleCrudMenuItems, crudPermissions, widgetPermissions]);

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

  async function putSidebarPermissions() {
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
  }

  async function putCrudPermissions() {
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
  }

  /** Menu visibility and its Add/Edit/Delete access live in one tree, so
   * they save together. */
  async function saveMenuAccess() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      await Promise.all([putSidebarPermissions(), putCrudPermissions()]);
      toast.success('Menu access saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save menu access');
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
              ['sidebar', 'Sidebar', 'Menus & Access', 'Menus'],
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
              {/* Phones: one short word per tab so they fit without wrapping. */}
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
          <div className="min-w-0">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-4">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">
                  {activeTab === 'sidebar' ? 'Menus & Access' : 'Dashboard Widget Visibility'}
                </div>
                <div className="text-[12px] text-secondary">
                  {activeTab === 'sidebar'
                    ? `Sidebar menus and Add / Edit / Delete access for ${selectedRole ? roleDisplayName(selectedRole.name) : 'selected role'}`
                    : `Choose which dashboard cards ${selectedRole ? roleDisplayName(selectedRole.name) : 'this role'} sees`}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="space-y-1 sm:w-[240px]">
                  <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">Role</div>
                  <AppSelect
                    value={selectedRoleId}
                    onChange={(v) => v && setSelectedRoleId(v)}
                    options={roles.map((role) => ({ value: String(role.id), label: roleDisplayName(role.name) }))}
                    isClearable={false}
                  />
                </div>
                <button
                  type="button"
                  className="group relative inline-flex shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-3 py-2 text-[11px] font-semibold tracking-wide shadow-sm transition-[transform,box-shadow,filter,opacity] duration-200 ease-out hover:brightness-110 hover:shadow-md active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
                  style={{
                    backgroundColor: 'var(--nav-active-bg)',
                    color: 'var(--nav-active-text)',
                    boxShadow:
                      '0 1px 2px rgba(0,0,0,0.12), 0 4px 14px color-mix(in srgb, var(--nav-active-bg) 45%, transparent)',
                  }}
                  onClick={activeTab === 'sidebar' ? saveMenuAccess : saveWidgetPermissions}
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
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${activeTab}-${selectedRoleId}`}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="space-y-3"
              >
                {(() => {
                  const allItems: { key: string; linked: boolean; node: React.ReactNode }[] =
                    activeTab === 'sidebar'
                      ? sidebarTreeItems.map((item) => {
                          const enabled = PROPONENT_MENU_KEYS.has(item.key)
                            ? sidebarPermissions[item.key] ?? true
                            : Boolean(sidebarPermissions[item.key]);
                          const menuCard = (
                            <TreeNodeCard
                              active={enabled}
                              title={item.label}
                              subtitle={enabled ? 'Visible in sidebar' : 'Hidden'}
                              trailing={
                                <PermissionToggle
                                  aria-label={`${item.label} sidebar visible`}
                                  checked={enabled}
                                  onChange={(next) =>
                                    setSidebarPermissions((prev) => ({ ...prev, [item.key]: next }))
                                  }
                                />
                              }
                            />
                          );
                          const isCrud = enabled && Boolean((LANDING_CONFIG as any)[item.key]?.isCrud);
                          if (!isCrud) return { key: item.key, linked: enabled, node: menuCard };

                          // CRUD access branches off its menu: only granted actions are
                          // linked into the tree; the rest sit as "+" chips on the card.
                          const row = crudPermissions[item.key] || { can_add: false, can_edit: false, can_delete: false };
                          const hints = (LANDING_CONFIG as any)[item.key]?.crudHints as
                            | { add?: string; edit?: string; delete?: string }
                            | undefined;
                          const setFlag = (flag: CrudFlag, next: boolean) =>
                            setCrudPermissions((prev) => ({
                              ...prev,
                              [item.key]: {
                                can_add: prev[item.key]?.can_add || false,
                                can_edit: prev[item.key]?.can_edit || false,
                                can_delete: prev[item.key]?.can_delete || false,
                                [flag]: next,
                              },
                            }));
                          const granted = CRUD_FLAGS.filter(([flag]) => row[flag]);
                          const missing = CRUD_FLAGS.filter(([flag]) => !row[flag]);
                          return {
                            key: item.key,
                            linked: true,
                            node: (
                              <div>
                                <NodeTree
                                  nested
                                  root={
                                    <TreeNodeCard
                                      active
                                      title={item.label}
                                      subtitle={granted.length ? 'Visible in sidebar' : 'Visible · view only'}
                                      trailing={
                                        <PermissionToggle
                                          aria-label={`${item.label} sidebar visible`}
                                          checked
                                          onChange={(next) =>
                                            setSidebarPermissions((prev) => ({ ...prev, [item.key]: next }))
                                          }
                                        />
                                      }
                                    >
                                      {missing.length > 0 ? (
                                        <div
                                          className="flex flex-wrap gap-1.5 border-t px-3 py-2"
                                          style={{ borderColor: 'var(--border-subtle)' }}
                                        >
                                          {missing.map(([flag, label]) => (
                                            <button
                                              key={flag}
                                              type="button"
                                              onClick={() => setFlag(flag, true)}
                                              className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[10px] font-semibold text-secondary cursor-pointer hover:opacity-80"
                                              style={{ borderColor: 'var(--border-subtle)' }}
                                              aria-label={`Grant ${label} on ${item.label}`}
                                            >
                                              <Plus size={10} /> {label}
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}
                                    </TreeNodeCard>
                                  }
                                  items={[
                                    ...granted.map(([flag, label, hintKey]) => ({
                                      key: flag,
                                      node: (
                                        <TreeNodeCard
                                          active
                                          title={label}
                                          subtitle={hints?.[hintKey] || `Can ${label.toLowerCase()} records`}
                                          trailing={
                                            <PermissionToggle
                                              aria-label={`${item.label} ${label.toLowerCase()} permission`}
                                              checked
                                              onChange={(next) => setFlag(flag, next)}
                                            />
                                          }
                                        />
                                      ),
                                    })),
                                  ]}
                                />
                              </div>
                            ),
                          };
                        })
                        : DASHBOARD_WIDGETS.map((item) => {
                            const enabled = widgetPermissions[item.key] ?? true;
                            return {
                              key: item.key,
                              linked: enabled,
                              node: (
                                <TreeNodeCard
                                  active={enabled}
                                  title={item.label}
                                  subtitle={enabled ? 'Shown on dashboard' : 'Hidden'}
                                  trailing={
                                    <PermissionToggle
                                      aria-label={`${item.label} visible`}
                                      checked={enabled}
                                      onChange={(next) => setWidgetPermissions((prev) => ({ ...prev, [item.key]: next }))}
                                    />
                                  }
                                />
                              ),
                            };
                          });
                  const linkedItems = allItems.filter((i) => i.linked);
                  const unlinkedItems = allItems.filter((i) => !i.linked);
                  return (
                    <>
                      <NodeTree
                        root={
                          <TreeNodeCard
                            emphasis
                            active
                            title={selectedRole ? roleDisplayName(selectedRole.name) : 'Role'}
                            subtitle={
                              <>
                                {rootSummary}
                                {selectedRole?.description ? <> · {selectedRole.description}</> : null}
                              </>
                            }
                          />
                        }
                        items={linkedItems}
                      />
                      {unlinkedItems.length > 0 ? (
                        <div className="pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                          <button
                            type="button"
                            aria-expanded={showUnlinked}
                            onClick={() => setShowUnlinked((v) => !v)}
                            className="flex items-center gap-1.5 text-[10px] font-semibold text-secondary uppercase tracking-widest cursor-pointer hover:opacity-80"
                          >
                            <ChevronRight
                              size={13}
                              className="transition-transform duration-200"
                              style={{ transform: showUnlinked ? 'rotate(90deg)' : 'none' }}
                            />
                            {showUnlinked ? 'Hide' : 'Show'} not linked ({unlinkedItems.length})
                          </button>
                          <AnimatePresence initial={false}>
                            {showUnlinked ? (
                              <motion.div
                                key="unlinked"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="overflow-hidden"
                              >
                                <p className="mt-1 mb-2 text-[11px] text-secondary">Turn one on to add it to the tree.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 pb-1">
                                  {unlinkedItems.map((i) => (
                                    <div key={i.key}>{i.node}</div>
                                  ))}
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
                <p className="text-[11px] text-secondary pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  {activeTab === 'sidebar'
                    ? 'Add, Edit, and Delete branch off each module the role can see — unlinking one hides that control for this role in that module.'
                    : 'New cards default to visible until turned off here — this never affects the Administrator role.'}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
