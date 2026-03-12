import React, { useEffect, useLayoutEffect, useState } from 'react';
import { AppFooter } from '../components/AppFooter';
import { AppHeader } from '../components/AppHeader';
import { AppSidebar } from '../components/AppSidebar';
import { cn } from '../lib/utils';

export type AppView = 'dashboard' | 'applications' | 'profile' | 'businesses';

type Theme = 'light' | 'dark';

const MOBILE_BREAKPOINT = 768;
const DESKTOP_BREAKPOINT = 1024; // tablet = 768..1023, desktop = 1024+

function getSidebarDefaultCollapsed(width: number) {
  if (width < MOBILE_BREAKPOINT) return true; // mobile: drawer closed
  if (width < DESKTOP_BREAKPOINT) return true; // tablet: icon-only default
  return false; // desktop: expanded default
}

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
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  );
  // On mobile: true = sidebar hidden (closed), false = sidebar open (drawer). On tablet/desktop: true = icon-only, false = expanded.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' ? getSidebarDefaultCollapsed(window.innerWidth) : true
  );

  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const desktopQuery = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const update = () => {
      const w = window.innerWidth;
      setIsMobile(w < MOBILE_BREAKPOINT);
      setSidebarCollapsed(getSidebarDefaultCollapsed(w));
    };
    mobileQuery.addEventListener('change', update);
    desktopQuery.addEventListener('change', update);
    update();
    return () => {
      mobileQuery.removeEventListener('change', update);
      desktopQuery.removeEventListener('change', update);
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  const closeSidebar = () => setSidebarCollapsed(true);
  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);
  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <div
      className={cn(
        'h-screen overflow-hidden flex flex-col font-sans selection:bg-white/10 relative',
      )}
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', transition: 'background-color 220ms ease-out, color 220ms ease-out' }}
    >
      <AppHeader onToggleSidebar={toggleSidebar} theme={theme} onToggleTheme={toggleTheme} />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile: sidebar as overlay drawer, hidden by default */}
        {isMobile ? (
          <>
            <div
              className="fixed left-0 bottom-0 z-50 w-64 max-w-[85vw] pt-1 pb-6 flex flex-col"
              style={{
                top: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
                paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))',
                transform: sidebarCollapsed ? 'translateX(-100%)' : 'translateX(0)',
                transition: 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
                willChange: 'transform',
              }}
            >
              <AppSidebar
                view={view}
                onViewChange={(v) => {
                  onViewChange(v);
                  closeSidebar();
                }}
                onLogout={onLogout}
                collapsed={false}
                variant="drawer"
              />
            </div>
          </>
        ) : (
          <AppSidebar
            view={view}
            onViewChange={onViewChange}
            onLogout={onLogout}
            collapsed={sidebarCollapsed}
          />
        )}

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 pt-6 sm:pt-8 pb-safe custom-scrollbar">
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

