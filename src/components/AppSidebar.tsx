import React from 'react';
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
          <div className="h-px w-7 rounded-full bg-zinc-800" />
        </div>
      ) : (
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{title}</p>
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
}) => (
  <button
    onClick={onClick}
    className={cn(
      'flex items-center rounded-lg transition-all duration-200 w-full group',
      collapsed ? 'justify-center px-1.5 py-2.5' : 'justify-start gap-3 px-3 py-2',
      active
        ? 'text-white shadow-sm bg-[var(--selected-bg)]'
        : 'text-secondary hover:text-zinc-100 hover:bg-[var(--selected-bg)]',
    )}
  >
    <Icon
      size={18}
      className={cn('transition-colors', active ? 'text-zinc-100' : 'text-secondary group-hover:text-zinc-200')}
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
              'transition-colors',
              active ? 'text-zinc-300/70' : 'text-zinc-500 group-hover:text-zinc-300',
            )}
          />
        )}
      </>
    )}
  </button>
);

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
          boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
        }}
      >
        <nav className={cn('flex-1 px-3 py-5 flex flex-col items-stretch', isDrawer && 'min-h-0 overflow-y-auto')}>
          <SidebarGroup title="Main" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarItem
                icon={LayoutDashboard}
                label="Overview"
                active={view === 'dashboard'}
                onClick={() => onViewChange('dashboard')}
                collapsed={collapsed}
              />
              <SidebarItem icon={Sparkles} label="AI Assistant" onClick={() => {}} collapsed={collapsed} />
              <SidebarItem icon={Users} label="Users" hasSubmenu onClick={() => {}} collapsed={collapsed} />
              <SidebarItem icon={Briefcase} label="Projects" hasSubmenu onClick={() => {}} collapsed={collapsed} />
            </div>
          </SidebarGroup>

          <SidebarGroup title="Admin" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarItem icon={Users} label="Admin Management" onClick={() => {}} collapsed={collapsed} />
              <SidebarItem icon={FileCheck} label="Admin Roles" onClick={() => {}} collapsed={collapsed} />
              <SidebarItem icon={Settings} label="Settings" onClick={() => {}} collapsed={collapsed} />
            </div>
          </SidebarGroup>

          <SidebarGroup title="Demos" collapsed={collapsed}>
            <div className="flex flex-col gap-1.5">
              <SidebarItem icon={Globe} label="UI Component" onClick={() => {}} collapsed={collapsed} />
            </div>
          </SidebarGroup>
        </nav>

        <div
          className="px-3 py-3 border-t border-zinc-800/60"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--control-bg) 60%, transparent)',
          }}
        >
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 w-full text-zinc-300 hover:text-white hover:bg-white/5 group"
          >
            <LogOut size={16} className="group-hover:rotate-12 transition-transform" />
            {!collapsed && <span className="text-[13px] font-medium">Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}

