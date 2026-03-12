import React, { useState } from 'react';
import {
  Briefcase,
  CalendarClock,
  ChevronRight,
  FileCheck,
  Globe,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
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
        'flex items-center rounded-lg transition-all duration-200 w-full group',
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
        'group w-full flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-lg text-[12px] hover:text-[var(--text)] transition-colors',
        active ? 'text-[var(--text)] bg-[var(--selected-bg)]' : 'text-[var(--text-muted)]',
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] group-hover:bg-[var(--text)] transition-colors" />
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

export function AppSidebar({
  view,
  onViewChange,
  onLogout,
  collapsed,
  variant = 'default',
}: {
  view: AppView;
  onViewChange: (view: AppView) => void;
  onLogout: () => void;
  collapsed?: boolean;
  variant?: 'default' | 'drawer';
}) {
  const isDrawer = variant === 'drawer';
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const toggleDropdown = (id: string) => {
    setOpenDropdownId((prev) => (prev === id ? null : id));
  };

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
        <nav className={cn('flex-1 px-3 py-5 flex flex-col items-stretch', isDrawer && 'min-h-0 overflow-y-auto')}>
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

          <SidebarGroup title="Applications" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarDropdown
                icon={Briefcase}
                label="Applications Management"
                collapsed={collapsed}
                isOpen={openDropdownId === 'applications'}
                onToggle={() => toggleDropdown('applications')}
              >
                <SidebarSubItem
                  label="New Applications"
                  active={view === 'applications:new'}
                  onClick={() => onViewChange('applications:new')}
                />
                <SidebarSubItem
                  label="Renewal Tracking"
                  active={view === 'applications:renewals'}
                  onClick={() => onViewChange('applications:renewals')}
                />
                <SidebarSubItem
                  label="Project Evaluations"
                  active={view === 'applications:projects'}
                  onClick={() => onViewChange('applications:projects')}
                />
              </SidebarDropdown>
            </div>
          </SidebarGroup>

          <SidebarGroup title="Verification" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarDropdown
                icon={FileCheck}
                label="Document Verification"
                collapsed={collapsed}
                isOpen={openDropdownId === 'verification'}
                onToggle={() => toggleDropdown('verification')}
              >
                <SidebarSubItem
                  label="Pending Review"
                  active={view === 'verification:pending'}
                  onClick={() => onViewChange('verification:pending')}
                />
                <SidebarSubItem
                  label="Audit Trail"
                  active={view === 'verification:audit'}
                  onClick={() => onViewChange('verification:audit')}
                />
              </SidebarDropdown>
            </div>
          </SidebarGroup>

          <SidebarGroup title="Directory" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarDropdown
                icon={Users}
                label="Proponent Directory"
                collapsed={collapsed}
                isOpen={openDropdownId === 'directory'}
                onToggle={() => toggleDropdown('directory')}
              >
                <SidebarSubItem
                  label="Company Profiles"
                  active={view === 'directory:companies'}
                  onClick={() => onViewChange('directory:companies')}
                />
                <SidebarSubItem
                  label="Key Officers & Stakeholders"
                  active={view === 'directory:officers'}
                  onClick={() => onViewChange('directory:officers')}
                />
                <SidebarSubItem
                  label="Site Development Plans"
                  active={view === 'directory:site-plans'}
                  onClick={() => onViewChange('directory:site-plans')}
                />
              </SidebarDropdown>
            </div>
          </SidebarGroup>

          <SidebarGroup title="Compliance & Permits" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarDropdown
                icon={ShieldCheck}
                label="CDC/CIAC Permits"
                collapsed={collapsed}
                isOpen={openDropdownId === 'permits'}
                onToggle={() => toggleDropdown('permits')}
              >
                <SidebarSubItem
                  label="Environmental, Fire, Occupancy, Sanitary"
                  active={view === 'compliance:permits'}
                  onClick={() => onViewChange('compliance:permits')}
                />
                <SidebarSubItem
                  label="Authority to Operate"
                  active={view === 'compliance:permits'}
                  onClick={() => onViewChange('compliance:permits')}
                />
              </SidebarDropdown>
              <SidebarDropdown
                icon={FileCheck}
                label="BIR & Tax Records"
                collapsed={collapsed}
                isOpen={openDropdownId === 'bir-tax'}
                onToggle={() => toggleDropdown('bir-tax')}
              >
                <SidebarSubItem
                  label="BIR Tax Clearance"
                  active={view === 'compliance:bir'}
                  onClick={() => onViewChange('compliance:bir')}
                />
                <SidebarSubItem
                  label="Certificate of Registration"
                  active={view === 'compliance:bir'}
                  onClick={() => onViewChange('compliance:bir')}
                />
                <SidebarSubItem
                  label="Receipts / Invoices / ATP"
                  active={view === 'compliance:bir'}
                  onClick={() => onViewChange('compliance:bir')}
                />
                <SidebarSubItem
                  label="POS / CRM Permit"
                  active={view === 'compliance:bir'}
                  onClick={() => onViewChange('compliance:bir')}
                />
              </SidebarDropdown>
              <SidebarDropdown
                icon={CalendarClock}
                label="Expiry Calendar"
                collapsed={collapsed}
                isOpen={openDropdownId === 'expiry-calendar'}
                onToggle={() => toggleDropdown('expiry-calendar')}
              >
                <SidebarSubItem
                  label="Expiring Permits"
                  active={view === 'compliance:expiry'}
                  onClick={() => onViewChange('compliance:expiry')}
                />
              </SidebarDropdown>
            </div>
          </SidebarGroup>

          <SidebarGroup title="Operations" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarDropdown
                icon={Globe}
                label="Operations & Assets"
                collapsed={collapsed}
                isOpen={openDropdownId === 'operations'}
                onToggle={() => toggleDropdown('operations')}
              >
                <SidebarSubItem
                  label="Production Flowcharts"
                  active={view === 'operations:flowcharts'}
                  onClick={() => onViewChange('operations:flowcharts')}
                />
                <SidebarSubItem
                  label="Brochures & Marketing"
                  active={view === 'operations:brochures'}
                  onClick={() => onViewChange('operations:brochures')}
                />
                <SidebarSubItem
                  label="GAD Programs"
                  active={view === 'operations:gad'}
                  onClick={() => onViewChange('operations:gad')}
                />
              </SidebarDropdown>
            </div>
          </SidebarGroup>

          <SidebarGroup title="System" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarDropdown
                icon={Settings}
                label="System Settings"
                collapsed={collapsed}
                isOpen={openDropdownId === 'system-settings'}
                onToggle={() => toggleDropdown('system-settings')}
              >
                <SidebarSubItem
                  label="User Management"
                  active={view === 'settings:users'}
                  onClick={() => onViewChange('settings:users')}
                />
                <SidebarSubItem
                  label="Master Checklist"
                  active={view === 'settings:checklist'}
                  onClick={() => onViewChange('settings:checklist')}
                />
              </SidebarDropdown>
            </div>
          </SidebarGroup>
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
            className="flex items-center justify-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 w-full text-[var(--text-muted)] hover:text-[var(--text)] group"
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

