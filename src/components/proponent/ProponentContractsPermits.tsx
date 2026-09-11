import React, { useEffect, useState } from 'react';
import { Loader2, ScrollText, ShieldCheck } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { clearLocatorSetupSkipAndReload } from '../../lib/locatorSetup';

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

type ContractRow = {
  id: number;
  application_id: number;
  contract_no: string;
  issue_date: string | null;
  effective_start: string | null;
  effective_end: string | null;
  application_no: string | null;
  is_renewal: number | null;
};

type PermitRow = {
  id: number;
  application_id: number | null;
  permit_type: string;
  permit_no: string;
  issuing_authority: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  effective_status: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'REVOKED';
};

const PERMIT_TYPE_LABELS: Record<string, string> = {
  ENVIRONMENTAL: 'Environmental',
  FIRE: 'Fire Safety',
  OCCUPANCY: 'Occupancy',
  SANITARY: 'Sanitary',
  AUTHORITY_TO_OPERATE: 'Authority to Operate',
};

const PERMIT_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  VALID: { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  EXPIRING: { bg: 'rgba(245,158,11,0.14)', color: '#f59e0b' },
  EXPIRED: { bg: 'rgba(220,38,38,0.14)', color: '#fca5a5' },
  REVOKED: { bg: 'rgba(148,163,184,0.14)', color: 'var(--text-muted)' },
};

function fmtDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Card({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
      <div className="flex items-center gap-2 mb-4">
        <Icon size={16} style={{ color: 'var(--text)' }} />
        <h4 className="text-sm font-bold" style={{ color: 'var(--text)' }}>{title}</h4>
      </div>
      {children}
    </div>
  );
}

export function ProponentContractsPermits({ navigate }: { navigate: Navigate }) {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [permits, setPermits] = useState<PermitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, pRes] = await Promise.all([
          fetch('/api/proponents/me/contracts', { credentials: 'include' }),
          fetch('/api/proponents/me/permits', { credentials: 'include' }),
        ]);
        const cJson = await cRes.json().catch(() => ({}));
        const pJson = await pRes.json().catch(() => ({}));
        if (cancelled) return;
        if (!cRes.ok) throw new Error(cJson?.message || 'Failed to load contracts');
        if (!pRes.ok) throw new Error(pJson?.message || 'Failed to load permits');
        setContracts(Array.isArray(cJson.data) ? cJson.data : []);
        setPermits(Array.isArray(pJson.data) ? pJson.data : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load');
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
    const noProfile = /no proponent profile/i.test(error);
    return (
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <EmptyState
          title="Couldn't load contracts & permits"
          description={noProfile ? "You skipped the business profile setup — finish it to unlock the rest of the portal." : error}
          action={
            noProfile ? (
              <button
                className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors cursor-pointer"
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                onClick={clearLocatorSetupSkipAndReload}
              >
                Complete your business profile
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card title="Executed Contracts" icon={ScrollText}>
        {contracts.length === 0 ? (
          <EmptyState title="No contracts yet" description="No executed lease contracts are on record for your business." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Contract No.', 'Application', 'Issued', 'Effective', 'Expires'].map((c) => (
                    <th key={c} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{c.contract_no}</td>
                    <td className="px-3 py-2 text-[11px]">
                      <button
                        className="underline text-secondary hover:text-[var(--text)] cursor-pointer"
                        onClick={() => navigate(`/me/applications?applicationId=${c.application_id}`)}
                      >
                        {c.application_no || `#${c.application_id}`}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{fmtDate(c.issue_date)}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{fmtDate(c.effective_start)}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{fmtDate(c.effective_end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Permits" icon={ShieldCheck}>
        {permits.length === 0 ? (
          <EmptyState title="No permits yet" description="No permits are on record for your business." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Type', 'Permit No.', 'Issuing Authority', 'Issued', 'Expiry', 'Status'].map((c) => (
                    <th key={c} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permits.map((p) => {
                  const s = PERMIT_STATUS_STYLE[p.effective_status] || PERMIT_STATUS_STYLE.REVOKED;
                  return (
                    <tr key={p.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{PERMIT_TYPE_LABELS[p.permit_type] || p.permit_type}</td>
                      <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{p.permit_no}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{p.issuing_authority || '—'}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{fmtDate(p.issue_date)}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary">{fmtDate(p.expiry_date)}</td>
                      <td className="px-3 py-2 text-[11px]">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>
                          {p.effective_status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
