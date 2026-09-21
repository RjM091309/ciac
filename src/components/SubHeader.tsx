import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Home, ShieldCheck, UserCog, User } from 'lucide-react';
import { cn } from '../lib/utils';
import { roleDisplayName } from '../lib/roleDisplay';

// 'admin' and 'proponent' are the two fixed tabs; anything else is a staff
// role's numeric id (as a string), from the Roles table fetched live (see
// previewStaffRoles below) — not a small hardcoded union, so a newly-added
// custom role shows up as its own tab without a code change. ID rather than
// name: unlike the 3 fixed roles, a custom role can be renamed, so a name
// baked into this value could go stale mid-session.
export type DashboardPreviewRole = string;

type SubHeaderProps = {
  title?: string;
  description?: string;
  badge?: string;
  /** Admin-only "preview other roles' dashboard" switcher. Omit to hide it. */
  previewRole?: DashboardPreviewRole;
  onPreviewRoleChange?: (role: DashboardPreviewRole) => void;
  /** Every role besides the built-in Admin/Locator — Officer, Account
   * Officer, Assessment Officer, or any other custom role — rendered as its
   * own tab between the two fixed ones. */
  previewStaffRoles?: { id: number; name: string }[];
};

export function SubHeader({
  title,
  description,
  badge,
  previewRole,
  onPreviewRoleChange,
  previewStaffRoles = [],
}: SubHeaderProps) {
  const roles = [
    { id: 'admin', label: 'Administrator', icon: ShieldCheck },
    ...previewStaffRoles.map((r) => ({ id: String(r.id), label: roleDisplayName(r.name), icon: UserCog })),
    { id: 'proponent', label: 'Locator', icon: User },
  ];

  const [shimmerRole, setShimmerRole] = useState<string | null>(null);
  const showRoleSwitcher = Boolean(onPreviewRoleChange);
  const activeRole = roles.find((r) => r.id === previewRole) ?? roles[0];
  const ActiveIcon = activeRole.icon;

  // Tablet: the tab strip can overflow, so keep the selected tab scrolled into
  // view (e.g. after switching on a phone and rotating, or on first load).
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    tabRefs.current[previewRole ?? '']?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [previewRole]);

  // Phone dropdown: close on outside tap or Escape.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const selectRole = (id: string) => {
    onPreviewRoleChange?.(id);
    setShimmerRole(id);
    setTimeout(() => {
      setShimmerRole((current) => (current === id ? null : current));
    }, 900);
  };

  return (
    <>
      {/* Breadcrumbs + Role tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3 sm:mb-4 min-w-0">
        {/* Hidden on phones — the bottom nav already shows where you are. */}
        <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-secondary min-w-0">
          <Home size={14} className="text-secondary shrink-0" />
          <ChevronRight size={12} className="text-secondary/70 shrink-0" />
          <span className="truncate text-[var(--text)]">
            {badge ?? 'Dashboard'}
          </span>
        </div>

        {showRoleSwitcher && (
        <>
        {/* Phone: five-plus role tabs never fit, so collapse them into a
            themed dropdown. (A native <select> popup ignores the app theme —
            white list with unreadable text in dark mode.) */}
        <div ref={menuRef} className="sm:hidden relative w-full">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-label="Preview dashboard as role"
            onClick={() => setMenuOpen((o) => !o)}
            className={cn(
              'relative flex items-center w-full min-h-[44px] rounded-full pl-3.5 pr-10 text-[11px] font-medium text-[var(--text)] cursor-pointer',
              shimmerRole && 'shimmer-badge',
            )}
            style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 82%, transparent)' }}
          >
            <ActiveIcon size={14} className="shrink-0 text-secondary" />
            <span className="ml-2 text-secondary shrink-0">Preview as</span>
            <span className="ml-1.5 uppercase font-semibold truncate">{activeRole.label}</span>
            <ChevronDown
              size={16}
              className={cn('absolute right-3.5 text-secondary transition-transform duration-200', menuOpen && 'rotate-180')}
            />
          </button>

          {menuOpen && (
            <ul
              role="listbox"
              aria-label="Roles"
              className="absolute left-0 right-0 top-full mt-2 z-30 rounded-2xl p-1.5 max-h-[60vh] overflow-y-auto"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border-subtle)',
                boxShadow: '0 16px 32px rgba(0,0,0,0.35)',
              }}
            >
              {roles.map((role) => {
                const Icon = role.icon;
                const isActive = role.id === activeRole.id;
                return (
                  <li key={role.id} role="option" aria-selected={isActive}>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (!isActive) selectRole(role.id);
                      }}
                      className={cn(
                        'flex items-center gap-2.5 w-full min-h-[44px] px-3 rounded-xl text-[11px] font-medium uppercase text-left cursor-pointer transition-colors',
                        isActive ? 'text-[var(--nav-active-text)]' : 'text-secondary hover:text-[var(--text)] hover:bg-[var(--selected-bg)]',
                      )}
                      style={isActive ? { backgroundColor: 'var(--nav-active-bg)' } : undefined}
                    >
                      <Icon size={14} className="shrink-0" />
                      <span className="flex-1 truncate">{role.label}</span>
                      {isActive && <Check size={14} className="shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Tablet/desktop: pill tabs. Left-aligned scroll container + mx-auto
            child centers the strip when it fits, but never clips the first
            tab when it overflows (justify-center on a scroller does). */}
        <div className="hidden sm:flex w-full lg:w-auto min-w-0 max-w-full overflow-x-auto overflow-y-hidden scrollbar-hide">
          <div
            className="flex w-max items-center gap-1.5 rounded-full px-1 py-1 snap-x snap-mandatory mx-auto lg:mr-0"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 82%, transparent)',
              WebkitOverflowScrolling: 'touch',
            }}
          >
          {roles.map((role) => {
            const Icon = role.icon;
            const isActive = previewRole === role.id;
            return (
              <button
                key={role.id}
                ref={(el) => { tabRefs.current[role.id] = el; }}
                type="button"
                title={role.label}
                aria-pressed={isActive}
                onClick={() => selectRole(role.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 lg:py-1.5 min-h-[40px] lg:min-h-0 rounded-full text-[11px] font-medium transition-colors snap-start shrink-0 whitespace-nowrap',
                  isActive
                    ? 'shadow-sm text-[var(--nav-active-text)]'
                    : 'text-secondary hover:text-[var(--text)] hover:bg-[var(--selected-bg)]',
                  shimmerRole === role.id && 'shimmer-badge',
                )}
                style={
                  isActive
                    ? {
                        backgroundColor: 'var(--nav-active-bg)',
                      }
                    : undefined
                }
              >
                <Icon
                  size={13}
                  className={cn(
                    'shrink-0',
                    isActive ? 'text-[var(--nav-active-text)]' : 'text-secondary',
                  )}
                />
                {/* uppercase via CSS, not by relying on the label's own
                    casing — a custom role's stored name (and so its
                    roleDisplayName() output) isn't guaranteed uppercase,
                    while the two fixed tabs are typed that way here. This
                    keeps every tab visually consistent regardless of source. */}
                <span className="uppercase">{role.label}</span>
              </button>
            );
          })}
        </div>
        </div>
        </>
        )}
      </div>

      {/* Page title */}
      <div className="flex justify-between items-center mb-4 sm:mb-5">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text)]">
            {title ?? 'Overview'}
          </h2>
          <p className="text-xs text-secondary">
            {description ?? 'Monitor key metrics and manage your platform'}
          </p>
        </div>
      </div>
    </>
  );
}

