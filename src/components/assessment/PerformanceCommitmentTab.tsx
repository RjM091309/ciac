import React, { useEffect, useState } from 'react';
import { Banknote, Lock, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Card, ReasonBanner, SaveButton } from './tabParts';

/**
 * Evaluation Queue → "Performance Commitment" tab (B-10): the BDO encodes what
 * the proponent commits to — investment and number of employees. Same
 * dbo.proponent_investment row as the Registered Locator's Performance
 * Commitment card (A-15); the BDO sets only the Commitment column, the Actual
 * figures are the Account Officer's once it's a locator
 * (GET/PUT /api/assessments/:id/commitment). Same edit rule as Proponent
 * Information.
 */

type Figures = { investment_commitment: string; employee_commitment: string };
type Actuals = { investment_actual: string; employee_actual: string };

/** "1000000" -> "1,000,000" as typed (digits and one decimal point). */
function formatAmountInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  const intPart = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  const decPart = firstDot === -1 ? '' : cleaned.slice(firstDot + 1).replace(/\./g, '');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return firstDot === -1 ? withCommas : `${withCommas}.${decPart}`;
}

/** Loaded free text: comma-format only a plain number; anything else as saved. */
function formatIfNumeric(value?: string | null): string {
  const text = String(value ?? '').trim();
  return /^[\d,]+(\.\d+)?$/.test(text) ? formatAmountInput(text) : text;
}

/** canEdit: the role's Edit right on this queue (Control Panel). */
export function PerformanceCommitmentTab({ applicationId, canEdit = true }: { applicationId: number; canEdit?: boolean }) {
  const [loaded, setLoaded] = useState<(Figures & Actuals & { editable: boolean; reason: string | null }) | null>(null);
  const [form, setForm] = useState<Figures | null>(null);
  const [saving, setSaving] = useState(false);

  const apply = (d: any) => {
    const next = {
      investment_commitment: formatIfNumeric(d?.investment_commitment),
      employee_commitment: String(d?.employee_commitment ?? ''),
      investment_actual: formatIfNumeric(d?.investment_actual),
      employee_actual: String(d?.employee_actual ?? ''),
      editable: Boolean(d?.editable),
      reason: d?.reason ?? null,
    };
    setLoaded(next);
    setForm({ investment_commitment: next.investment_commitment, employee_commitment: next.employee_commitment });
  };

  useEffect(() => {
    setLoaded(null);
    setForm(null);
    fetch(`/api/assessments/${applicationId}/commitment`, { credentials: 'include' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) throw new Error(json?.message || 'Failed to load the commitment');
        apply(json.data);
      })
      .catch((e) => toast.error(e?.message || 'Failed to load the commitment'));
  }, [applicationId]);

  if (!form || !loaded) {
    return <div className="py-8 text-center text-[12px] text-secondary">Loading the commitment…</div>;
  }
  const editable = loaded.editable && canEdit;
  const dirty =
    form.investment_commitment !== loaded.investment_commitment || form.employee_commitment !== loaded.employee_commitment;

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/assessments/${applicationId}/commitment`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investment_commitment: form.investment_commitment.trim() || null,
          employee_commitment: form.employee_commitment.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.message || 'Save failed');
      apply(json.data);
      toast.success('Performance Commitment saved');
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const rows = [
    {
      label: 'Investment',
      icon: Banknote,
      hint: 'Total amount the proponent commits to invest',
      key: 'investment_commitment' as const,
      actual: 'investment_actual' as const,
      placeholder: '0.00',
      inputMode: 'decimal' as const,
      clean: formatAmountInput,
    },
    {
      label: 'No. of Employees',
      icon: Users,
      hint: 'People the proponent commits to employ',
      key: 'employee_commitment' as const,
      actual: 'employee_actual' as const,
      placeholder: '0',
      inputMode: 'numeric' as const,
      clean: (v: string) => v.replace(/[^\d]/g, ''),
    },
  ];

  return (
    // @container: the layout responds to the drawer's width, not the screen's.
    <div className="@container flex flex-col gap-4">
      {!editable ? <ReasonBanner reason={loaded.reason} /> : null}

      <Card
        title="Performance Commitment"
        icon={TrendingUp}
        actions={editable && dirty ? <SaveButton saving={saving} onClick={() => void save()} /> : null}
      >
        {/* One tile per figure: the Commitment the BDO encodes, and the Actual
            the Account Officer records later (read-only here). */}
        <fieldset disabled={!editable || saving} className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex flex-col gap-3 rounded-xl border p-4"
              style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 40%, transparent)' }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="grid h-9 w-9 place-items-center rounded-lg"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 12%, transparent)', color: 'var(--nav-active-bg)' }}
                >
                  <row.icon size={17} />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>
                    {row.label}
                  </div>
                  <div className="text-[10px] text-secondary">{row.hint}</div>
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-secondary">Commitment</span>
                <input
                  className="app-form-control w-full h-11 text-[16px] font-semibold tabular-nums"
                  inputMode={row.inputMode}
                  placeholder={row.placeholder}
                  value={form[row.key]}
                  onChange={(e) => {
                    const value = row.clean(e.target.value);
                    setForm((p) => (p ? { ...p, [row.key]: value } : p));
                  }}
                />
              </label>
              <div
                className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px]"
                style={{ borderColor: 'var(--input-border)' }}
                title="Recorded by the Account Officer once it's a Registered Locator"
              >
                <span className="flex items-center gap-1.5 text-secondary">
                  <Lock size={11} /> Actual
                </span>
                <span className="font-semibold tabular-nums" style={{ color: loaded[row.actual] ? 'var(--text)' : 'var(--text-muted)' }}>
                  {loaded[row.actual] || 'Not recorded yet'}
                </span>
              </div>
            </div>
          ))}
        </fieldset>
        <span className="text-[10px] text-secondary">
          What the proponent commits to. The Actual figures are recorded by the Account Officer once it's a Registered
          Locator.
        </span>
      </Card>
    </div>
  );
}
