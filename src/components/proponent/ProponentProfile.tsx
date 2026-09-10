import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Clock, Loader2, PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '../ui/EmptyState';

type ProponentProfileData = {
  id: number;
  user_id: number | null;
  business_name: string;
  registration_no: string | null;
  tin: string | null;
  address: string | null;
  contact_no: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_active: number | boolean;
};

type ChangeRequest = {
  id: number;
  status: string;
  payload: Record<string, string | null>;
  review_remarks: string | null;
  created_at: string | null;
  reviewed_at: string | null;
};

type MeResponse = {
  success: boolean;
  data: ProponentProfileData;
  pendingChangeRequest: ChangeRequest | null;
  changeRequestHistory: ChangeRequest[];
  editableFields: string[];
  message?: string;
  code?: string;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; res: MeResponse }
  | { status: 'no-profile' }
  | { status: 'error'; message: string };

const EDITABLE: { key: keyof ProponentProfileData; label: string }[] = [
  { key: 'business_name', label: 'Business Name' },
  { key: 'registration_no', label: 'Registration No.' },
  { key: 'tin', label: 'TIN' },
  { key: 'address', label: 'Address' },
  { key: 'contact_no', label: 'Contact No.' },
];

const FIELD_LABELS: Record<string, string> = Object.fromEntries(EDITABLE.map((f) => [f.key, f.label]));

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-secondary">{label}</span>
      <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
        {value && value.trim() ? value : '—'}
      </span>
    </div>
  );
}

export function ProponentProfile() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/proponents/me', { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as MeResponse;
      if (res.status === 404 || json?.code === 'NO_PROPONENT_PROFILE') {
        setState({ status: 'no-profile' });
        return;
      }
      if (!res.ok || !json?.success) {
        setState({ status: 'error', message: String(json?.message || 'Failed to load your profile.') });
        return;
      }
      setState({ status: 'ready', res: json });
    } catch {
      setState({ status: 'error', message: 'Failed to load your profile.' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startEditing(p: ProponentProfileData) {
    setForm({
      business_name: p.business_name || '',
      registration_no: p.registration_no || '',
      tin: p.tin || '',
      address: p.address || '',
      contact_no: p.contact_no || '',
    });
    setEditing(true);
  }

  async function submitRequest() {
    setSaving(true);
    try {
      const res = await fetch('/api/proponents/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to submit change request');
      toast.success('Change request submitted for CIAC review.');
      setEditing(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to submit change request');
    } finally {
      setSaving(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin opacity-60" style={{ color: 'var(--text)' }} />
      </div>
    );
  }

  if (state.status === 'no-profile') {
    return (
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <EmptyState
          title="No business profile linked"
          description="Your account isn't linked to a locator/company profile yet. Please contact CIAC to have your account linked."
        />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <EmptyState title="Couldn't load your profile" description={state.message} />
      </div>
    );
  }

  const { data: p, pendingChangeRequest, changeRequestHistory } = state.res;
  const isActive = Number(p.is_active) === 1 || p.is_active === true;
  const hasPending = Boolean(pendingChangeRequest);
  const reviewedHistory = (changeRequestHistory || []).filter((r) => r.status !== 'PENDING').slice(0, 3);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div
        className="relative overflow-hidden rounded-2xl px-4 py-5 sm:px-6 sm:py-6 !border-transparent"
        style={{
          backgroundColor: 'var(--surface)',
          boxShadow: '0 6px 16px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
        }}
      >
        <div className="pointer-events-none absolute -top-32 -right-32 h-80 w-80 rounded-full bg-blue-600/30 blur-[100px]" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="p-2.5 rounded-xl border shrink-0"
              style={{ backgroundColor: 'var(--control-bg)', borderColor: 'var(--border-subtle)' }}
            >
              <Building2 size={22} style={{ color: 'var(--text)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg sm:text-xl font-bold tracking-tight truncate" style={{ color: 'var(--text)' }}>
                  {p.business_name}
                </h3>
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border shrink-0"
                  style={{
                    backgroundColor: isActive ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.14)',
                    color: isActive ? '#10b981' : 'var(--text-muted)',
                    borderColor: isActive ? 'rgba(16,185,129,0.24)' : 'var(--border-subtle)',
                  }}
                >
                  {isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs text-secondary">Your registered business information on file with CIAC.</p>
            </div>
          </div>

          {!editing && !hasPending ? (
            <button
              onClick={() => startEditing(p)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm cursor-pointer shrink-0"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            >
              <PencilLine size={13} /> Request changes
            </button>
          ) : null}
        </div>
      </div>

      {hasPending ? (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.08)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} style={{ color: 'rgba(245,158,11,0.95)' }} />
            <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>
              Change request pending review
            </span>
            <span className="text-[11px] text-secondary">· submitted {formatDate(pendingChangeRequest!.created_at)}</span>
          </div>
          <ul className="text-[11px] text-secondary space-y-0.5 ml-1">
            {Object.entries(pendingChangeRequest!.payload || {}).map(([k, v]) => (
              <li key={k}>
                <span className="font-semibold" style={{ color: 'var(--text)' }}>{FIELD_LABELS[k] || k}:</span>{' '}
                {v || '—'}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-secondary">
            You can submit new changes once CIAC has reviewed this request.
          </p>
        </div>
      ) : null}

      {editing ? (
        <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <h4 className="text-sm font-bold mb-1" style={{ color: 'var(--text)' }}>
            Request profile changes
          </h4>
          <p className="text-[11px] text-secondary mb-4">
            Edit the fields you want to change. Your request goes to CIAC for approval before it takes effect.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {EDITABLE.map((f) => (
              <div key={f.key} className={f.key === 'address' ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-secondary">{f.label}</label>
                <input
                  className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                  style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={submitRequest}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm cursor-pointer disabled:opacity-60"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            >
              {saving ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-sm font-semibold border cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <h4 className="text-sm font-bold mb-4" style={{ color: 'var(--text)' }}>
            Business &amp; Registration
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
            <Field label="Business Name" value={p.business_name} />
            <Field label="Registration No." value={p.registration_no} />
            <Field label="TIN" value={p.tin} />
            <Field label="Contact No." value={p.contact_no} />
            <div className="sm:col-span-2">
              <Field label="Address" value={p.address} />
            </div>
          </div>
        </div>
      )}

      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <h4 className="text-sm font-bold mb-4" style={{ color: 'var(--text)' }}>
          Record
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          <Field label="Profile Created" value={formatDate(p.created_at)} />
          <Field label="Last Updated" value={formatDate(p.updated_at)} />
        </div>

        {reviewedHistory.length > 0 ? (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-secondary">Recent change requests</span>
            <ul className="mt-2 space-y-1.5">
              {reviewedHistory.map((r) => (
                <li key={r.id} className="text-[11px] text-secondary flex items-center gap-2">
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold"
                    style={
                      r.status === 'APPROVED'
                        ? { backgroundColor: 'rgba(16,185,129,0.12)', color: '#10b981' }
                        : { backgroundColor: 'rgba(220,38,38,0.12)', color: '#fca5a5' }
                    }
                  >
                    {r.status}
                  </span>
                  <span>{formatDate(r.reviewed_at || r.created_at)}</span>
                  {r.review_remarks ? <span>· {r.review_remarks}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
