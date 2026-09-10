import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';

const FIELD_LABELS: Record<string, string> = {
  business_name: 'Business Name',
  registration_no: 'Registration No.',
  tin: 'TIN',
  address: 'Address',
  contact_no: 'Contact No.',
};

type ChangeRequest = {
  id: number;
  proponent_id: number;
  business_name: string | null;
  requested_by_username: string | null;
  created_at: string | null;
  payload: Record<string, string | null>;
  current: Record<string, string | null>;
};

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ProponentChangeRequests({ onReviewed }: { onReviewed?: () => void }) {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/proponents/change-requests?status=PENDING', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load change requests');
      setRequests(Array.isArray(json.data) ? json.data : []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load change requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: number, action: 'approve' | 'reject') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/proponents/change-requests/${id}/${action}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || `${action} failed`);
      toast.success(action === 'approve' ? 'Change request approved' : 'Change request rejected');
      await load();
      onReviewed?.();
    } catch (e: any) {
      toast.error(e?.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        title="No pending change requests"
        description="Profile edit requests submitted by locators will show up here for review."
      />
    );
  }

  return (
    <div className="space-y-4">
      {requests.map((req) => {
        const fields = Object.keys(req.payload || {});
        return (
          <div
            key={req.id}
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
          >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h4 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  {req.business_name || `Locator #${req.proponent_id}`}
                </h4>
                <p className="text-[11px] text-secondary">
                  Requested by {req.requested_by_username || 'locator'} · {formatDateTime(req.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => review(req.id, 'approve')}
                  disabled={busyId === req.id}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(34,197,94,.16)', color: 'rgba(34,197,94,.95)' }}
                >
                  <Check size={13} /> Approve
                </button>
                <button
                  onClick={() => review(req.id, 'reject')}
                  disabled={busyId === req.id}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(220,38,38,.14)', color: '#fca5a5' }}
                >
                  <X size={13} /> Reject
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr>
                    {['Field', 'Current', 'Requested'].map((c) => (
                      <th
                        key={c}
                        className="px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-1.5 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                        {FIELD_LABELS[f] || f}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-secondary line-through decoration-secondary/40">
                        {req.current?.[f] || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] font-medium" style={{ color: 'var(--text)' }}>
                        {req.payload?.[f] || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
