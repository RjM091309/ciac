import React, { useState } from 'react';
import {
  Briefcase,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  FileCheck,
  Globe,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  Stamp,
  Users,
} from 'lucide-react';
import { useControlPanelAccess } from '../context/ControlPanelAccessContext';
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
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-lg text-[12px] hover:text-[var(--text)] transition-colors cursor-pointer',
        active ? 'text-[var(--text)]' : 'text-[var(--text-muted)]',
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full transition-colors',
          active ? 'bg-[var(--text)]' : 'bg-[var(--text-muted)] group-hover:bg-[var(--text)]',
        )}
      />
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

type SidebarLeaf = { key: string; label: string; active: boolean; onClick: () => void };

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
}: {
  icon: any;
  label: string;
  items: SidebarLeaf[];
  flat: boolean;
  collapsed?: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  if (items.length === 0) return null;

  if (flat) {
    return (
      <>
        {items.map((item) => (
          <SidebarItem
            key={item.key}
            icon={DotIcon}
            label={item.label}
            active={item.active}
            onClick={item.onClick}
            collapsed={collapsed}
          />
        ))}
      </>
    );
  }

  return (
    <SidebarDropdown icon={icon} label={label} collapsed={collapsed} isOpen={isOpen} onToggle={onToggle}>
      {items.map((item) => (
        <SidebarSubItem key={item.key} label={item.label} active={item.active} onClick={item.onClick} />
      ))}
    </SidebarDropdown>
  );
};

export function AppSidebar({
  view,
  onViewChange,
  onLogout,
  collapsed,
  variant = 'default',
  permissionOverride,
}: {
  view: string;
  onViewChange: (view: string) => void;
  onLogout: () => void;
  collapsed?: boolean;
  variant?: 'default' | 'drawer';
  /** Set only during the admin's dashboard-role preview: the previewed
   * role's actual saved sidebar permissions, shown in place of the logged-in
   * admin's own fullAccess so the preview reflects what that role really sees. */
  permissionOverride?: Record<string, boolean> | null;
}) {
  const isDrawer = variant === 'drawer';
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const { ready, fullAccess, sidebarPermissions } = useControlPanelAccess();

  const toggleDropdown = (id: string) => {
    setOpenDropdownId((prev) => (prev === id ? null : id));
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
    canView('applications:new') ||
    canView('applications:renewals') ||
    canView('applications:projects') ||
    canView('settings:proponents') ||
    canView('applications:requirements') ||
    canView('settings:requirement-categories');
  const showAssessment = canView('assessment:queue');
  const showApproval = canView('approval:queue');
  const showVerification = canView('verification:pending') || canView('verification:audit');
  const showComplianceInspection = canView('compliance:inspections');
  const showPermits = canView('compliance:permits');
  const showBirTax = canView('compliance:bir');
  const showExpiryCalendar = canView('compliance:expiry');
  const showComplianceGroup = showComplianceInspection || showPermits || showBirTax || showExpiryCalendar;
  const showOperations = canView('operations:flowcharts') || canView('operations:brochures') || canView('operations:gad');
  const showSystemSettings =
    canView('settings:users') ||
    canView('settings:locator-users') ||
    canView('settings:control-panel') ||
    canView('settings:audit-log');
  const showFileMaintenance = canView('settings:inspection-types') || canView('settings:compliance-types');
  const showSystemGroup = showSystemSettings || showFileMaintenance;

  // Officer/Locator-style restricted roles (previewed or real) get a flat
  // list instead of click-to-expand parents — see SidebarSection above.
  const flat = Boolean(permissionOverride) || !fullAccess;

  const applicationsItems: SidebarLeaf[] = [
    canView('applications:new') && { key: 'applications:new', label: 'New Applications', active: view === 'applications:new', onClick: () => onViewChange('applications:new') },
    canView('applications:renewals') && { key: 'applications:renewals', label: 'Renewal Tracking', active: view === 'applications:renewals', onClick: () => onViewChange('applications:renewals') },
    canView('applications:projects') && { key: 'applications:projects', label: 'Project Evaluations', active: view === 'applications:projects', onClick: () => onViewChange('applications:projects') },
    canView('settings:proponents') && { key: 'settings:proponents', label: 'Locator', active: view === 'settings:proponents', onClick: () => onViewChange('settings:proponents') },
    canView('applications:requirements') && { key: 'applications:requirements', label: 'Requirements', active: view === 'applications:requirements', onClick: () => onViewChange('applications:requirements') },
    canView('settings:requirement-categories') && { key: 'settings:requirement-categories', label: 'Requirement Categories', active: view === 'settings:requirement-categories', onClick: () => onViewChange('settings:requirement-categories') },
  ].filter(Boolean) as SidebarLeaf[];

  const assessmentItems: SidebarLeaf[] = [
    canView('assessment:queue') && { key: 'assessment:queue', label: 'Evaluation Queue', active: view === 'assessment:queue', onClick: () => onViewChange('assessment:queue') },
  ].filter(Boolean) as SidebarLeaf[];

  const approvalItems: SidebarLeaf[] = [
    canView('approval:queue') && { key: 'approval:queue', label: 'Approval Queue', active: view === 'approval:queue', onClick: () => onViewChange('approval:queue') },
  ].filter(Boolean) as SidebarLeaf[];

  const verificationItems: SidebarLeaf[] = [
    canView('verification:pending') && { key: 'verification:pending', label: 'Pending Review', active: view === 'verification:pending', onClick: () => onViewChange('verification:pending') },
    canView('verification:audit') && { key: 'verification:audit', label: 'Audit Trail', active: view === 'verification:audit', onClick: () => onViewChange('verification:audit') },
  ].filter(Boolean) as SidebarLeaf[];

  const complianceInspectionItems: SidebarLeaf[] = [
    canView('compliance:inspections') && { key: 'compliance:inspections', label: 'Inspections & Monitoring', active: view === 'compliance:inspections', onClick: () => onViewChange('compliance:inspections') },
  ].filter(Boolean) as SidebarLeaf[];

  const permitsItems: SidebarLeaf[] = !canView('compliance:permits') ? [] : [
    { key: 'compliance:permits', label: 'Environmental, Fire, Occupancy, Sanitary', active: view === 'compliance:permits', onClick: () => onViewChange('compliance:permits') },
  ];

  const birTaxItems: SidebarLeaf[] = !canView('compliance:bir') ? [] : [
    { key: 'compliance:bir', label: 'BIR Tax Clearance', active: view === 'compliance:bir', onClick: () => onViewChange('compliance:bir') },
  ];

  const expiryCalendarItems: SidebarLeaf[] = [
    canView('compliance:expiry') && { key: 'compliance:expiry', label: 'Expiring Permits', active: view === 'compliance:expiry', onClick: () => onViewChange('compliance:expiry') },
  ].filter(Boolean) as SidebarLeaf[];

  const operationsItems: SidebarLeaf[] = [
    canView('operations:flowcharts') && { key: 'operations:flowcharts', label: 'Production Flowcharts', active: view === 'operations:flowcharts', onClick: () => onViewChange('operations:flowcharts') },
    canView('operations:brochures') && { key: 'operations:brochures', label: 'Brochures & Marketing', active: view === 'operations:brochures', onClick: () => onViewChange('operations:brochures') },
    canView('operations:gad') && { key: 'operations:gad', label: 'GAD Programs', active: view === 'operations:gad', onClick: () => onViewChange('operations:gad') },
  ].filter(Boolean) as SidebarLeaf[];

  const systemSettingsItems: SidebarLeaf[] = [
    canView('settings:users') && { key: 'settings:users', label: 'User Management', active: view === 'settings:users', onClick: () => onViewChange('settings:users') },
    canView('settings:locator-users') && { key: 'settings:locator-users', label: 'Locator Accounts', active: view === 'settings:locator-users', onClick: () => onViewChange('settings:locator-users') },
    canView('settings:control-panel') && { key: 'settings:control-panel', label: 'Control Panel', active: view === 'settings:control-panel', onClick: () => onViewChange('settings:control-panel') },
    canView('settings:audit-log') && { key: 'settings:audit-log', label: 'Audit Log', active: view === 'settings:audit-log', onClick: () => onViewChange('settings:audit-log') },
  ].filter(Boolean) as SidebarLeaf[];

  const fileMaintenanceItems: SidebarLeaf[] = [
    canView('settings:inspection-types') && { key: 'settings:inspection-types', label: 'Inspection Types', active: view === 'settings:inspection-types', onClick: () => onViewChange('settings:inspection-types') },
    canView('settings:compliance-types') && { key: 'settings:compliance-types', label: 'Compliance Types', active: view === 'settings:compliance-types', onClick: () => onViewChange('settings:compliance-types') },
  ].filter(Boolean) as SidebarLeaf[];

  return (
    <aside
      className={cn(
        'shrink-0 pb-6 transition-[width] duration-300 ease-in-out',
        isDrawer ? 'pt-1' : 'pt-3',
        collapsed ? 'w-[88px] px-3' : 'w-64 pl-4 pr-2',
        isDrawer && 'h-full',
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
                onClick={() => onViewChange('dashboard')}
                collapsed={collapsed}
              />
            </div>
          </SidebarGroup>
          )}

          {showApplicationsMgmt && (
          <SidebarGroup title="Applications" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarSection
                icon={Briefcase}
                label="Management"
                items={applicationsItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'applications'}
                onToggle={() => toggleDropdown('applications')}
              />
            </div>
          </SidebarGroup>
          )}

          {showAssessment && (
          <SidebarGroup title="Assessment & Evaluation" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarSection
                icon={ClipboardCheck}
                label="Assessment"
                items={assessmentItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'assessment'}
                onToggle={() => toggleDropdown('assessment')}
              />
            </div>
          </SidebarGroup>
          )}

          {showApproval && (
          <SidebarGroup title="Approval & Issuance" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarSection
                icon={Stamp}
                label="Approval"
                items={approvalItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'approval'}
                onToggle={() => toggleDropdown('approval')}
              />
            </div>
          </SidebarGroup>
          )}

          {showVerification && (
          <SidebarGroup title="Verification" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarSection
                icon={FileCheck}
                label="Doc Verification"
                items={verificationItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'verification'}
                onToggle={() => toggleDropdown('verification')}
              />
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
                isOpen={openDropdownId === 'compliance-inspection'}
                onToggle={() => toggleDropdown('compliance-inspection')}
              />
              <SidebarSection
                icon={ShieldCheck}
                label="CDC/CIAC Permits"
                items={permitsItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'permits'}
                onToggle={() => toggleDropdown('permits')}
              />
              <SidebarSection
                icon={FileCheck}
                label="BIR & Tax Records"
                items={birTaxItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'bir-tax'}
                onToggle={() => toggleDropdown('bir-tax')}
              />
              <SidebarSection
                icon={CalendarClock}
                label="Expiry Calendar"
                items={expiryCalendarItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'expiry-calendar'}
                onToggle={() => toggleDropdown('expiry-calendar')}
              />
            </div>
          </SidebarGroup>
          )}

          {showOperations && (
          <SidebarGroup title="Operations" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarSection
                icon={Globe}
                label="Operations & Assets"
                items={operationsItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'operations'}
                onToggle={() => toggleDropdown('operations')}
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
                isOpen={openDropdownId === 'system-settings'}
                onToggle={() => toggleDropdown('system-settings')}
              />
              <SidebarSection
                icon={FileCheck}
                label="File Maintenance"
                items={fileMaintenanceItems}
                flat={flat}
                collapsed={collapsed}
                isOpen={openDropdownId === 'file-maintenance'}
                onToggle={() => toggleDropdown('file-maintenance')}
              />
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
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 w-full text-[var(--text-muted)] hover:text-[var(--text)] group cursor-pointer"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <LogOut size={16} className="group-hover:rotate-12 transition-transform" />
            {!collapsed && <span className="text-[13px] font-medium">Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}

