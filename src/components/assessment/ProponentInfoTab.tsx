import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, Building2, CheckCircle2, CircleAlert, MapPin, PenLine, Phone, Plus, Users } from 'lucide-react';
import { Card, Chip, LockedValue, Section } from './tabParts';
import { toast } from 'sonner';
import { AppSelect } from '../ui/AppSelect';
import { ConfirmModal } from '../ui/ConfirmModal';
import { LeaseTermInput } from '../settings/LocatorUsersManagement';
import { cn } from '../../lib/utils';
import {
  CONTACT_RULES,
  NationalityInput,
  RowsEditor,
  blankContactPersonRow,
  invalidRowKeys,
  mapContactRows,
  rowsError,
  toContactPayload,
  type ContactPersonRow,
} from '../proponent/ProponentsManagement';

/**
 * Evaluation Queue → "Proponent Information" tab (B-09): the BDO encodes the
 * proponent's details while evaluating. Same dbo.proponents row and contact /
 * signatory tables the Registered Locator shows once approved
 * (GET/PUT /api/assessments/:id/profile). Editable by the assigned Level 2
 * while the review is open, like the Terms tab; read-only otherwise.
 */

type Profile = {
  business_name: string;
  address: string;
  lease_address: string;
  location: string;
  land_use_id: string;
  proposed_lease_term_years: string;
  proposed_lease_term_unit: 'YEARS' | 'MONTHS';
  contact_no: string;
  business_activities: string;
  nationality: string;
  contact_persons: ContactPersonRow[];
  signatories: ContactPersonRow[];
};

type Loaded = Profile & {
  login_email: string | null;
  contract_type_name: string | null;
  business_type: string | null;
  editable: boolean;
  reason: string | null;
};

// What the BDO has to fill in before the profile counts as complete — the
// details known at application time (the lease terms, extension, grace
// period, rates and the Account Officer come later, on the Registered Locator).
const REQUIRED: { key: keyof Profile; label: string }[] = [
  { key: 'business_name', label: 'Business Name' },
  { key: 'address', label: 'Principal Address' },
  { key: 'lease_address', label: 'Lease Address' },
  { key: 'location', label: 'Location' },
  { key: 'land_use_id', label: 'Land Use' },
  { key: 'proposed_lease_term_years', label: 'Proposed Lease Term' },
  { key: 'contact_no', label: 'Contact No.' },
  { key: 'business_activities', label: 'Business Activities' },
  { key: 'nationality', label: 'Nationality' },
];

function missingRequired(f: Profile): Set<keyof Profile> {
  return new Set(REQUIRED.filter((r) => !String(f[r.key] ?? '').trim()).map((r) => r.key));
}

function toForm(d: any): Loaded {
  return {
    business_name: d?.business_name || '',
    address: d?.address || '',
    lease_address: d?.lease_address || '',
    location: d?.location || '',
    land_use_id: d?.land_use_id != null ? String(d.land_use_id) : '',
    proposed_lease_term_years: d?.proposed_lease_term_years != null ? String(d.proposed_lease_term_years) : '',
    proposed_lease_term_unit: d?.proposed_lease_term_unit === 'MONTHS' ? 'MONTHS' : 'YEARS',
    contact_no: d?.contact_no || '',
    business_activities: d?.business_activities || '',
    nationality: d?.nationality || '',
    contact_persons: mapContactRows(d?.contact_persons),
    signatories: mapContactRows(d?.signatories),
    login_email: d?.login_email ?? null,
    contract_type_name: d?.contract_type_name ?? null,
    business_type: d?.business_type ?? null,
    editable: Boolean(d?.editable),
    reason: d?.reason ?? null,
  };
}

const editableOf = (f: Profile): Profile => ({
  business_name: f.business_name,
  address: f.address,
  lease_address: f.lease_address,
  location: f.location,
  land_use_id: f.land_use_id,
  proposed_lease_term_years: f.proposed_lease_term_years,
  proposed_lease_term_unit: f.proposed_lease_term_unit,
  contact_no: f.contact_no,
  business_activities: f.business_activities,
  nationality: f.nationality,
  contact_persons: f.contact_persons,
  signatories: f.signatories,
});

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] font-semibold uppercase tracking-widest text-secondary">{children}</div>;
}

function Cell({
  label,
  children,
  bad = false,
  className,
}: {
  label: string;
  children: React.ReactNode;
  bad?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <Label>{label}</Label>
      <div className={cn('min-w-0', bad && '[&>*]:rounded-md [&>*]:ring-1 [&>*]:ring-red-500')}>{children}</div>
    </div>
  );
}


/** Top of the tab: who the proponent is, and how much of the profile is in. */
function SummaryHeader({ form, loaded }: { form: Profile; loaded: Loaded }) {
  const filled = REQUIRED.filter((r) => String(form[r.key] ?? '').trim()).length;
  const checks = [
    ...REQUIRED.map((r) => Boolean(String(form[r.key] ?? '').trim())),
    form.contact_persons.length > 0,
    form.signatories.length > 0,
  ];
  const done = checks.filter(Boolean).length;
  const pct = Math.round((done / checks.length) * 100);
  const complete = done === checks.length;
  const name = form.business_name.trim() || 'Unnamed proponent';
  const initials =
    name
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'P';
  const color = complete ? '#10b981' : '#f59e0b';
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-4 shadow-sm @2xl:flex-row @2xl:items-center"
      style={{
        borderColor: 'var(--input-border)',
        background: 'linear-gradient(135deg, color-mix(in oklab, var(--nav-active-bg) 8%, var(--surface)), var(--surface))',
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[15px] font-bold"
          style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
          aria-hidden
        >
          {initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[16px] font-bold leading-tight" style={{ color: 'var(--text)' }}>
            {name}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {loaded.contract_type_name ? <Chip tone="accent">{loaded.contract_type_name}</Chip> : null}
            {loaded.business_type ? <Chip>{loaded.business_type}</Chip> : null}
            {form.nationality.trim() ? <Chip>{form.nationality.trim().toUpperCase()}</Chip> : null}
          </div>
        </div>
      </div>
      <div className="w-full @2xl:w-64">
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 font-semibold" style={{ color }}>
            {complete ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
            {complete ? 'Profile complete' : 'Profile incomplete'}
          </span>
          <span className="text-secondary">{pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--input-border)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
        <div className="mt-1 text-[10px] text-secondary">
          {filled}/{REQUIRED.length} required fields · {form.contact_persons.length ? '✓' : '✗'} contact ·{' '}
          {form.signatories.length ? '✓' : '✗'} signatory
        </div>
      </div>
    </div>
  );
}

/** canEdit: the role's Edit right on this queue (Control Panel); the server
 * also says whether this user may edit right now (assigned Level 2, review open). */
export function ProponentInfoTab({
  applicationId,
  canEdit = true,
  onSaved,
}: {
  applicationId: number;
  canEdit?: boolean;
  /** After a save, with the saved business name (the drawer header / queue show it). */
  onSaved?: (businessName: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Profile | null>(null);
  const [landUses, setLandUses] = useState<{ id: number; name: string; is_active: number | boolean }[]>([]);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [rowDelete, setRowDelete] = useState<{ what: string; proceed: () => void } | null>(null);

  const load = async () => {
    const res = await fetch(`/api/assessments/${applicationId}/profile`, { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) throw new Error(json?.message || 'Failed to load the proponent');
    const next = toForm(json.data);
    setLoaded(next);
    setForm(editableOf(next));
  };

  useEffect(() => {
    setLoaded(null);
    setForm(null);
    setShowErrors(false);
    load().catch((e) => toast.error(e?.message || 'Failed to load the proponent'));
    fetch('/api/proponents/land-uses', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => setLandUses(Array.isArray(j?.data) ? j.data : []))
      .catch(() => setLandUses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const dirty = useMemo(
    () => Boolean(form && loaded && JSON.stringify(form) !== JSON.stringify(editableOf(loaded))),
    [form, loaded],
  );
  const landUseOptions = useMemo(
    () =>
      landUses
        .filter((l) => Number(l.is_active) === 1 || String(l.id) === form?.land_use_id)
        .map((l) => ({ value: String(l.id), label: l.name })),
    [landUses, form?.land_use_id],
  );

  if (!form || !loaded) {
    return <div className="py-8 text-center text-[12px] text-secondary">Loading the proponent…</div>;
  }
  const editable = loaded.editable && canEdit;
  const set = (patch: Partial<Profile>) => setForm((p) => (p ? { ...p, ...patch } : p));
  const missingNow = showErrors ? missingRequired(form) : null;
  const bad = (key: keyof Profile) => Boolean(missingNow?.has(key));

  async function save() {
    if (!form) return;
    const missing = missingRequired(form);
    const listProblem =
      form.contact_persons.length === 0
        ? 'Add at least one Contact Person.'
        : form.signatories.length === 0
          ? 'Add at least one Authorized Person / Signatory.'
          : null;
    const problem =
      (missing.size
        ? `Fill in ${REQUIRED.filter((r) => missing.has(r.key))
            .map((r) => r.label)
            .join(', ')}.`
        : null) ??
      listProblem ??
      rowsError('Contact Person', form.contact_persons, CONTACT_RULES) ??
      rowsError('Authorized Signatory', form.signatories, CONTACT_RULES);
    if (problem) {
      setShowErrors(true);
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/assessments/${applicationId}/profile`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: form.business_name.trim(),
          address: form.address.trim() || null,
          lease_address: form.lease_address.trim() || null,
          location: form.location.trim() || null,
          land_use_id: form.land_use_id ? Number(form.land_use_id) : null,
          proposed_lease_term_years: form.proposed_lease_term_years.trim() || null,
          proposed_lease_term_unit: form.proposed_lease_term_unit,
          contact_no: form.contact_no.trim() || null,
          business_activities: form.business_activities.trim() || null,
          nationality: form.nationality.trim() || null,
          contact_persons: form.contact_persons.map(toContactPayload),
          signatories: form.signatories.map(toContactPayload),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.message || 'Save failed');
      const next = toForm(json.data);
      setLoaded(next);
      setForm(editableOf(next));
      setShowErrors(false);
      onSaved?.(next.business_name);
      toast.success('Proponent information saved');
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // One height for every control (36px), like the Locator Information panel.
  const input = 'app-form-control app-form-control-sm w-full h-9';
  const groups = [
    {
      title: 'Contact Person',
      icon: Phone,
      nameLabel: 'Contact Person',
      addLabel: 'Add contact',
      rows: form.contact_persons,
      empty: 'No contact persons yet — use Add contact.',
      setRows: (next: ContactPersonRow[]) => set({ contact_persons: next }),
    },
    {
      title: 'Authorized Person / Signatory',
      icon: PenLine,
      nameLabel: 'Signatory',
      addLabel: 'Add signatory',
      rows: form.signatories,
      empty: 'No signatories yet — use Add signatory.',
      setRows: (next: ContactPersonRow[]) => set({ signatories: next }),
    },
  ];

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

      <SummaryHeader form={form} loaded={loaded} />

      <fieldset disabled={!editable || saving} className="flex min-w-0 flex-col gap-4">
        <Card
          title="Proponent Information"
          icon={Building2}
          actions={
            editable && dirty ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-md px-3 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            ) : null
          }
        >
          {/* Same arrangement as the Registered Locator's Locator Information:
              name / contract / industry on top, the two addresses with the lease
              term, then location / land use / contact / nationality, and Business
              Activities. * = needed before the profile is complete. */}
          <Section title="Business" icon={Briefcase}>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-[1.6fr_1.6fr_1.1fr]">
              <Cell label="Business Name *" bad={bad('business_name')}>
                <input className={input} value={form.business_name} onChange={(e) => set({ business_name: e.target.value })} />
              </Cell>
              <Cell label="Type of Contract">
                <LockedValue value={loaded.contract_type_name} />
              </Cell>
              <Cell label="Industry">
                <LockedValue value={loaded.business_type} />
              </Cell>
            </div>
          </Section>

          <Section title="Address & Lease" icon={MapPin}>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-[1.6fr_1.6fr_1.1fr]">
              <Cell label="Principal Address *" bad={bad('address')}>
                <textarea
                  className={cn(input, 'h-auto min-h-[4.5rem]')}
                  placeholder="Company's address"
                  value={form.address}
                  onChange={(e) => set({ address: e.target.value })}
                />
              </Cell>
              <Cell label="Lease Address *" bad={bad('lease_address')}>
                <textarea
                  className={cn(input, 'h-auto min-h-[4.5rem]')}
                  placeholder="CIAC lot"
                  value={form.lease_address}
                  onChange={(e) => set({ lease_address: e.target.value })}
                />
              </Cell>
              <Cell label="Proposed Lease Term *" bad={bad('proposed_lease_term_years')}>
                {/* Same years + months input as the Proponent Accounts form (stored as
                    years, or as total months when there are months), stacked to
                    match the address boxes beside it. */}
                <LeaseTermInput
                  stacked
                  value={form.proposed_lease_term_years}
                  unit={form.proposed_lease_term_unit}
                  onChange={(value, unit) =>
                    set({ proposed_lease_term_years: value, proposed_lease_term_unit: unit === 'MONTHS' ? 'MONTHS' : 'YEARS' })
                  }
                />
              </Cell>
            </div>
          </Section>

          <Section title="Location & Contact" icon={Phone}>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
              <Cell label="Location (Preferred Lot Area) *" bad={bad('location')}>
                <input
                  className={input}
                  placeholder="e.g. G Puyat, Bertaphil V"
                  value={form.location}
                  onChange={(e) => set({ location: e.target.value })}
                />
              </Cell>
              <Cell label="Land Use *" bad={bad('land_use_id')}>
                <div className="app-form-control app-form-control-sm h-9 p-0 overflow-hidden flex items-stretch">
                  <AppSelect
                    options={landUseOptions}
                    value={form.land_use_id}
                    onChange={(v) => set({ land_use_id: v })}
                    placeholder="Select land use"
                    isClearable
                    isDisabled={!editable}
                    compact
                    boxed
                    minHeight={26}
                  />
                </div>
              </Cell>
              <Cell label="Contact No. *" bad={bad('contact_no')}>
                <input className={input} value={form.contact_no} onChange={(e) => set({ contact_no: e.target.value })} />
              </Cell>
              <Cell label="Nationality *" bad={bad('nationality')}>
                {/* Same box and inner height as Land Use. */}
                <NationalityInput
                  value={form.nationality}
                  onChange={(v) => set({ nationality: v })}
                  className="h-9"
                  minHeight={26}
                  disabled={!editable}
                />
              </Cell>
            </div>
          </Section>

          <Section title="Business Activities" icon={Briefcase}>
            <Cell label="What the proponent will do at CIAC *" bad={bad('business_activities')}>
              <textarea
                className={cn(input, 'h-auto min-h-[4.5rem]')}
                placeholder="e.g. Manufacturing of aircraft parts and equipment"
                value={form.business_activities}
                onChange={(e) => set({ business_activities: e.target.value })}
              />
            </Cell>
          </Section>
        </Card>

        <Card title="Contact Person & Authorized Signatory" icon={Users}>
          {groups.map((group, gi) => (
            <div
              key={group.title}
              className={cn('flex flex-col gap-2', gi > 0 && 'border-t pt-3')}
              style={{ borderColor: 'var(--input-border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                  <group.icon size={13} className="text-secondary" />
                  {group.title}
                  <span
                    className="inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                    style={
                      group.rows.length
                        ? { backgroundColor: 'rgba(16,185,129,.14)', color: '#10b981' }
                        : { backgroundColor: 'rgba(245,158,11,.14)', color: '#d97706' }
                    }
                  >
                    {group.rows.length}
                  </span>
                </span>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowErrors(false);
                      group.setRows([...group.rows, blankContactPersonRow()]);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer hover:bg-[var(--selected-bg)]"
                    style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                  >
                    <Plus size={12} /> {group.addLabel}
                  </button>
                ) : null}
              </div>
              <RowsEditor<ContactPersonRow>
                rows={group.rows}
                disabled={!editable}
                emptyText={group.empty}
                hideSideActions
                rowNoun={group.nameLabel.toLowerCase()}
                confirmDelete={(what, proceed) => setRowDelete({ what, proceed })}
                invalidKeys={(row) => (showErrors ? invalidRowKeys(row, CONTACT_RULES) : null)}
                columns={[
                  { key: 'name', label: group.nameLabel, width: '30%', placeholder: 'Full name' },
                  { key: 'designation', label: 'Designation', width: '22%', placeholder: 'e.g. President' },
                  { key: 'contact_no', label: 'Contact No.', width: '18%', placeholder: '09XX XXX XXXX' },
                  { key: 'email', label: 'Email Address', width: '30%', placeholder: 'name@company.com' },
                ]}
                onChange={group.setRows}
                blankRow={blankContactPersonRow}
              />
            </div>
          ))}
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
            {saving ? 'Saving…' : 'Save Proponent Information'}
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
