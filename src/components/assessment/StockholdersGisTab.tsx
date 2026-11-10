import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, FileText, Globe2, Landmark, Mail, Percent, Plus, Target, UserRound, Users } from 'lucide-react';
import { Card as TabCard, ReasonBanner, SaveButton, Section } from './tabParts';
import { toast } from 'sonner';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DatePicker, parseYmd, toYmd } from '../ui/DatePicker';
import { cn } from '../../lib/utils';
import {
  CapitalField,
  NATIONALITIES,
  OwnershipSummary,
  ownershipError,
  ownershipFullNotice,
  stockholderInvalidKeys,
  stockholderTotals,
  useOwnershipNotice,
  RegistrationTypeToggle,
  RowsEditor,
  STOCKHOLDER_RULES,
  blankStockholderRow,
  formatMoney,
  invalidRowKeys,
  mapStockholderRows,
  registrationLabels,
  registrationTypeOf,
  recomputeAllOwnership,
  rowsError,
  toStockholderPayload,
  withOwnership,
  type StockholderRow,
} from '../proponent/ProponentsManagement';

/**
 * Evaluation Queue → "Stockholders / GIS" tab (B-11): the stockholders and the
 * SEC or DTI registration details (as on the General Information Sheet), encoded by
 * the BDO while evaluating. Same rows as the Registered Locator's Stockholders
 * tab (GET/PUT /api/assessments/:id/stockholders). No Ref. Code here — it's set
 * on the Registered Locator only. The GIS file is the locator's "GIS"
 * compliance document, shown read-only. Same edit rule as Proponent Information.
 */

const SEC_TEXT = [
  'registration_type',
  'registration_no',
  'tin',
  'address',
  'sec_registration_date',
  'authorized_capital',
  'authorized_capital_currency',
  'subscribed_capital',
  'subscribed_capital_currency',
  'paid_up_capital',
  'paid_up_capital_currency',
  'sec_company_email',
  'sec_company_telephone',
  'sec_company_mobile',
  'sec_primary_purpose',
  'sec_secondary_purpose',
  'sec_gis_date',
  'sec_contact_name',
  'sec_contact_email',
  'sec_contact_telephone',
  'sec_contact_mobile',
] as const;
type SecKey = (typeof SEC_TEXT)[number];
type Form = Record<SecKey, string> & { stockholders: StockholderRow[] };
type GisDocument = { original_file_name: string | null; status: string | null; validity_to: string | null; uploaded_at: string | null } | null;

const ymd = (v: unknown) => (v ? String(v).slice(0, 10) : '');

function toForm(d: any): Form {
  const f = {} as Form;
  for (const key of SEC_TEXT) {
    const v = d?.[key];
    f[key] =
      key === 'sec_registration_date' || key === 'sec_gis_date'
        ? ymd(v)
        : key.endsWith('_currency')
          ? String(v || 'PHP')
          : key.endsWith('_capital')
            ? formatMoney(v)
            : String(v ?? '');
  }
  // Subscribed and Paid-up follow the Authorized Capital Stock's currency.
  f.subscribed_capital_currency = f.authorized_capital_currency;
  f.paid_up_capital_currency = f.authorized_capital_currency;
  f.stockholders = recomputeAllOwnership(mapStockholderRows(d?.stockholders), f.subscribed_capital);
  return f;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
      {children}
    </div>
  );
}

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** One summary figure above the cards. */
function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn';
}) {
  const color = tone === 'good' ? '#10b981' : tone === 'warn' ? '#d97706' : 'var(--text)';
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3 shadow-sm" style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--surface)' }}>
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 12%, transparent)', color: 'var(--nav-active-bg)' }}
      >
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-widest text-secondary">{label}</div>
        <div className="truncate text-[15px] font-bold leading-tight tabular-nums" style={{ color }}>
          {value}
        </div>
        {hint ? <div className="truncate text-[10px] text-secondary">{hint}</div> : null}
      </div>
    </div>
  );
}

export function StockholdersGisTab({ applicationId, canEdit = true }: { applicationId: number; canEdit?: boolean }) {
  const [loaded, setLoaded] = useState<{ form: Form; editable: boolean; reason: string | null; gis: GisDocument } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [rowDelete, setRowDelete] = useState<{ what: string; proceed: () => void } | null>(null);
  // Switching to DTI with stockholders listed asks first.
  const [regTypeConfirm, setRegTypeConfirm] = useState(false);

  const apply = (d: any) => {
    const next = toForm(d);
    setLoaded({ form: next, editable: Boolean(d?.editable), reason: d?.reason ?? null, gis: d?.gis_document ?? null });
    setForm(next);
  };

  useEffect(() => {
    setLoaded(null);
    setForm(null);
    setShowErrors(false);
    fetch(`/api/assessments/${applicationId}/stockholders`, { credentials: 'include' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) throw new Error(json?.message || 'Failed to load the stockholders');
        apply(json.data);
      })
      .catch((e) => toast.error(e?.message || 'Failed to load the stockholders'));
  }, [applicationId]);

  const dirty = useMemo(() => Boolean(form && loaded && JSON.stringify(form) !== JSON.stringify(loaded.form)), [form, loaded]);
  // Ownership % over 100: a notice while typing, and the fields outlined.
  const ownershipProblem = useOwnershipNotice(
    form?.stockholders ?? [],
    form?.subscribed_capital ?? '',
    Boolean(form) && registrationTypeOf(form?.registration_type) !== 'DTI',
  );

  if (!form || !loaded) {
    return <div className="py-8 text-center text-[12px] text-secondary">Loading the stockholders…</div>;
  }
  const editable = loaded.editable && canEdit;
  const set = (patch: Partial<Form>) => setForm((p) => (p ? { ...p, ...patch } : p));
  const input = 'app-form-control app-form-control-sm w-full h-9';

  const regType = registrationTypeOf(form.registration_type);
  const regLabels = registrationLabels(regType);

  async function save() {
    if (!form) return;
    // DTI (sole proprietorship): the hidden stockholders list isn't checked.
    const problem =
      regType === 'DTI'
        ? null
        : rowsError('Stockholders', form.stockholders, STOCKHOLDER_RULES) ?? ownershipError(form.stockholders, form.subscribed_capital);
    if (problem) {
      setShowErrors(true);
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { stockholders: form.stockholders.map(toStockholderPayload) };
      for (const key of SEC_TEXT) body[key] = String(form[key] ?? '').trim() || null;
      const res = await fetch(`/api/assessments/${applicationId}/stockholders`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.message || 'Save failed');
      apply(json.data);
      setShowErrors(false);
      toast.success(regType === 'DTI' ? 'DTI registration saved' : 'Stockholders and SEC registration saved');
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const text = (key: SecKey, label: string, placeholder?: string, className?: string) => (
    <Cell label={label} className={className}>
      <input className={input} value={form[key]} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<Form>)} />
    </Cell>
  );
  const date = (key: 'sec_registration_date' | 'sec_gis_date', label: string) => (
    <Cell label={label}>
      <DatePicker
        mode="single"
        fullWidth
        boxed
        placeholder="Select date"
        value={parseYmd(form[key])}
        onChange={(d: Date | null) => set({ [key]: toYmd(d) } as Partial<Form>)}
      />
    </Cell>
  );
  const capital = (prefix: 'authorized_capital' | 'subscribed_capital' | 'paid_up_capital', label: string) => (
    <CapitalField
      label={label}
      amount={form[prefix]}
      // Subscribed and Paid-up follow the Authorized Capital Stock's currency.
      currency={form.authorized_capital_currency}
      currencyText={prefix !== 'authorized_capital'}
      currencyTitle={prefix !== 'authorized_capital' ? "Same as the Authorized Capital Stock's currency" : undefined}
      disabled={!editable}
      onAmountChange={(v) =>
        set(
          (prefix === 'subscribed_capital'
            ? { subscribed_capital: v, stockholders: recomputeAllOwnership(form.stockholders, v) }
            : { [prefix]: v }) as Partial<Form>,
        )
      }
      onCurrencyChange={(v) =>
        set({ authorized_capital_currency: v, subscribed_capital_currency: v, paid_up_capital_currency: v } as Partial<Form>)
      }
    />
  );
  const gis = loaded.gis;
  const ownershipTotal =
    Math.round(form.stockholders.reduce((sum, r) => sum + (Number(String((r as any).ownership ?? '').replace(/,/g, '')) || 0), 0) * 100) / 100;
  const nationalities = Array.from(
    new Set(form.stockholders.map((r) => String((r as any).nationality || '').trim().toUpperCase()).filter(Boolean))
  );

  return (
    // @container: the fields respond to the drawer's width, not the screen's.
    <div className="@container flex flex-col gap-4">
      {!editable ? <ReasonBanner reason={loaded.reason} /> : null}

      {/* At a glance: how many, whether the shares add up, the mix, the GIS. */}
      <div className={cn('grid grid-cols-2 gap-3', regType === 'DTI' ? '@3xl:grid-cols-2' : '@3xl:grid-cols-4')}>
        {regType === 'DTI' ? null : (
        <>
        <StatTile icon={Users} label="Stockholders" value={String(form.stockholders.length)} />
        <StatTile
          icon={Percent}
          label="Total ownership"
          value={`${ownershipTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`}
          hint={ownershipTotal === 100 ? 'Adds up to 100%' : form.stockholders.length ? 'Should add up to 100%' : undefined}
          tone={form.stockholders.length ? (ownershipTotal === 100 ? 'good' : 'warn') : undefined}
        />
        <StatTile
          icon={Globe2}
          label="Nationalities"
          value={String(nationalities.length)}
          hint={nationalities.slice(0, 3).join(', ') || undefined}
        />
        </>
        )}
        <StatTile
          icon={FileText}
          label="Latest GIS filing"
          value={form.sec_gis_date ? fmtDate(form.sec_gis_date) : '—'}
          hint={gis ? String(gis.status || 'uploaded').replace(/_/g, ' ').toLowerCase() : 'No GIS uploaded'}
          tone={gis ? undefined : 'warn'}
        />
      </div>

      <fieldset disabled={!editable || saving} className="flex min-w-0 flex-col gap-4">
        <TabCard
          title={regLabels.card}
          icon={Landmark}
          actions={editable && dirty ? <SaveButton saving={saving} onClick={() => void save()} /> : null}
        >
          <RegistrationTypeToggle
            value={regType}
            disabled={!editable}
            onChange={(next) => {
              if (next === 'DTI' && form.stockholders.length > 0) setRegTypeConfirm(true);
              else set({ registration_type: next });
            }}
          />
          <Section title="Registration" icon={Landmark}>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
              {text('registration_no', regLabels.no, regLabels.noPlaceholder)}
              {date('sec_registration_date', regLabels.date)}
              {text('tin', 'TIN Number')}
            </div>
            <Cell label="Principal Office Address">
              <textarea
                className={cn(input, 'h-auto min-h-[4rem]')}
                placeholder="No. / Street / Barangay / City / Town / Province / Zip code"
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            </Cell>
          </Section>
          <Section title="Company Contact" icon={Mail}>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
              {text('sec_company_email', "Company's Email Address")}
              {text('sec_company_telephone', "Company's Telephone No.")}
              {text('sec_company_mobile', "Company's Mobile No.")}
            </div>
          </Section>
          <Section title="Capital" icon={Banknote}>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
              {capital('authorized_capital', 'Authorized Capital Stock')}
              {capital('subscribed_capital', 'Subscribed Capital')}
              {capital('paid_up_capital', 'Paid-up Capital')}
            </div>
          </Section>
          <Section title="Purpose" icon={Target}>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
              <Cell label="Primary Purpose">
                <textarea
                  className={cn(input, 'h-auto min-h-[4rem]')}
                  value={form.sec_primary_purpose}
                  onChange={(e) => set({ sec_primary_purpose: e.target.value })}
                />
              </Cell>
              <Cell label="Secondary Purpose">
                <textarea
                  className={cn(input, 'h-auto min-h-[4rem]')}
                  value={form.sec_secondary_purpose}
                  onChange={(e) => set({ sec_secondary_purpose: e.target.value })}
                />
              </Cell>
            </div>
          </Section>
          <Section title={regLabels.contact} icon={UserRound}>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
              {text('sec_contact_name', 'Name of Contact Person')}
              {text('sec_contact_email', 'Email Address')}
              {text('sec_contact_telephone', 'Telephone No.')}
              {text('sec_contact_mobile', 'Mobile No.')}
            </div>
          </Section>
        </TabCard>

        {/* DTI (sole proprietorship): no stockholders. */}
        {regType === 'DTI' ? null : (
        <TabCard
          title={`Stockholders (${form.stockholders.length})`}
          icon={Users}
          actions={
            editable ? (
              <button
                type="button"
                onClick={() => {
                  const full = ownershipFullNotice(form.stockholders, form.subscribed_capital);
                  if (full) {
                    toast.warning(full, { id: 'ownership-full' });
                    return;
                  }
                  setShowErrors(false);
                  set({ stockholders: [...form.stockholders, blankStockholderRow()] });
                }}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer hover:bg-[var(--selected-bg)]"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
              >
                <Plus size={12} /> Add stockholder
              </button>
            ) : null
          }
        >
          <RowsEditor<StockholderRow>
            rows={form.stockholders}
            disabled={!editable}
            emptyText="No stockholders yet — use Add stockholder."
            hideSideActions
            rowNoun="stockholder"
            confirmDelete={(what, proceed) => setRowDelete({ what, proceed })}
            invalidKeys={(row) => stockholderInvalidKeys(row, showErrors, Boolean(ownershipProblem))}
            columns={[
              { key: 'name', label: 'Stockholder Name', width: '30%', placeholder: 'Full name' },
              { key: 'nationality', label: 'Nationality', width: '18%', placeholder: 'Select nationality', options: NATIONALITIES },
              { key: 'subscribed', label: 'Subscribed', width: '18%', numeric: true, amount: true, placeholder: '0.00' },
              { key: 'paid', label: 'Paid', width: '18%', numeric: true, amount: true, placeholder: '0.00' },
              { key: 'ownership', label: 'Ownership %', width: '16%', numeric: true, placeholder: '—', readOnly: true },
            ]}
            onChange={(next) => set({ stockholders: withOwnership(form.stockholders, next, form.subscribed_capital) })}
            blankRow={blankStockholderRow}
            totals={stockholderTotals(form.stockholders)}
          />
          <OwnershipSummary rows={form.stockholders} subscribedCapital={form.subscribed_capital} />
        </TabCard>
        )}

        <TabCard title="GIS (General Information Sheet)" icon={FileText}>
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
            {date('sec_gis_date', 'Latest GIS Filing')}
            <Cell label="GIS document (Compliance)">
              <div
                className="flex min-h-9 items-center gap-2.5 rounded-lg border px-3 py-1.5 text-[12px]"
                style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)', borderStyle: gis ? 'solid' : 'dashed' }}
                title="Uploaded by the locator on their Compliance page (or by the Compliance Officer)"
              >
                {gis ? (
                  <>
                    <img src="/images/pdf.png" alt="" className="h-6 w-6 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold" style={{ color: 'var(--text)' }}>
                        {gis.original_file_name || 'GIS'}
                      </div>
                      {gis.validity_to ? <div className="text-[10px] text-secondary">Valid until {fmtDate(gis.validity_to)}</div> : null}
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                      style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 10%, transparent)', color: 'var(--text)' }}
                    >
                      {String(gis.status || 'uploaded').replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </>
                ) : (
                  <span className="text-secondary">Not uploaded yet — the locator uploads it on their Compliance page</span>
                )}
              </div>
            </Cell>
          </div>
        </TabCard>
      </fieldset>

      {editable && dirty ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[12px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
          >
            {saving ? 'Saving…' : 'Save Stockholders / GIS'}
          </button>
        </div>
      ) : null}

      <ConfirmModal
        open={regTypeConfirm}
        title="Switch to DTI?"
        description="A DTI-registered business (sole proprietorship) has no stockholders, so the Stockholders list is hidden. The rows already saved are kept, not deleted — switching back to SEC shows them again."
        confirmText="Switch to DTI"
        onCancel={() => setRegTypeConfirm(false)}
        onConfirm={() => {
          set({ registration_type: 'DTI' });
          setRegTypeConfirm(false);
        }}
      />

      <ConfirmModal
        open={rowDelete !== null}
        title={`Delete ${rowDelete?.what ?? 'row'}?`}
        description="It's removed from the list now and from the proponent when you click Save. Cancel to keep it."
        confirmText="Delete"
        danger
        onCancel={() => setRowDelete(null)}
        onConfirm={() => {
          rowDelete?.proceed();
          setRowDelete(null);
        }}
      />
    </div>
  );
}
