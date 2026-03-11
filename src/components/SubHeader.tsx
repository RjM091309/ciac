import React, { useState } from 'react';
import { ChevronRight, Home, ShieldCheck, UserCog, User } from 'lucide-react';
import { cn } from '../lib/utils';

export function SubHeader() {
  const roles = [
    { id: 'admin', label: 'Administrator', icon: ShieldCheck },
    { id: 'account-officer', label: 'Account Officer', icon: UserCog },
    { id: 'proponent', label: 'Proponent', icon: User },
  ] as const;

  const [activeRole, setActiveRole] = useState<(typeof roles)[number]['id']>('admin');
  const [shimmerRole, setShimmerRole] = useState<(typeof roles)[number]['id'] | null>(null);

  return (
    <>
      {/* Breadcrumbs + Role tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3 sm:mb-4">
        <div className="flex items-center gap-2 text-xs font-medium text-secondary min-w-0">
          <Home size={14} className="text-secondary shrink-0" />
          <ChevronRight size={12} className="text-secondary/70 shrink-0" />
          <span className="truncate text-[var(--text)]">Dashboard</span>
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5 rounded-full px-1 py-1 w-fit"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--control-bg) 82%, transparent)',
          }}
        >
          {roles.map((role) => {
            const Icon = role.icon;
            const isActive = activeRole === role.id;
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => {
                  setActiveRole(role.id);
                  setShimmerRole(role.id);
                  setTimeout(() => {
                    setShimmerRole((current) => (current === role.id ? null : current));
                  }, 900);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-full text-[11px] font-medium transition-colors',
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
                <span className="whitespace-nowrap">{role.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Page title */}
      <div className="flex justify-between items-center mb-4 sm:mb-5">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-[var(--text)]">Overview</h2>
          <p className="text-xs text-secondary">Monitor key metrics and manage your platform</p>
        </div>
      </div>
    </>
  );
}

