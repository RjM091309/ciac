import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, ChevronRight, Info, Loader2, Plus, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { AppSelect } from '../ui/AppSelect';
import { ConfirmModal } from '../ui/ConfirmModal';
import { LANDING_CONFIG } from '../../config/landingConfig';
import { roleDisplayName } from '../../lib/roleDisplay';
import { balancedRowStyle } from '../../lib/balancedColumns';
import { cn } from '../../lib/utils';

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

/** One staff-dashboard widget, as GET /api/control-panel/dashboard-widget-catalog
 * describes it (server/lib/dashboardWidgets.js is the source of truth). */
type CatalogWidget = {
  key: string;
  label: string;
  group: WidgetGroup | null;
  parent: string | null;
  requiresAnyMenu: string[];
};
type WidgetGroup = 'summary' | 'work' | 'insights' | 'tools';

function api(path: string) {
  return path;
}

// Neither is managed here: admin bypasses every Control Panel check, and the
// Locator ('proponent') role is external users whose portal is its own,
// separate surface — the server refuses to grant it any staff menu at all
// (server/models/ControlPanelPermission.js), so offering those toggles here
// would only be misleading.
const EXCLUDED_ROLES = new Set(['admin', 'proponent']);

const WIDGET_GROUPS: { key: WidgetGroup; label: string; hint: string }[] = [
  { key: 'summary', label: 'Summary', hint: 'Counts across the top of the dashboard' },
  { key: 'work', label: 'Work lists', hint: 'Rows this role acts on or reviews' },
  { key: 'insights', label: 'Insights', hint: 'Charts and performance, scoped to what this role sees' },
  { key: 'tools', label: 'Tools', hint: 'Personal utilities' },
];

type QueueKind = 'approval' | 'assessment' | 'overview';

/** What each widget shows for a role — the data behind it changes with the
 * queue the role works (same rule as server/controller/c_dashboard.js). */
function widgetDescription(key: string, queue: QueueKind): string {
  switch (key) {
    case 'dashboard:stats':
      return queue === 'approval'
        ? "Counts for each officer's own approval queue"
        : queue === 'assessment'
          ? 'Counts for Level 2 assignments, or new applications for Level 1'
          : 'Counts across every application';
    case 'dashboard:attention':
      return queue === 'approval'
        ? 'Approvals waiting on the officer, plus permits and contracts nearing expiry'
        : 'Level 2: open assignments · Level 1: reviews to recommend and applications to assign';
    case 'dashboard:table':
      return queue === 'approval'
        ? "Applications in the officer's own approval queue"
        : queue === 'assessment'
          ? 'Level 2: own assignments · Level 1: new applications'
          : 'Every application, read-only';
    case 'dashboard:status-chart':
      return 'Status split of the applications this role sees';
    case 'dashboard:pipeline':
      return 'Applications filed over time, by day up to year';
    case 'dashboard:performance':
      return 'Average turnaround, open items, and the oldest open one';
    case 'dashboard:requirements':
      return 'Requirement completion by category';
    case 'dashboard:quick-tasks':
      return "Each user's own to-do list — nobody else sees it";
    default:
      return '';
  }
}

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
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
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
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative box-border flex h-7 w-[3.25rem] shrink-0 items-center overflow-hidden rounded-full px-0.5 py-0 transition-[background-color,box-shadow,opacity] duration-200 ease-out cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nav-active-bg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
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
      className="rounded-lg border transition-colors h-full"
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
            <span className={`truncate font-semibold ${emphasis ? 'text-[13px]' : 'text-[12px]'}`} style={{ color: 'var(--text)' }}>
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

/** Inline notice under the header (info or warning). */
function Notice({ tone, children }: { tone: 'info' | 'warning'; children: React.ReactNode }) {
  const Icon = tone === 'warning' ? AlertTriangle : Info;
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'note'}
      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug"
      style={{
        borderColor: tone === 'warning' ? 'rgba(245,158,11,.35)' : 'var(--border-subtle)',
        backgroundColor: tone === 'warning' ? 'rgba(245,158,11,.08)' : 'var(--control-bg)',
        color: 'var(--text)',
      }}
    >
      <Icon size={13} className="mt-px shrink-0" style={{ color: tone === 'warning' ? '#f59e0b' : 'var(--text-muted)' }} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const menuTitle = (key: string) => (LANDING_CONFIG as any)[key]?.title || key;
/** "A", "A or B", "A, B, or C". */
const orList = (items: string[]) =>
  items.length <= 2 ? items.join(' or ') : `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;

export function ControlPanelManagement({ locationSearch }: { locationSearch?: string } = {}) {
  const [activeTab, setActiveTab] = useState<'sidebar' | 'widgets'>('sidebar');
  // Unlinked (turned-off) menus stay collapsed so the tree only shows what's linked.
  const [showUnlinked, setShowUnlinked] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  // Pre-selects the role named in ?roleId=... (e.g. arriving here via
  // RolesPanel's "Configure in Control Panel" nudge right after creating a
  // role). loadRoles() falls back to the first role if it isn't manageable.
  const [selectedRoleId, setSelectedRoleId] = useState<string>(() => new URLSearchParams(locationSearch || '').get('roleId') || '');
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  // Set when a role's permissions couldn't be loaded — Save stays off so the
  // page can never write stale or empty permissions onto that role.
  const [roleLoadFailed, setRoleLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // The role a finishing save belongs to, so a late response for a role the
  // admin has since switched away from is ignored.
  const currentRoleRef = useRef(selectedRoleId);
  currentRoleRef.current = selectedRoleId;
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<CatalogWidget[]>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);

  // Current (edited) state and the last saved state; the difference is what
  // "Unsaved changes" / Discard / the role-switch guard work from.
  const [sidebarPermissions, setSidebarPermissions] = useState<SidebarPermissionMap>({});
  const [crudPermissions, setCrudPermissions] = useState<CrudPermissionMap>({});
  const [widgetPermissions, setWidgetPermissions] = useState<WidgetPermissionMap>({});
  const [saved, setSaved] = useState<{ sidebar: SidebarPermissionMap; crud: CrudPermissionMap; widgets: WidgetPermissionMap }>({
    sidebar: {},
    crud: {},
    widgets: {},
  });
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);

  // Admin-only pages (Portal Settings) can't be granted to a role, so they
  // aren't offered here at all.
  const sidebarMenuItems: MenuItem[] = useMemo(
    () =>
      Object.entries(LANDING_CONFIG)
        .filter(([, cfg]) => !cfg.adminOnly)
        .map(([key, cfg]) => ({ key, label: cfg.title })),
    []
  );

  // Every CRUD-capable menu, regardless of current Sidebar visibility — this
  // stays the full set so a save never drops a hidden menu's
  // already-configured Add/Edit/Delete permissions just because it isn't
  // rendered this session. Re-checking a Sidebar box later brings its
  // previously-saved CRUD row right back.
  const crudMenuItems: MenuItem[] = useMemo(
    () =>
      Object.entries(LANDING_CONFIG)
        .filter(([, cfg]) => Boolean((cfg as any)?.isCrud))
        .map(([key, cfg]) => ({ key, label: (cfg as any).title })),
    []
  );

  // Scoped to menus the selected role can see: a CRUD toggle for a menu
  // they can't reach would be dead configuration.
  const visibleCrudMenuItems: MenuItem[] = useMemo(
    () => crudMenuItems.filter((item) => Boolean(sidebarPermissions[item.key])),
    [crudMenuItems, sidebarPermissions]
  );

  const selectedRole = useMemo(() => roles.find((r) => String(r.id) === selectedRoleId) || null, [roles, selectedRoleId]);
  const roleName = selectedRole ? roleDisplayName(selectedRole.name) : 'this role';

  /* ------------------------------ payloads ------------------------------- */

  const sidebarPayload = (map: SidebarPermissionMap) =>
    sidebarMenuItems.map((item) => ({ menu_key: item.key, is_enabled: Boolean(map[item.key]) }));
  const crudPayload = (map: CrudPermissionMap) =>
    crudMenuItems.map((item) => ({
      menu_key: item.key,
      can_add: Boolean(map[item.key]?.can_add),
      can_edit: Boolean(map[item.key]?.can_edit),
      can_delete: Boolean(map[item.key]?.can_delete),
    }));
  // Missing key = visible (fail-open) — written back explicitly so "no row
  // yet" and "explicitly on" agree. Ineligible widgets keep their saved
  // preference for if the role later gains the menus they need.
  const widgetPayload = (map: WidgetPermissionMap) =>
    catalog.map((w) => ({ widget_key: w.key, is_enabled: map[w.key] ?? true }));

  const menusDirty =
    JSON.stringify(sidebarPayload(sidebarPermissions)) !== JSON.stringify(sidebarPayload(saved.sidebar)) ||
    JSON.stringify(crudPayload(crudPermissions)) !== JSON.stringify(crudPayload(saved.crud));
  const widgetsDirty = JSON.stringify(widgetPayload(widgetPermissions)) !== JSON.stringify(widgetPayload(saved.widgets));
  const dirty = menusDirty || widgetsDirty;

  // Closing/reloading the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /* ------------------------------- loading ------------------------------- */

  async function loadRoles() {
    setLoading(true);
    try {
      const res = await fetch(api('/api/roles'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load roles');
      const allowedRoles = ((json.data || []) as Role[]).filter(
        (r) => !EXCLUDED_ROLES.has(String(r.name || '').trim().toLowerCase())
      );
      setRoles(allowedRoles);
      setSelectedRoleId((prev) =>
        allowedRoles.some((r) => String(r.id) === prev) ? prev : allowedRoles[0] ? String(allowedRoles[0].id) : ''
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  async function loadCatalog() {
    setCatalogFailed(false);
    try {
      const res = await fetch(api('/api/control-panel/dashboard-widget-catalog'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load dashboard widgets');
      setCatalog(Array.isArray(json?.data) ? json.data : []);
    } catch (e: any) {
      setCatalogFailed(true);
      toast.error(e?.message || 'Failed to load dashboard widgets');
    }
  }

  useEffect(() => {
    loadRoles();
    loadCatalog();
  }, []);

  async function fetchRows(path: string, what: string) {
    const res = await fetch(api(path), { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Failed to load ${what}`);
    return (json?.data || []) as any[];
  }

  const isOn = (v: any) => Number(v) === 1 || v === true;

  useEffect(() => {
    if (!selectedRoleId) return;
    let cancelled = false;
    setRoleLoading(true);
    setRoleLoadFailed(false);
    Promise.all([
      fetchRows(`/api/control-panel/sidebar-menu/${selectedRoleId}`, 'sidebar permissions'),
      fetchRows(`/api/control-panel/menu-crud/${selectedRoleId}`, 'CRUD permissions'),
      fetchRows(`/api/control-panel/dashboard-widgets/${selectedRoleId}`, 'dashboard widget permissions'),
    ])
      .then(([sRows, cRows, wRows]) => {
        if (cancelled) return;
        const sidebar: SidebarPermissionMap = {};
        sRows.forEach((row) => (sidebar[String(row.menu_key)] = isOn(row.is_enabled)));
        const crud: CrudPermissionMap = {};
        cRows.forEach((row) => {
          crud[String(row.menu_key)] = { can_add: isOn(row.can_add), can_edit: isOn(row.can_edit), can_delete: isOn(row.can_delete) };
        });
        const widgets: WidgetPermissionMap = {};
        wRows.forEach((row) => (widgets[String(row.widget_key)] = isOn(row.is_enabled)));
        setSidebarPermissions(sidebar);
        setCrudPermissions(crud);
        setWidgetPermissions(widgets);
        setSaved({ sidebar, crud, widgets });
      })
      .catch((e: any) => {
        if (cancelled) return;
        // Never leave the previous role's toggles on screen under this role.
        setSidebarPermissions({});
        setCrudPermissions({});
        setWidgetPermissions({});
        setSaved({ sidebar: {}, crud: {}, widgets: {} });
        setRoleLoadFailed(true);
        toast.error(e?.message || 'Failed to load control panel data');
      })
      .finally(() => {
        if (!cancelled) setRoleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoleId, reloadKey]);

  /* -------------------------------- saving ------------------------------- */

  async function put(path: string, permissions: unknown[], what: string) {
    const res = await fetch(api(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ permissions }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Failed to save ${what}`);
  }

  /** One Save for both tabs: menu visibility, Add/Edit/Delete, and widgets.
   * Only the parts that actually changed are sent: each PUT replaces that
   * whole set for the role, so an unchanged part is never rewritten, and
   * widgets are never written without the catalog to build them from.
   * Each part that succeeds becomes the new saved baseline even if another
   * fails, so a retry only resends what's still unsaved. */
  async function saveAll() {
    if (!selectedRoleId || !dirty || roleLoadFailed) return;
    const roleId = selectedRoleId;
    setSaving(true);
    const snapshot = { sidebar: sidebarPermissions, crud: crudPermissions, widgets: widgetPermissions };
    const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    const skip = Promise.resolve();
    const [s, c, w] = await Promise.allSettled([
      changed(sidebarPayload(snapshot.sidebar), sidebarPayload(saved.sidebar))
        ? put(`/api/control-panel/sidebar-menu/${roleId}`, sidebarPayload(snapshot.sidebar), 'menu access')
        : skip,
      changed(crudPayload(snapshot.crud), crudPayload(saved.crud))
        ? put(`/api/control-panel/menu-crud/${roleId}`, crudPayload(snapshot.crud), 'Add/Edit/Delete access')
        : skip,
      widgetsDirty && catalog.length
        ? put(`/api/control-panel/dashboard-widgets/${roleId}`, widgetPayload(snapshot.widgets), 'dashboard widgets')
        : skip,
    ]);
    setSaving(false);
    // The admin switched roles while this was saving; its baseline is gone.
    if (currentRoleRef.current !== roleId) return;
    setSaved((prev) => ({
      sidebar: s.status === 'fulfilled' ? snapshot.sidebar : prev.sidebar,
      crud: c.status === 'fulfilled' ? snapshot.crud : prev.crud,
      widgets: w.status === 'fulfilled' ? snapshot.widgets : prev.widgets,
    }));
    const failed = [s, c, w].find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) toast.error(failed.reason?.message || 'Some changes could not be saved');
    else toast.success(`Changes saved for ${roleName}`);
  }

  function discardChanges() {
    setSidebarPermissions(saved.sidebar);
    setCrudPermissions(saved.crud);
    setWidgetPermissions(saved.widgets);
  }

  function requestRoleChange(next: string) {
    if (!next || next === selectedRoleId || saving) return;
    if (dirty) setPendingRoleId(next);
    else setSelectedRoleId(next);
  }

  /* -------------------------------- widgets ------------------------------ */

  // Evaluated against the Menus tab's current (maybe unsaved) state, so a
  // widget's toggle appears or disappears the moment the admin changes the
  // menu access it depends on. The server applies the same rule on save.
  const enabledMenus = useMemo(
    () => new Set(Object.entries(sidebarPermissions).filter(([, v]) => v).map(([k]) => k)),
    [sidebarPermissions]
  );
  const queue: QueueKind = enabledMenus.has('approval:queue')
    ? 'approval'
    : enabledMenus.has('assessment:queue')
      ? 'assessment'
      : 'overview';
  const byKey = useMemo(() => new Map(catalog.map((w) => [w.key, w])), [catalog]);
  // Same as the server: a role with no menu access at all gets no widgets.
  const hasAnyMenu = enabledMenus.size > 0;
  const isEligible = (w: CatalogWidget | undefined): boolean => {
    if (!w || !hasAnyMenu) return false;
    if (w.parent && !isEligible(byKey.get(w.parent))) return false;
    return w.requiresAnyMenu.length === 0 || w.requiresAnyMenu.some((m) => enabledMenus.has(m));
  };
  const widgetOn = (key: string) => widgetPermissions[key] ?? true;
  const setWidget = (key: string, next: boolean) => setWidgetPermissions((prev) => ({ ...prev, [key]: next }));

  const topWidgets = catalog.filter((w) => !w.parent);
  const eligibleTop = topWidgets.filter((w) => isEligible(w));
  const unavailableTop = topWidgets.filter((w) => !isEligible(w));
  const childrenOf = (key: string) => catalog.filter((w) => w.parent === key && isEligible(w));
  const statsParent = eligibleTop.find((w) => w.key === 'dashboard:stats');
  const statChildren = statsParent ? childrenOf(statsParent.key) : [];
  const statsOnButEmpty = Boolean(statsParent && widgetOn(statsParent.key) && statChildren.every((c) => !widgetOn(c.key)));
  // "Visible" = on, and for the stat row, at least one card under it on.
  const widgetVisible = (w: CatalogWidget) =>
    widgetOn(w.key) && (w.key !== 'dashboard:stats' || statChildren.some((c) => widgetOn(c.key)));
  const visibleWidgetCount = eligibleTop.filter(widgetVisible).length;

  /* -------------------------------- summary ------------------------------ */

  const rootSummary = useMemo(() => {
    if (activeTab === 'sidebar') {
      const on = sidebarMenuItems.filter((item) => Boolean(sidebarPermissions[item.key])).length;
      const editable = visibleCrudMenuItems.filter((item) => {
        const r = crudPermissions[item.key];
        return r && (r.can_add || r.can_edit || r.can_delete);
      }).length;
      return `${on} of ${sidebarMenuItems.length} menus visible · ${editable} with edit access`;
    }
    return `${visibleWidgetCount} of ${eligibleTop.length} widgets shown`;
  }, [activeTab, sidebarMenuItems, sidebarPermissions, visibleCrudMenuItems, crudPermissions, visibleWidgetCount, eligibleTop.length]);

  /* --------------------------------- render ------------------------------ */

  const tabs = [
    ['sidebar', 'Sidebar', 'Menus & Access', 'Menus', menusDirty],
    ['widgets', 'Dashboard', 'Widgets', 'Widgets', widgetsDirty],
  ] as const;

  function renderSidebarTab() {
    const allItems: { key: string; linked: boolean; node: React.ReactNode }[] = sidebarMenuItems.map((item) => {
      const enabled = Boolean(sidebarPermissions[item.key]);
      const menuCard = (
        <TreeNodeCard
          active={enabled}
          title={item.label}
          subtitle={enabled ? 'Visible in sidebar' : 'Hidden'}
          trailing={
            <PermissionToggle
              aria-label={`${item.label} sidebar visible`}
              checked={enabled}
              onChange={(next) => setSidebarPermissions((prev) => ({ ...prev, [item.key]: next }))}
            />
          }
        />
      );
      const isCrud = enabled && Boolean((LANDING_CONFIG as any)[item.key]?.isCrud);
      if (!isCrud) return { key: item.key, linked: enabled, node: menuCard };

      // CRUD access branches off its menu: only granted actions are linked
      // into the tree; the rest sit as "+" chips on the card.
      const row = crudPermissions[item.key] || { can_add: false, can_edit: false, can_delete: false };
      const hints = (LANDING_CONFIG as any)[item.key]?.crudHints as { add?: string; edit?: string; delete?: string } | undefined;
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
                    onChange={(next) => setSidebarPermissions((prev) => ({ ...prev, [item.key]: next }))}
                  />
                }
              >
                {missing.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 border-t px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                    {missing.map(([flag, label]) => (
                      <button
                        key={flag}
                        type="button"
                        onClick={() => setFlag(flag, true)}
                        className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 pointer-coarse:py-1.5 text-[10px] font-semibold text-secondary cursor-pointer hover:opacity-80"
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
            items={granted.map(([flag, label, hintKey]) => ({
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
            }))}
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
              title={roleName}
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
              className="flex items-center gap-1.5 py-1 text-[10px] font-semibold text-secondary uppercase tracking-widest cursor-pointer hover:opacity-80"
            >
              <ChevronRight size={13} className="transition-transform duration-200" style={{ transform: showUnlinked ? 'rotate(90deg)' : 'none' }} />
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
        <p className="text-[11px] text-secondary pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          Add, Edit, and Delete branch off each module the role can see — unlinking one hides that control for this role in that module.
        </p>
      </>
    );
  }

  function widgetCard(w: CatalogWidget) {
    const on = widgetOn(w.key);
    return (
      <TreeNodeCard
        key={w.key}
        active={on}
        title={w.label}
        subtitle={
          <>
            {widgetDescription(w.key, queue)}
            {on ? null : <span className="font-semibold"> · Hidden</span>}
          </>
        }
        trailing={<PermissionToggle aria-label={`Show ${w.label}`} checked={on} onChange={(next) => setWidget(w.key, next)} />}
      />
    );
  }

  function renderWidgetsTab() {
    if (catalogFailed) {
      return (
        <div className="space-y-3 py-4 text-center">
          <EmptyState title="Couldn't load dashboard widgets" description="Widget settings can't be changed until they load." />
          <button
            type="button"
            onClick={loadCatalog}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold cursor-pointer hover:opacity-80"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Try again
          </button>
        </div>
      );
    }
    if (!catalog.length) {
      return <Skeleton className="h-[200px] w-full rounded-xl" />;
    }
    const statsOn = statsParent ? widgetOn(statsParent.key) : false;
    if (!hasAnyMenu) {
      return (
        <EmptyState
          title="No menu access yet"
          description={`${roleName} can't open any menu, so its dashboard stays empty. Give it menu access on the Menus tab first, and the widgets it may have will show up here.`}
        />
      );
    }
    return (
      <>
        <div className="lg:max-w-md">
          <TreeNodeCard
            emphasis
            active
            title={roleName}
            subtitle={
              <>
                {rootSummary}
                {selectedRole?.description ? <> · {selectedRole.description}</> : null}
              </>
            }
          />
        </div>

        {!enabledMenus.has('dashboard') || visibleWidgetCount === 0 || statsOnButEmpty ? (
          <div className="space-y-2">
            {!enabledMenus.has('dashboard') ? (
              <Notice tone="info">
                The Dashboard link is hidden from this role's sidebar, but it's still their home page after sign-in, so these widgets
                still apply.
              </Notice>
            ) : null}
            {visibleWidgetCount === 0 ? (
              <Notice tone="warning">Every widget is off — {roleName} will see an empty dashboard.</Notice>
            ) : null}
            {statsOnButEmpty ? (
              <Notice tone="warning">
                Stat Cards is on but every card under it is off, so the stat row won't show. Turn a card on, or switch Stat Cards off.
              </Notice>
            ) : null}
          </div>
        ) : null}

        {WIDGET_GROUPS.map((group) => {
          const widgets = eligibleTop.filter((w) => w.group === group.key);
          if (!widgets.length) return null;
          return (
            <section key={group.key} aria-labelledby={`cp-group-${group.key}`} className="space-y-2">
              <div>
                <h5 id={`cp-group-${group.key}`} className="text-[10px] font-semibold text-secondary uppercase tracking-widest">
                  {group.label}
                </h5>
                <p className="text-[11px] text-secondary">{group.hint}</p>
              </div>
              {group.key === 'summary' && statsParent ? (
                <TreeNodeCard
                  active={statsOn}
                  title={statsParent.label}
                  subtitle={
                    <>
                      {widgetDescription(statsParent.key, queue)}
                      {statsOn ? null : <span className="font-semibold"> · Hidden</span>}
                    </>
                  }
                  trailing={
                    <PermissionToggle
                      aria-label={`Show ${statsParent.label}`}
                      checked={statsOn}
                      onChange={(next) => setWidget(statsParent.key, next)}
                    />
                  }
                >
                  {/* Each card under the stat row, nested like Add/Edit/Delete
                      on the Menus tab. Inert while Stat Cards itself is off. */}
                  <div
                    className={cn('border-t px-3 py-2.5 transition-opacity', !statsOn && 'opacity-50')}
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <ul className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-1.5">
                      {statChildren.map((c) => (
                        <li key={c.key} className="flex items-center gap-2.5 min-w-0">
                          <PermissionToggle
                            aria-label={`Show ${c.label} card`}
                            checked={widgetOn(c.key)}
                            disabled={!statsOn}
                            onChange={(next) => setWidget(c.key, next)}
                          />
                          <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text)' }}>
                            {c.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </TreeNodeCard>
              ) : (
                <div className="balanced-row" style={balancedRowStyle(widgets.length, { base: 1, sm: 2, xl: 3 })}>
                  {widgets.map(widgetCard)}
                </div>
              )}
            </section>
          );
        })}

        {unavailableTop.length > 0 ? (
          <div className="pt-3 border-t space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">Not available for this role</div>
            <ul className="space-y-0.5">
              {unavailableTop.map((w) => (
                <li key={w.key} className="text-[11px] text-secondary">
                  <span className="font-semibold" style={{ color: 'var(--text)' }}>
                    {w.label}
                  </span>{' '}
                  — needs access to {orList(w.requiresAnyMenu.map(menuTitle))} in Menus
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-[11px] text-secondary pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          Only widgets this role's menu access allows are listed, and the dashboard reflows to fit whichever are on. This never affects the
          Administrator role.
        </p>
      </>
    );
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
          {tabs.map(([key, caption, title, shortTitle, tabDirty]) => (
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
              <span className="inline-flex items-center justify-center sm:justify-start gap-1.5 text-[12px] sm:text-sm font-bold leading-tight tracking-tight">
                <span className="sm:hidden">{shortTitle}</span>
                <span className="hidden sm:inline">{title}</span>
                {tabDirty ? (
                  <span aria-label="Unsaved changes" title="Unsaved changes" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                ) : null}
              </span>
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
          <EmptyState title="No roles found" description="There are no roles available to manage permissions for." />
        ) : (
          <div className="min-w-0">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-4">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">
                  {activeTab === 'sidebar' ? 'Menus & Access' : 'Dashboard Widgets'}
                </div>
                <div className="text-[12px] text-secondary">
                  {activeTab === 'sidebar'
                    ? `Sidebar menus and Add / Edit / Delete access for ${roleName}`
                    : `Choose which dashboard widgets ${roleName} sees`}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="space-y-1 sm:w-[240px]">
                  <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">Role</div>
                  <AppSelect
                    value={selectedRoleId}
                    isDisabled={saving}
                    onChange={(v) => v && requestRoleChange(v)}
                    options={roles.map((role) => ({ value: String(role.id), label: roleDisplayName(role.name) }))}
                    isClearable={false}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {dirty ? (
                    <button
                      type="button"
                      onClick={discardChanges}
                      disabled={saving}
                      className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold text-secondary cursor-pointer hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      Discard
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="group relative inline-flex flex-1 sm:flex-none shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-3 py-2 text-[11px] font-semibold tracking-wide shadow-sm transition-[transform,box-shadow,filter,opacity] duration-200 ease-out hover:brightness-110 hover:shadow-md active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
                    style={{
                      backgroundColor: 'var(--nav-active-bg)',
                      color: 'var(--nav-active-text)',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.12), 0 4px 14px color-mix(in srgb, var(--nav-active-bg) 45%, transparent)',
                    }}
                    onClick={saveAll}
                    disabled={saving || loading || roleLoading || roleLoadFailed || !dirty}
                  >
                    <span
                      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 50%)' }}
                    />
                    {saving ? (
                      <Loader2 className="relative h-3.5 w-3.5 shrink-0 animate-spin opacity-95" aria-hidden />
                    ) : (
                      <Save className="relative h-3.5 w-3.5 shrink-0 opacity-95 transition-transform duration-200 group-hover:scale-105" aria-hidden />
                    )}
                    <span className="relative">{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</span>
                  </button>
                </div>
              </div>
            </div>

            {dirty ? (
              <p className="-mt-2 mb-3 text-[11px] text-amber-500 lg:text-right" role="status">
                Unsaved changes{menusDirty && widgetsDirty ? ' on both tabs' : menusDirty ? ' on Menus' : ' on Widgets'} — Save applies both tabs.
              </p>
            ) : null}

            {roleLoading ? (
              <Skeleton className="h-[200px] w-full rounded-xl" />
            ) : roleLoadFailed ? (
              <div className="space-y-3 py-4 text-center">
                <EmptyState title="Couldn't load this role's permissions" description="Nothing can be changed until they load." />
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold cursor-pointer hover:opacity-80"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Try again
                </button>
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${activeTab}-${selectedRoleId}`}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="space-y-4"
                >
                  {activeTab === 'sidebar' ? renderSidebarTab() : renderWidgetsTab()}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingRoleId !== null}
        title="Discard unsaved changes?"
        description={`Your changes to ${roleName} haven't been saved. Switching roles will discard them.`}
        confirmText="Discard changes"
        cancelText="Keep editing"
        danger
        onConfirm={() => {
          const next = pendingRoleId;
          setPendingRoleId(null);
          if (next) setSelectedRoleId(next);
        }}
        onCancel={() => setPendingRoleId(null)}
      />
    </div>
  );
}
