import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

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
      key: 'investment_commitment' as const,
      actual: 'investment_actual' as const,
      placeholder: '0.00',
      inputMode: 'decimal' as const,
      clean: formatAmountInput,
    },
    {
      label: 'No. of Employees',
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
      {!editable && loaded.reason ? (
        <div
          className="rounded-lg border px-3 py-2 text-[12px] text-secondary"
          style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
        >
          {loaded.reason}
        </div>
      ) : null}

      <div
        className="flex flex-col gap-3 rounded-xl border p-3"
        style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
      >
        <div
          className="-mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2"
          style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
        >
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
            Performance Commitment
          </span>
          {editable && dirty ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md px-3 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          ) : null}
        </div>

        {/* Same layout as the Registered Locator's Performance Commitment card.
            Actual is read-only here — the Account Officer records it later. */}
        <fieldset
          disabled={!editable || saving}
          className="grid grid-cols-2 items-center gap-x-3 gap-y-2 @lg:grid-cols-[max-content_minmax(0,1fr)_minmax(0,1fr)]"
        >
          <span className="hidden @lg:block" />
          <span className="text-[9px] font-semibold uppercase tracking-widest text-secondary">Commitment</span>
          <span className="text-[9px] font-semibold uppercase tracking-widest text-secondary">Actual</span>
          {rows.map((row) => (
            <React.Fragment key={row.key}>
              <span
                className="col-span-2 text-[12px] font-semibold leading-tight @lg:col-span-1 @lg:text-right"
                style={{ color: 'var(--text)' }}
              >
                {row.label}
              </span>
              <input
                className="app-form-control app-form-control-sm h-9 w-full tabular-nums"
                inputMode={row.inputMode}
                placeholder={row.placeholder}
                value={form[row.key]}
                onChange={(e) => {
                  const value = row.clean(e.target.value);
                  setForm((p) => (p ? { ...p, [row.key]: value } : p));
                }}
              />
              <input
                className="app-form-control app-form-control-sm h-9 w-full tabular-nums"
                style={{ color: 'var(--text-muted)', backgroundColor: 'var(--control-bg)', cursor: 'default' }}
                value={loaded[row.actual] || ''}
                placeholder="Recorded by the Account Officer"
                readOnly
                tabIndex={-1}
              />
            </React.Fragment>
          ))}
        </fieldset>
        <span className="text-[10px] text-secondary">
          What the proponent commits to. The Actual figures are recorded by the Account Officer once it's a Registered
          Locator.
        </span>
      </div>
    </div>
  );
}
