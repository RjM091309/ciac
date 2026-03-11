import React, { useState } from 'react';
import { AppFooter } from '../components/AppFooter';
import { AppHeader } from '../components/AppHeader';
import { AppSidebar } from '../components/AppSidebar';

export type AppView = 'dashboard' | 'applications' | 'profile' | 'businesses';

export function AppLayout({
  view,
  onViewChange,
  onLogout,
  children,
}: {
  view: AppView;
  onViewChange: (view: AppView) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className="h-screen overflow-hidden flex flex-col text-zinc-100 font-sans selection:bg-white/10 relative"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <AppHeader onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)} />

      <div className="flex-1 flex overflow-hidden">
        <AppSidebar
          view={view}
          onViewChange={onViewChange}
          onLogout={onLogout}
          collapsed={sidebarCollapsed}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-y-auto pl-3 pr-4 pt-8 custom-scrollbar">
            <div className="min-h-full flex flex-col">
              <div className="flex-1">{children}</div>
              <AppFooter />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

