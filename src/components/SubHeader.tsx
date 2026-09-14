import React, { useState } from 'react';
import { ChevronRight, Home, ShieldCheck, UserCog, User } from 'lucide-react';
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

  return (
    <>
      {/* Breadcrumbs + Role tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3 sm:mb-4 min-w-0">
        <div className="flex items-center gap-2 text-xs font-medium text-secondary min-w-0">
          <Home size={14} className="text-secondary shrink-0" />
          <ChevronRight size={12} className="text-secondary/70 shrink-0" />
          <span className="truncate text-[var(--text)]">
            {badge ?? 'Dashboard'}
          </span>
        </div>

        {showRoleSwitcher && (
        <div className="w-full sm:w-auto min-w-0 max-w-full flex justify-center overflow-x-auto overflow-y-hidden scrollbar-hide px-1">
          <div
            className="inline-flex sm:flex items-center gap-1.5 rounded-full px-1 py-1 min-w-max sm:min-w-0 max-w-full snap-x snap-mandatory lg:flex-wrap mx-auto"
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
                type="button"
                title={role.label}
                onClick={() => {
                  onPreviewRoleChange?.(role.id);
                  setShimmerRole(role.id);
                  setTimeout(() => {
                    setShimmerRole((current) => (current === role.id ? null : current));
                  }, 900);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 sm:px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-full text-[10px] sm:text-[11px] font-medium transition-colors snap-start shrink-0 whitespace-nowrap',
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

