import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { OfficerDashboard, type OfficerDashboardData } from './OfficerDashboard';
import { ProponentDashboard, type ProponentDashboardData } from './ProponentDashboard';

type PreviewRole = 'account-officer' | 'proponent';

type PreviewState =
  | { status: 'loading' }
  | { status: 'officer'; data: OfficerDashboardData }
  | { status: 'proponent'; data: ProponentDashboardData }
  | { status: 'error' };

/** Admin-only: shows what the Officer/Proponent dashboard looks like, using a
 * representative sample of live data (not tied to a real officer/proponent identity). */
export function PreviewDashboard({ role }: { role: PreviewRole }) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/dashboard/preview/${role}`, { credentials: 'include' })
      .then((res) => res.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        if (json?.role === 'officer') {
          setState({ status: 'officer', data: json.data });
        } else if (json?.role === 'proponent') {
          setState({ status: 'proponent', data: json.data });
        } else {
          setState({ status: 'error' });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
      </div>
    );
  }

  if (state.status === 'officer') return <OfficerDashboard data={state.data} />;
  if (state.status === 'proponent') return <ProponentDashboard data={state.data} />;

  return (
    <div className="glass-card p-6 text-center text-xs text-secondary !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
      Couldn't load preview data.
    </div>
  );
}
