import React, { useState } from 'react';
import { ChevronRight, Home, ShieldCheck, UserCog, User } from 'lucide-react';

export function SubHeader() {
  const roles = [
    { id: 'admin', label: 'Administrator', icon: ShieldCheck },
    { id: 'account-officer', label: 'Account Officer', icon: UserCog },
    { id: 'proponent', label: 'Proponent', icon: User },
  ] as const;

  const [activeRole, setActiveRole] = useState<(typeof roles)[number]['id']>('admin');

  return (
    <>
      {/* Breadcrumbs + Role tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-xs font-medium text-secondary">
          <Home size={14} className="text-secondary" />
          <ChevronRight size={12} className="text-secondary/70" />
          <span className="text-zinc-100">Dashboard</span>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900/70 px-1 py-1">
          {roles.map((role) => {
            const Icon = role.icon;
            const isActive = activeRole === role.id;
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => setActiveRole(role.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'bg-zinc-100 text-black shadow-sm'
                    : 'text-secondary hover:text-zinc-100 hover:bg-zinc-800/70'
                }`}
              >
                <Icon size={13} />
                <span>{role.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Page title */}
      <div className="flex justify-between items-center mb-5">
        <div className="space-y-0.5">
          <h2 className="text-2xl font-semibold tracking-tight text-white">Overview</h2>
          <p className="text-xs text-secondary">Monitor key metrics and manage your platform</p>
        </div>
      </div>
    </>
  );
}

