import React, { useState } from 'react';
import { Building2, FileCheck2, FileText, History, KeyRound, LayoutDashboard, LogOut, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { useBottomNavTabs } from './ProponentBottomNav';
import { SheetRow, SheetRowGroup, SheetSection, SheetTile, SheetTileGrid } from '../MobileMenuSheet';

/** Tile icons for the mobile "More" sheet (the desktop list uses dots). */
const SHEET_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  dashboard: LayoutDashboard,
  'me:applications': FileText,
  'me:contracts-permits': FileCheck2,
  'me:profile': Building2,
  'me:activity': History,
};

type ProponentNavItem = {
  key: string;
  label: string;
};

/** Stands in for a lucide icon component so SidebarItem can render a plain
 * bullet — matches the dot treatment AppSidebar uses for restricted-role
 * flat lists (see its own DotIcon). Dashboard keeps a real icon, same as
 * AppSidebar's own "Overview" group; only the rest become dots. */
const DotIcon = ({ className }: { className?: string }) => (
  <span className={cn('flex items-center justify-center shrink-0', className)} style={{ width: 18, height: 18 }}>
    <span className="rounded-full" style={{ width: 6, height: 6, backgroundColor: 'currentColor' }} />
  </span>
);

/** Mirrors AppSidebar's own (unexported, so duplicated here) group header —
 * same "Overview" / category label treatment. */
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

/**
 * Self-service menu for the `proponent` role. Toggled per-item via Control
 * Panel's "Locator Portal Menu" (role_sidebar_menu_permissions, same table
 * AppSidebar reads) but — unlike AppSidebar's canView — defaults to visible
 * (fail-open) when a key has no saved row, since every proponent already saw
 * all five items before this toggle existed; a fail-closed default would have
 * hidden them the moment this shipped, for every locator, until an admin
 * revisited Control Panel. Each screen stays scoped to its own record
 * server-side regardless of sidebar visibility.
 */
const NAV_ITEMS: ProponentNavItem[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'me:applications', label: 'My Applications' },
  { key: 'me:contracts-permits', label: 'Contracts & Permits' },
  { key: 'me:profile', label: 'My Business Profile' },
  { key: 'me:activity', label: 'Activity History' },
];

const SidebarItem = ({
  icon: Icon,
  label,
  active,
  onClick,
  collapsed,
}: {
  icon: any;
  label: string;
  active?: boolean;
  onClick: () => void;
  collapsed?: boolean;
}) => {
  const [shimmer, setShimmer] = useState(false);

  const handleClick = () => {
    setShimmer(true);
    setTimeout(() => setShimmer(false), 900);
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
        <span className="flex-1 text-left text-[13px] font-medium tracking-tight leading-snug whitespace-nowrap overflow-hidden text-ellipsis">
          {label}
        </span>
      )}
    </button>
  );
};

export function ProponentSidebar({
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
  /** Set only during the admin's dashboard-role preview (sourced from the
   * preview endpoint's `sidebarPermissions`), so the preview sidebar matches
   * what a real locator would see instead of always showing all five items. */
  permissionOverride?: Record<string, boolean> | null;
  /** Mobile drawer only: stands in for the header's account menu, which is
   * hidden below md. */
  accountActions?: { onOpenSettings: () => void; onChangePassword: () => void };
}) {
  const isDrawer = variant === 'drawer';
  const { sidebarPermissions: mySidebarPermissions, ready } = useControlPanelAccess();
  // Sheet only: every module is listed (the sheet covers the bottom nav), except
  // Dashboard when it's already the bottom nav's center Home button.
  const { showHome } = useBottomNavTabs('proponent', permissionOverride);

  const canView = (key: string) => {
    if (key === 'dashboard') return true; // always the portal's landing page
    if (permissionOverride) return key in permissionOverride ? Boolean(permissionOverride[key]) : true;
    if (!ready) return true;
    return key in mySidebarPermissions ? mySidebarPermissions[key] : true;
  };
  const visibleItems = NAV_ITEMS.filter((item) => canView(item.key));
  const dashboardItem = visibleItems.find((item) => item.key === 'dashboard') || null;
  const portalItems = visibleItems.filter((item) => item.key !== 'dashboard');

  if (variant === 'sheet') {
    const sheetItems = visibleItems.filter((item) => !(showHome && item.key === 'dashboard'));
    return (
      <div className="flex flex-col">
        {sheetItems.length > 0 && (
          <SheetSection title="Modules">
            <SheetTileGrid>
              {sheetItems.map((item) => (
                <SheetTile
                  key={item.key}
                  icon={SHEET_ICONS[item.key] || LayoutDashboard}
                  label={item.label}
                  active={view === item.key}
                  onClick={() => onViewChange(item.key)}
                />
              ))}
            </SheetTileGrid>
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
        <nav className={cn('flex-1 px-3 py-5 flex flex-col items-stretch', isDrawer && 'min-h-0 overflow-y-auto')}>
          {dashboardItem && (
            <SidebarGroup title="Overview" collapsed={collapsed}>
              <SidebarItem
                icon={LayoutDashboard}
                label={dashboardItem.label}
                active={view === dashboardItem.key}
                onClick={() => onViewChange(dashboardItem.key)}
                collapsed={collapsed}
              />
            </SidebarGroup>
          )}

          {portalItems.length > 0 && (
            <SidebarGroup title="Portal" collapsed={collapsed}>
              {portalItems.map((item) => (
                <SidebarItem
                  key={item.key}
                  icon={DotIcon}
                  label={item.label}
                  active={view === item.key}
                  onClick={() => onViewChange(item.key)}
                  collapsed={collapsed}
                />
              ))}
            </SidebarGroup>
          )}

          {isDrawer && accountActions && (
            <SidebarGroup title="Account" collapsed={collapsed}>
              <SidebarItem icon={Settings} label="Settings" onClick={accountActions.onOpenSettings} collapsed={collapsed} />
              <SidebarItem icon={KeyRound} label="Change Password" onClick={accountActions.onChangePassword} collapsed={collapsed} />
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
