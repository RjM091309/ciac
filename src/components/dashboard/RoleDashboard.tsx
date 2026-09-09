import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dashboard, type AdminDashboardData } from './Dashboard';
import { OfficerDashboard, type OfficerDashboardData } from './OfficerDashboard';
import { ProponentDashboard, type ProponentDashboardData } from './ProponentDashboard';

type DashboardState =
  | { status: 'loading' }
  | { status: 'admin'; data: AdminDashboardData | null }
  | { status: 'officer'; data: OfficerDashboardData }
  | { status: 'proponent'; data: ProponentDashboardData };

// DBM-01: refetch on an interval so totals/status counts stay close to
// live without the user having to manually reload the page.
const POLL_INTERVAL_MS = 30_000;

export function RoleDashboard() {
  const [state, setState] = useState<DashboardState>({ status: 'loading' });
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/me', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      const role = String(json?.role || '').toLowerCase();
      if (role === 'officer') {
        setState({ status: 'officer', data: json?.data });
        return;
      }
      if (role === 'proponent') {
        setState({ status: 'proponent', data: json?.data });
        return;
      }
      setState({ status: 'admin', data: json?.data ?? null });
    } catch {
      if (firstLoad.current) setState({ status: 'admin', data: null });
    } finally {
      firstLoad.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
      </div>
    );
  }

  if (state.status === 'officer') return <OfficerDashboard data={state.data} />;
  if (state.status === 'proponent') return <ProponentDashboard data={state.data} onFiled={load} />;
  return <Dashboard data={state.data} />;
}
