import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dashboard } from './Dashboard';
import { OfficerDashboard, type OfficerDashboardData } from './OfficerDashboard';
import { ProponentDashboard, type ProponentDashboardData } from './ProponentDashboard';

type DashboardState =
  | { status: 'loading' }
  | { status: 'admin' }
  | { status: 'officer'; data: OfficerDashboardData }
  | { status: 'proponent'; data: ProponentDashboardData };

export function RoleDashboard() {
  const [state, setState] = useState<DashboardState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/dashboard/me', { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const role = String(json?.role || '').toLowerCase();
        if (role === 'officer') {
          setState({ status: 'officer', data: json?.data });
          return;
        }
        if (role === 'proponent') {
          setState({ status: 'proponent', data: json?.data });
          return;
        }
        setState({ status: 'admin' });
      } catch {
        if (!cancelled) setState({ status: 'admin' });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
      </div>
    );
  }

  if (state.status === 'officer') return <OfficerDashboard data={state.data} />;
  if (state.status === 'proponent') return <ProponentDashboard data={state.data} />;
  return <Dashboard />;
}
