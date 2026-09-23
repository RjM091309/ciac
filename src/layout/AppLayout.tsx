import React, { useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { AppFooter } from '../components/AppFooter';
import { AppHeader } from '../components/AppHeader';
import { AppSidebar } from '../components/AppSidebar';
import { ProponentSidebar } from '../components/proponent/ProponentSidebar';
import { ProponentBottomNav, BOTTOM_NAV_HEIGHT } from '../components/proponent/ProponentBottomNav';
import { MobileMenuSheet } from '../components/MobileMenuSheet';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { LoadingBar } from '../components/ui/LoadingBar';
import { ControlPanelAccessProvider } from '../context/ControlPanelAccessContext';
import { cn } from '../lib/utils';
import { ThemeProvider, createTheme } from '@mui/material/styles';

export type AppView =
  | 'dashboard'
  | 'applications:new'
  | 'applications:renewals'
  | 'applications:requirements'
  | 'assessment:queue'
  | 'approval:queue'
  | 'compliance:permits'
  | 'compliance:inspections'
  | 'reports:analytics'
  | 'settings:users'
  | 'settings:locator-users'
  | 'settings:proponents'
  | 'settings:requirement-categories'
  | 'settings:inspection-types'
  | 'settings:compliance-types'
  | 'settings:application-types'
  | 'settings:account-officers'
  | 'settings:type-of-contract'
  | 'settings:building'
  | 'settings:land-use'
  | 'settings:control-panel'
  | 'settings:audit-log';

type Theme = 'light' | 'dark';
type ThemeMode = 'system' | 'manual';

const MOBILE_BREAKPOINT = 768;
/**
 * Inline sidebar defaults to icon-only below this width. Matches dashboard `min-[1181px]` desktop layout.
 * iPad Pro / Safari often reports 1025–1112px instead of exactly 1024, so 1025 alone was not enough.
 */
const SIDEBAR_EXPANDED_MIN_WIDTH = 1025;

function getSidebarDefaultCollapsed(width: number) {
  if (width < MOBILE_BREAKPOINT) return true; // mobile: drawer closed
  if (width < SIDEBAR_EXPANDED_MIN_WIDTH) return true; // tablet + iPad: icon rail (collapsed)
  return false; // wide desktop: expanded by default
}

export function AppLayout({
  view,
  onViewChange,
  navigate,
  onLogout,
  userRole,
  sidebarRoleOverride,
  sidebarPermissionOverride,
  userId,
  backendUrl,
  children,
}: {
  view: string;
  onViewChange: (view: string) => void;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  onLogout: () => void;
  userRole: 'admin' | 'officer' | 'proponent';
  /** Admin-only dashboard preview: swaps which sidebar renders (e.g. to
   * ProponentSidebar) without changing the real, logged-in `userRole`. */
  sidebarRoleOverride?: 'admin' | 'officer' | 'proponent';
  /** Paired with sidebarRoleOverride === 'officer': the previewed role's
   * actual saved sidebar menu permissions, so AppSidebar shows what that
   * role really sees instead of the admin's own full access. */
  sidebarPermissionOverride?: Record<string, boolean> | null;
  userId?: number | null;
  backendUrl: string;
  children: React.ReactNode;
}) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  );
  // On mobile: true = sidebar hidden (closed), false = sidebar open (drawer). On tablet/desktop: true = icon-only, false = expanded.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' ? getSidebarDefaultCollapsed(window.innerWidth) : true
  );

  const getSystemTheme = (): Theme => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  };

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system';
    const storedMode = window.localStorage.getItem('themeMode');
    return storedMode === 'manual' ? 'manual' : 'system';
  });

  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return getSystemTheme();
  });

  useEffect(() => {
    const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const desktopQuery = window.matchMedia(`(min-width: ${SIDEBAR_EXPANDED_MIN_WIDTH}px)`);
    const update = () => {
      const w = window.innerWidth;
      setIsMobile(w < MOBILE_BREAKPOINT);
      setSidebarCollapsed(getSidebarDefaultCollapsed(w));
    };
    mobileQuery.addEventListener('change', update);
    desktopQuery.addEventListener('change', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();
    return () => {
      mobileQuery.removeEventListener('change', update);
      desktopQuery.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      if (themeMode === 'system') setTheme(getSystemTheme());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themeMode]);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem('theme', theme);
    window.localStorage.setItem('themeMode', themeMode);
  }, [theme, themeMode]);

  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const closeSidebar = () => setSidebarCollapsed(true);
  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);
  const toggleTheme = () => {
    setThemeMode('manual');
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: theme,
          primary:
            theme === 'dark'
              ? { main: '#ffffff', contrastText: '#000000' }
              : { main: '#000000', contrastText: '#ffffff' },
          background:
            theme === 'dark'
              ? { default: '#000000', paper: '#0b0b0b' }
              : { default: '#ffffff', paper: '#ffffff' },
          text:
            theme === 'dark'
              ? { primary: '#ffffff', secondary: 'rgba(255,255,255,0.72)' }
              : { primary: '#000000', secondary: 'rgba(0,0,0,0.72)' },
          divider: theme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)',
        },
        typography: {
          fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
        },
        shape: { borderRadius: 12 },
        components: {
          MuiButtonBase: {
            styleOverrides: {
              root: {
                '&:not(.Mui-disabled)': { cursor: 'pointer' },
                '&.Mui-disabled': { cursor: 'not-allowed' },
              },
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                backgroundColor: theme === 'dark' ? '#0b0b0b' : '#ffffff',
              },
              notchedOutline: {
                borderColor: theme === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)',
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: 'none',
              },
            },
          },
        },
      }),
    [theme]
  );

  // Proponents get a fixed self-service menu that doesn't depend on Control
  // Panel permissions; every other role uses the permission-gated AppSidebar.
  const effectiveSidebarRole = sidebarRoleOverride ?? userRole;
  const SidebarComponent = effectiveSidebarRole === 'proponent' ? ProponentSidebar : AppSidebar;
  // Every role gets a persistent bottom tab bar on mobile instead of relying
  // on the hamburger drawer for primary nav.
  const showBottomNav = isMobile;

  return (
    <ThemeProvider theme={muiTheme}>
      <ControlPanelAccessProvider>
      <div
        className={cn(
          // 100vh on mobile browsers is the height with the URL bar *hidden*, so
          // with it showing, the bottom of the scroll area (behind the fixed
          // bottom nav) is pushed off-screen. dvh tracks the visible viewport.
          'h-screen supports-[height:100dvh]:h-dvh overflow-hidden flex flex-col font-sans relative',
        )}
        style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', transition: 'background-color 220ms ease-out, color 220ms ease-out' }}
      >
        <LoadingBar />
        <AppHeader
          onToggleSidebar={toggleSidebar}
          theme={theme}
          onToggleTheme={toggleTheme}
          userRole={userRole}
          userId={userId}
          backendUrl={backendUrl}
        navigate={navigate}
        />

        <div className="flex-1 flex overflow-hidden relative">
          {/* Mobile: "More" opens a bottom sheet (MobileMenuSheet) instead of an inline sidebar. */}
          {isMobile ? (
            <MobileMenuSheet
              open={!sidebarCollapsed}
              onClose={closeSidebar}
              backendUrl={backendUrl}
              onOpenSettings={() => {
                closeSidebar();
                navigate('/me/profile');
              }}
            >
              <SidebarComponent
                view={view}
                onViewChange={(v) => {
                  onViewChange(v);
                  closeSidebar();
                }}
                onLogout={onLogout}
                variant="sheet"
                permissionOverride={sidebarPermissionOverride}
                accountActions={{
                  onOpenSettings: () => {
                    closeSidebar();
                    navigate('/me/profile');
                  },
                  onChangePassword: () => {
                    closeSidebar();
                    setChangePasswordOpen(true);
                  },
                }}
              />
            </MobileMenuSheet>
          ) : (
            <SidebarComponent
              view={view}
              onViewChange={onViewChange}
              onLogout={onLogout}
              collapsed={sidebarCollapsed}
              permissionOverride={sidebarPermissionOverride}
            />
          )}

          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <main
              className={cn(
                'flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 pt-6 sm:pt-8 custom-scrollbar',
                showBottomNav ? undefined : 'pb-safe',
              )}
              style={showBottomNav ? { paddingBottom: `calc(${BOTTOM_NAV_HEIGHT}px + max(1.5rem, env(safe-area-inset-bottom, 0px)))` } : undefined}
            >
              <div className="min-h-full flex flex-col">
                <div className="flex-1">{children}</div>
                <AppFooter />
              </div>
            </main>
          </div>
        </div>

        {showBottomNav && (
          <ProponentBottomNav
            role={effectiveSidebarRole}
            view={view}
            onViewChange={(v) => {
              onViewChange(v);
              closeSidebar();
            }}
            onOpenMore={toggleSidebar}
            moreOpen={!sidebarCollapsed}
            permissionOverride={sidebarPermissionOverride}
          />
        )}

        {/* Mobile drawer's Change Password (the header's own modal is
            unreachable there since its account menu is hidden below md). */}
        <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
      </div>
    </ControlPanelAccessProvider>
    </ThemeProvider>
  );
}


