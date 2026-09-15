import React from 'react';
import { LayoutDashboard, FileText, FileCheck2, Building2, Menu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';

type BottomNavItem = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

const LEFT_ITEMS: BottomNavItem[] = [
  { key: 'me:applications', label: 'Applications', icon: FileText },
  { key: 'me:contracts-permits', label: 'Contracts', icon: FileCheck2 },
];
const RIGHT_ITEMS: BottomNavItem[] = [
  { key: 'me:profile', label: 'Profile', icon: Building2 },
];

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
 * Persistent bottom tab bar — the locator (proponent) role's mobile nav,
 * standing in for the sidebar drawer's primary items so mobile feels like a
 * native app instead of a desktop layout with a hamburger bolted on.
 * Dashboard/Home lives in the raised center FAB (bank-app style notch);
 * "More" opens the existing drawer for Activity History + Logout rather
 * than duplicating them here, so those stay in one place.
 */
export function ProponentBottomNav({
  view,
  onViewChange,
  onOpenMore,
  permissionOverride,
}: {
  view: string;
  onViewChange: (view: string) => void;
  onOpenMore: () => void;
  permissionOverride?: Record<string, boolean> | null;
}) {
  const { sidebarPermissions: mySidebarPermissions, ready } = useControlPanelAccess();

  const canView = (key: string) => {
    if (key === 'dashboard') return true;
    if (permissionOverride) return key in permissionOverride ? Boolean(permissionOverride[key]) : true;
    if (!ready) return true;
    return key in mySidebarPermissions ? mySidebarPermissions[key] : true;
  };

  const leftItems = LEFT_ITEMS.filter((item) => canView(item.key));
  const rightItems = RIGHT_ITEMS.filter((item) => canView(item.key));
  const homeActive = view === 'dashboard';

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

      {/* Notched bar background, pinned to the bottom of the taller wrapper. */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          height: `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
          backgroundColor: 'var(--surface)',
          borderTop: '1px solid var(--border-subtle)',
          boxShadow: '0 -8px 20px rgba(0,0,0,0.18)',
          maskImage: NOTCH_MASK,
          WebkitMaskImage: NOTCH_MASK,
        }}
      />

      <div
        className="absolute left-0 right-0 bottom-0 flex items-stretch"
        style={{ height: BAR_HEIGHT, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {leftItems.map(renderItem)}
        <div style={{ width: NOTCH_RADIUS * 2 }} aria-hidden="true" />
        {rightItems.map(renderItem)}
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
    </div>
  );
}
