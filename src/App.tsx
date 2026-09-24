import React, { useCallback, useEffect, useMemo, useState, Suspense, lazy } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AppLayout, AppView } from './layout/AppLayout';
import { SubHeader, type DashboardPreviewRole } from './components/SubHeader';
import { FileCheck, FolderTree, ShieldCheck, Users, Loader2, Search, BarChart3 } from 'lucide-react';
import { LoginPage } from './components/auth/LoginPage';
import { LocatorProfileSetup } from './components/proponent/LocatorProfileSetup';
import { locatorSetupSkipKey } from './lib/locatorSetup';
import { DataTableControls } from './components/ui/DataTableControls';
import { PageSkeleton } from './components/ui/PageSkeleton';
import { Toaster } from 'sonner';
import { useIdleSession } from './lib/idleSession';

const RoleDashboard = lazy(() => import('./components/dashboard/RoleDashboard').then((m) => ({ default: m.RoleDashboard })));
const PreviewDashboard = lazy(() => import('./components/dashboard/PreviewDashboard').then((m) => ({ default: m.PreviewDashboard })));
const ProponentProfile = lazy(() => import('./components/proponent/ProponentProfile').then((m) => ({ default: m.ProponentProfile })));
const ProponentApplications = lazy(() => import('./components/proponent/ProponentApplications').then((m) => ({ default: m.ProponentApplications })));
const ProponentContractsPermits = lazy(() => import('./components/proponent/ProponentContractsPermits').then((m) => ({ default: m.ProponentContractsPermits })));
const ProponentActivity = lazy(() => import('./components/proponent/ProponentActivity').then((m) => ({ default: m.ProponentActivity })));
const PermitsManagement = lazy(() => import('./components/compliance/PermitsManagement').then((m) => ({ default: m.PermitsManagement })));
const UsersManagement = lazy(() => import('./components/settings/UsersManagement').then((m) => ({ default: m.UsersManagement })));
const LocatorUsersManagement = lazy(() => import('./components/settings/LocatorUsersManagement').then((m) => ({ default: m.LocatorUsersManagement })));
const ControlPanelManagement = lazy(() => import('./components/settings/ControlPanelManagement').then((m) => ({ default: m.ControlPanelManagement })));
const ProponentsManagement = lazy(() => import('./components/proponent/ProponentsManagement').then((m) => ({ default: m.ProponentsManagement })));
const RequirementsManagement = lazy(() => import('./components/applications/Requirements').then((m) => ({ default: m.RequirementsManagement })));
const RequirementCategoriesManagement = lazy(() => import('./components/applications/RequirementCategories').then((m) => ({ default: m.RequirementCategoriesManagement })));
const ApplicationsWorkflow = lazy(() => import('./components/applications/ApplicationsWorkflow').then((m) => ({ default: m.ApplicationsWorkflow })));
const AssessmentEvaluation = lazy(() => import('./components/assessment/AssessmentEvaluation').then((m) => ({ default: m.AssessmentEvaluation })));
const ApprovalIssuance = lazy(() => import('./components/approval/ApprovalIssuance').then((m) => ({ default: m.ApprovalIssuance })));
const ComplianceInspections = lazy(() => import('./components/compliance/ComplianceInspections').then((m) => ({ default: m.ComplianceInspections })));
const InspectionTypesManagement = lazy(() => import('./components/FileMaintenance/InspectionTypes').then((m) => ({ default: m.InspectionTypesManagement })));
const ComplianceTypesManagement = lazy(() => import('./components/FileMaintenance/ComplianceTypes').then((m) => ({ default: m.ComplianceTypesManagement })));
const ApplicationTypesManagement = lazy(() => import('./components/FileMaintenance/ApplicationTypes').then((m) => ({ default: m.ApplicationTypesManagement })));
const AccountOfficersManagement = lazy(() => import('./components/FileMaintenance/AccountOfficers').then((m) => ({ default: m.AccountOfficersManagement })));
const TypeOfContractManagement = lazy(() => import('./components/FileMaintenance/TypeOfContract').then((m) => ({ default: m.TypeOfContractManagement })));
const BuildingManagement = lazy(() => import('./components/FileMaintenance/Building').then((m) => ({ default: m.BuildingManagement })));
const LandUseManagement = lazy(() => import('./components/FileMaintenance/LandUse').then((m) => ({ default: m.LandUseManagement })));
const AuditLog = lazy(() => import('./components/settings/AuditLog').then((m) => ({ default: m.AuditLog })));
const ReportsAnalytics = lazy(() => import('./components/reports/ReportsAnalytics').then((m) => ({ default: m.ReportsAnalytics })));

/** "New Application" no longer has its own page — a locator account and its
 * one application are created together on Locator Accounts now — so any
 * remaining link/bookmark/deep-link to it (Search's "in_new" bucket,
 * Dashboard cards, old notification links) lands here and gets sent to the
 * page that actually replaced it, instead of a dead/blank view. */
function RedirectToLocatorAccounts({ navigate }: { navigate: (to: string, opts?: { replace?: boolean }) => void }) {
  useEffect(() => {
    navigate('/applications/locator-users', { replace: true });
  }, [navigate]);
  return null;
}

// --- Types ---
type Role = 'admin' | 'officer' | 'proponent';

function normalizeRole(value: unknown): Role {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'admin' || role === 'officer' || role === 'proponent') return role;
  // Custom roles created via Role Management don't fit this 3-value UI type.
  // Falling back to 'admin' here would silently grant admin-level treatment
  // (e.g. notification targeting) to any role the admin didn't literally name
  // "admin" — default to the least-privileged known value instead.
  return 'officer';
}

interface UserData {
  id: number;
  username: string;
  role: Role;
  /** The literal Control-Panel role name (e.g. "ACCOUNT OFFICER"), before
   * `normalizeRole()` collapses it into the 3-value `role` above — needed
   * wherever behavior depends on the specific custom role, not just the
   * coarse admin/officer/proponent split. */
  roleName: string;
}

const VIEW_TO_PATH: Record<AppView, string> = {
  dashboard: '/dashboard',
  'applications:new': '/applications/new',
  'applications:renewals': '/applications/renewals',
  'applications:requirements': '/applications/requirements',
  'assessment:queue': '/assessment',
  'approval:queue': '/approval',
  'compliance:permits': '/compliance/permits',
  'compliance:inspections': '/compliance/inspections',
  'reports:analytics': '/reports/analytics',
  'settings:users': '/settings/users',
  'settings:locator-users': '/applications/locator-users',
  'settings:proponents': '/applications/proponents',
  'settings:requirement-categories': '/settings/requirement-categories',
  'settings:inspection-types': '/settings/inspection-types',
  'settings:compliance-types': '/settings/compliance-types',
  'settings:application-types': '/settings/application-types',
  'settings:account-officers': '/settings/account-officers',
  'settings:type-of-contract': '/settings/type-of-contract',
  'settings:building': '/settings/building',
  'settings:land-use': '/settings/land-use',
  'settings:audit-log': '/settings/audit-log',
  'settings:control-panel': '/settings/control-panel',
};

const PATH_TO_VIEW = Object.entries(VIEW_TO_PATH).reduce(
  (acc, [view, routePath]) => {
    acc[routePath] = view as AppView;
    return acc;
  },
  {} as Record<string, AppView>
);

// --- Proponent self-service portal (separate from the permission-gated AppView set) ---
type ProponentView = 'dashboard' | 'me:profile' | 'me:applications' | 'me:contracts-permits' | 'me:activity';

const PROPONENT_VIEW_TO_PATH: Record<ProponentView, string> = {
  dashboard: '/dashboard',
  'me:profile': '/me/profile',
  'me:applications': '/me/applications',
  'me:contracts-permits': '/me/contracts-permits',
  'me:activity': '/me/activity',
};

const PROPONENT_PATH_TO_VIEW: Record<string, ProponentView> = Object.entries(PROPONENT_VIEW_TO_PATH).reduce(
  (acc, [view, routePath]) => {
    acc[routePath] = view as ProponentView;
    return acc;
  },
  {} as Record<string, ProponentView>
);

const PROPONENT_SUBHEADER: Record<ProponentView, { title: string; description: string; badge: string }> = {
  dashboard: {
    title: 'Dashboard',
    description: 'Your lease applications and requirement status at a glance.',
    badge: 'Overview',
  },
  'me:profile': {
    title: 'My Business Profile',
    description: 'Your registered business information and contact details on file with 3CORE.',
    badge: 'Profile',
  },
  'me:applications': {
    title: 'My Applications',
    description: 'Track the status, requirements, documents, and contract of each lease application.',
    badge: 'Applications',
  },
  'me:contracts-permits': {
    title: 'Contracts & Permits',
    description: 'Your executed lease contracts and the permits on record with 3CORE.',
    badge: 'Compliance',
  },
  'me:activity': {
    title: 'Activity History',
    description: 'A record of sign-ins and changes to your account and business profile.',
    badge: 'Activity',
  },
};

// --- Main App ---

export default function App() {
  const backendUrl = useMemo(() => {
    const env = (import.meta as any).env ?? {};
    // Dev server: always same-origin /api. Vite proxies it to VITE_BACKEND_URL
    // (see vite.config.ts), so the auth cookie is first-party whether the page
    // is opened via localhost, a LAN IP (http://192.168.x.x:2500) or another
    // device — calling the backend directly would make the cookie cross-site
    // (and "localhost" would point at the phone itself).
    if (env.DEV) return '';
    return (env.VITE_BACKEND_URL as string) || 'http://localhost:3100';
  }, []);

  const [locationState, setLocationState] = useState<{ pathname: string; search: string }>(() => ({
    pathname: window.location.pathname || '/',
    search: window.location.search || '',
  }));
  const path = locationState.pathname;
  const locationSearch = locationState.search;
  const navigate = useMemo(() => {
    return (to: string, opts?: { replace?: boolean }) => {
      const next = to.startsWith('/') ? to : `/${to}`;
      const nextUrl = new URL(next, window.location.origin);
      const nextHref = `${nextUrl.pathname}${nextUrl.search}`;
      if (opts?.replace) window.history.replaceState({}, '', nextHref);
      else window.history.pushState({}, '', nextHref);
      setLocationState({
        pathname: nextUrl.pathname || '/',
        search: nextUrl.search || '',
      });
    };
  }, []);

  const [user, setUser] = useState<UserData | null>(null);
  const [authState, setAuthState] = useState<'authed' | 'guest'>('guest');
  // Shown on the login screen after an automatic sign-out (idle timeout).
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [view, setView] = useState<AppView>('dashboard');
  const [proponentView, setProponentView] = useState<ProponentView>('dashboard');
  const [dashboardPreviewRole, setDashboardPreviewRole] = useState<DashboardPreviewRole>('admin');
  // While the admin is previewing "Account Officer" or "Locator", the sidebar
  // itself swaps to that role's actual saved Control Panel sidebar
  // permissions — otherwise the admin's own full sidebar keeps showing
  // underneath the preview, which is what made the preview feel fake.
  const [previewSidebarPermissions, setPreviewSidebarPermissions] = useState<Record<string, boolean> | null>(null);
  // The Locator preview's sidebar clicks stay local to this sub-view instead
  // of driving the admin's own `view`/URL — those self-service screens are
  // scoped to a real locator's own record server-side, so there's no route
  // for an admin session to land on; see the preview placeholder below.
  const [previewProponentView, setPreviewProponentView] = useState<ProponentView>('dashboard');
  // Populates the dashboard preview switcher's dynamic staff tabs (everything
  // besides the fixed Administrator/Locator ones) from the live Roles table,
  // so a newly-added custom role (e.g. "Assessment Officer") shows up there
  // on its own — no code change needed per role.
  const [previewStaffRoles, setPreviewStaffRoles] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    if (user?.role !== 'admin') {
      setPreviewStaffRoles([]);
      return;
    }
    let cancelled = false;
    fetch('/api/roles', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const rows = Array.isArray(json?.data) ? json.data : [];
        const staff = rows
          .filter((r: any) => {
            const name = String(r?.name || '').trim().toLowerCase();
            return name && name !== 'admin' && name !== 'proponent';
          })
          .map((r: any) => ({ id: Number(r.id), name: String(r.name) }));
        setPreviewStaffRoles(staff);
      })
      .catch(() => {
        if (!cancelled) setPreviewStaffRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  useEffect(() => {
    setPreviewProponentView('dashboard');
    if (dashboardPreviewRole === 'admin') {
      setPreviewSidebarPermissions(null);
      return;
    }
    let cancelled = false;
    // dashboardPreviewRole is either 'proponent' or a staff role's numeric id
    // (as a string, from /api/roles — see previewStaffRoles below), passed
    // straight through rather than mapped from a small hardcoded set.
    fetch(`/api/dashboard/preview/${encodeURIComponent(dashboardPreviewRole)}`, { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        (json?.sidebarPermissions || []).forEach((row: any) => {
          map[String(row.menu_key)] = Number(row.is_enabled) === 1 || row.is_enabled === true;
        });
        setPreviewSidebarPermissions(map);
      })
      .catch(() => {
        if (!cancelled) setPreviewSidebarPermissions({});
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardPreviewRole]);

  const isProponent = user?.role === 'proponent';

  // First-login gate: a real Locator with no business profile yet sees only
  // the setup wizard (LocatorProfileSetup) instead of the portal, until they
  // declare their own business info — an officer/admin only ever creates the
  // login account, not the business record, so nobody else fills this in for
  // them. `null` = not applicable / not checked yet; checked once per login.
  const [proponentSetupComplete, setProponentSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isProponent || !user?.id) {
      setProponentSetupComplete(null);
      return;
    }
    // "Skip for now" is a per-browser dismissal (no backend flag) — a fresh
    // browser/device still gets prompted once, which is fine for a one-time
    // "fill this in later" nudge rather than a hard gate.
    try {
      if (window.localStorage.getItem(locatorSetupSkipKey(user.id)) === '1') {
        setProponentSetupComplete(true);
        return;
      }
    } catch {
      // localStorage unavailable — fall through to the real check
    }
    let cancelled = false;
    setProponentSetupComplete(null);
    fetch('/api/proponents/me/setup-status', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setProponentSetupComplete(json?.success ? Boolean(json.setupComplete) : true);
      })
      .catch(() => {
        if (!cancelled) setProponentSetupComplete(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isProponent, user?.id]);

  useEffect(() => {
    const onPop = () =>
      setLocationState({
        pathname: window.location.pathname || '/',
        search: window.location.search || '',
      });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    // Keep URL and view in sync (minimal router)
    if (isProponent) {
      setProponentView(PROPONENT_PATH_TO_VIEW[path] || 'dashboard');
      return;
    }
    if (path === '/' || path === '') {
      setView('dashboard');
      return;
    }
    const nextView = PATH_TO_VIEW[path];
    if (nextView) {
      setView(nextView);
      return;
    }
    // Fallback: unknown route -> dashboard
    setView('dashboard');
  }, [path, isProponent]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const primaryUrl = `${String(backendUrl).replace(/\/+$/, '')}/api/auth/check`;
        let res = await fetch(primaryUrl, { credentials: 'include' });
        if (!res.ok) {
          res = await fetch('/api/auth/check', { credentials: 'include' });
        }
        const json = await res.json().catch(() => ({} as any));
        if (cancelled) return;
        if (res.ok && json?.authenticated) {
          const u = json?.user || {};
          setUser({
            id: Number(u.id || 0),
            username: String(u.username || ''),
            role: normalizeRole(u.role),
            roleName: String(u.role || ''),
          });
          setAuthState('authed');
          return;
        }
      } catch {
        // ignore (stay guest)
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  const logout = useCallback(
    async (notice?: string) => {
      try {
        const primaryUrl = `${String(backendUrl).replace(/\/+$/, '')}/api/auth/logout`;
        let res = await fetch(primaryUrl, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
          });
        }
      } catch {
        // ignore
      } finally {
        setUser(null);
        setAuthState('guest');
        setLoginNotice(notice ?? null);
        navigate('/', { replace: true });
      }
    },
    [backendUrl, navigate]
  );

  useIdleSession({
    enabled: authState === 'authed',
    backendUrl,
    onSignedOut: (reason) =>
      logout(
        reason === 'idle'
          ? 'You were signed out after 15 minutes of inactivity.'
          : 'Your session has ended. Please sign in again.'
      ),
  });

  useEffect(() => {
    // Once authenticated, default landing should be /dashboard
    if (authState === 'authed' && (path === '/' || path === '')) {
      navigate('/dashboard', { replace: true });
    }
  }, [authState, navigate, path]);

  const handleViewChange = useMemo(() => {
    return (nextView: string) => {
      setView(nextView as AppView);
      const targetPath = VIEW_TO_PATH[nextView as AppView] || '/dashboard';
      if (targetPath !== path) {
        navigate(targetPath);
      }
    };
  }, [navigate, path]);

  const handleProponentViewChange = useMemo(() => {
    return (nextView: string) => {
      setProponentView(nextView as ProponentView);
      const targetPath = PROPONENT_VIEW_TO_PATH[nextView as ProponentView] || '/dashboard';
      if (targetPath !== path) {
        navigate(targetPath);
      }
    };
  }, [navigate, path]);

  if (authState === 'guest') {
    const resetToken = path === '/reset-password' ? new URLSearchParams(locationSearch).get('token') : null;
    return (
      <LoginPage
        backendUrl={backendUrl}
        resetToken={resetToken}
        notice={loginNotice}
        onResetHandled={() => navigate('/', { replace: true })}
        onLoggedIn={(u) => {
          setUser({ id: u.id, username: u.username, role: normalizeRole(u.role), roleName: String(u.role || '') });
          setAuthState('authed');
          setLoginNotice(null);
          navigate('/dashboard');
        }}
      />
    );
  }

  if (isProponent && proponentSetupComplete === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ backgroundColor: 'var(--background)' }}>
        <Loader2 className="h-8 w-8 animate-spin text-secondary opacity-50" />
      </div>
    );
  }

  if (isProponent && proponentSetupComplete === false) {
    return (
      <LocatorProfileSetup
        onComplete={() => setProponentSetupComplete(true)}
        onSkip={() => {
          if (user?.id) {
            try {
              window.localStorage.setItem(locatorSetupSkipKey(user.id), '1');
            } catch {
              // ignore — worst case, they're prompted again next login
            }
          }
          setProponentSetupComplete(true);
        }}
      />
    );
  }

  return (
    <>
      {/* expand: sonner collapses multiple simultaneous toasts into a stack
          with only the front one fully visible (rest peek behind until
          hovered). theme: always light (light green/red richColors toasts),
          regardless of the page's light/dark mode. Default z-index (sonner's own, way above every modal) — this
          is the shared instance every plain toast.success()/toast.error()
          call in the app renders into, and those are direct feedback for
          whatever the user just did (e.g. Save inside an open modal), so
          they must stay visible even with a modal open. */}
      <Toaster
        richColors
        position="top-right"
        expand
        theme="light"
        duration={6000}
        toastOptions={{
          style: { fontSize: '14px', padding: '14px 16px', lineHeight: 1.45 },
          classNames: { title: 'font-semibold' },
        }}
      />
      {/* Second, separate instance — only locator-triggered event toasts
          (tagged with toasterId: 'locator-events' in AppHeader.tsx) render
          here, never the app's regular success/error toasts. Its lower
          z-index (index.css, scoped to .locator-events-toaster) is what
          lets an open modal's own backdrop cover it — a background
          "a locator did something" ping shouldn't float on top of a modal
          the officer has open, unlike the Toaster above. theme: always
          light, same as the Toaster above. */}
      <Toaster
        id="locator-events"
        className="locator-events-toaster"
        richColors
        position="bottom-right"
        expand
        theme="light"
      />
      <AppLayout
        view={
          isProponent
            ? proponentView
            : dashboardPreviewRole === 'proponent'
              ? previewProponentView
              : view
        }
        onViewChange={
          isProponent
            ? handleProponentViewChange
            : dashboardPreviewRole === 'proponent'
              ? (v: string) => setPreviewProponentView(v as ProponentView)
              : handleViewChange
        }
        navigate={navigate}
        userRole={user?.role || 'officer'}
        sidebarRoleOverride={
          isProponent
            ? undefined
            : dashboardPreviewRole === 'proponent'
              ? 'proponent'
              : dashboardPreviewRole === 'admin'
                ? undefined
                // Any other staff role — Officer, Account Officer, Assessment
                // Officer, or any future custom role — shares the same
                // permission-gated AppSidebar; only sidebarPermissionOverride
                // below (that role's own Control Panel settings) changes what
                // it actually shows.
                : 'officer'
        }
        sidebarPermissionOverride={dashboardPreviewRole !== 'admin' ? previewSidebarPermissions : null}
        userId={user?.id ?? null}
        backendUrl={backendUrl}
        onLogout={() => logout()}
      >
        {isProponent ? (
          <SubHeader
            title={PROPONENT_SUBHEADER[proponentView].title}
            description={PROPONENT_SUBHEADER[proponentView].description}
            badge={PROPONENT_SUBHEADER[proponentView].badge}
          />
        ) : view === 'dashboard' ? (
          <SubHeader
            previewRole={dashboardPreviewRole}
            onPreviewRoleChange={user?.role === 'admin' ? setDashboardPreviewRole : undefined}
            previewStaffRoles={previewStaffRoles}
          />
        ) : (
          <SubHeader
            title={LANDING_CONFIG[view].title}
            description={LANDING_CONFIG[view].description}
            badge={LANDING_CONFIG[view].badge}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={
              isProponent
                ? `me-${proponentView}`
                : view === 'dashboard'
                  ? `dashboard-${dashboardPreviewRole}-${dashboardPreviewRole === 'proponent' ? previewProponentView : ''}`
                  : view
            }
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25, ease: [0.22, 0.8, 0.35, 1] }}
            className="h-full"
          >
            <Suspense fallback={<PageSkeleton />}>
              {isProponent ? (
                proponentView === 'me:profile' ? (
                  <ProponentProfile />
                ) : proponentView === 'me:applications' ? (
                  <ProponentApplications locationSearch={locationSearch} navigate={navigate} />
                ) : proponentView === 'me:contracts-permits' ? (
                  <ProponentContractsPermits navigate={navigate} />
                ) : proponentView === 'me:activity' ? (
                  <ProponentActivity />
                ) : (
                  <RoleDashboard navigate={navigate} />
                )
              ) : view === 'dashboard' ? (
                dashboardPreviewRole === 'admin' ? (
                  <RoleDashboard navigate={navigate} />
                ) : dashboardPreviewRole === 'proponent' && previewProponentView === 'me:profile' ? (
                  <ProponentProfile />
                ) : dashboardPreviewRole === 'proponent' && previewProponentView === 'me:applications' ? (
                  <ProponentApplications locationSearch={locationSearch} navigate={navigate} />
                ) : dashboardPreviewRole === 'proponent' && previewProponentView === 'me:contracts-permits' ? (
                  <ProponentContractsPermits navigate={navigate} />
                ) : dashboardPreviewRole === 'proponent' && previewProponentView === 'me:activity' ? (
                  <ProponentActivity />
                ) : (
                  <PreviewDashboard role={dashboardPreviewRole} navigate={navigate} />
                )
              ) : view === 'settings:users' ? (
                <UsersManagement navigate={navigate} />
              ) : view === 'settings:locator-users' ? (
                <LocatorUsersManagement locationSearch={locationSearch} navigate={navigate} />
              ) : view === 'applications:new' ? (
                <RedirectToLocatorAccounts navigate={navigate} />
              ) : view === 'applications:renewals' ? (
                <ApplicationsWorkflow renewalMode={true} locationSearch={locationSearch} navigate={navigate} />
              ) : view === 'applications:requirements' ? (
                <RequirementsManagement />
              ) : view === 'assessment:queue' ? (
                <AssessmentEvaluation locationSearch={locationSearch} navigate={navigate} />
              ) : view === 'approval:queue' ? (
                <ApprovalIssuance locationSearch={locationSearch} navigate={navigate} />
              ) : view === 'compliance:inspections' ? (
                <ComplianceInspections locationSearch={locationSearch} navigate={navigate} />
              ) : view === 'reports:analytics' ? (
                <ReportsAnalytics navigate={navigate} />
              ) : view === 'settings:proponents' ? (
                <ProponentsManagement locationSearch={locationSearch} navigate={navigate} currentUserRoleName={user?.roleName} />
              ) : view === 'settings:requirement-categories' ? (
                <RequirementCategoriesManagement />
              ) : view === 'settings:inspection-types' ? (
                <InspectionTypesManagement />
              ) : view === 'settings:compliance-types' ? (
                <ComplianceTypesManagement />
              ) : view === 'settings:application-types' ? (
                <ApplicationTypesManagement />
              ) : view === 'settings:account-officers' ? (
                <AccountOfficersManagement />
              ) : view === 'settings:type-of-contract' ? (
                <TypeOfContractManagement />
              ) : view === 'settings:building' ? (
                <BuildingManagement />
              ) : view === 'settings:land-use' ? (
                <LandUseManagement />
              ) : view === 'settings:audit-log' ? (
                <AuditLog />
              ) : view === 'settings:control-panel' ? (
                <ControlPanelManagement locationSearch={locationSearch} />
              ) : view === 'compliance:permits' ? (
                <PermitsManagement locationSearch={locationSearch} navigate={navigate} />
              ) : (
                <SectionLanding view={view} />
              )}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </AppLayout>
    </>
  );
}

type LandingConfig = {
  title: string;
  description: string;
  badge: string;
  icon: any;
  stats: { label: string; value: string; hint?: string }[];
  table: {
    columns: string[];
    rows: (string | number)[][];
  };
};

const LANDING_CONFIG: Record<AppView, LandingConfig> = {
  dashboard: {
    title: 'Dashboard',
    description: 'High-level overview of applications, permits, and daily tasks.',
    badge: 'Overview',
    icon: FolderTree,
    stats: [],
    table: { columns: [], rows: [] },
  },
  'applications:new': {
    title: 'Applications',
    description: 'File, track, and manage lease applications for locators.',
    badge: 'Applications',
    icon: FileCheck,
    stats: [
      { label: 'Total New Applications', value: '18', hint: 'Last 30 days' },
      { label: 'Pending Screening', value: '7', hint: ' LOI received, docs incomplete' },
      { label: 'For Board Evaluation', value: '3' },
    ],
    table: {
      columns: ['Locator', 'Project', 'Submitted', 'Missing Docs', 'Status'],
      rows: [
        ['SkyPort Logistics Inc.', 'Cargo Hub Expansion', 'Mar 10, 2026', 'AFS, Bank Cert', 'Pending Verification'],
        ['GreenFuel Terminals Corp.', 'Fuel Depot Lease', 'Mar 09, 2026', 'Board Resolution', 'For Evaluation'],
        ['Atlas Aero Parts', 'Hangar Lease', 'Mar 05, 2026', 'None', 'Ready for Board'],
      ],
    },
  },
  'applications:renewals': {
    title: 'Renewal Tracking',
    description: 'Existing locators with lease agreements due for renewal.',
    badge: 'Renewals',
    icon: FileCheck,
    stats: [
      { label: 'Renewals This Year', value: '32' },
      { label: 'Expiring in 90 Days', value: '6' },
      { label: 'With Pending Requirements', value: '4' },
    ],
    table: {
      columns: ['Locator', 'Lease No.', 'Expiry', 'Days Left', 'Renewal Status'],
      rows: [
        ['NorthGate Foods Corp.', 'DL-2020-018', 'Jun 15, 2026', '95', 'For LOI Submission'],
        ['Delta AeroTech', 'DL-2019-004', 'May 30, 2026', '79', 'Docs Under Review'],
        ['HarborFresh Cold Storage', 'DL-2021-022', 'Apr 21, 2026', '40', 'For Board Approval'],
      ],
    },
  },
  'applications:requirements': {
    title: 'Requirements',
    description: 'Manage requirement definitions for new and renewal applications.',
    badge: 'Applications',
    icon: FileCheck,
    stats: [
      { label: 'Total Requirements', value: '—' },
      { label: 'For New', value: '—' },
      { label: 'For Renewal', value: '—' },
    ],
    table: {
      columns: ['Code', 'Name', 'Category', 'Flags', 'Status'],
      rows: [
        ['SEC-AOI', 'Articles of Incorporation', 'Legal', 'New, Mandatory', 'Active'],
        ['BIR-CLR', 'BIR Tax Clearance', 'Financial', 'New, Renewal, Mandatory', 'Active'],
        ['FSIC', 'Fire Safety Certificate', 'Technical', 'Renewal', 'Inactive'],
      ],
    },
  },
  'assessment:queue': {
    title: 'Assessment & Evaluation',
    description: 'Review submitted applications, evaluate compliance, assess charges, and record findings.',
    badge: 'Assessment',
    icon: FileCheck,
    stats: [
      { label: 'In Assessment', value: '—' },
      { label: 'Unassigned', value: '—' },
      { label: 'Overdue', value: '—' },
    ],
    table: {
      columns: ['Application', 'Locator', 'Stage', 'Evaluator', 'Charges'],
      rows: [
        ['APP-NEW-0001', 'SkyPort Logistics Inc.', 'In Review', 'AO Santos', '₱610,000'],
        ['APP-REN-0007', 'Delta AeroTech', 'For Recommendation', 'AO Cruz', '₱120,000'],
        ['APP-NEW-0012', 'Metro Agro Trading', 'Unassigned', '—', '—'],
      ],
    },
  },
  'approval:queue': {
    title: 'Approval & Issuance',
    description: 'Route endorsed applications through the approval hierarchy, record decisions, and issue approval documents and contracts.',
    badge: 'Approval',
    icon: FileCheck,
    stats: [
      { label: 'In Progress', value: '—' },
      { label: 'Awaiting Start', value: '—' },
      { label: 'Issued', value: '—' },
    ],
    table: {
      columns: ['Application', 'Locator', 'Approval Status', 'Current Level', 'Issued'],
      rows: [
        ['APP-2026-00001', 'SkyPort Logistics Inc.', 'In Progress', 'Division Chief', '—'],
        ['REN-2026-00007', 'Delta AeroTech', 'Approved', '—', 'Approval Order'],
        ['APP-2026-00012', 'Metro Agro Trading', 'Awaiting Start', '—', '—'],
      ],
    },
  },
  'compliance:permits': {
    title: 'Permits',
    description: 'Monitoring of environmental, fire, occupancy and sanitary permits.',
    badge: 'Compliance',
    icon: ShieldCheck,
    stats: [
      { label: 'Valid Permits', value: '211' },
      { label: 'Expiring in 30 Days', value: '8' },
      { label: 'Expired', value: '2', hint: 'Requires urgent follow-up' },
    ],
    table: {
      columns: ['Locator', 'Permit Type', 'Permit No.', 'Expiry', 'Status'],
      rows: [
        ['HarborFresh Cold Storage', 'Occupancy', 'OCC-24-019', 'Mar 31, 2026', 'Expiring'],
        ['GreenFuel Terminals Corp.', 'Fire Safety', 'FSIC-26-088', 'Apr 12, 2026', 'Valid'],
        ['NorthGate Foods Corp.', 'Sanitary', 'SAN-25-103', 'Jan 10, 2026', 'Expired'],
      ],
    },
  },
  'compliance:inspections': {
    title: 'Compliance & Inspection',
    description: 'Schedule inspections, record findings and corrective actions, and monitor locator compliance.',
    badge: 'Compliance',
    icon: ShieldCheck,
    stats: [
      { label: 'Scheduled', value: '—' },
      { label: 'Open Findings', value: '—' },
      { label: 'Overdue Actions', value: '—' },
    ],
    table: {
      columns: ['Inspection', 'Locator', 'Type', 'Status', 'Result'],
      rows: [
        ['Annual Safety Audit', 'SkyPort Logistics Inc.', 'Safety', 'In Progress', '—'],
        ['Engineering Check', 'Delta AeroTech', 'Engineering', 'Completed', 'Passed w/ Findings'],
        ['Performance Commitment', 'Metro Agro Trading', 'Perf. Commitment', 'Scheduled', '—'],
      ],
    },
  },
  'reports:analytics': {
    title: 'Reports & Analytics',
    description: 'Statistical overview of applications, permits, and inspections with printable and exportable reports.',
    badge: 'Reports',
    icon: BarChart3,
    stats: [],
    table: { columns: [], rows: [] },
  },
  'settings:users': {
    title: 'User Management',
    description: 'Manage admin and staff accounts who assist in verification.',
    badge: 'System',
    icon: Users,
    stats: [
      { label: 'Active Users', value: '34' },
      { label: 'Pending Invitations', value: '5' },
      { label: 'Deactivated', value: '3' },
    ],
    table: {
      columns: ['Name', 'Email', 'Role', 'Last Login', 'Status'],
      rows: [
        ['Admin Demo', 'admin@bizreg.com', 'System Admin', 'Mar 11, 2026 09:18', 'Active'],
        ['Joan Cruz', 'j.cruz@ciac.gov', 'Verifier', 'Mar 10, 2026 16:02', 'Active'],
        ['Leo Dizon', 'l.dizon@ciac.gov', 'Account Officer', 'Mar 05, 2026 11:22', 'Active'],
      ],
    },
  },
  'settings:locator-users': {
    title: 'Locator Accounts',
    description: 'Manage login accounts for registered locators, kept separate from staff accounts.',
    badge: 'System',
    icon: Users,
    stats: [
      { label: 'Active Accounts', value: '—' },
      { label: 'Total Accounts', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Username', 'Full Name', 'Email', '2FA', 'Status'],
      rows: [
        ['jdelacruz', 'Juan Dela Cruz', 'j.delacruz@skyport.com', 'On', 'Active'],
        ['mreyes', 'Maria Reyes', 'm.reyes@greenfuel.com', 'On', 'Active'],
      ],
    },
  },
  'settings:proponents': {
    title: 'Registered Locator',
    description: 'Master list of registered locator businesses, with lease/contract status pulled in automatically.',
    badge: 'Directory',
    icon: Users,
    stats: [
      { label: 'Total Locators', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Ref No', 'Tenant', 'Address', 'Industry', 'Start Term', 'End Term', 'Lease Term', 'Encoded By'],
      rows: [
        ['LOC-2026-00001', 'SkyPort Logistics Inc.', 'Clark Freeport Zone', 'Warehouse Lease', 'Mar 10, 2024', 'Mar 10, 2027', '3Y-0M-0D', 'J. Puyat'],
        ['LOC-2026-00002', 'GreenFuel Terminals Corp.', 'Clark Civil Aviation Complex', 'Direct Lease', 'Mar 09, 2024', 'Mar 09, 2029', '5Y-0M-0D', 'G. Cruz'],
      ],
    },
  },
  'settings:requirement-categories': {
    title: 'Requirement Categories',
    description: 'Manage requirement categories used in checklists and document grouping.',
    badge: 'Locator',
    icon: FileCheck,
    stats: [
      { label: 'Total Categories', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Category Name', 'Description', 'Status', 'Last Updated'],
      rows: [
        ['Legal', 'Incorporation and legal identity docs', 'Active', 'Mar 19, 2026'],
        ['Financial', 'Tax filings and financial statements', 'Active', 'Mar 18, 2026'],
        ['Technical', 'Engineering plans and permits', 'Inactive', 'Mar 15, 2026'],
      ],
    },
  },
  'settings:inspection-types': {
    title: 'Inspection Types',
    description: 'Manage inspection types for file maintenance.',
    badge: 'File Maintenance',
    icon: FileCheck,
    stats: [
      { label: 'Total Types', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Code', 'Name', 'Description', 'Status'],
      rows: [
        ['PRE', 'Pre-operation', 'Pre-operation inspection', 'Active'],
        ['POST', 'Post-operation', 'Post-operation inspection', 'Active'],
        ['RND', 'Random', 'Random spot check', 'Inactive'],
      ],
    },
  },
  'settings:compliance-types': {
    title: 'Compliance Types',
    description: 'Manage compliance types for file maintenance.',
    badge: 'File Maintenance',
    icon: FileCheck,
    stats: [
      { label: 'Total Types', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Code', 'Name', 'Description', 'Status'],
      rows: [
        ['ENV', 'Environmental', 'Environmental compliance requirement', 'Active'],
        ['FIRE', 'Fire Safety', 'Fire safety compliance requirement', 'Active'],
        ['SAN', 'Sanitary', 'Sanitary compliance requirement', 'Inactive'],
      ],
    },
  },
  'settings:application-types': {
    title: 'Application Types',
    description: 'Manage lease application types for file maintenance.',
    badge: 'File Maintenance',
    icon: FileCheck,
    stats: [
      { label: 'Total Types', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Code', 'Name', 'Description', 'Status'],
      rows: [
        ['DIRECT_LEASE', 'Direct Lease', 'Standard direct lease', 'Active'],
        ['WAREHOUSE_LEASE', 'Warehouse Lease', 'Warehouse lease', 'Active'],
        ['SUBLEASE', 'Sublease', 'Sublease', 'Active'],
      ],
    },
  },
  'settings:account-officers': {
    title: 'Account Officers',
    description: 'Manage account officers and their departments for file maintenance.',
    badge: 'File Maintenance',
    icon: Users,
    stats: [
      { label: 'Total Officers', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Name', 'Department', 'Locators', 'Status'],
      rows: [['—', '—', '—', '—']],
    },
  },
  'settings:type-of-contract': {
    title: 'Type of Contract',
    description: 'Manage types of contract for file maintenance.',
    badge: 'File Maintenance',
    icon: FileCheck,
    stats: [
      { label: 'Total Types', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Name', 'Status'],
      rows: [['—', '—']],
    },
  },
  'settings:land-use': {
    title: 'Land Use',
    description: 'Manage land uses for file maintenance.',
    badge: 'File Maintenance',
    icon: FolderTree,
    stats: [
      { label: 'Total Land Uses', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Name', 'Status'],
      rows: [['—', '—']],
    },
  },
  'settings:building': {
    title: 'Building',
    description: 'Manage buildings for file maintenance.',
    badge: 'File Maintenance',
    icon: FolderTree,
    stats: [
      { label: 'Total Buildings', value: '—' },
      { label: 'Active', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Name', 'Status'],
      rows: [['—', '—']],
    },
  },
  'settings:audit-log': {
    title: 'Audit Log',
    description: 'Logins, account changes, and permission changes — for monitoring and compliance review.',
    badge: 'Security',
    icon: ShieldCheck,
    stats: [],
    table: { columns: [], rows: [] },
  },
  'settings:control-panel': {
    title: 'Control Panel',
    description: 'Configure role-based access to sidebar menus and CRUD-capable modules.',
    badge: 'Configuration',
    icon: FileCheck,
    stats: [
      { label: 'Tabs', value: '2' },
      { label: 'Role Source', value: 'roles table' },
      { label: 'Access Scope', value: 'By Role' },
    ],
    table: {
      columns: ['Configuration', 'Source', 'Behavior', 'Status'],
      rows: [
        ['Sidebar Menu', 'roles + menu map', 'Show/hide menu per role', 'Active'],
        ['Menu CRUD Permissions', 'roles + CRUD map', 'Add/Edit/Delete per role', 'Active'],
        ['Save Action', 'admin API', 'Upsert role permissions', 'Active'],
      ],
    },
  },
};

function SectionLanding({ view }: { view: AppView }) {
  const config = LANDING_CONFIG[view];
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(1);

  const q = query.trim().toLowerCase();
  const allRows = config && view !== 'dashboard' ? config.table.rows : [];
  const filteredRows = useMemo(
    () =>
      q
        ? allRows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(q)))
        : allRows,
    [allRows, q]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize);
  const showingFrom = filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const showingTo = Math.min(filteredRows.length, safePage * pageSize);
  const visiblePageNumbers = useMemo(() => {
    const start = Math.max(1, safePage - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [safePage, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  if (!config || view === 'dashboard') return null;

  return (
    <div className="space-y-4 sm:space-y-5">
      {config.stats.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
          {config.stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl px-3 py-3 flex flex-col gap-1 shadow-sm"
              style={{ backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
            >
              <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">
                {stat.label}
              </span>
              <span
                className="text-base sm:text-lg font-bold leading-tight"
                style={{ color: 'var(--text)' }}
              >
                {stat.value}
              </span>
              {stat.hint && <span className="text-[10px] text-secondary">{stat.hint}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          {config.title} List
        </h3>
      </div>

      <div
        className="glass-card p-4 sm:p-5 !border-transparent overflow-hidden"
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div className="relative group w-full sm:w-72">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search records..."
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {config.table.columns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  {row.map((cell, i) => (
                    <td key={i} className="px-3 py-2.5 text-[11px] text-secondary">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DataTableControls
          page={safePage}
          totalPages={totalPages}
          totalItems={filteredRows.length}
          showingFrom={showingFrom}
          showingTo={showingTo}
          visiblePageNumbers={visiblePageNumbers}
          pageSize={pageSize}
          pageSizeOptions={[5, 20, 50, 100, 200]}
          onPageSizeChange={setPageSize}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
