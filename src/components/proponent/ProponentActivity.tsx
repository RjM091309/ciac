import React, { useEffect, useState } from 'react';
import { FileUp, KeyRound, Loader2, LogIn, ShieldCheck, UserPlus, PencilLine } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

type ActivityRow = {
  id: number;
  actor_username: string | null;
  entity_type: string;
  entity_id: number | null;
  action: string;
  meta: Record<string, any> | null;
  created_at: string | null;
};

const ACTION_META: Record<string, { label: string; icon: any; color: string }> = {
  LOGIN: { label: 'Signed in', icon: LogIn, color: '#6366f1' },
  REGISTERED: { label: 'Submitted registration', icon: UserPlus, color: '#3b82f6' },
  ACCOUNT_APPROVED: { label: 'Account approved by 3CORE', icon: ShieldCheck, color: '#10b981' },
  ACCOUNT_REJECTED: { label: 'Registration declined', icon: ShieldCheck, color: '#ef4444' },
  PASSWORD_CHANGED: { label: 'Password changed', icon: KeyRound, color: '#f59e0b' },
  PROFILE_CHANGE_REQUESTED: { label: 'Profile change requested', icon: PencilLine, color: '#f59e0b' },
  PROFILE_CHANGE_APPROVED: { label: 'Profile change approved', icon: PencilLine, color: '#10b981' },
  PROFILE_CHANGE_REJECTED: { label: 'Profile change declined', icon: PencilLine, color: '#ef4444' },
  DOCUMENT_UPLOADED: { label: 'Document uploaded', icon: FileUp, color: '#06b6d4' },
};

function fmt(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function detail(row: ActivityRow): string | null {
  const m = row.meta || {};
  if (row.action === 'DOCUMENT_UPLOADED' && m.file_name) return m.file_name;
  if (row.action === 'PROFILE_CHANGE_REQUESTED' && Array.isArray(m.fields)) return `Fields: ${m.fields.join(', ')}`;
  if (row.action === 'PROFILE_CHANGE_APPROVED' && Array.isArray(m.fields)) return `Fields: ${m.fields.join(', ')}`;
  if (row.action === 'PROFILE_CHANGE_REJECTED' && m.remarks) return m.remarks;
  if (row.action === 'ACCOUNT_REJECTED' && m.note) return m.note;
  return null;
}

export function ProponentActivity() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/proponents/me/activity?limit=60', { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.message || 'Failed to load activity');
        setRows(Array.isArray(json.data) ? json.data : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load activity');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <EmptyState title="Couldn't load your activity" description={error} />
      </div>
    );
  }

  return (
    <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
      {rows.length === 0 ? (
        <EmptyState title="No activity yet" description="Sign-ins and changes to your account will appear here." />
      ) : (
        <ol className="relative border-l ml-2" style={{ borderColor: 'var(--border-subtle)' }}>
          {rows.map((row) => {
            const meta = ACTION_META[row.action] || { label: row.action, icon: ShieldCheck, color: 'var(--text-muted)' };
            const Icon = meta.icon;
            const d = detail(row);
            return (
              <li key={row.id} className="ml-4 pb-4 last:pb-0">
                <span
                  className="absolute -left-[9px] mt-0.5 h-4 w-4 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'var(--surface)', border: `1px solid ${meta.color}` }}
                >
                  <Icon size={9} style={{ color: meta.color }} />
                </span>
                <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{meta.label}</div>
                {d ? <div className="text-[11px] text-secondary mt-0.5">{d}</div> : null}
                <div className="text-[10px] text-secondary mt-0.5">
                  {fmt(row.created_at)}
                  {row.actor_username ? ` · by ${row.actor_username}` : ''}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
