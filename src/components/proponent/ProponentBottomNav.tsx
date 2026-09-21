import React from 'react';
import {
  LayoutDashboard,
  FileText,
  FileCheck2,
  Building2,
  Menu,
  FilePlus2,
  ClipboardCheck,
  Stamp,
  ShieldCheck,
  FileCheck,
  BarChart3,
  RefreshCw,
  Users,
  ClipboardList,
  ScrollText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';

type BottomNavItem = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

/** Locator self-service tabs — fixed menu, same as ProponentSidebar. */
const PROPONENT_ITEMS: BottomNavItem[] = [
  { key: 'me:applications', label: 'Applications', icon: FileText },
  { key: 'me:contracts-permits', label: 'Contracts', icon: FileCheck2 },
  { key: 'me:profile', label: 'Profile', icon: Building2 },
];

/**
 * Staff tabs in priority order. Only the first MAX_TABS the role can actually
 * see are shown, so each role (admin, account/assessment officer, viewer) gets
 * its own most relevant screens; everything else stays in the "More" drawer.
 */
const STAFF_ITEMS: BottomNavItem[] = [
  { key: 'applications:new', label: 'Applications', icon: FilePlus2 },
  { key: 'assessment:queue', label: 'Evaluation', icon: ClipboardCheck },
  { key: 'approval:queue', label: 'Approval', icon: Stamp },
  { key: 'compliance:inspections', label: 'Inspections', icon: ShieldCheck },
  { key: 'compliance:permits', label: 'Permits', icon: FileCheck },
  { key: 'reports:analytics', label: 'Reports', icon: BarChart3 },
  { key: 'applications:renewals', label: 'Renewals', icon: RefreshCw },
  { key: 'settings:users', label: 'Users', icon: Users },
  // Fallbacks so read-only roles (e.g. Viewer) whose menus aren't in the list
  // above still get real tabs instead of a bar with only "More".
  { key: 'applications:requirements', label: 'Requirements', icon: ClipboardList },
  { key: 'settings:locator-users', label: 'Locators', icon: Building2 },
  { key: 'settings:audit-log', label: 'Audit Log', icon: ScrollText },
];

const MAX_TABS = 3; // + "More" = 4 slots, 2 on each side of the FAB

const BAR_HEIGHT = 64; // px, excludes safe-area inset
const NOTCH_RADIUS = 40; // px
const FAB_SIZE = 56; // px
// Center of the notch/FAB sits this far above the bar's own top edge.
const FAB_LIFT = 0; // px
// Room reserved above the bar so the FAB fits inside the nav's own opaque
// box instead of poking into page content — otherwise whatever is scrolled
// underneath shows through the notch and around the button.
const TOP_CLEARANCE = FAB_LIFT + FAB_SIZE / 2;
/** Total footprint (bar + FAB clearance), excluding the safe-area inset. Exported so AppLayout can reserve matching space. */
export const BOTTOM_NAV_HEIGHT = BAR_HEIGHT + TOP_CLEARANCE;

/** Radial-gradient mask that punches a circular notch out of the bar's top-center. */
const NOTCH_MASK = `radial-gradient(circle ${NOTCH_RADIUS}px at 50% ${-FAB_LIFT}px, transparent 99%, #000 100%)`;

/**
 * Persistent mobile bottom tab bar for every role, standing in for the
 * sidebar drawer's primary items so mobile feels like a native app instead of
 * a desktop layout with a hamburger bolted on.
 * Dashboard/Home lives in the raised center FAB (bank-app style notch);
 * "More" opens the existing drawer for the rest of the menu + Logout rather
 * than duplicating them here, so those stay in one place.
 */
export function ProponentBottomNav({
  role,
  view,
  onViewChange,
  onOpenMore,
  permissionOverride,
}: {
  role: 'admin' | 'officer' | 'proponent';
  view: string;
  onViewChange: (view: string) => void;
  onOpenMore: () => void;
  permissionOverride?: Record<string, boolean> | null;
}) {
  const { sidebarPermissions, fullAccess, ready } = useControlPanelAccess();
  const isProponent = role === 'proponent';

  // Mirrors each sidebar's own gating: ProponentSidebar fails open, AppSidebar
  // fails closed (nothing restricted shows until permissions load).
  const canView = (key: string) => {
    if (isProponent) {
      if (key === 'dashboard') return true;
      if (permissionOverride) return key in permissionOverride ? Boolean(permissionOverride[key]) : true;
      if (!ready) return true;
      return key in sidebarPermissions ? sidebarPermissions[key] : true;
    }
    if (permissionOverride) return Boolean(permissionOverride[key]);
    if (fullAccess) return true;
    if (!ready) return false;
    return Boolean(sidebarPermissions[key]);
  };

  const tabs = (isProponent ? PROPONENT_ITEMS : STAFF_ITEMS).filter((item) => canView(item.key)).slice(0, MAX_TABS);
  // Two tabs left of the FAB; the rest (plus "More") on the right.
  const leftItems = tabs.slice(0, 2);
  const rightItems = tabs.slice(2);
  const showHome = canView('dashboard');
  const homeActive = view === 'dashboard';
  // Fixed slot grid (2 per side of the FAB), padded with empty slots, so every
  // role's tabs line up the same: "More" always sits in the far-right slot and
  // the notch stays centered even for roles with 0–1 tabs (e.g. Viewer).
  const rightCount = rightItems.length + 1; // + "More"
  const sideSlots = Math.max(2, leftItems.length, rightCount);
  const spacers = (n: number, side: string) =>
    Array.from({ length: Math.max(0, n) }, (_, i) => <div key={`${side}-pad-${i}`} className="flex-1" aria-hidden="true" />);

  const renderItem = (item: BottomNavItem) => {
    const active = view === item.key;
    const Icon = item.icon;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => onViewChange(item.key)}
        className="relative flex-1 flex flex-col items-center justify-center gap-1 min-w-0 cursor-pointer"
        style={{ color: active ? 'var(--nav-active-bg)' : 'var(--text-secondary)' }}
      >
        <Icon size={24} strokeWidth={active ? 2.4 : 2} />
        <span className={cn('text-[10px] font-medium tracking-tight truncate max-w-full', active && 'font-bold')}>
          {item.label}
        </span>
        {active && (
          <span
            className="absolute bottom-0 rounded-full"
            style={{ width: 22, height: 3, backgroundColor: 'var(--nav-active-bg)' }}
          />
        )}
      </button>
    );
  };

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-40"
      style={{ height: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px))` }}
    >
      {/* Opaque page-colored backing spanning the FAB's full clearance, so
          scrolled content can never show through the notch or beside the FAB. */}
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--background)' }} />

      {/* Bar background (notched when the Home FAB is shown), pinned to the bottom of the taller wrapper. */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          height: `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
          backgroundColor: 'var(--surface)',
          borderTop: '1px solid var(--border-subtle)',
          boxShadow: '0 -8px 20px rgba(0,0,0,0.18)',
          maskImage: showHome ? NOTCH_MASK : undefined,
          WebkitMaskImage: showHome ? NOTCH_MASK : undefined,
        }}
      />

      <div
        className="absolute left-0 right-0 bottom-0 flex items-stretch"
        style={{ height: BAR_HEIGHT, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {showHome && spacers(sideSlots - leftItems.length, 'left')}
        {leftItems.map(renderItem)}
        {showHome && <div style={{ width: NOTCH_RADIUS * 2 }} aria-hidden="true" />}
        {rightItems.map(renderItem)}
        {showHome && spacers(sideSlots - rightCount, 'right')}
        <button
          type="button"
          onClick={onOpenMore}
          className="flex-1 flex flex-col items-center justify-center gap-1 min-w-0 cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Menu size={24} />
          <span className="text-[10px] font-medium tracking-tight">More</span>
        </button>
      </div>

      {showHome && (
        <button
          type="button"
          onClick={() => onViewChange('dashboard')}
          aria-label="Home"
          aria-current={homeActive ? 'page' : undefined}
          className="absolute left-1/2 flex items-center justify-center cursor-pointer"
          style={{
            top: TOP_CLEARANCE - FAB_LIFT - FAB_SIZE / 2,
            width: FAB_SIZE,
            height: FAB_SIZE,
            borderRadius: '9999px',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--nav-active-bg)',
            color: 'var(--nav-active-text)',
            boxShadow: '0 10px 22px rgba(0,0,0,0.35)',
          }}
        >
          <LayoutDashboard size={24} strokeWidth={homeActive ? 2.4 : 2} />
        </button>
      )}
    </div>
  );
}
