import React, { useState } from 'react';
import {
  Briefcase,
  ChevronRight,
  FileCheck,
  Globe,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { cn } from '../lib/utils';

type View = 'dashboard' | 'applications' | 'profile' | 'businesses';

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
}: {
  label: string;
  onClick?: () => void;
}) => {
  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-lg text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
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
  view: View;
  onViewChange: (view: View) => void;
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
          <SidebarGroup title="Application" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarItem
                icon={LayoutDashboard}
                label="Application Overview"
                active={view === 'dashboard'}
                onClick={() => onViewChange('dashboard')}
                collapsed={collapsed}
              />
              <SidebarDropdown
                icon={Users}
                label="Proponent"
                collapsed={collapsed}
                isOpen={openDropdownId === 'proponent'}
                onToggle={() => toggleDropdown('proponent')}
              >
                <SidebarSubItem label="Letter of Intent (LOI)" />
                <SidebarSubItem label="Company Profile" />
                <SidebarSubItem label="Board Resolution" />
                <SidebarSubItem label="Business Registration" />
                <SidebarSubItem label="Resume & IDs" />
              </SidebarDropdown>
              <SidebarDropdown
                icon={FileCheck}
                label="Financial Documents"
                collapsed={collapsed}
                isOpen={openDropdownId === 'financial'}
                onToggle={() => toggleDropdown('financial')}
              >
                <SidebarSubItem label="AFS" />
                <SidebarSubItem label="Financial Capability" />
                <SidebarSubItem label="Bank Certification" />
              </SidebarDropdown>
              <SidebarDropdown
                icon={Briefcase}
                label="Property"
                collapsed={collapsed}
                isOpen={openDropdownId === 'property'}
                onToggle={() => toggleDropdown('property')}
              >
                <SidebarSubItem label="Project Evaluation" />
                <SidebarSubItem label="Site Dev" />
                <SidebarSubItem label="Production Process" />
              </SidebarDropdown>
            </div>
          </SidebarGroup>

          <SidebarGroup title="Compliance" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarDropdown
                icon={FileCheck}
                label="BIR Documents"
                collapsed={collapsed}
                isOpen={openDropdownId === 'bir'}
                onToggle={() => toggleDropdown('bir')}
              >
                <SidebarSubItem label="BIR Tax Clearance" />
                <SidebarSubItem label="Certificate" />
                <SidebarSubItem label="Receipts / Invoices / ATP" />
                <SidebarSubItem label="POS / CRM Permit" />
              </SidebarDropdown>
              <SidebarDropdown
                icon={Settings}
                label="CDC Permits"
                collapsed={collapsed}
                isOpen={openDropdownId === 'cdc'}
                onToggle={() => toggleDropdown('cdc')}
              >
                <SidebarSubItem label="Environmental Compliance" />
                <SidebarSubItem label="Fire Safety Inspection" />
                <SidebarSubItem label="Annual Inspection" />
                <SidebarSubItem label="Sanitary Permit" />
                <SidebarSubItem label="Authority to Operate" />
                <SidebarSubItem label="Other Licenses" />
              </SidebarDropdown>
              <SidebarDropdown
                icon={Globe}
                label="Supporting Docs"
                collapsed={collapsed}
                isOpen={openDropdownId === 'supporting'}
                onToggle={() => toggleDropdown('supporting')}
              >
                <SidebarSubItem label="Brochures" />
                <SidebarSubItem label="Gender & Development" />
              </SidebarDropdown>
            </div>
          </SidebarGroup>

          <SidebarGroup title="Access Control" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarDropdown
                icon={Users}
                label="User Management"
                collapsed={collapsed}
                isOpen={openDropdownId === 'user-management'}
                onToggle={() => toggleDropdown('user-management')}
              >
                <SidebarSubItem label="All Users" />
                <SidebarSubItem label="Pending Approvals" />
                <SidebarSubItem label="Deactivated Users" />
              </SidebarDropdown>
              <SidebarDropdown
                icon={Sparkles}
                label="Roles & Access"
                collapsed={collapsed}
                isOpen={openDropdownId === 'roles-access'}
                onToggle={() => toggleDropdown('roles-access')}
              >
                <SidebarSubItem label="Role Definitions" />
                <SidebarSubItem label="Permissions Matrix" />
                <SidebarSubItem label="Audit Logs" />
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

