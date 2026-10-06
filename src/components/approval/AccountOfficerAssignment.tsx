import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { AppSelect } from '../ui/AppSelect';
import { ConfirmModal } from '../ui/ConfirmModal';
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeleton';
import { requestNotificationsRefresh } from '../../lib/notificationRefresh';

// Approved Queue (/approval) for the Account Officer department. An
// application (new or renewal) approved by the Level 1 BDO lands here
// unassigned; Level 1 Account Officer assigns a Level 2 (the locator's
// account officer). Once assigned it leaves this list: a new locator is added
// to Registered Locator, a renewal just updates its existing row.

type QueueRow = {
  application_id: number;
  application_no: string;
  is_renewal: number | boolean;
  application_type_name: string | null;
  proponent_id: number;
  proponent_name: string | null;
  current_account_officer_id: number | null;
  current_account_officer_name: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
};

type Officer = { id: number; full_name: string | null; username: string };

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json;
}

function fmtDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function AccountOfficerAssignment(_props: {
  locationSearch?: string;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
}) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [confirmRow, setConfirmRow] = useState<QueueRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const json = await apiFetch('/api/approvals/assignment-queue');
      const nextRows: QueueRow[] = json.data?.rows || [];
      setRows(nextRows);
      // A renewal starts on the locator's current Account Officer.
      setPicked((prev) => {
        const next = { ...prev };
        nextRows.forEach((r) => {
          if (next[r.application_id] == null && r.current_account_officer_id) {
            next[r.application_id] = String(r.current_account_officer_id);
          }
        });
        return next;
      });
      setOfficers(json.data?.officers || []);
      setCanAssign(Boolean(json.data?.canAssign));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => `${r.application_no} ${r.proponent_name ?? ''}`.toLowerCase().includes(term));
  }, [rows, search]);

  const officerOptions = useMemo(
    () => officers.map((o) => ({ value: String(o.id), label: o.full_name || o.username })),
    [officers]
  );
  const officerName = (id: string) => officerOptions.find((o) => o.value === id)?.label || '';

  async function assign() {
    if (!confirmRow) return;
    const officerId = picked[confirmRow.application_id];
    setSaving(true);
    try {
      await apiFetch(`/api/approvals/assignment-queue/${confirmRow.application_id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ account_officer_id: Number(officerId) }),
      });
      toast.success(`${confirmRow.proponent_name || confirmRow.application_no} assigned to ${officerName(officerId)}`);
      setConfirmRow(null);
      requestNotificationsRefresh();
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
        <div className="glass-card mt-3 p-4 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
            <div className="relative group flex-1 min-w-0 sm:flex-none sm:w-72">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search application / locator..."
                className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
                style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
              />
            </div>
            {!canAssign ? (
              <p className="text-[11px] text-secondary">Only Level 1 can assign an Account Officer.</p>
            ) : null}
          </div>

          {loading ? (
            <TableSkeleton columns={5} rows={5} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<UserPlus size={40} className="opacity-40" />}
              title="Nothing to assign"
              description="Applications (new and renewal) approved by BDO Level 1 appear here until a Level 2 Account Officer is assigned."
            />
          ) : (
            <div className="space-y-2 sm:space-y-0">
              {/* Phones: stacked cards */}
              <div className="sm:hidden space-y-2">
                {visible.map((r) => (
                  <div
                    key={r.application_id}
                    className="rounded-xl p-3 space-y-2"
                    style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)' }}
                  >
                    <div>
                      <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{r.proponent_name || '—'}</div>
                      <div className="text-[11px] text-secondary">
                        {r.application_no} · {r.is_renewal ? 'Renewal' : 'New'}
                        {r.application_type_name ? ` · ${r.application_type_name}` : ''} · Approved {fmtDate(r.approved_at)}
                      </div>
                    </div>
                    {canAssign ? (
                      <div className="flex gap-2">
                        <div className="flex-1 min-w-0">
                          <AppSelect
                            compact
                            placeholder="Level 2 Account Officer…"
                            value={picked[r.application_id] || ''}
                            onChange={(v) => setPicked((p) => ({ ...p, [r.application_id]: v }))}
                            options={officerOptions}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={!picked[r.application_id]}
                          onClick={() => setConfirmRow(r)}
                          className="rounded-lg px-3 text-[12px] font-semibold disabled:opacity-50 cursor-pointer"
                          style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                        >
                          Assign
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Application</th>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Locator</th>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Approved</th>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Approved by</th>
                      {canAssign ? (
                        <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary w-[320px]">Assign Level 2 Account Officer</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.application_id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold" style={{ color: 'var(--text)' }}>{r.application_no}</div>
                          <div className="text-[11px] text-secondary">
                            {r.is_renewal ? 'Renewal' : 'New'} · {r.application_type_name || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary">
                          {r.proponent_name || '—'}
                          {r.is_renewal && r.current_account_officer_name ? (
                            <div className="text-[10px]">Current AO: {r.current_account_officer_name}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary">{fmtDate(r.approved_at)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary">{r.approved_by_name || '—'}</td>
                        {canAssign ? (
                          <td className="px-3 py-2.5">
                            <div className="flex gap-2 items-center">
                              <div className="flex-1 min-w-0">
                                <AppSelect
                                  compact
                                  placeholder="Select Level 2…"
                                  value={picked[r.application_id] || ''}
                                  onChange={(v) => setPicked((p) => ({ ...p, [r.application_id]: v }))}
                                  options={officerOptions}
                                />
                              </div>
                              <button
                                type="button"
                                disabled={!picked[r.application_id]}
                                onClick={() => setConfirmRow(r)}
                                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                              >
                                Assign
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canAssign && officerOptions.length === 0 ? (
                <p className="pt-3 text-[11px] text-secondary">
                  No Level 2 Account Officer yet — set one up in User Management (role Account Officer, Level 2).
                </p>
              ) : null}
            </div>
          )}
        </div>

      <ConfirmModal
        open={confirmRow !== null}
        title="Assign Account Officer?"
        description={
          confirmRow
            ? `${officerName(picked[confirmRow.application_id] || '')} becomes the Account Officer of ${
                confirmRow.proponent_name || confirmRow.application_no
              }. ${
                confirmRow.is_renewal
                  ? 'Its existing Registered Locator row is updated with this renewal.'
                  : 'The locator is added to Registered Locator.'
              }`
            : undefined
        }
        confirmText="Assign"
        loading={saving}
        onCancel={() => setConfirmRow(null)}
        onConfirm={() => void assign()}
      />
    </div>
  );
}
