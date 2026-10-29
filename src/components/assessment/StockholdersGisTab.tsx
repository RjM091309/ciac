import React, { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DatePicker, parseYmd, toYmd } from '../ui/DatePicker';
import { cn } from '../../lib/utils';
import {
  CapitalField,
  NATIONALITIES,
  RowsEditor,
  STOCKHOLDER_RULES,
  blankStockholderRow,
  invalidRowKeys,
  mapStockholderRows,
  rowsError,
  toStockholderPayload,
  type StockholderRow,
} from '../proponent/ProponentsManagement';

/**
 * Evaluation Queue → "Stockholders + GIS" tab (B-11): the stockholders and the
 * SEC registration details (as on the General Information Sheet), encoded by
 * the BDO while evaluating. Same rows as the Registered Locator's Stockholders
 * tab (GET/PUT /api/assessments/:id/stockholders). No Ref. Code here — it's set
 * on the Registered Locator only. The GIS file is the locator's "GIS"
 * compliance document, shown read-only. Same edit rule as Proponent Information.
 */

const SEC_TEXT = [
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
          : String(v ?? '');
  }
  f.stockholders = mapStockholderRows(d?.stockholders);
  return f;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] font-semibold uppercase tracking-widest text-secondary">{children}</div>;
}

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Card({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-3"
      style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
    >
      <div
        className="-mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2"
        style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
          {title}
        </span>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function StockholdersGisTab({ applicationId, canEdit = true }: { applicationId: number; canEdit?: boolean }) {
  const [loaded, setLoaded] = useState<{ form: Form; editable: boolean; reason: string | null; gis: GisDocument } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [rowDelete, setRowDelete] = useState<{ what: string; proceed: () => void } | null>(null);

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

  if (!form || !loaded) {
    return <div className="py-8 text-center text-[12px] text-secondary">Loading the stockholders…</div>;
  }
  const editable = loaded.editable && canEdit;
  const set = (patch: Partial<Form>) => setForm((p) => (p ? { ...p, ...patch } : p));
  const input = 'app-form-control app-form-control-sm w-full h-9';

  async function save() {
    if (!form) return;
    const problem = rowsError('Stockholders', form.stockholders, STOCKHOLDER_RULES);
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
      toast.success('Stockholders and SEC registration saved');
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
      currency={form[`${prefix}_currency`]}
      disabled={!editable}
      onAmountChange={(v) => set({ [prefix]: v } as Partial<Form>)}
      onCurrencyChange={(v) => set({ [`${prefix}_currency`]: v } as Partial<Form>)}
    />
  );
  const gis = loaded.gis;

  return (
    // @container: the fields respond to the drawer's width, not the screen's.
    <div className="@container flex flex-col gap-4">
      {!editable && loaded.reason ? (
        <div
          className="rounded-lg border px-3 py-2 text-[12px] text-secondary"
          style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
        >
          {loaded.reason}
        </div>
      ) : null}

      <fieldset disabled={!editable || saving} className="flex min-w-0 flex-col gap-4">
        <Card
          title={`Stockholders (${form.stockholders.length})`}
          actions={
            editable ? (
              <button
                type="button"
                onClick={() => {
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
            invalidKeys={(row) => (showErrors ? invalidRowKeys(row, STOCKHOLDER_RULES) : null)}
            columns={[
              { key: 'name', label: 'Stockholder Name', width: '30%', placeholder: 'Full name' },
              { key: 'nationality', label: 'Nationality', width: '18%', placeholder: 'Select nationality', options: NATIONALITIES },
              { key: 'subscribed', label: 'Subscribed', width: '18%', numeric: true, amount: true, placeholder: '0.00' },
              { key: 'paid', label: 'Paid', width: '18%', numeric: true, amount: true, placeholder: '0.00' },
              { key: 'ownership', label: 'Ownership %', width: '16%', numeric: true, placeholder: '0' },
            ]}
            onChange={(next) => set({ stockholders: next })}
            blankRow={blankStockholderRow}
          />
        </Card>

        <Card title="SEC Registration Information">
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
            {text('registration_no', 'SEC Registration No.', 'e.g. CS201811260')}
            {date('sec_registration_date', 'SEC Registration Date')}
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
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
            {text('sec_company_email', "Company's Email Address")}
            {text('sec_company_telephone', "Company's Telephone No.")}
            {text('sec_company_mobile', "Company's Mobile No.")}
          </div>
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
            {capital('authorized_capital', 'Authorized Capital Stock')}
            {capital('subscribed_capital', 'Subscribed Capital')}
            {capital('paid_up_capital', 'Paid-up Capital')}
          </div>
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
          <div className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--input-border)' }}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-secondary">SEC Contact Person</div>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
              {text('sec_contact_name', 'Name of Contact Person')}
              {text('sec_contact_email', 'Email Address')}
              {text('sec_contact_telephone', 'Telephone No.')}
              {text('sec_contact_mobile', 'Mobile No.')}
            </div>
          </div>
        </Card>

        <Card title="GIS (General Information Sheet)">
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
            {date('sec_gis_date', 'Latest GIS Filing')}
            <Cell label="GIS document (Compliance)">
              <div
                className="app-form-control app-form-control-sm flex h-9 items-center gap-2 text-[12px]"
                style={{ backgroundColor: 'var(--control-bg)', cursor: 'default' }}
                title="Uploaded by the locator on their Compliance page (or by the Compliance Officer)"
              >
                {gis ? (
                  <>
                    <span className="truncate font-medium" style={{ color: 'var(--text)' }}>
                      {gis.original_file_name || 'GIS'}
                    </span>
                    <span className="shrink-0 text-secondary">
                      · {String(gis.status || '').replace(/_/g, ' ').toLowerCase() || 'uploaded'}
                      {gis.validity_to ? ` · valid until ${fmtDate(gis.validity_to)}` : ''}
                    </span>
                  </>
                ) : (
                  <span className="text-secondary">Not uploaded yet</span>
                )}
              </div>
            </Cell>
          </div>
        </Card>
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
            {saving ? 'Saving…' : 'Save Stockholders + GIS'}
          </button>
        </div>
      ) : null}

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
