import React, { useState } from 'react';
import {
  BarChart3,
  ChevronRight,
  ClipboardCheck,
  FileCheck,
  KeyRound,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Settings,
  ShieldCheck,
  Stamp,
  Users,
} from 'lucide-react';
import { useControlPanelAccess } from '../context/ControlPanelAccessContext';
import { useBottomNavTabs } from './proponent/ProponentBottomNav';
import { SheetRow, SheetRowGroup, SheetSection, SheetTile, SheetTileGrid } from './MobileMenuSheet';
import { cn } from '../lib/utils';
import type { AppView } from '../layout/AppLayout';

const SidebarGroup = ({
  title,
  children,
  collapsed,
}: {
  title: string;
  children: React.ReactNode;
  collapsed?: boolean;
}) => (
  <div className="mb-5">
    <div className="px-3 mb-2 h-5 flex items-center">
      {collapsed ? (
        <div className="w-full flex justify-center">
          <div className="h-px w-7 rounded-full" style={{ backgroundColor: 'var(--border-subtle)' }} />
        </div>
      ) : (
        <p className="text-[10px] font-bold text-secondary uppercase tracking-widest">{title}</p>
      )}
    </div>
    <div className="space-y-1.5 flex flex-col items-stretch">{children}</div>
  </div>
);

const SidebarItem = ({
  icon: Icon,
  label,
  active,
  onClick,
  hasSubmenu,
  collapsed,
}: {
  icon: any;
  label: string;
  active?: boolean;
  onClick: () => void;
  hasSubmenu?: boolean;
  collapsed?: boolean;
}) => {
  const [shimmer, setShimmer] = useState(false);

  const handleClick = () => {
    setShimmer(true);
    setTimeout(() => {
      setShimmer(false);
    }, 900);
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex items-center rounded-lg transition-all duration-200 w-full group cursor-pointer',
        collapsed ? 'justify-center px-1.5 py-2.5' : 'justify-start gap-3 px-3 py-2',
        active
          ? 'shadow-sm text-[var(--nav-active-text)]'
          : 'text-secondary hover:text-[var(--text)] hover:bg-[var(--selected-bg)]',
        shimmer && 'shimmer-badge',
      )}
      style={active ? { backgroundColor: 'var(--nav-active-bg)' } : undefined}
    >
      <Icon
        size={18}
        className={cn(
          'transition-colors',
          active ? 'text-[var(--nav-active-text)]' : 'text-secondary group-hover:text-[var(--text)]',
        )}
      />
      {!collapsed && (
        <>
          <span className="flex-1 text-left text-[13px] font-medium tracking-tight leading-snug whitespace-nowrap overflow-hidden text-ellipsis">
            {label}
          </span>
          {hasSubmenu && (
            <ChevronRight
              size={14}
              className={cn(
                'transition-transform transition-colors opacity-70',
                active && 'rotate-90',
                active ? 'text-[var(--nav-active-text)]' : 'text-secondary group-hover:text-[var(--text)]',
              )}
            />
          )}
        </>
      )}
    </button>
  );
};

const SidebarSubItem = ({
  label,
  onClick,
  active,
  icon: Icon,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  /** Optional — most dropdowns just use the plain bullet below; a group
   * whose items are distinct enough to earn their own icon (e.g. Operations
   * & Assets) can pass one per leaf instead. */
  icon?: any;
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-lg text-[12px] hover:text-[var(--text)] transition-colors cursor-pointer',
        active ? 'text-[var(--text)]' : 'text-[var(--text-muted)]',
      )}
    >
      {Icon ? (
        <Icon size={14} className="shrink-0" />
      ) : (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full transition-colors',
            active ? 'bg-[var(--text)]' : 'bg-[var(--text-muted)] group-hover:bg-[var(--text)]',
          )}
        />
      )}
      <span className="flex-1 text-left leading-snug whitespace-nowrap overflow-hidden text-ellipsis">
        {label}
      </span>
    </button>
  );
};

const SidebarDropdown = ({
  icon,
  label,
  collapsed,
  children,
  isOpen,
  onToggle,
}: {
  icon: any;
  label: string;
  collapsed?: boolean;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  return (
    <div className="flex flex-col">
      <SidebarItem
        icon={icon}
        label={label}
        active={isOpen}
        hasSubmenu
        onClick={onToggle}
        collapsed={collapsed}
      />
      {!collapsed && isOpen && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
};

type SidebarLeaf = { key: string; label: string; active: boolean; onClick: () => void; icon?: any };

/** Stands in for a lucide icon component so SidebarItem can render a plain
 * bullet — used for flattened leaf rows, which don't each need their own
 * distinct icon the way top-level categories do. */
const DotIcon = ({ className }: { size?: number; className?: string }) => (
  <span className={cn('flex items-center justify-center shrink-0', className)} style={{ width: 18, height: 18 }}>
    <span className="rounded-full" style={{ width: 6, height: 6, backgroundColor: 'currentColor' }} />
  </span>
);

/** Renders a set of menu items either grouped behind a click-to-expand
 * parent (admin's own view — many items, grouping earns its keep) or as
 * direct top-level rows (restricted roles — Officer/Locator typically end
 * up with only a handful of enabled items total, so the extra click to
 * expand a near-empty "Management"/"Assessment" parent is just friction). */
const SidebarSection = ({
  icon,
  label,
  items,
  flat,
  collapsed,
  isOpen,
  onToggle,
  onDirectSelect,
  singleItemIsGroup = true,
}: {
  icon: any;
  label: string;
  items: SidebarLeaf[];
  flat: boolean;
  collapsed?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  /** Called when a row that ISN'T inside a dropdown is clicked (single-item
   * or flat mode), so any open dropdown closes like it would for other
   * top-level items. */
  onDirectSelect?: () => void;
  /** Set false for an umbrella group whose items are genuinely different
   * pages (System Settings: Users/Locator Accounts/Control Panel/Audit Log;
   * File Maintenance: Requirement Categories/Inspection Types/...). When a
   * restricted role only has one of those enabled, collapsing to the GROUP
   * label (e.g. "System Settings") makes the sidebar say something
   * different from the page actually open ("Locator Accounts") — so these
   * groups keep the item's own label even at one item. Groups that are
   * truly one page by nature (Assessment, Approval, Permits) keep the
   * default group-label collapse below. */
  singleItemIsGroup?: boolean;
}) => {
  if (items.length === 0) return null;

  // A section that only ever holds one item (e.g. Assessment, Approval,
  // Permits — each backed by a single queue/page) has nothing to expand
  // into or distinguish itself from; render it as one direct row under the
  // group's own icon/label instead of the item's internal sub-label, in
  // BOTH flat and dropdown mode — otherwise a restricted role (flat) sees a
  // raw descriptive sub-label ("Environmental, Fire, Occupancy, Sanitary")
  // where a full-access role sees the clean group name ("Permit & Contract").
  if (items.length === 1 && singleItemIsGroup) {
    const only = items[0];
    return (
      <SidebarItem
        icon={icon}
        label={label}
        active={only.active}
        onClick={() => {
          onDirectSelect?.();
          only.onClick();
        }}
        collapsed={collapsed}
      />
    );
  }

  if (flat) {
    return (
      <>
        {items.map((item) => (
          <SidebarItem
            key={item.key}
            icon={DotIcon}
            label={item.label}
            active={item.active}
            onClick={() => {
              onDirectSelect?.();
              item.onClick();
            }}
            collapsed={collapsed}
          />
        ))}
      </>
    );
  }

  return (
    <SidebarDropdown icon={icon} label={label} collapsed={collapsed} isOpen={isOpen} onToggle={onToggle}>
      {items.map((item) => (
        <SidebarSubItem key={item.key} label={item.label} active={item.active} onClick={item.onClick} icon={item.icon} />
      ))}
    </SidebarDropdown>
  );
};

export function AppSidebar({
  view,
  onViewChange,
  onLogout,
  collapsed,
  onToggleCollapse,
  variant = 'default',
  permissionOverride,
  accountActions,
}: {
  view: string;
  onViewChange: (view: string) => void;
  onLogout: () => void;
  collapsed?: boolean;
  /** Desktop sidebar: the collapse/expand toggle in its footer. */
  onToggleCollapse?: () => void;
  variant?: 'default' | 'drawer' | 'sheet';
  /** Set only during the admin's dashboard-role preview: the previewed
   * role's actual saved sidebar permissions, shown in place of the logged-in
   * admin's own fullAccess so the preview reflects what that role really sees. */
  permissionOverride?: Record<string, boolean> | null;
  /** Mobile drawer only: stands in for the header's account menu, which is
   * hidden below md. */
  accountActions?: { onOpenSettings: () => void; onChangePassword: () => void };
}) {
  const isDrawer = variant === 'drawer';
  // Dropdown state has two parts:
  // - the dropdown holding the current page stays open (unless the user
  //   collapses it by clicking its header), so peeking into another dropdown
  //   doesn't hide where you are;
  // - at most one other dropdown can be open for browsing. It closes when a
  //   different dropdown is opened, a top-level item is clicked, or the page
  //   changes (e.g. a sub-item is picked), at which point the new page's
  //   dropdown becomes the "current" one.
  const [browseDropdownId, setBrowseDropdownId] = useState<string | null>(null);
  const [activeDropdownCollapsed, setActiveDropdownCollapsed] = useState(false);
  const [prevView, setPrevView] = useState(view);
  if (prevView !== view) {
    // Reset during render (not in an effect) so the old dropdown never flashes open.
    setPrevView(view);
    setBrowseDropdownId(null);
    setActiveDropdownCollapsed(false);
  }
  const { ready, fullAccess, sidebarPermissions } = useControlPanelAccess();
  // Sheet only: every module is listed (the sheet covers the bottom nav), except
  // Dashboard when it's already the bottom nav's center Home button.
  const { showHome } = useBottomNavTabs('admin', permissionOverride);

  const closeDropdowns = () => setBrowseDropdownId(null);
  // Clicking a top-level (non-dropdown) item closes the dropdown being browsed.
  const withClose = (fn: () => void) => () => {
    closeDropdowns();
    fn();
  };

  // Fail-closed: while permissions are loading (or failed to load), show
  // nothing restricted rather than everything. Roles exempt from Control
  // Panel restrictions (fullAccess, e.g. admin) always see every menu.
  const canView = (menuKey: AppView) => {
    if (permissionOverride) return Boolean(permissionOverride[menuKey]);
    if (fullAccess) return true;
    if (!ready) return false;
    return Boolean(sidebarPermissions[menuKey]);
  };

  // A dropdown/group with every child hidden must hide itself too — otherwise
  // a role with nothing configured (or everything turned off) still sees an
  // empty "Management"/"Assessment"/etc. shell with no way to know it's empty.
  const showDashboard = canView('dashboard');
  const showApplicationsMgmt =
    canView('applications:renewals') ||
    canView('settings:proponents') ||
    canView('settings:locator-users') ||
    canView('assessment:queue') ||
    canView('approval:queue');
  const showComplianceInspection = canView('compliance:inspections');
  const showPermits = canView('compliance:permits');
  const showComplianceGroup = showComplianceInspection || showPermits;
  const showReports = canView('reports:analytics');
  const showSystemSettings =
    canView('settings:users') ||
    canView('settings:control-panel') ||
    canView('settings:audit-log');
  const showFileMaintenance =
    canView('applications:requirements') ||
    canView('settings:inspection-types') ||
    canView('settings:compliance-types') ||
    canView('settings:application-types') ||
    canView('settings:account-officers') ||
    canView('settings:type-of-contract') ||
    canView('settings:building') ||
    canView('settings:land-use') ||
    canView('settings:requirement-categories');
  const showSystemGroup = showSystemSettings || showFileMaintenance;

  // Officer/Locator-style restricted roles (previewed or real) get a flat
  // list instead of click-to-expand parents — see SidebarSection above.
  const flat = Boolean(permissionOverride) || !fullAccess;

  // Ordered to match the real workflow sequence: create the account, file
  // the application, evaluate it, approve it, then it shows up as a
  // registered locator — renewals are a separate, later-in-time track.
  // New Application has no page of its own anymore — a locator account and
  // its one application are created together on Locator Accounts.
  const applicationsItems: SidebarLeaf[] = [
    canView('settings:locator-users') && { key: 'settings:locator-users', label: 'Locator Accounts', active: view === 'settings:locator-users', onClick: () => onViewChange('settings:locator-users'), icon: KeyRound },
    canView('assessment:queue') && { key: 'assessment:queue', label: 'Evaluation Queue', active: view === 'assessment:queue', onClick: () => onViewChange('assessment:queue'), icon: ClipboardCheck },
    canView('approval:queue') && { key: 'approval:queue', label: 'Approval Queue', active: view === 'approval:queue', onClick: () => onViewChange('approval:queue'), icon: Stamp },
    canView('settings:proponents') && { key: 'settings:proponents', label: 'Registered Locator', active: view === 'settings:proponents', onClick: () => onViewChange('settings:proponents'), icon: Users },
    canView('applications:renewals') && { key: 'applications:renewals', label: 'Renewal Tracking', active: view === 'applications:renewals', onClick: () => onViewChange('applications:renewals'), icon: RefreshCw },
  ].filter(Boolean) as SidebarLeaf[];

  const complianceInspectionItems: SidebarLeaf[] = [
    canView('compliance:inspections') && { key: 'compliance:inspections', label: 'Inspections & Monitoring', active: view === 'compliance:inspections', onClick: () => onViewChange('compliance:inspections') },
  ].filter(Boolean) as SidebarLeaf[];

  const permitsItems: SidebarLeaf[] = !canView('compliance:permits') ? [] : [
    { key: 'compliance:permits', label: 'Environmental, Fire, Occupancy, Sanitary', active: view === 'compliance:permits', onClick: () => onViewChange('compliance:permits') },
  ];

  const systemSettingsItems: SidebarLeaf[] = [
    canView('settings:users') && { key: 'settings:users', label: 'User Management', active: view === 'settings:users', onClick: () => onViewChange('settings:users') },
    canView('settings:control-panel') && { key: 'settings:control-panel', label: 'Control Panel', active: view === 'settings:control-panel', onClick: () => onViewChange('settings:control-panel') },
    canView('settings:audit-log') && { key: 'settings:audit-log', label: 'Audit Log', active: view === 'settings:audit-log', onClick: () => onViewChange('settings:audit-log') },
  ].filter(Boolean) as SidebarLeaf[];

  const fileMaintenanceItems: SidebarLeaf[] = [
    canView('applications:requirements') && { key: 'applications:requirements', label: 'Requirements', active: view === 'applications:requirements', onClick: () => onViewChange('applications:requirements') },
    canView('settings:requirement-categories') && { key: 'settings:requirement-categories', label: 'Requirement Categories', active: view === 'settings:requirement-categories', onClick: () => onViewChange('settings:requirement-categories') },
    canView('settings:inspection-types') && { key: 'settings:inspection-types', label: 'Inspection Types', active: view === 'settings:inspection-types', onClick: () => onViewChange('settings:inspection-types') },
    canView('settings:compliance-types') && { key: 'settings:compliance-types', label: 'Compliance Types', active: view === 'settings:compliance-types', onClick: () => onViewChange('settings:compliance-types') },
    canView('settings:application-types') && { key: 'settings:application-types', label: 'Application Types', active: view === 'settings:application-types', onClick: () => onViewChange('settings:application-types') },
    canView('settings:account-officers') && { key: 'settings:account-officers', label: 'Account Officers', active: view === 'settings:account-officers', onClick: () => onViewChange('settings:account-officers') },
    canView('settings:type-of-contract') && { key: 'settings:type-of-contract', label: 'Type of Contract', active: view === 'settings:type-of-contract', onClick: () => onViewChange('settings:type-of-contract') },
    canView('settings:building') && { key: 'settings:building', label: 'Building', active: view === 'settings:building', onClick: () => onViewChange('settings:building') },
    canView('settings:land-use') && { key: 'settings:land-use', label: 'Land Use', active: view === 'settings:land-use', onClick: () => onViewChange('settings:land-use') },
  ].filter(Boolean) as SidebarLeaf[];

  const dropdownItems: Record<string, SidebarLeaf[]> = {
    'compliance-inspection': complianceInspectionItems,
    permits: permitsItems,
    'system-settings': systemSettingsItems,
    'file-maintenance': fileMaintenanceItems,
  };
  const activeDropdownId =
    Object.keys(dropdownItems).find((id) => dropdownItems[id].some((item) => item.active)) ?? null;
  const isDropdownOpen = (id: string) =>
    id === activeDropdownId ? !activeDropdownCollapsed : id === browseDropdownId;
  const toggleDropdown = (id: string) => {
    if (id === activeDropdownId) {
      setActiveDropdownCollapsed((c) => !c);
    } else {
      setBrowseDropdownId((prev) => (prev === id ? null : id));
    }
  };

  if (variant === 'sheet') {
    const notHidden = (item: SidebarLeaf) => !(showHome && item.key === 'dashboard');
    // Same full labels as the desktop sidebar, so the two menus read the same.
    const SHEET_TILES: Record<string, { label: string; icon: any }> = {
      dashboard: { label: 'Dashboard', icon: LayoutDashboard },
      'applications:renewals': { label: 'Renewal Tracking', icon: RefreshCw },
      'settings:proponents': { label: 'Registered Locator', icon: Users },
      'assessment:queue': { label: 'Evaluation Queue', icon: ClipboardCheck },
      'approval:queue': { label: 'Approval Queue', icon: Stamp },
      'compliance:inspections': { label: 'Compliance & Inspection', icon: ClipboardCheck },
      'compliance:permits': { label: 'Permit & Contract', icon: ShieldCheck },
      'reports:analytics': { label: 'Reports & Analytics', icon: BarChart3 },
    };
    const leaf = (key: AppView): SidebarLeaf => ({ key, label: '', active: view === key, onClick: () => onViewChange(key) });
    const moduleTiles: SidebarLeaf[] = [
      ...(showDashboard ? [leaf('dashboard')] : []),
      ...applicationsItems,
      ...complianceInspectionItems,
      ...permitsItems,
      ...(showReports ? [leaf('reports:analytics')] : []),
    ].filter(notHidden);
    // System groups hold many pages each, so they stay accordion rows rather than tiles.
    const systemGroups = [
      { id: 'system-settings', label: 'System Settings', icon: Settings, items: systemSettingsItems.filter(notHidden) },
      { id: 'file-maintenance', label: 'File Maintenance', icon: FileCheck, items: fileMaintenanceItems.filter(notHidden) },
    ].filter((g) => g.items.length > 0);

    return (
      <div className="flex flex-col">
        {moduleTiles.length > 0 && (
          <SheetSection title="Modules">
            <SheetTileGrid>
              {moduleTiles.map((item) => (
                <SheetTile
                  key={item.key}
                  icon={SHEET_TILES[item.key]?.icon || FileCheck}
                  label={SHEET_TILES[item.key]?.label || item.label}
                  active={item.active}
                  onClick={item.onClick}
                />
              ))}
            </SheetTileGrid>
          </SheetSection>
        )}

        {systemGroups.length > 0 && (
          <SheetSection title="System">
            <SheetRowGroup>
              {systemGroups.map((g) => {
                const open = isDropdownOpen(g.id);
                return (
                  <React.Fragment key={g.id}>
                    <SheetRow icon={g.icon} label={g.label} expandable expanded={open} onClick={() => toggleDropdown(g.id)} />
                    {open &&
                      g.items.map((item) => (
                        <SheetRow key={item.key} nested label={item.label} active={item.active} onClick={item.onClick} />
                      ))}
                  </React.Fragment>
                );
              })}
            </SheetRowGroup>
          </SheetSection>
        )}

        <SheetSection title="Account">
          <SheetRowGroup>
            {accountActions && (
              <SheetRow icon={KeyRound} label="Change Password" chevron onClick={accountActions.onChangePassword} />
            )}
            <SheetRow icon={LogOut} label="Logout" danger onClick={onLogout} />
          </SheetRowGroup>
        </SheetSection>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        'shrink-0 transition-[width] duration-300 ease-in-out',
        isDrawer ? 'h-full' : 'pt-3 pb-6',
        collapsed ? 'w-[88px] px-3' : 'w-64 pl-4 pr-2',
      )}
      >
      <div
        className={cn('rounded-2xl overflow-hidden flex flex-col', isDrawer ? 'h-full min-h-0' : 'h-full')}
        style={{
          backgroundColor: 'var(--surface)',
          boxShadow:
            '0 8px 20px rgba(0,0,0,0.18), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
        }}
      >
        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden sidebar-scroll px-3 py-5 flex flex-col items-stretch">
          {showDashboard && (
          <SidebarGroup title="Overview" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarItem
                icon={LayoutDashboard}
                label="Dashboard"
                active={view === 'dashboard'}
                onClick={withClose(() => onViewChange('dashboard'))}
                collapsed={collapsed}
              />
            </div>
          </SidebarGroup>
          )}

          {showApplicationsMgmt && (
          <SidebarGroup title="Applications" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              {applicationsItems.map((item) => (
                <SidebarItem
                  key={item.key}
                  icon={item.icon || FileCheck}
                  label={item.label}
                  active={item.active}
                  onClick={withClose(item.onClick)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </SidebarGroup>
          )}

          {showComplianceGroup && (
          <SidebarGroup title="Compliance & Permits" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarSection
                icon={ClipboardCheck}
                label="Compliance & Inspection"
                items={complianceInspectionItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={isDropdownOpen('compliance-inspection')}
                onToggle={() => toggleDropdown('compliance-inspection')}
                onDirectSelect={closeDropdowns}
              />
              <SidebarSection
                icon={ShieldCheck}
                label="Permit & Contract"
                items={permitsItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={isDropdownOpen('permits')}
                onToggle={() => toggleDropdown('permits')}
                onDirectSelect={closeDropdowns}
              />
            </div>
          </SidebarGroup>
          )}

          {showReports && (
          <SidebarGroup title="Reports" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarItem
                icon={BarChart3}
                label="Reports & Analytics"
                active={view === 'reports:analytics'}
                onClick={withClose(() => onViewChange('reports:analytics'))}
                collapsed={collapsed}
              />
            </div>
          </SidebarGroup>
          )}

          {showSystemGroup && (
          <SidebarGroup title="System" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarSection
                icon={Settings}
                label="System Settings"
                items={systemSettingsItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={isDropdownOpen('system-settings')}
                onToggle={() => toggleDropdown('system-settings')}
                onDirectSelect={closeDropdowns}
                singleItemIsGroup={false}
              />
              <SidebarSection
                icon={FileCheck}
                label="File Maintenance"
                items={fileMaintenanceItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={isDropdownOpen('file-maintenance')}
                onToggle={() => toggleDropdown('file-maintenance')}
                onDirectSelect={closeDropdowns}
                singleItemIsGroup={false}
              />
            </div>
          </SidebarGroup>
          )}

          {isDrawer && accountActions && (
          <SidebarGroup title="Account" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarItem icon={Settings} label="Settings" onClick={withClose(accountActions.onOpenSettings)} collapsed={collapsed} />
              <SidebarItem icon={KeyRound} label="Change Password" onClick={withClose(accountActions.onChangePassword)} collapsed={collapsed} />
            </div>
          </SidebarGroup>
          )}
        </nav>

        <div
          className="px-3 py-3 border-t"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--control-bg) 60%, transparent)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {/* Collapse/expand toggle (moved here from the header). Logout
              lives in the header's account menu on desktop, and in the
              mobile sheet's Account section. */}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 w-full text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <span className="flex flex-col items-center justify-center gap-[3px] w-4 h-4 shrink-0" aria-hidden>
              <span className="w-3.5 h-0.5 rounded-full bg-current" />
              <span className="w-3.5 h-0.5 rounded-full bg-current" />
              <span className="w-3.5 h-0.5 rounded-full bg-current" />
            </span>
            {!collapsed && <span className="text-[13px] font-medium">Collapse</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}

