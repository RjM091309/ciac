import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { OfficerDashboard, type OfficerDashboardData } from './OfficerDashboard';
import { ProponentDashboard, type ProponentDashboardData } from './ProponentDashboard';

type PreviewRole = 'account-officer' | 'proponent';

type PreviewState =
  | { status: 'loading' }
  | { status: 'officer'; data: OfficerDashboardData; widgetOverrides: Record<string, boolean> }
  | { status: 'proponent'; data: ProponentDashboardData; widgetOverrides: Record<string, boolean> }
  | { status: 'error' };

function toWidgetOverrides(rows: any): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  (Array.isArray(rows) ? rows : []).forEach((row: any) => {
    map[String(row.widget_key)] = Number(row.is_enabled) === 1 || row.is_enabled === true;
  });
  return map;
}

/** Admin-only: shows what the Officer/Proponent dashboard looks like, using a
 * representative sample of live data (not tied to a real officer/proponent identity).
 * The admin viewing this is exempt from Control Panel restrictions, so the
 * previewed role's actual widget visibility is fetched separately and forced
 * onto the child dashboard via `widgetOverrides` — otherwise the preview would
 * always show every widget regardless of what was configured for that role. */
export function PreviewDashboard({ role }: { role: PreviewRole }) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/dashboard/preview/${role}`, { credentials: 'include' })
      .then((res) => res.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        const widgetOverrides = toWidgetOverrides(json?.widgetPermissions);
        if (json?.role === 'officer') {
          setState({ status: 'officer', data: json.data, widgetOverrides });
        } else if (json?.role === 'proponent') {
          setState({ status: 'proponent', data: json.data, widgetOverrides });
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

  if (state.status === 'officer') return <OfficerDashboard data={state.data} widgetOverrides={state.widgetOverrides} />;
  if (state.status === 'proponent') return <ProponentDashboard data={state.data} widgetOverrides={state.widgetOverrides} />;

  return (
    <div className="glass-card p-6 text-center text-xs text-secondary !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
      Couldn't load preview data.
    </div>
  );
}
