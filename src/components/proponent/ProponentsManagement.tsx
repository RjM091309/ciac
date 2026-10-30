import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Minus, Plus, Save, Search, Send, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';
import { DatePicker } from '../ui/DatePicker';
import { DataTableControls } from '../ui/DataTableControls';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { LocatorDocumentsTab, uploadLocatorDocument, type PendingLocatorDocument } from './LocatorDocumentsTab';
import { useLiveRefresh } from '../../lib/liveData';

type ChangeRequestRow = {
  id: number;
  proponent_id: number;
  payload: Record<string, string | null>;
  current: Record<string, string | null>;
  created_at: string | null;
  requested_by_username: string | null;
};

const CHANGE_FIELD_LABELS: Record<string, string> = {
  business_name: 'Business name',
  registration_no: 'Registration no.',
  tin: 'TIN',
  address: 'Address',
  contact_no: 'Contact no.',
};

type ProponentRow = {
  id: number;
  user_id: number | null;
  business_name: string;
  registration_no: string | null;
  tin: string | null;
  address: string | null;
  contact_no: string | null;
  ref_no: string | null;
  location: string | null;
  // "Profile" fields mirroring the legacy BRIDGE system's Locator's
  // Information form — fetched on demand in openEdit(), same as `location`.
  ref_code: string | null;
  lease_address: string | null;
  account_officer_id: number | null;
  account_officer_name: string | null;
  sec_registration_date: string | null;
  date_signed: string | null;
  grace_period: string | null;
  is_sublease: number | null;
  /** Set when this locator is a sub-lessee of another (A-07). */
  sublessor_id?: number | null;
  sub_pgro: string | null;
  sub_pgrr: string | null;
  land_use: string | null;
  extension_date: string | null;
  extension_remarks: string | null;
  authorized_capital: string | null;
  authorized_capital_currency: string | null;
  subscribed_capital: string | null;
  subscribed_capital_currency: string | null;
  paid_up_capital: string | null;
  paid_up_capital_currency: string | null;
  business_activities: string | null;
  nationality: string | null;
  advance_lease_payment_months: string | null;
  advance_lease_payment_amount: string | null;
  advance_lease_payment_currency: string | null;
  security_deposit_months: string | null;
  security_deposit_amount: string | null;
  security_deposit_currency: string | null;
  performance_security_months: string | null;
  performance_security_amount: string | null;
  performance_security_currency: string | null;
  // Contract-derived, read-only here — same "no contract yet = blank" rule
  // as the Locators List columns. contract_type_id IS settable (writes to
  // the current contract, see Contract.setContractTypeForProponent).
  start_term: string | null;
  end_term: string | null;
  lease_term: string | null;
  contract_type_id: number | null;
  contract_type_name: string | null;
  // Manual Industry fallback (application type code) for locators with no
  // filed application yet — see Proponent.setManualClassification.
  industry_code?: string | null;
  // Latest application's type, else industry_code — what the Documents
  // checklist filters requirements by.
  effective_industry_code?: string | null;
  has_application?: boolean;
  has_contract?: boolean;
  // Open (undecided) renewal — header badge shows "Renewal in process".
  renewal_application_no?: string | null;
  renewal_status?: string | null;
  // No approved contract yet (an existing locator encoded by hand): Start/End
  // Term are typed in and kept in manual_* (see Proponent.setManualLeaseTerm).
  term_editable?: boolean;
  manual_start_term?: string | null;
  manual_end_term?: string | null;
  // "Industry" in the legacy BRIDGE form — the Application Type of this
  // locator's most recently filed application, same source as the Locators
  // List's "business_type" column. Never set directly (no application yet =
  // blank), so it's read-only wherever it's shown.
  business_type: string | null;
  properties: PropertyRow[];
  created_by: number | null;
  updated_by: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_active: number;
};

// The legacy BRIDGE "Profile" tab's property schedule table — a real
// one-to-many child table (dbo.proponent_properties), synced wholesale on
// every save (see replaceProponentProperties in server/models/Proponent.js).
type PropertyRow = {
  id?: number;
  year: string;
  date_from: string;
  date_to: string;
  type_of_property: string;
  area_sqm: string;
  rate_sqm_mo: string;
  rate_currency: string;
  mgl_mo: string;
  mgl_currency: string;
  // STANDARD: MGL/MO = Area × Rate/SQM/MO (computed, read-only).
  // NON_STANDARD: every amount entered by hand.
  // '': not chosen yet (rows from before the type existed) — no default.
  rate_type: PropertyRateType | '';
};

type PropertyRateType = 'STANDARD' | 'NON_STANDARD';

// Property schedule dropdowns.
const PROPERTY_YEARS = Array.from({ length: 11 }, (_, k) => String(2020 + k)); // 2020–2030
const PROPERTY_TYPES = ['OPEN SPACE', 'STRUCTURE'];
// Year / Type of Property only take values from their lists (any case):
// an older free-text value that isn't one of them shows as "Select ..." and
// has to be picked again before the schedule can be saved.
const asOption = (options: string[], current: string) =>
  options.find((o) => o.toUpperCase() === String(current || '').trim().toUpperCase()) ?? '';

/** "1,234.50" -> 1234.5, or null. */
function parseAmount(value: string): number | null {
  const n = Number(String(value || '').replace(/,/g, ''));
  return value && Number.isFinite(n) ? n : null;
}

/** Standard rows: Area × Rate, formatted like the other amount inputs. */
function computeStandardMgl(row: Pick<PropertyRow, 'area_sqm' | 'rate_sqm_mo'>): string {
  const area = parseAmount(row.area_sqm);
  const rate = parseAmount(row.rate_sqm_mo);
  if (area === null || rate === null) return '';
  return (Math.round(area * rate * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Applies a field change; a Standard row keeps its MGL (and its currency)
 * in step with Area × Rate. */
function updatePropertyRow(row: PropertyRow, patch: Partial<PropertyRow>): PropertyRow {
  const next = { ...row, ...patch };
  if (next.rate_type === 'STANDARD') {
    next.mgl_mo = computeStandardMgl(next);
    next.mgl_currency = next.rate_currency;
  }
  return next;
}

// Every column of a property row is required before the schedule can be saved.
const PROPERTY_REQUIRED: [keyof PropertyRow, string][] = [
  ['year', 'Year'],
  ['date_from', 'Date From'],
  ['date_to', 'Date To'],
  ['rate_type', 'Rate'],
  ['type_of_property', 'Type of Property'],
  ['area_sqm', 'Area (SQM)'],
  ['rate_sqm_mo', 'Rate/SQM/MO'],
  ['rate_currency', 'Currency'],
  ['mgl_mo', 'MGL/MO'],
  ['mgl_currency', 'MGL Currency'],
];
const PROPERTY_NUMERIC = new Set<keyof PropertyRow>(['area_sqm', 'rate_sqm_mo', 'mgl_mo']);

/** The fields of a row that are blank (or not a number where one is expected). */
function missingPropertyFields(row: PropertyRow): Set<keyof PropertyRow> {
  const missing = new Set<keyof PropertyRow>();
  for (const [key] of PROPERTY_REQUIRED) {
    const value = String(row[key] ?? '').trim();
    if (!value || (PROPERTY_NUMERIC.has(key) && parseAmount(value) === null)) missing.add(key);
  }
  if (!asOption(PROPERTY_YEARS, row.year)) missing.add('year');
  if (!asOption(PROPERTY_TYPES, row.type_of_property)) missing.add('type_of_property');
  if (row.date_from && row.date_to && row.date_to < row.date_from) missing.add('date_to');
  return missing;
}

/** First problem in the schedule as a message, or null when every row is complete. */
function propertyScheduleError(rows: PropertyRow[]): string | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const missing = missingPropertyFields(row);
    if (!missing.size) continue;
    if (missing.size === 1 && missing.has('date_to') && row.date_to) {
      return `Property row ${i + 1}: Date To can't be before Date From.`;
    }
    const labels = PROPERTY_REQUIRED.filter(([k]) => missing.has(k)).map(([, label]) => label);
    return `Property row ${i + 1}: fill in ${labels.join(', ')}.`;
  }
  return null;
}

function blankPropertyRow(rateType: PropertyRateType = 'STANDARD'): PropertyRow {
  return {
    rate_type: rateType,
    year: '',
    date_from: '',
    date_to: '',
    type_of_property: '',
    area_sqm: '',
    rate_sqm_mo: '',
    rate_currency: 'PHP',
    mgl_mo: '',
    mgl_currency: 'PHP',
  };
}

// Fields resolved dynamically from the applications/contracts/users tables
// (never typed in directly) — see server/models/Proponent.js's
// listProponentsForLocatorList for how each one is derived.
type LocatorDynamicRow = {
  id: number;
  business_type: string | null;
  start_term: string | null;
  end_term: string | null;
  lease_term: string | null;
  encoded_by: string | null;
  /** A renewal still being decided — the Ref No then shows as REN-… (same number). */
  renewal_application_no?: string | null;
};

type DisplayRow = ProponentRow & LocatorDynamicRow;

type UserOption = {
  id: number;
  username: string;
  full_name: string | null;
  is_active: number;
  /** 1 = Level 1 (assigns), 2 = Level 2. */
  assessment_level?: number;
  department_code: string | null;
  department_name: string | null;
};

/** The signed-in user, as the Account Officer field needs it: Level 1 picks
 * the Level 2 who handles the locator; Level 2's own locators are theirs. */
type OfficerViewer = { userId: number | null; accountOfficerLevel: 1 | 2 | null };

type ContractTypeOption = {
  id: number;
  name: string;
  is_active: number;
};

/** New Locator panel heading, by the Type of Contract picked (matched on the
 * File Maintenance name). No type picked, or one not listed here: "New Locator". */
function newLocatorTitle(contractTypeName: string | null | undefined): string {
  // Extra spaces are ignored ("DIRECT  LEASE" as typed in File Maintenance).
  const name = String(contractTypeName || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (name === 'DIRECT LEASE' || name === 'SHORT TERM LEASE') return 'New Lessee';
  if (name === 'MOA' || name.includes('(MOA)') || name.startsWith('MEMORANDUM OF AGREEMENT')) return 'New Development Partner';
  if (name === 'MOU' || name.includes('(MOU)') || name.startsWith('MEMORANDUM OF UNDERSTANDING')) return 'New Lessee (Supplemental)';
  if (name.startsWith('SUBLEASE')) return 'Sub Lessee';
  return 'New Locator';
}

// File Maintenance lookup (Land Use) — same shape as the contract types.
type LookupOption = ContractTypeOption;

type LocatorsData = {
  proponents: ProponentRow[];
  dynamic: LocatorDynamicRow[];
  users: UserOption[];
  contractTypes: ContractTypeOption[];
  landUses: LookupOption[];
  industries: IndustryOption[];
  viewer: OfficerViewer;
};

// Industry = Application Types catalog, keyed by code (what applications store).
type IndustryOption = { id: number; code: string; name: string; is_active: number };

// "Stockholders" tab / Contact Person section — child tables (dbo.stockholder,
// dbo.contact_person) synced by id on every save (rows removed here are deactivated).
export type StockholderRow = {
  id?: number;
  name: string;
  nationality: string;
  subscribed: string;
  paid: string;
  ownership: string;
};

export type ContactPersonRow = {
  id?: number;
  name: string;
  designation: string;
  contact_no: string;
  email: string;
};

// Signatories have exactly the same columns as contact persons.
type SignatoryRow = ContactPersonRow;

export function blankStockholderRow(): StockholderRow {
  return { name: '', nationality: '', subscribed: '', paid: '', ownership: '' };
}

export function blankContactPersonRow(): ContactPersonRow {
  return { name: '', designation: '', contact_no: '', email: '' };
}

const blankSignatoryRow = blankContactPersonRow;

// Row tables (Stockholders, Contact Person, Signatory): like the property
// schedule, every column of every listed row is required before saving.
export type RowRule<T> = {
  key: keyof T & string;
  label: string;
  kind?: 'amount' | 'percent' | 'email' | 'option';
  options?: readonly string[];
};

// Stockholder nationality: Filipino plus the nationalities most often seen
// among locators / foreign investors in the Philippines (alphabetical after
// Filipino), and OTHER. Stored as the uppercase text, as before.
export const NATIONALITIES = [
  'FILIPINO',
  'AMERICAN',
  'AUSTRALIAN',
  'BELGIAN',
  'BRITISH',
  'BRUNEIAN',
  'CANADIAN',
  'CHINESE',
  'DANISH',
  'DUTCH',
  'EMIRATI',
  'FRENCH',
  'GERMAN',
  'HONG KONG',
  'INDIAN',
  'INDONESIAN',
  'ISRAELI',
  'ITALIAN',
  'JAPANESE',
  'KOREAN',
  'MALAYSIAN',
  'NEW ZEALANDER',
  'NORWEGIAN',
  'RUSSIAN',
  'SAUDI',
  'SINGAPOREAN',
  'SPANISH',
  'SWEDISH',
  'SWISS',
  'TAIWANESE',
  'THAI',
  'VIETNAMESE',
  'OTHER',
] as const;

/** The proponent / locator's own nationality (B-13): the same searchable
 * dropdown as the stockholders' Nationality column. An older free-text value
 * that isn't in the list is kept as an extra option so it still shows. */
export function NationalityInput({
  value,
  onChange,
  className,
  disabled,
  minHeight = 26,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  minHeight?: number;
}) {
  const current = String(value || '').trim();
  const matched = asOption([...NATIONALITIES], current);
  const options: string[] = [...NATIONALITIES];
  if (current && !matched) options.unshift(current.toUpperCase());
  return (
    <div className={cn('app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch', className)}>
      <AppSelect
        options={options.map((o) => ({ value: o, label: o }))}
        value={matched || current.toUpperCase()}
        onChange={onChange}
        placeholder="Select nationality"
        isClearable={false}
        isDisabled={disabled}
        compact
        boxed
        minHeight={minHeight}
      />
    </div>
  );
}

export const STOCKHOLDER_RULES: RowRule<StockholderRow>[] = [
  { key: 'name', label: 'Stockholder Name' },
  { key: 'nationality', label: 'Nationality', kind: 'option', options: NATIONALITIES },
  { key: 'subscribed', label: 'Subscribed', kind: 'amount' },
  { key: 'paid', label: 'Paid', kind: 'amount' },
  { key: 'ownership', label: 'Ownership %', kind: 'percent' },
];
export const CONTACT_RULES: RowRule<ContactPersonRow>[] = [
  { key: 'name', label: 'Name' },
  { key: 'designation', label: 'Designation' },
  { key: 'contact_no', label: 'Contact No.' },
  { key: 'email', label: 'Email Address', kind: 'email' },
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A row added in this form (no id yet) with nothing typed in it: removed with a
 * "−" right away, no "Delete?" prompt — there's nothing to lose. */
function isBlankNewRow(row: { id?: number }, keys: string[]): boolean {
  return row.id == null && keys.every((k) => String((row as any)[k] ?? '').trim() === '');
}

/** The keys of a row that are blank or not valid for their kind. */
export function invalidRowKeys<T>(row: T, rules: RowRule<T>[]): Set<string> {
  const bad = new Set<string>();
  for (const rule of rules) {
    const value = String((row as any)[rule.key] ?? '').trim();
    if (!value) {
      bad.add(rule.key);
      continue;
    }
    if (rule.kind === 'amount' && parseAmount(value) === null) bad.add(rule.key);
    if (rule.kind === 'percent') {
      const n = parseAmount(value);
      if (n === null || n < 0 || n > 100) bad.add(rule.key);
    }
    if (rule.kind === 'email' && !EMAIL_RE.test(value)) bad.add(rule.key);
    if (rule.kind === 'option' && rule.options && !asOption([...rule.options], value)) bad.add(rule.key);
  }
  return bad;
}

/** First problem in a table as a message ("Contact Person row 2: fill in Name, Email Address."), or null. */
export function rowsError<T>(title: string, rows: T[], rules: RowRule<T>[]): string | null {
  for (let i = 0; i < rows.length; i++) {
    const bad = invalidRowKeys(rows[i], rules);
    if (!bad.size) continue;
    // A filled-in but invalid value says what's expected.
    const labels = rules
      .filter((r) => bad.has(r.key))
      .map((r) => {
        const filled = String((rows[i] as any)[r.key] ?? '').trim() !== '';
        if (!filled) return r.label;
        if (r.kind === 'email') return `${r.label} (e.g. name@company.com)`;
        if (r.kind === 'percent') return `${r.label} (0–100)`;
        if (r.kind === 'option') return `${r.label} (pick from the list)`;
        return `${r.label} (a number)`;
      });
    return `${title} row ${i + 1}: fill in ${labels.join(', ')}.`;
  }
  return null;
}

// The sections that can be saved on their own (see saveSection).
type SectionKey = 'stockholders' | 'contacts' | 'properties' | 'investment' | 'sec';

// SEC Registration Information card: the SEC fields kept on dbo.proponents
// plus the ones in dbo.proponent_sec_registration. Saved together by the
// card's own Save (PUT /api/proponents/:id/sec-registration) and by the
// panel's main Save.
const SEC_PROPONENT_KEYS = [
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
] as const;
const SEC_DETAIL_KEYS = [
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
type SecKey = (typeof SEC_PROPONENT_KEYS)[number] | (typeof SEC_DETAIL_KEYS)[number];

/** The card's fields as the API takes them (blank -> null). */
function secRegistrationPayload(f: Record<SecKey, string>): Record<SecKey, string | null> {
  const out = {} as Record<SecKey, string | null>;
  for (const key of [...SEC_PROPONENT_KEYS, ...SEC_DETAIL_KEYS]) out[key] = String(f[key] ?? '').trim() || null;
  return out;
}

// API rows -> form rows.
export function mapStockholderRows(rows: any): StockholderRow[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name || '',
    nationality: r.nationality || '',
    subscribed: r.subscribed != null ? formatAmountInput(String(r.subscribed)) : '',
    paid: r.paid != null ? formatAmountInput(String(r.paid)) : '',
    ownership: r.ownership != null ? String(r.ownership) : '',
  }));
}

// Contact persons and signatories share the same columns.
export function mapContactRows(rows: any): ContactPersonRow[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name || '',
    designation: r.designation || '',
    contact_no: r.contact_no || '',
    email: r.email || '',
  }));
}

// No rows = the table stays hidden until "+" adds one.
function mapPropertyRows(rows: any): PropertyRow[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((row: any) => ({
    id: row.id,
    rate_type: row.rate_type === 'STANDARD' || row.rate_type === 'NON_STANDARD' ? row.rate_type : '',
    year: row.year || '',
    date_from: toDateInputValue(row.date_from),
    date_to: toDateInputValue(row.date_to),
    type_of_property: row.type_of_property || '',
    area_sqm: row.area_sqm || '',
    rate_sqm_mo: row.rate_sqm_mo || '',
    rate_currency: row.rate_currency || 'PHP',
    mgl_mo: row.mgl_mo || '',
    mgl_currency: row.mgl_currency || 'PHP',
  }));
}

// Form rows -> API rows.
export const toStockholderPayload = (r: StockholderRow) => ({
  id: r.id,
  name: r.name.trim(),
  nationality: r.nationality.trim() || null,
  subscribed: r.subscribed.trim(),
  paid: r.paid.trim(),
  ownership: r.ownership.trim(),
});

export const toContactPayload = (r: ContactPersonRow) => ({
  id: r.id,
  name: r.name.trim(),
  designation: r.designation.trim() || null,
  contact_no: r.contact_no.trim() || null,
  email: r.email.trim() || null,
});

const toPropertyPayload = (row: PropertyRow) => ({
  // Kept rows are updated by id; rows left out are soft-deleted server-side.
  id: row.id,
  year: row.year.trim() || null,
  date_from: row.date_from || null,
  date_to: row.date_to || null,
  type_of_property: row.type_of_property.trim() || null,
  area_sqm: row.area_sqm.trim() || null,
  rate_sqm_mo: row.rate_sqm_mo.trim() || null,
  rate_currency: row.rate_currency || null,
  mgl_mo: (row.rate_type === 'STANDARD' ? computeStandardMgl(row) : row.mgl_mo.trim()) || null,
  mgl_currency: (row.rate_type === 'STANDARD' ? row.rate_currency : row.mgl_currency) || null,
  rate_type: row.rate_type || null,
});

function api(path: string) {
  return path;
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type LeaseStatus = 'active' | 'expired';

/** One lease agreement (GET /api/proponents/:id/leases, A-02/A-03/A-04). */
type LeaseRow = {
  id: number;
  ref_code: string | null;
  is_current: boolean;
  contract_no: string | null;
  application_no: string | null;
  is_renewal: boolean;
  contract_type_name: string | null;
  date_signed: string | null;
  start_term: string | null;
  end_term: string | null;
  /** Earlier leases only: their property schedule (read-only). */
  properties?: any[];
};

/** Sub-lease (A-07): a sub-lessee is a locator of its own, linked to the
 * locator it sub-leases from (GET /:id → sublessor_* / sublessees). */
type SublesseeRow = {
  id: number;
  ref_no: string | null;
  ref_code: string | null;
  business_name: string;
  is_active: number;
  account_officer_id: number | null;
  start_term: string | null;
  end_term: string | null;
};
type SubleaseInfo = {
  sublessor: { id: number; name: string; ref_no: string | null } | null;
  sublessees: SublesseeRow[];
};
const NO_SUBLEASE: SubleaseInfo = { sublessor: null, sublessees: [] };
function subleaseFrom(data: any): SubleaseInfo {
  return {
    sublessor: data?.sublessor_id
      ? { id: Number(data.sublessor_id), name: data.sublessor_name || 'Locator', ref_no: data.sublessor_ref_no ?? null }
      : null,
    sublessees: Array.isArray(data?.sublessees) ? data.sublessees : [],
  };
}

/** Lease status from the contract's End Term: Active through that day
 * (inclusive), Expired after. null = no contract/End Term yet. Shared by the
 * list's status filter and the panel header badge. */
function leaseStatus(endTerm?: string | null): LeaseStatus | null {
  if (!endTerm) return null;
  const end = new Date(endTerm);
  if (Number.isNaN(end.getTime())) return null;
  end.setHours(23, 59, 59, 999);
  return end.getTime() >= Date.now() ? 'active' : 'expired';
}

/** Same as the server's formatLeaseTerm (models/Proponent.js): "1Y-2M-3D". */
function formatLeaseTerm(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return null;
  let years = e.getFullYear() - s.getFullYear();
  let months = e.getMonth() - s.getMonth();
  let days = e.getDate() - s.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(e.getFullYear(), e.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return `${years}Y-${months}M-${days}D`;
}

// Live thousand-separator formatting for currency-amount inputs (Capital
// Stock, Advance Lease Payment/Security Deposit/Performance Security,
// property schedule Rate/MGL) — strips everything but digits and a single
// decimal point, then re-inserts commas every 3 digits on the integer part.
export function formatAmountInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  const intPart = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  const decPart = firstDot === -1 ? '' : cleaned.slice(firstDot + 1).replace(/\./g, '');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return firstDot === -1 ? withCommas : `${withCommas}.${decPart}`;
}

/** Loaded free-text amounts: comma-format only a plain number ("1000000" ->
 * "1,000,000"); anything else (e.g. older "USD 1M") is shown as saved. */
function formatIfNumeric(value?: string | null): string {
  const text = String(value ?? '').trim();
  return /^[\d,]+(\.\d+)?$/.test(text) ? formatAmountInput(text) : text;
}

// yyyy-mm-dd, what <input type="date"> requires.
function toDateInputValue(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// DatePicker (src/components/ui/DatePicker.tsx) works in single mode with a
// plain Date | null, while the form keeps every date as a yyyy-mm-dd string
// (what the API expects) — these two just bridge that gap.
function dateInputToDate(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function dateToDateInputValue(value: Date | null): string {
  if (!value) return '';
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const CURRENCY_OPTIONS = ['PHP', 'USD'];

const HIGHLIGHT_DURATION_MS = 5000;

function stripProponentQueryParam(search: string) {
  const raw = String(search || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('?') ? raw.slice(1) : raw;
  const params = new URLSearchParams(normalized);
  params.delete('proponentId');
  const next = params.toString();
  return next ? `?${next}` : '';
}

// "Profile" fields mirroring the legacy BRIDGE system's Locator's
// Information form — see openEdit() for how these are fetched on demand.
const BLANK_PROFILE_FORM = {
  location: '',
  ref_code: '',
  lease_address: '',
  account_officer_id: '',
  sec_registration_date: '',
  date_signed: '',
  // Encoded lease term (only while there's no approved contract).
  start_term: '',
  end_term: '',
  grace_period: '',
  is_sublease: false,
  sub_pgro: '',
  sub_pgrr: '',
  land_use: '',
  extension_date: '',
  extension_remarks: '',
  authorized_capital: '',
  authorized_capital_currency: 'PHP',
  subscribed_capital: '',
  subscribed_capital_currency: 'PHP',
  paid_up_capital: '',
  paid_up_capital_currency: 'PHP',
  contract_type_id: '',
  industry_code: '',
  business_activities: '',
  nationality: '',
  advance_lease_payment_months: '',
  advance_lease_payment_amount: '',
  advance_lease_payment_currency: 'PHP',
  security_deposit_months: '',
  security_deposit_amount: '',
  security_deposit_currency: 'PHP',
  performance_security_months: '',
  performance_security_amount: '',
  performance_security_currency: 'PHP',
  investment_commitment: '',
  investment_actual: '',
  employee_commitment: '',
  employee_actual: '',
  // SEC Registration Information card (dbo.proponent_sec_registration)
  sec_company_email: '',
  sec_company_telephone: '',
  sec_company_mobile: '',
  sec_primary_purpose: '',
  sec_secondary_purpose: '',
  sec_gis_date: '',
  sec_contact_name: '',
  sec_contact_email: '',
  sec_contact_telephone: '',
  sec_contact_mobile: '',
  properties: [] as PropertyRow[],
  land_use_id: '',
  // Start empty, like the property schedule: every row listed must be complete.
  stockholders: [] as StockholderRow[],
  contact_persons: [] as ContactPersonRow[],
  signatories: [] as SignatoryRow[],
};

/** A sub-lessee opened from its sublessor's panel: this component renders only
 * its own panel, stacked over the sublessor's, which stays as it was. */
type EmbeddedLocator = {
  /** Open this saved locator. */
  locatorId?: number;
  /** With locatorId: show this earlier lease of it, read only (Lease Agreements history). */
  leaseId?: number;
  /** Or start a New Locator as a sub-lessee of this one ("Add Sub-Lessee"). */
  sublessor?: { id: number; name: string; ref_no: string | null; account_officer_id: string };
  onClose: () => void;
};

export function ProponentsManagement({
  locationSearch = '',
  navigate,
  embedded,
}: {
  locationSearch?: string;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
  embedded?: EmbeddedLocator;
} = {}) {
  // The Account Officer field shows who a locator is assigned to. An Account
  // Officer looking at their own assigned locators doesn't need (or should
  // see) this about themselves, so it's hidden outright for that role; every
  // other staff role can assign/reassign it from this dropdown.
  // An Account Officer = a role that works the Approved Queue (Control Panel)
  // and isn't a BDO — by permission, not by role name.
  const { fullAccess: cpFullAccess, sidebarPermissions: cpSidebar, crudPermissions } = useControlPanelAccess();
  // Control Panel add/edit for Registered Locator (settings:proponents, the
  // same key the server checks): without them the buttons aren't shown.
  const crud = crudPermissions['settings:proponents'] || { can_add: false, can_edit: false, can_delete: false };
  // An earlier lease opened in a stacked panel is history: nothing in it saves.
  const viewOnlyLease = embedded?.leaseId != null;
  const canAdd = !viewOnlyLease && (cpFullAccess || crud.can_add);
  const canEdit = !viewOnlyLease && (cpFullAccess || crud.can_edit);
  const isAccountOfficer =
    !cpFullAccess && Boolean(cpSidebar['approval:queue']) && !cpSidebar['assessment:queue'];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProponentRow | null>(null);
  // No Add/Edit right for this panel (new vs. existing locator) = view only.
  const formLocked = embedded?.leaseId != null || (editing ? !canEdit : !canAdd);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // "+" on the property schedule asks Standard vs Non-standard first.
  const [propertyTypePickerOpen, setPropertyTypePickerOpen] = useState(false);
  // A section's own save on a New Locator: creates the locator (with what's
  // entered so far) and keeps the panel open on it, instead of closing.
  // A ref so it survives the duplicate-check confirm, which calls save again.
  const keepOpenAfterCreateRef = useRef(false);
  // Set after a save is blocked by an incomplete property row: outlines the
  // blank fields in red until they're filled in.
  const [showPropertyErrors, setShowPropertyErrors] = useState(false);
  // Contact Person & Authorized Signatory card: collapsed to a one-line summary
  // so the tabs stay in view. null = automatic (open while both lists are empty
  // or have unsaved changes); a click pins it open / closed.
  const [contactsOpen, setContactsOpen] = useState<boolean | null>(null);
  // Set after a save is blocked by an incomplete row: outlines its fields in red.
  const [showRowErrors, setShowRowErrors] = useState<{ stockholders: boolean; contacts: boolean }>({
    stockholders: false,
    contacts: false,
  });
  // "Delete this row?" — every table's trash button asks first.
  const [rowDelete, setRowDelete] = useState<{ what: string; proceed: () => void } | null>(null);
  const askRowDelete = (what: string, proceed: () => void) => setRowDelete({ what, proceed });
  // "Same as Primary Purpose" on Business Activities asks first when it would
  // replace text already there.
  const [confirmCopyPurpose, setConfirmCopyPurpose] = useState(false);
  const copyPrimaryPurpose = () =>
    setForm((p) => ({ ...p, business_activities: p.sec_primary_purpose.trim() }));
  // Changing a row's Rate type changes how its MGL/MO works, so it's
  // confirmed first in the app's own dialog: to Standard replaces a typed MGL
  // with Area × Rate; to Non-standard stops computing it (value kept, typed by hand).
  const [rateSwitch, setRateSwitch] = useState<{
    index: number;
    to: PropertyRateType;
    current: string;
    computed: string;
  } | null>(null);
  // Documents picked on the Documents tab while creating a New Locator —
  // uploaded once the POST returns the new locator's id.
  const [pendingDocs, setPendingDocs] = useState<PendingLocatorDocument[]>([]);
  // Mirrors the legacy BRIDGE system's Locator's Information tab strip —
  // only Profile has content so far, the rest are placeholders.
  const [activeProfileTab, setActiveProfileTab] = useState<
    'Profile' | 'Stockholders' | 'Documents'
  >('Profile');
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [termFilter, setTermFilter] = useState<'all' | LeaseStatus>('all');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [highlightedProponentId, setHighlightedProponentId] = useState<number | null>(null);
  const [highlightedProponentTick, setHighlightedProponentTick] = useState(0);
  const consumedProponentQueryRef = useRef<string>('');
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const cardRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const { data: locatorsData, isLoading, isRevalidating, refresh } = useSessionStorageCachedResource<LocatorsData>({
    cacheKey: 'ciac.locators.v12',
    ttlMs: 5 * 60 * 1000,
    fetcher: async () => {
      const [pRes, dRes, uRes, atRes, luRes, inRes] = await Promise.all([
        fetch(api('/api/proponents?approvedOnly=1'), { credentials: 'include' }),
        fetch(api('/api/proponents/locator-list'), { credentials: 'include' }),
        fetch(api('/api/proponents/account-officers'), { credentials: 'include' }),
        fetch(api('/api/proponents/type-of-contract'), { credentials: 'include' }),
        fetch(api('/api/proponents/land-uses'), { credentials: 'include' }),
        fetch(api('/api/proponents/industries'), { credentials: 'include' }),
      ]);

      const pJson = await pRes.json();
      const dJson = await dRes.json();
      const uJson = await uRes.json();
      const atJson = await atRes.json();
      const luJson = await luRes.json();
      const inJson = await inRes.json();

      if (!pRes.ok) throw new Error(pJson?.message || 'Failed to load proponents');
      if (!dRes.ok) throw new Error(dJson?.message || 'Failed to load locator list');
      if (!uRes.ok) throw new Error(uJson?.message || 'Failed to load account officers');
      if (!atRes.ok) throw new Error(atJson?.message || 'Failed to load types of contract');
      if (!luRes.ok) throw new Error(luJson?.message || 'Failed to load land uses');
      if (!inRes.ok) throw new Error(inJson?.message || 'Failed to load industries');

      const nextProponents: ProponentRow[] = (pJson.data || []).map((p: any) => ({
        ...p,
        is_active: Number(p?.is_active) ? 1 : 0,
      }));

      const nextDynamic: LocatorDynamicRow[] = dJson.data || [];

      const nextUsers: UserOption[] = (uJson.data || []).map((u: any) => ({
        ...u,
        is_active: Number(u?.is_active) ? 1 : 0,
      }));

      const nextContractTypes: ContractTypeOption[] = (atJson.data || []).map((t: any) => ({
        ...t,
        is_active: Number(t?.is_active) ? 1 : 0,
      }));

      const toLookup = (rows: any[]): LookupOption[] =>
        (rows || []).map((t: any) => ({ ...t, is_active: Number(t?.is_active) ? 1 : 0 }));

      return {
        proponents: nextProponents,
        dynamic: nextDynamic,
        users: nextUsers,
        contractTypes: nextContractTypes,
        landUses: toLookup(luJson.data),
        industries: (inJson.data || []).map((t: any) => ({ ...t, is_active: Number(t?.is_active) ? 1 : 0 })),
        viewer: {
          userId: uJson?.viewer?.userId ?? null,
          accountOfficerLevel: uJson?.viewer?.accountOfficerLevel === 1 ? 1 : uJson?.viewer?.accountOfficerLevel === 2 ? 2 : null,
        },
      };
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : 'Failed to load data';
      setError(message);
      toast.error(message);
    },
  });
  // Locators' pending profile change requests ("Request changes" on their
  // portal) — reviewed here. Scoped server-side (a Level 2 AO: own locators).
  const [changeRequests, setChangeRequests] = useState<ChangeRequestRow[]>([]);
  const loadChangeRequests = useCallback(() => {
    fetch(api('/api/proponents/change-requests'), { credentials: 'include' })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => setChangeRequests(ok && Array.isArray(json?.data) ? json.data : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadChangeRequests();
  }, [loadChangeRequests]);
  const pendingRequestFor = useMemo(() => {
    const map = new Map<number, ChangeRequestRow>();
    for (const cr of changeRequests) if (!map.has(cr.proponent_id)) map.set(cr.proponent_id, cr);
    return map;
  }, [changeRequests]);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [reviewing, setReviewing] = useState<'approve' | 'reject' | null>(null);
  async function reviewChangeRequest(cr: ChangeRequestRow, action: 'approve' | 'reject') {
    setReviewing(action);
    try {
      const res = await fetch(api(`/api/proponents/change-requests/${cr.id}/${action}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ remarks: reviewRemarks.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Could not save the review');
      toast.success(action === 'approve' ? 'Changes approved — profile updated' : 'Change request declined');
      setReviewRemarks('');
      loadChangeRequests();
      await refresh({ showLoading: false });
      // Approving changed the profile: reload the open panel with the new values.
      if (action === 'approve' && editing && editing.id === cr.proponent_id) {
        const row = (await fetch(api(`/api/proponents/${cr.proponent_id}`), { credentials: 'include' }).then((r) => r.json()))?.data;
        if (row) openEdit({ ...editing, ...row });
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the review');
    } finally {
      setReviewing(null);
    }
  }
  // Live: re-fetch quietly when something changes for this user (lib/liveData.ts).
  useLiveRefresh(() => {
    refresh({ showLoading: false }).catch(() => {});
    loadChangeRequests();
  });

  const proponents = locatorsData?.proponents ?? [];
  const users = locatorsData?.users ?? [];
  // Account Officer field: Level 1 assigns a Level 2; a Level 2 sees it
  // read-only (always themselves on a new locator — the server enforces it).
  const officerLevel = cpFullAccess || !isAccountOfficer ? null : locatorsData?.viewer.accountOfficerLevel ?? null;
  const officerLocked = officerLevel === 2;
  const myUserId = locatorsData?.viewer.userId ?? null;

  const rows: DisplayRow[] = useMemo(() => {
    const dynamicById = new Map((locatorsData?.dynamic ?? []).map((d) => [d.id, d]));
    return proponents.map((p) => {
      const d = dynamicById.get(p.id);
      return {
        ...p,
        business_type: d?.business_type ?? null,
        start_term: d?.start_term ?? null,
        end_term: d?.end_term ?? null,
        lease_term: d?.lease_term ?? null,
        encoded_by: d?.encoded_by ?? null,
        renewal_application_no: d?.renewal_application_no ?? null,
      };
    });
  }, [proponents, locatorsData?.dynamic]);

  const [form, setForm] = useState({
    user_id: '',
    business_name: '',
    registration_no: '',
    tin: '',
    address: '',
    contact_no: '',
    ...BLANK_PROFILE_FORM,
  });
  const [loadingLocation, setLoadingLocation] = useState(false);
  // Tracks which locator's location fetch is the most recent one requested,
  // so an out-of-order response from a previous openEdit() (e.g. the user
  // clicked another row before the first fetch resolved) never overwrites
  // the form with a different locator's data.
  const locationRequestIdRef = useRef<number | null>(null);

  const stats = useMemo(() => {
    const active = proponents.filter((p) => p.is_active === 1).length;
    const inactive = proponents.filter((p) => p.is_active === 0).length;
    return { active, inactive, total: proponents.length };
  }, [proponents]);

  // Account Officer dropdown: ACCOUNT OFFICER-role users only (server-filtered).
  // New assignments are limited to active officers, but the locator's current
  // officer stays listed even if since deactivated, so editing doesn't blank it.
  const userOptions = useMemo(
    () =>
      users
        .filter((u) => u.is_active === 1 || String(u.id) === form.account_officer_id)
        // Level 1 hands the locator to a Level 2.
        .filter((u) => officerLevel !== 1 || u.assessment_level !== 1 || String(u.id) === form.account_officer_id)
        .map((u) => {
          const name = (u.full_name || u.username).replace(/\s*\(Legacy Import\)\s*$/i, '');
          return {
            value: String(u.id),
            label: `${name}${u.is_active === 1 ? '' : ' (inactive)'}`,
            detail: u.department_name ?? '',
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [users, form.account_officer_id, officerLevel],
  );
  const officerName = (id: string) => {
    const u = users.find((x) => String(x.id) === id);
    return u ? (u.full_name || u.username).replace(/\s*\(Legacy Import\)\s*$/i, '') : '';
  };
  const contractTypes = locatorsData?.contractTypes ?? [];
  // Type of Contract comes from File Maintenance > Type of Contract. Only active
  // types are offered, but the locator's current one stays listed even if it was
  // since deactivated, so editing doesn't blank it.
  const contractTypeOptions = useMemo(
    () =>
      contractTypes
        .filter((t) => t.is_active === 1 || String(t.id) === form.contract_type_id)
        .map((t) => ({ value: String(t.id), label: t.is_active === 1 ? t.name : `${t.name} (inactive)` })),
    [contractTypes, form.contract_type_id],
  );
  // Land Use comes from File Maintenance too — active rows only, plus the locator's
  // current pick even if it was since deactivated.
  const landUses = locatorsData?.landUses ?? [];
  const lookupOptions = (rows: LookupOption[], current: string) =>
    rows
      .filter((t) => t.is_active === 1 || String(t.id) === current)
      .map((t) => ({ value: String(t.id), label: t.is_active === 1 ? t.name : `${t.name} (inactive)` }));
  const landUseOptions = useMemo(() => lookupOptions(landUses, form.land_use_id), [landUses, form.land_use_id]);
  const industries = locatorsData?.industries ?? [];
  const industryOptions = useMemo(
    () =>
      industries
        .filter((t) => t.is_active === 1 || t.code === form.industry_code)
        .map((t) => ({ value: t.code, label: t.is_active === 1 ? t.name : `${t.name} (inactive)` })),
    [industries, form.industry_code],
  );
  // Industry is derived from the latest filed application once one exists;
  // before that (New Locator / manual registration) it's picked here.
  const industryDerived = Boolean(editing?.has_application);
  // Start/End Term are typed in for a new locator, or one with no approved
  // contract yet (encoded existing locator); otherwise the contract's dates show.
  const termEditable = !editing || Boolean(editing.term_editable);
  const [duplicateMatches, setDuplicateMatches] = useState<
    { id: number; ref_no: string | null; business_name: string; match: 'name' | 'tin' | 'registration_no' }[]
  >([]);
  // Portal login for an encoded locator that has none (POST /:id/login).
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', email: '', full_name: '' });
  const [loginSaving, setLoginSaving] = useState(false);
  // The open locator's portal login (from GET /:id): PENDING = created but
  // not sent yet ("Send login now"), ACTIVE = the locator has it.
  const [loginInfo, setLoginInfo] = useState<{ status: string | null; email: string | null; username: string | null } | null>(null);
  // The latest GIS upload on the locator's Compliance page (from GET /:id),
  // shown read only beside Latest GIS Filing on the Stockholders tab (A-16).
  const [gisDocument, setGisDocument] = useState<{
    original_file_name: string | null;
    status: string | null;
    validity_to: string | null;
  } | null>(null);
  // Lease Agreements card: every lease of the open locator, and which earlier
  // one's property schedule is being viewed (null = the current lease).
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [viewLeaseId, setViewLeaseId] = useState<number | null>(null);
  // Sub-lease (A-07): who this locator sub-leases from, and its own sub-lessees.
  // On a New Locator opened by "Add Sub-Lessee", `sublessor` is the parent.
  const [sublease, setSublease] = useState<SubleaseInfo>(NO_SUBLEASE);
  const [sublesseeLinkId, setSublesseeLinkId] = useState('');
  const [sublesseeUnlink, setSublesseeUnlink] = useState<SublesseeRow | null>(null);
  // A sub-lessee (opened from the Sub-Lessees card, or a new one from "Add
  // Sub-Lessee") gets its own panel stacked over this one, so this locator's
  // fields are never swapped out from under the user.
  const [nestedLocator, setNestedLocator] = useState<Omit<EmbeddedLocator, 'onClose'> | null>(null);
  const [sublesseeLinkConfirm, setSublesseeLinkConfirm] = useState(false);
  const [subleaseSaving, setSubleaseSaving] = useState(false);
  const loadLeases = useCallback(async (proponentId: number) => {
    try {
      const res = await fetch(api(`/api/proponents/${proponentId}/leases`), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      setLeases(res.ok && Array.isArray(json?.data) ? json.data : []);
    } catch {
      setLeases([]);
    }
  }, []);
  const [sendLoginOpen, setSendLoginOpen] = useState(false);
  const [sendingLogin, setSendingLogin] = useState(false);
  // No username typed: the server makes one from the Ref No (shown as a hint).
  const suggestedUsername = (editing?.ref_no || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  async function sendLogin() {
    if (!editing) return;
    setSendingLogin(true);
    try {
      const res = await fetch(api(`/api/proponents/${editing.id}/login/send`), { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Could not send the login');
      setLoginInfo({ status: json?.data?.login_status ?? 'ACTIVE', email: json?.data?.login_email ?? null, username: json?.data?.login_username ?? null });
      setSendLoginOpen(false);
      toast.success(json?.message || 'Login sent');
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the login');
    } finally {
      setSendingLogin(false);
    }
  }
  async function createLogin() {
    if (!editing) return;
    setLoginSaving(true);
    try {
      const res = await fetch(api(`/api/proponents/${editing.id}/login`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: loginForm.username.trim(),
          email: loginForm.email.trim(),
          full_name: loginForm.full_name.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Could not create the login');
      const userId = Number(json?.data?.user_id);
      setEditing((prev) => (prev ? { ...prev, user_id: userId } : prev));
      setLoginInfo({ status: 'PENDING', email: json?.data?.email ?? null, username: json?.data?.username ?? null });
      setForm((prev) => ({ ...prev, user_id: String(userId) }));
      setLoginOpen(false);
      toast.success(json?.message || 'Login created');
      await refresh({ showLoading: false });
    } catch (e: any) {
      toast.error(e?.message || 'Could not create the login');
    } finally {
      setLoginSaving(false);
    }
  }

  // Snapshot of the form once an edit's profile has finished loading. canSubmit only
  // compared the top few fields, so changing anything else (account officer,
  // land use, the stockholder / contact tables...) left Save disabled.
  //
  // The three tables that have their own Save (stockholders, contacts + signatories, the
  // property schedule) are tracked separately from the locator's own fields, so saving
  // one of them clears only its own "unsaved changes" state.
  const splitForm = (f: typeof form) => {
    const {
      stockholders,
      contact_persons,
      signatories,
      properties,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      ...afterSections
    } = f;
    const rest: Record<string, unknown> = { ...afterSections };
    const sec: Record<string, unknown> = {};
    for (const key of [...SEC_PROPONENT_KEYS, ...SEC_DETAIL_KEYS]) {
      sec[key] = rest[key];
      delete rest[key];
    }
    return {
      rest: JSON.stringify(rest),
      sections: {
        sec: JSON.stringify(sec),
        stockholders: JSON.stringify(stockholders),
        contacts: JSON.stringify([contact_persons, signatories]),
        properties: JSON.stringify(properties),
        investment: JSON.stringify([investment_commitment, investment_actual, employee_commitment, employee_actual]),
      } as Record<SectionKey, string>,
    };
  };
  const [loaded, setLoaded] = useState<ReturnType<typeof splitForm> | null>(null);
  useEffect(() => {
    if (editing && !loadingLocation && loaded === null) setLoaded(splitForm(form));
  }, [editing, loadingLocation, loaded, form]);
  const currentParts = splitForm(form);
  const sectionDirty: Record<SectionKey, boolean> = {
    stockholders: loaded !== null && currentParts.sections.stockholders !== loaded.sections.stockholders,
    contacts: loaded !== null && currentParts.sections.contacts !== loaded.sections.contacts,
    properties: loaded !== null && currentParts.sections.properties !== loaded.sections.properties,
    investment: loaded !== null && currentParts.sections.investment !== loaded.sections.investment,
    sec: loaded !== null && currentParts.sections.sec !== loaded.sections.sec,
  };
  const formChangedSinceLoad =
    loaded !== null && (currentParts.rest !== loaded.rest || Object.values(sectionDirty).some(Boolean));
  const [savingSection, setSavingSection] = useState<SectionKey | null>(null);
  const canSubmit = useMemo(() => {
    const userId = form.user_id.trim();
    const businessName = form.business_name.trim();
    const registrationNo = form.registration_no.trim();
    const tin = form.tin.trim();
    const address = form.address.trim();
    const contactNo = form.contact_no.trim();

    if (!businessName) return false;

    if (!editing) {
      const hasAnyInput = Boolean(userId || businessName || registrationNo || tin || address || contactNo);
      return hasAnyInput;
    }

    const originalUserId = editing.user_id != null ? String(editing.user_id).trim() : '';
    const originalBusinessName = (editing.business_name || '').trim();
    const originalRegistrationNo = (editing.registration_no || '').trim();
    const originalTin = (editing.tin || '').trim();
    const originalAddress = (editing.address || '').trim();
    const originalContactNo = (editing.contact_no || '').trim();
    const originalLocation = (editing.location || '').trim();
    const location = form.location.trim();

    const hasChanged =
      formChangedSinceLoad ||
      userId !== originalUserId ||
      businessName !== originalBusinessName ||
      registrationNo !== originalRegistrationNo ||
      tin !== originalTin ||
      address !== originalAddress ||
      contactNo !== originalContactNo ||
      location !== originalLocation;

    return hasChanged;
  }, [
    editing,
    formChangedSinceLoad,
    form.address,
    form.business_name,
    form.contact_no,
    form.location,
    form.registration_no,
    form.tin,
    form.user_id,
  ]);

  const termCounts = useMemo(() => {
    let active = 0;
    let expired = 0;
    for (const p of rows) {
      const st = leaseStatus(p.end_term);
      if (st === 'active') active += 1;
      else if (st === 'expired') expired += 1;
    }
    return { all: rows.length, active, expired };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const byTerm = termFilter === 'all' ? rows : rows.filter((p) => leaseStatus(p.end_term) === termFilter);
    if (!q) return byTerm;
    return byTerm.filter((p) => {
      const statusStr = p.is_active === 1 ? 'active' : 'inactive';
      return (
        (p.ref_no || '').toLowerCase().includes(q) ||
        String(displayRef(p)).toLowerCase().includes(q) ||
        (p.ref_code || '').toLowerCase().includes(q) ||
        (p.business_name || '').toLowerCase().includes(q) ||
        (p.tin || '').toLowerCase().includes(q) ||
        (p.registration_no || '').toLowerCase().includes(q) ||
        (p.contact_no || '').toLowerCase().includes(q) ||
        (p.address || '').toLowerCase().includes(q) ||
        (p.business_type || '').toLowerCase().includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [rows, searchQuery, termFilter]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredRows.length / Math.max(1, pageSize)));
  }, [filteredRows.length, pageSize]);

  const pagedRows = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize, totalPages]);

  const showingRange = useMemo(() => {
    if (filteredRows.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    const from = (safePage - 1) * pageSize + 1;
    const to = Math.min(filteredRows.length, safePage * pageSize);
    return { from, to };
  }, [filteredRows.length, page, pageSize, totalPages]);

  const visiblePageNumbers = useMemo(() => {
    const current = Math.min(Math.max(1, page), totalPages);
    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize, termFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const highlightProponentRow = useCallback((proponentId: number) => {
    setHighlightedProponentId(proponentId);
    setHighlightedProponentTick((current) => current + 1);
  }, []);

  const [shouldCleanProponentQuery, setShouldCleanProponentQuery] = useState(false);

  // Arriving from global search (?proponentId=…): jump to the right page,
  // clear any search filter that would hide the row, and flash-highlight it —
  // same pattern as ApplicationsWorkflow's notification deep-link.
  useEffect(() => {
    const search = String(locationSearch || '').trim();
    if (!search || consumedProponentQueryRef.current === search) return;
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const rawId = Number(params.get('proponentId') || '');
    if (!Number.isFinite(rawId) || rawId <= 0) return;
    if (!rows.some((row) => row.id === rawId)) return;

    consumedProponentQueryRef.current = search;
    if (searchQuery.trim()) setSearchQuery('');

    const targetIndex = rows.findIndex((row) => row.id === rawId);
    if (targetIndex !== -1) setPage(Math.floor(targetIndex / Math.max(1, pageSize)) + 1);

    setShouldCleanProponentQuery(true);
    highlightProponentRow(rawId);
  }, [rows, pageSize, searchQuery, locationSearch, highlightProponentRow]);

  useEffect(() => {
    if (!highlightedProponentId) return;
    const target = [rowRefs.current[highlightedProponentId], cardRefs.current[highlightedProponentId]].find(
      (node) => node && node.offsetParent !== null,
    );
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedProponentId, pagedRows]);

  useEffect(() => {
    if (!highlightedProponentId) return;
    const timerId = window.setTimeout(() => {
      setHighlightedProponentId((current) => (current === highlightedProponentId ? null : current));
    }, HIGHLIGHT_DURATION_MS);
    return () => window.clearTimeout(timerId);
  }, [highlightedProponentId, highlightedProponentTick]);

  useEffect(() => {
    if (!shouldCleanProponentQuery || highlightedProponentId !== null || !navigate) return;
    const normalizedSearch = String(locationSearch || '').trim();
    const cleanedSearch = stripProponentQueryParam(normalizedSearch);
    setShouldCleanProponentQuery(false);
    consumedProponentQueryRef.current = '';
    if (cleanedSearch === normalizedSearch) return;
    const nextPathname = typeof window !== 'undefined' ? window.location.pathname || '/applications/proponents' : '/applications/proponents';
    navigate(`${nextPathname}${cleanedSearch}`, { replace: true });
  }, [highlightedProponentId, locationSearch, navigate, shouldCleanProponentQuery]);

  // Manual registration (walk-in/legacy locators) — the backend flags these
  // is_manual_registration so they show in this list without an approved
  // application behind them.
  // With `sublessor` ("Add Sub-Lessee" on a locator): a new sub-lessee of it —
  // Type of Contract preset to Sublease and the same Account Officer.
  function openCreate(sublessor?: { id: number; name: string; ref_no: string | null; account_officer_id: string }) {
    setEditing(null);
    const subleaseType = sublessor
      ? contractTypes.find((t) => t.is_active === 1 && newLocatorTitle(t.name) === 'Sub Lessee')
      : undefined;
    setForm({
      user_id: '',
      business_name: '',
      registration_no: '',
      tin: '',
      address: '',
      contact_no: '',
      ...BLANK_PROFILE_FORM,
      ...(sublessor
        ? {
            account_officer_id: sublessor.account_officer_id,
            contract_type_id: subleaseType ? String(subleaseType.id) : '',
          }
        : {}),
    });
    setSublease(sublessor ? { sublessor: { id: sublessor.id, name: sublessor.name, ref_no: sublessor.ref_no }, sublessees: [] } : NO_SUBLEASE);
    setActiveProfileTab('Profile');
    setContactsOpen(null);
    setShowRowErrors({ stockholders: false, contacts: false });
    setLeases([]);
    setViewLeaseId(null);
    setGisDocument(null);
    setLoaded(null);
    setPendingDocs([]);
    locationRequestIdRef.current = null;
    setLoadingLocation(false);
    setIsCreateOpen(true);
  }

  // Profile fields aren't part of the bulk /api/proponents list — they're
  // fetched on demand here, only when a specific locator's panel is opened,
  // rather than pulled for every row up front.
  function openEdit(p: ProponentRow) {
    setIsCreateOpen(true);
    setActiveProfileTab('Profile');
    setContactsOpen(null);
    setShowRowErrors({ stockholders: false, contacts: false });
    setLeases([]);
    setViewLeaseId(null);
    setSublease(NO_SUBLEASE);
    setLoaded(null);
    setEditing(p);
    setLoginInfo(null);
    setGisDocument(null);
    setForm({
      user_id: p.user_id != null ? String(p.user_id) : '',
      business_name: p.business_name || '',
      registration_no: p.registration_no || '',
      tin: p.tin || '',
      address: p.address || '',
      contact_no: p.contact_no || '',
      ...BLANK_PROFILE_FORM,
    });

    locationRequestIdRef.current = p.id;
    setLoadingLocation(true);
    fetch(api(`/api/proponents/${p.id}`), { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (locationRequestIdRef.current !== p.id) return; // superseded by a newer openEdit() call
        const data = json?.data || {};
        setLoginInfo({ status: data.login_status ?? null, email: data.login_email ?? null, username: data.login_username ?? null });
        setGisDocument(data.gis_document ?? null);
        const profileFields = {
          location: data.location || '',
          ref_code: data.ref_code || '',
          lease_address: data.lease_address || '',
          account_officer_id: data.account_officer_id != null ? String(data.account_officer_id) : '',
          sec_registration_date: toDateInputValue(data.sec_registration_date),
          date_signed: toDateInputValue(data.date_signed),
          start_term: toDateInputValue(data.manual_start_term),
          end_term: toDateInputValue(data.manual_end_term),
          grace_period: data.grace_period || '',
          is_sublease: Boolean(data.is_sublease),
          sub_pgro: data.sub_pgro || '',
          sub_pgrr: data.sub_pgrr || '',
          land_use: data.land_use || '',
          extension_date: toDateInputValue(data.extension_date),
          extension_remarks: data.extension_remarks || '',
          authorized_capital: data.authorized_capital || '',
          authorized_capital_currency: data.authorized_capital_currency || 'PHP',
          subscribed_capital: data.subscribed_capital || '',
          subscribed_capital_currency: data.subscribed_capital_currency || 'PHP',
          paid_up_capital: data.paid_up_capital || '',
          paid_up_capital_currency: data.paid_up_capital_currency || 'PHP',
          contract_type_id: data.contract_type_id != null ? String(data.contract_type_id) : '',
          industry_code: data.industry_code || '',
          business_activities: data.business_activities || '',
          nationality: data.nationality || '',
          advance_lease_payment_months: data.advance_lease_payment_months || '',
          advance_lease_payment_amount: data.advance_lease_payment_amount || '',
          advance_lease_payment_currency: data.advance_lease_payment_currency || 'PHP',
          security_deposit_months: data.security_deposit_months || '',
          security_deposit_amount: data.security_deposit_amount || '',
          security_deposit_currency: data.security_deposit_currency || 'PHP',
          performance_security_months: data.performance_security_months || '',
          performance_security_amount: data.performance_security_amount || '',
          performance_security_currency: data.performance_security_currency || 'PHP',
          investment_commitment: formatIfNumeric(data.investment_commitment),
          investment_actual: formatIfNumeric(data.investment_actual),
          employee_commitment: data.employee_commitment || '',
          employee_actual: data.employee_actual || '',
          sec_company_email: data.sec_company_email || '',
          sec_company_telephone: data.sec_company_telephone || '',
          sec_company_mobile: data.sec_company_mobile || '',
          sec_primary_purpose: data.sec_primary_purpose || '',
          sec_secondary_purpose: data.sec_secondary_purpose || '',
          sec_gis_date: toDateInputValue(data.sec_gis_date),
          sec_contact_name: data.sec_contact_name || '',
          sec_contact_email: data.sec_contact_email || '',
          sec_contact_telephone: data.sec_contact_telephone || '',
          sec_contact_mobile: data.sec_contact_mobile || '',
          properties: mapPropertyRows(data.properties),
          land_use_id: data.land_use_id != null ? String(data.land_use_id) : '',
          stockholders: mapStockholderRows(data.stockholders),
          contact_persons: mapContactRows(data.contact_persons),
          signatories: mapContactRows(data.signatories),
        };
        setForm((prev) => ({ ...prev, ...profileFields }));
        setSublease(subleaseFrom(data));
        setViewLeaseId(null);
        void loadLeases(p.id);
        setEditing((prev) =>
          prev && prev.id === p.id
            ? {
                ...prev,
                location: data.location ?? null,
                account_officer_name: data.account_officer_name ?? null,
                start_term: data.start_term ?? null,
                end_term: data.end_term ?? null,
                lease_term: data.lease_term ?? null,
                contract_type_name: data.contract_type_name ?? null,
                business_type: data.business_type ?? null,
                has_application: Boolean(data.has_application),
                effective_industry_code: data.effective_industry_code ?? null,
                has_contract: Boolean(data.has_contract),
                renewal_application_no: data.renewal_application_no ?? null,
                renewal_status: data.renewal_status ?? null,
                term_editable: Boolean(data.term_editable),
                manual_start_term: data.manual_start_term ?? null,
                manual_end_term: data.manual_end_term ?? null,
              }
            : prev,
        );
      })
      .catch(() => {
        /* non-critical — profile fields just stay blank/editable */
      })
      .finally(() => {
        if (locationRequestIdRef.current === p.id) setLoadingLocation(false);
      });
  }

  // Stockholders / Contact Person + Signatory / Property schedule each save on their own
  // (PUT /api/proponents/:id/<section>): this data is entered over time, not in one sitting,
  // so it must not depend on re-saving the whole locator. The saved rows come back with
  // their ids and replace the form's copy, so the next save updates them instead of
  // adding duplicates. Only available for a locator that already exists.
  /** Validates the row tables; on a problem shows it, outlines the fields and returns false. */
  function checkRowTables(which: { stockholders?: boolean; contacts?: boolean }): boolean {
    const problems: [keyof typeof showRowErrors, string | null][] = [];
    if (which.stockholders) problems.push(['stockholders', rowsError('Stockholders', form.stockholders, STOCKHOLDER_RULES)]);
    if (which.contacts) {
      problems.push([
        'contacts',
        rowsError('Contact Person', form.contact_persons, CONTACT_RULES) ??
          rowsError('Authorized Signatory', form.signatories, CONTACT_RULES),
      ]);
    }
    const first = problems.find(([, problem]) => problem);
    if (!first) return true;
    setShowRowErrors((prev) => ({ ...prev, [first[0]]: true }));
    if (first[0] === 'contacts') setContactsOpen(true);
    if (first[0] === 'stockholders') setActiveProfileTab('Stockholders');
    toast.error(first[1] as string);
    return false;
  }

  async function saveSection(section: SectionKey) {
    if ((section === 'stockholders' || section === 'contacts') && !checkRowTables({ [section]: true })) return;
    // The Ref. Code is a lease field now (saved by the panel's Save), so only
    // the SEC Registration No. holds up the SEC card's own save.
    if (section === 'sec' && secNoTaken) {
      toast.error(secNoTaken);
      return;
    }
    if (section === 'properties') {
      const problem = propertyScheduleError(form.properties);
      if (problem) {
        setShowPropertyErrors(true);
        toast.error(problem);
        return;
      }
    }
    if (!editing) {
      if (!form.business_name.trim()) {
        toast.error("Enter the Locator's Name first — this is saved under the locator.");
        return;
      }
      keepOpenAfterCreateRef.current = true;
      await save();
      return;
    }
    setSavingSection(section);
    try {
      const body =
        section === 'stockholders'
          ? { stockholders: form.stockholders.map(toStockholderPayload) }
          : section === 'contacts'
            ? {
                contact_persons: form.contact_persons.map(toContactPayload),
                signatories: form.signatories.map(toContactPayload),
              }
            : section === 'sec'
              ? secRegistrationPayload(form)
            : section === 'investment'
              ? {
                  investment_commitment: form.investment_commitment.trim() || null,
                  investment_actual: form.investment_actual.trim() || null,
                  employee_commitment: form.employee_commitment.trim() || null,
                  employee_actual: form.employee_actual.trim() || null,
                }
              : { properties: form.properties.map(toPropertyPayload) };

      const path = section === 'sec' ? 'sec-registration' : section;
      const res = await fetch(api(`/api/proponents/${editing.id}/${path}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');

      const data = json.data || {};
      const saved =
        section === 'stockholders'
          ? { stockholders: mapStockholderRows(data.stockholders) }
          : section === 'contacts'
            ? { contact_persons: mapContactRows(data.contact_persons), signatories: mapContactRows(data.signatories) }
            : section === 'sec'
              ? Object.fromEntries(
                  [...SEC_PROPONENT_KEYS, ...SEC_DETAIL_KEYS].map((key) => [
                    key,
                    key === 'sec_registration_date' || key === 'sec_gis_date'
                      ? toDateInputValue(data[key])
                      : key.endsWith('_currency')
                        ? data[key] || 'PHP'
                        : data[key] || '',
                  ]),
                )
            : section === 'investment'
              ? {
                  investment_commitment: formatIfNumeric(data.investment_commitment),
                  investment_actual: formatIfNumeric(data.investment_actual),
                  employee_commitment: data.employee_commitment || '',
                  employee_actual: data.employee_actual || '',
                }
              : { properties: mapPropertyRows(data.properties) };
      const nextForm = { ...form, ...saved };
      setForm(nextForm);
      if (section === 'sec') {
        setEditing((prev) =>
          prev
            ? {
                ...prev,
                registration_no: data.registration_no ?? null,
                tin: data.tin ?? null,
                address: data.address ?? null,
              }
            : prev,
        );
      }
      setLoaded((prev) =>
        prev ? { ...prev, sections: { ...prev.sections, [section]: splitForm(nextForm).sections[section] } } : prev,
      );
      toast.success(
        section === 'stockholders'
          ? 'Stockholders saved'
          : section === 'contacts'
            ? 'Contact persons and signatories saved'
            : section === 'sec'
              ? 'SEC registration information saved'
            : section === 'investment'
              ? 'Performance Commitment saved'
              : 'Property schedule saved',
      );
      if (section === 'properties') setShowPropertyErrors(false);
      if (section === 'stockholders' || section === 'contacts') setShowRowErrors((prev) => ({ ...prev, [section]: false }));
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSavingSection(null);
    }
  }

  async function save(skipDuplicateCheck = false) {
    if (refCodeTaken || secNoTaken) {
      keepOpenAfterCreateRef.current = false;
      toast.error((refCodeTaken || secNoTaken) as string);
      return;
    }
    // Same rule as the property schedule below: only a table that was touched
    // (or, on a New Locator, has rows) is checked, so untouched older rows
    // don't block saving the rest.
    if (
      !checkRowTables({
        stockholders: sectionDirty.stockholders || (!editing && form.stockholders.length > 0),
        contacts:
          sectionDirty.contacts || (!editing && (form.contact_persons.length > 0 || form.signatories.length > 0)),
      })
    ) {
      keepOpenAfterCreateRef.current = false;
      return;
    }
    if (sectionDirty.properties || (!editing && form.properties.length > 0)) {
      const problem = propertyScheduleError(form.properties);
      if (problem) {
        keepOpenAfterCreateRef.current = false;
        setShowPropertyErrors(true);
        toast.error(problem);
        return;
      }
    }
    // Registered Locator only lists locators with an Account Officer (an
    // Account Officer's own new locator defaults to them on the server).
    if (!officerLocked && !form.account_officer_id.trim()) {
      keepOpenAfterCreateRef.current = false;
      toast.error("Choose the locator's Account Officer.");
      return;
    }
    if (termEditable) {
      if (!form.start_term !== !form.end_term) {
        keepOpenAfterCreateRef.current = false;
        toast.error('Enter both the Start Term and the End Term (or neither).');
        return;
      }
      if (form.start_term && form.end_term < form.start_term) {
        keepOpenAfterCreateRef.current = false;
        toast.error("End Term can't be before Start Term.");
        return;
      }
    }
    // Same business already encoded? Warn before saving a second one.
    if (!skipDuplicateCheck) {
      const name = form.business_name.trim();
      const tin = form.tin.trim();
      const changed = !editing || name !== (editing.business_name || '').trim() || tin !== (editing.tin || '').trim();
      if (changed && (name || tin)) {
        try {
          const q = new URLSearchParams({ business_name: name, tin });
          if (editing) q.set('excludeId', String(editing.id));
          const res = await fetch(api(`/api/proponents/duplicates?${q}`), { credentials: 'include' });
          const json = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(json?.data) && json.data.length) {
            setDuplicateMatches(json.data);
            return;
          }
        } catch {
          // The check is only a warning — never block saving on it.
        }
      }
    }
    setSaving(true);
    setError(null);
    try {
      // Same field set for both create and edit — createProponent now persists
      // the full profile up front instead of requiring a later edit.
      const payload: any = {
        user_id: form.user_id.trim() ? Number(form.user_id) : null,
        business_name: form.business_name.trim(),
        registration_no: form.registration_no.trim() || null,
        tin: form.tin.trim() || null,
        address: form.address.trim() || null,
        contact_no: form.contact_no.trim() || null,
        location: form.location.trim() || null,
        ref_code: form.ref_code.trim() || null,
        lease_address: form.lease_address.trim() || null,
        account_officer_id: form.account_officer_id.trim() ? Number(form.account_officer_id) : null,
        sec_registration_date: form.sec_registration_date || null,
        date_signed: form.date_signed || null,
        grace_period: form.grace_period.trim() || null,
        is_sublease: form.is_sublease,
        sub_pgro: form.sub_pgro.trim() || null,
        sub_pgrr: form.sub_pgrr.trim() || null,
        // land_use (the old free text) is no longer edited here — it is kept as a legacy note.
        land_use_id: form.land_use_id ? Number(form.land_use_id) : null,
        extension_date: form.extension_date || null,
        extension_remarks: form.extension_remarks.trim() || null,
        authorized_capital: form.authorized_capital.trim() || null,
        authorized_capital_currency: form.authorized_capital_currency || null,
        subscribed_capital: form.subscribed_capital.trim() || null,
        subscribed_capital_currency: form.subscribed_capital_currency || null,
        paid_up_capital: form.paid_up_capital.trim() || null,
        paid_up_capital_currency: form.paid_up_capital_currency || null,
        business_activities: form.business_activities.trim() || null,
        nationality: form.nationality.trim() || null,
        advance_lease_payment_months: form.advance_lease_payment_months.trim() || null,
        advance_lease_payment_amount: form.advance_lease_payment_amount.trim() || null,
        advance_lease_payment_currency: form.advance_lease_payment_currency || null,
        security_deposit_months: form.security_deposit_months.trim() || null,
        security_deposit_amount: form.security_deposit_amount.trim() || null,
        security_deposit_currency: form.security_deposit_currency || null,
        performance_security_months: form.performance_security_months.trim() || null,
        performance_security_amount: form.performance_security_amount.trim() || null,
        performance_security_currency: form.performance_security_currency || null,
        investment_commitment: form.investment_commitment.trim() || null,
        investment_actual: form.investment_actual.trim() || null,
        employee_commitment: form.employee_commitment.trim() || null,
        employee_actual: form.employee_actual.trim() || null,
        ...secRegistrationPayload(form),
        stockholders: form.stockholders.map(toStockholderPayload),
        contact_persons: form.contact_persons.map(toContactPayload),
        signatories: form.signatories.map(toContactPayload),
        properties: form.properties.map(toPropertyPayload),
      };

      // Type of Contract goes to the current contract when there is one,
      // otherwise to the locator's own fallback column (manual registration).
      payload.contract_type_id = form.contract_type_id ? Number(form.contract_type_id) : null;
      // "Add Sub-Lessee": the new locator is linked to its sublessor.
      if (!editing && sublease.sublessor) payload.sublessor_id = sublease.sublessor.id;
      if (!industryDerived) payload.industry_code = form.industry_code || null;
      // Encoded lease term — only while there's no approved contract (its
      // dates rule after that; the server ignores these then too).
      if (termEditable) {
        payload.start_term = form.start_term || null;
        payload.end_term = form.end_term || null;
      }

      if (!payload.business_name) throw new Error('Business name is required');

      const res = await fetch(api(editing ? `/api/proponents/${editing.id}` : '/api/proponents'), {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');

      let failedUploads = 0;
      const newId = Number(json?.data?.id);
      if (!editing && pendingDocs.length && Number.isFinite(newId)) {
        for (const doc of pendingDocs) {
          try {
            await uploadLocatorDocument(newId, doc);
          } catch (uploadError: any) {
            failedUploads += 1;
            toast.error(uploadError?.message || `Upload failed: ${doc.file.name}`);
          }
        }
        setPendingDocs([]);
      }
      if (failedUploads) {
        toast.warning(`Locator saved, but ${failedUploads} document(s) failed to upload — re-upload them from the Documents tab.`);
      }

      setError(null);
      await refresh({ showLoading: false });
      if (!editing && keepOpenAfterCreateRef.current && json?.data?.id) {
        keepOpenAfterCreateRef.current = false;
        // Stay on the new locator: reload it in edit mode, so further section
        // saves only save that section.
        openEdit(json.data as ProponentRow);
        toast.success('Locator created — saved with this section');
        return;
      }
      keepOpenAfterCreateRef.current = false;
      setIsCreateOpen(false);
      toast.success(editing ? 'Locator updated successfully' : 'Locator created successfully');
    } catch (e: any) {
      keepOpenAfterCreateRef.current = false;
      const message = e?.message || 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  // ---- Sub-lease (A-07) ----
  // Opening another locator (a sub-lessee, or the sublessor) replaces this
  // panel, so unsaved edits must be saved or undone first.
  // The Sub-Lease box itself doesn't count: adding or linking a sub-lessee
  // ticks it on the server anyway.
  function blockedByUnsaved() {
    if (!formChangedSinceLoad || !loaded) return false;
    let savedSublease = form.is_sublease;
    try {
      savedSublease = Boolean(JSON.parse(loaded.rest).is_sublease);
    } catch {
      /* keep the form's value */
    }
    const parts = splitForm({ ...form, is_sublease: savedSublease });
    const dirty = parts.rest !== loaded.rest || Object.values(sectionDirty).some(Boolean);
    if (!dirty) return false;
    toast.warning('Save or undo your changes to this locator first.');
    return true;
  }
  function openLocatorById(id: number) {
    const row = proponents.find((p) => p.id === id);
    if (!row || blockedByUnsaved()) return;
    openEdit(row);
  }
  function addSublessee() {
    if (!editing) return;
    setNestedLocator({
      sublessor: {
        id: editing.id,
        name: form.business_name.trim() || editing.business_name,
        ref_no: editing.ref_no,
        account_officer_id: form.account_officer_id,
      },
    });
  }
  // Stacked (embedded) instance: open its locator once the list has loaded,
  // and hand control back to the sublessor's panel when this one closes.
  const embeddedOpenedRef = useRef(false);
  useEffect(() => {
    if (!embedded || embeddedOpenedRef.current || !locatorsData) return;
    embeddedOpenedRef.current = true;
    if (embedded.sublessor) {
      openCreate(embedded.sublessor);
      return;
    }
    const row = proponents.find((p) => p.id === embedded.locatorId);
    if (row) openEdit(row);
    else embedded.onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, locatorsData]);
  useEffect(() => {
    if (embedded?.leaseId != null && leases.some((l) => l.id === embedded.leaseId)) setViewLeaseId(embedded.leaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leases]);
  const embeddedShownRef = useRef(false);
  useEffect(() => {
    if (isCreateOpen) embeddedShownRef.current = true;
    if (!embedded || !embeddedShownRef.current || isCreateOpen) return;
    // Let the panel's slide-out finish before it's unmounted.
    const t = window.setTimeout(() => embedded.onClose(), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateOpen]);

  /** After the stacked sub-lessee panel closes: its name, terms or link may
   * have changed, so re-read this locator's sub-lessees. */
  async function reloadSublease() {
    if (!editing) return;
    try {
      const data = (await fetch(api(`/api/proponents/${editing.id}`), { credentials: 'include' }).then((r) => r.json()))?.data;
      if (data) setSublease(subleaseFrom(data));
    } catch {
      /* keep what's shown */
    }
  }
  /** Links `childId` under the open locator, or unlinks it (sublessorId null). */
  async function setSublessorOf(childId: number, sublessorId: number | null) {
    if (!editing || blockedByUnsaved()) return;
    setSubleaseSaving(true);
    try {
      const res = await fetch(api(`/api/proponents/${childId}/sublessor`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sublessor_id: sublessorId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Could not update the sub-lease');
      const data = (await fetch(api(`/api/proponents/${editing.id}`), { credentials: 'include' }).then((r) => r.json()))?.data;
      if (data) {
        setSublease(subleaseFrom(data));
        // Linking ticks Sub-Lease on the server; keep the form (and its
        // "unsaved" baseline) in step so the next Update doesn't untick it.
        const nextForm = { ...form, is_sublease: Boolean(data.is_sublease) };
        setForm(nextForm);
        setLoaded(splitForm(nextForm));
      }
      setSublesseeLinkId('');
      toast.success(sublessorId ? 'Sub-lessee linked' : 'Sub-lessee unlinked');
      await refresh({ showLoading: false });
    } catch (e: any) {
      toast.error(e?.message || 'Could not update the sub-lease');
    } finally {
      setSubleaseSaving(false);
    }
  }

  async function deactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/proponents/${id}/deactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      setError(null);
      await refresh({ showLoading: false });
      toast.success('Locator deactivated successfully');
      setConfirmDeactivateId(null);
    } catch (e: any) {
      const message = e?.message || 'Deactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function reactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/proponents/${id}/reactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reactivate failed');
      setError(null);
      await refresh({ showLoading: false });
      toast.success('Locator reactivated successfully');
    } catch (e: any) {
      const message = e?.message || 'Reactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const contactNames = (rows: ContactPersonRow[]) =>
    rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), designation: r.designation.trim() }));
  const contactSummary = { contacts: contactNames(form.contact_persons), signatories: contactNames(form.signatories) };
  const contactsEmpty = contactSummary.contacts.length === 0 && contactSummary.signatories.length === 0;
  // Collapsed by default (even when empty — the header says so); open while it
  // has unsaved changes, or once clicked open.
  const contactsExpanded = contactsOpen ?? sectionDirty.contacts;

  // Ref. Code and SEC Registration No. are typed in but unique across
  // locators: checked as they're typed (debounced) and again by the server on save.
  const useTakenCheck = (field: 'ref_code' | 'registration_no', value: string, saved: string | null | undefined) => {
    const [taken, setTaken] = useState<string | null>(null);
    useEffect(() => {
      const code = value.trim();
      setTaken(null);
      if (!code || (editing && code.toUpperCase() === String(saved || '').trim().toUpperCase())) return;
      let cancelled = false;
      const timer = window.setTimeout(async () => {
        try {
          const q = new URLSearchParams({ code, field });
          if (editing) q.set('excludeId', String(editing.id));
          const res = await fetch(api(`/api/proponents/ref-code-available?${q}`), { credentials: 'include' });
          const json = await res.json().catch(() => ({}));
          if (!cancelled && res.ok && json?.available === false) setTaken(json.message || 'Already used by another locator.');
        } catch {
          // Non-fatal: the save checks again.
        }
      }, 400);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, editing, saved]);
    return taken;
  };
  const refCodeTaken = useTakenCheck('ref_code', form.ref_code, editing?.ref_code);
  const secNoTaken = useTakenCheck('registration_no', form.registration_no, editing?.registration_no);

  const viewedLease = viewLeaseId !== null ? leases.find((l) => l.id === viewLeaseId) || null : null;
  // An earlier lease's stacked panel: lease-view layout from the first render,
  // even before its lease has loaded (no flash of the locator's own layout).
  const leaseView = viewOnlyLease;
  const leaseLabel = viewedLease
    ? viewedLease.ref_code || viewedLease.application_no || viewedLease.contract_no || 'Encoded lease'
    : null;

  // One-line text input on the SEC Registration Information card.
  const secTextField = (key: SecKey, label: string, placeholder?: string) => (
    <Field compact label={label}>
      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
        <input
          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
          style={{ color: 'var(--text)' }}
          value={form[key]}
          placeholder={placeholder}
          disabled={loadingLocation}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        />
      </div>
    </Field>
  );

  return (
    <div className={embedded ? undefined : 'space-y-4 sm:space-y-5'}>
      {embedded ? null : (
      <div className="glass-card p-3 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        {error && (
          <div
            className="mb-3 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}
          >
            {error}
          </div>
        )}

        {/* Search + New Locator share one row on every size. Locators normally
            arrive via an approved application; "New Locator" is the manual
            registration path (flagged is_manual_registration server-side). */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <div className="relative group flex-1 min-w-0 sm:flex-none sm:w-72">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search locators..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
          </div>
          {/* Lease status filter (End Term based) — same "All statuses"
              dropdown the Approval & Compliance lists use beside their search. */}
          <div className="w-40 shrink-0 sm:w-48">
            <AppSelect
              compact
              isClearable
              placeholder={`All statuses (${termCounts.all})`}
              value={termFilter === 'all' ? '' : termFilter}
              onChange={(value) => setTermFilter(value === 'active' || value === 'expired' ? value : 'all')}
              options={[
                { value: 'active', label: 'Active', detail: String(termCounts.active) },
                { value: 'expired', label: 'Expired', detail: String(termCounts.expired) },
              ]}
            />
          </div>
          </div>
          {canAdd ? (
          <button
            className="shrink-0 h-9 rounded-lg px-3 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            onClick={() => openCreate()}
          >
            <Plus size={15} />
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">New Locator</span>
          </button>
          ) : null}
        </div>

        {isLoading ? (
          <div className="py-2">
            <TableSkeleton columns={8} rows={5} />
          </div>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title="No locators found"
            description={
              searchQuery
                ? 'Try adjusting your search filters.'
                : 'No locators are registered yet — one appears here once an application is approved, or register one manually with New Locator.'
            }
          />
        ) : (
          <>
          {/* Phones: one card per locator instead of an 8-column table */}
          <div className="sm:hidden space-y-2">
            {pagedRows.map((p) => (
              <button
                key={p.id}
                ref={(node) => { cardRefs.current[p.id] = node; }}
                type="button"
                className="w-full text-left rounded-xl p-3 cursor-pointer active:bg-[var(--selected-bg)] transition-colors"
                style={{
                  border: p.id === highlightedProponentId ? '1px solid #2563eb' : '1px solid var(--border-subtle)',
                  backgroundColor:
                    p.id === highlightedProponentId
                      ? 'rgba(59,130,246,0.12)'
                      : 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
                  boxShadow: p.id === highlightedProponentId ? 'inset 0 0 0 1px rgba(59,130,246,0.22)' : undefined,
                }}
                onClick={() => openEdit(p)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 text-[13px] font-semibold leading-snug break-words" style={{ color: 'var(--text)' }}>
                    {p.business_name}
                    {pendingRequestFor.has(p.id) ? <ChangeRequestBadge /> : null}
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold text-secondary tabular-nums">{displayRef(p)}</span>
                </div>
                {p.address ? <div className="mt-0.5 text-[11px] text-secondary break-words line-clamp-2">{p.address}</div> : null}
                {p.business_type ? (
                  <span
                    className="mt-2 inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-medium truncate"
                    style={{ backgroundColor: 'rgba(99,102,241,0.18)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.4)' }}
                  >
                    {p.business_type}
                  </span>
                ) : null}
                <div className="mt-2.5 grid grid-cols-3 gap-2 text-[11px]">
                  <div className="min-w-0">
                    <div className="text-[9px] uppercase tracking-wider text-secondary">Start</div>
                    <div className="truncate" style={{ color: 'var(--text)' }}>{fmtDate(p.start_term)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] uppercase tracking-wider text-secondary">End</div>
                    <div className="truncate" style={{ color: 'var(--text)' }}>{fmtDate(p.end_term)}</div>
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="text-[9px] uppercase tracking-wider text-secondary">Lease term</div>
                    <div className="truncate" style={{ color: 'var(--text)' }}>{p.lease_term || '—'}</div>
                  </div>
                </div>
                {p.encoded_by ? <div className="mt-2 text-[10px] text-secondary">Encoded by {p.encoded_by}</div> : null}
              </button>
            ))}
          </div>

          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Ref No', 'Tenant', 'Address', 'Industry', 'Start Term', 'End Term', 'Lease Term', 'Encoded By'].map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((p) => (
                  <tr
                    key={p.id}
                    ref={(node) => { rowRefs.current[p.id] = node; }}
                    style={
                      p.id === highlightedProponentId
                        ? {
                            borderTop: '1px solid var(--border-subtle)',
                            background:
                              'linear-gradient(90deg, rgba(59,130,246,0.14) 0%, rgba(59,130,246,0.07) 34%, rgba(59,130,246,0.02) 100%)',
                            boxShadow: 'inset 3px 0 0 #2563eb, inset 0 0 0 1px rgba(59,130,246,0.22)',
                          }
                        : { borderTop: '1px solid var(--border-subtle)' }
                    }
                    className="cursor-pointer hover:bg-[var(--control-bg)]/40"
                    onClick={() => openEdit(p)}
                  >
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap" style={{ color: 'var(--text)' }}>
                      {displayRef(p)}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {p.business_name}
                      {pendingRequestFor.has(p.id) ? <ChangeRequestBadge /> : null}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary max-w-[220px] truncate" title={p.address || ''}>
                      {p.address || '-'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary max-w-[180px] truncate" title={p.business_type || ''}>
                      {p.business_type || '—'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{fmtDate(p.start_term)}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{fmtDate(p.end_term)}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{p.lease_term || '—'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{p.encoded_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            <DataTableControls
              page={page}
              totalPages={totalPages}
              totalItems={filteredRows.length}
              showingFrom={showingRange.from}
              showingTo={showingRange.to}
              visiblePageNumbers={visiblePageNumbers}
              pageSize={pageSize}
              pageSizeOptions={[50, 100, 200, 500]}
              onPageSizeChange={(value) => setPageSize(value)}
              onPageChange={(p) => setPage(p)}
              loading={isLoading || isRevalidating}
            />
          </>
        )}
      </div>
      )}

      <SidePanel
        open={isCreateOpen}
        title={
          leaseView
            ? leaseLabel
              ? `Lease Agreement — ${leaseLabel}`
              : 'Lease Agreement'
            : editing
            ? sublease.sublessor
              ? 'Sub-Lessee Information'
              : 'Locator Information'
            : sublease.sublessor
            ? 'Sub Lessee'
            : // Same lookup the Type of Contract select uses to show its value.
              newLocatorTitle(
                contractTypeOptions
                  .find((o) => o.value === String(form.contract_type_id ?? ''))
                  ?.label.replace(/ \(inactive\)$/, ''),
              )
        }
        subtitle={leaseView ? 'Locators master table · earlier lease (read only)' : 'Locators master table'}
        onClose={() => setIsCreateOpen(false)}
        onSave={() => void save()}
        saving={saving}
        saveDisabled={!canSubmit}
        hideSave={embedded?.leaseId != null || (editing ? !canEdit : !canAdd)}
        saveLabel={editing ? 'Update' : 'Save'}
        headerExtra={(() => {
          // An encoded locator with no portal login yet: offer to create one.
          const loginButton =
            editing && !editing.user_id && canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setLoginForm({ username: '', email: '', full_name: '' });
                  setLoginOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border cursor-pointer"
                style={{ color: 'var(--text)', borderColor: 'var(--border-subtle)' }}
                title="This locator has no portal login yet — needed before a renewal"
              >
                <Plus size={12} /> Portal login
              </button>
            ) : editing?.user_id && loginInfo?.status === 'PENDING' ? (
              // Created but not sent yet: who it goes to, and send it now.
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border"
                  style={{ color: '#d97706', backgroundColor: 'rgba(245,158,11,.12)', borderColor: 'rgba(245,158,11,.35)' }}
                  title={`${loginInfo.username || ''} · ${loginInfo.email || 'no email'}`}
                >
                  Login pending
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setSendLoginOpen(true)}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border cursor-pointer"
                    style={{ color: 'var(--text)', borderColor: 'var(--border-subtle)' }}
                    title={`Email the username and a temporary password to ${loginInfo.email || 'the locator'}`}
                  >
                    <Send size={12} /> Send login now
                  </button>
                ) : null}
              </span>
            ) : null;
          const badge = (() => {
          // Lease status from the contract terms: Active through End Term
          // (inclusive), Expired after. No badge until a contract exists.
          // A renewal in progress outranks Active/Expired.
          if (editing?.renewal_application_no) {
            return (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border"
                style={{ color: '#d97706', backgroundColor: 'rgba(245,158,11,.12)', borderColor: 'rgba(245,158,11,.35)' }}
                title={`${editing.renewal_application_no} · ${editing.renewal_status || ''}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
                Renewal in process
              </span>
            );
          }
          const status = leaseStatus(editing?.end_term);
          if (!status) return null;
          const active = status === 'active';
          return (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border"
              style={
                active
                  ? { color: '#059669', backgroundColor: 'rgba(16,185,129,.12)', borderColor: 'rgba(16,185,129,.35)' }
                  : { color: '#dc2626', backgroundColor: 'rgba(239,68,68,.12)', borderColor: 'rgba(239,68,68,.35)' }
              }
              title={`End term: ${fmtDate(editing?.end_term)}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: active ? '#10b981' : '#ef4444' }} />
              {active ? 'Active' : 'Expired'}
            </span>
          );
          })();
          return loginButton || badge ? (
            <div className="flex items-center gap-2">
              {loginButton}
              {badge}
            </div>
          ) : null;
        })()}
        footerNote={
          editing ? (
            <>
              Business Type/Industry and Encoded By are derived automatically from this locator's filed
              applications — they aren't set here. Ref No: {editing.ref_no || '—'}.
            </>
          ) : undefined
        }
        // Stacked sub-lessee panel: a little narrower so the sublessor's shows behind it.
        widthClassName={embedded ? 'md:max-w-[70vw]' : 'md:max-w-[75vw]'}
      >
        {editing && pendingRequestFor.has(editing.id) ? (() => {
          const cr = pendingRequestFor.get(editing.id)!;
          const fields = Object.keys(cr.payload || {});
          return (
            <div
              className="mb-4 rounded-xl border p-3 sm:p-4"
              style={{ borderColor: 'rgba(245,158,11,0.35)', backgroundColor: 'rgba(245,158,11,0.07)' }}
            >
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>Change request from the locator</span>
                <span className="text-[11px] text-secondary">
                  {cr.requested_by_username ? `${cr.requested_by_username} · ` : ''}submitted {fmtDate(cr.created_at)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-secondary">
                      <th className="py-1 pr-3 font-semibold">Field</th>
                      <th className="py-1 pr-3 font-semibold">Current</th>
                      <th className="py-1 font-semibold">Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f) => (
                      <tr key={f} className="align-top">
                        <td className="py-1 pr-3 text-secondary whitespace-nowrap">{CHANGE_FIELD_LABELS[f] || f}</td>
                        <td className="py-1 pr-3" style={{ color: 'var(--text)' }}>{cr.current?.[f] || '—'}</td>
                        <td className="py-1 font-semibold" style={{ color: 'var(--text)' }}>{cr.payload[f] || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit ? (
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <input
                    className="app-input flex-1"
                    placeholder="Remarks for the locator (optional)"
                    value={reviewRemarks}
                    onChange={(e) => setReviewRemarks(e.target.value)}
                  />
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={reviewing !== null}
                      onClick={() => void reviewChangeRequest(cr, 'reject')}
                      className="rounded-lg px-3 py-2 text-xs font-semibold border cursor-pointer disabled:opacity-60"
                      style={{ borderColor: 'var(--border-subtle)', color: '#ef4444' }}
                    >
                      {reviewing === 'reject' ? 'Declining…' : 'Reject'}
                    </button>
                    <button
                      type="button"
                      disabled={reviewing !== null}
                      onClick={() => void reviewChangeRequest(cr, 'approve')}
                      className="rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer disabled:opacity-60"
                      style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                    >
                      {reviewing === 'approve' ? 'Approving…' : 'Approve changes'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-secondary">You can view this request; approving it needs edit access.</p>
              )}
            </div>
          );
        })() : null}
        {(() => {
          // Same field layout for New and Edit — same grouping/positions as
          // the legacy BRIDGE system's Locator's Information form, one flex
          // row per visual row of the reference form, each field given a
          // width fraction matching it (no shared grid-row-height coupling
          // between differently-sized rows, which is what caused the
          // cramped overlap in an earlier attempt at this layout). Start/End
          // Term and Lease Term are contract-derived and only exist once a
          // contract has been filed against this locator, so they read
          // straight off `editing` (blank for a not-yet-created locator).
          return (
          <div className="flex flex-col gap-3">
            {/* View-only (no Add/Edit right): every field is locked, not just
                the Save button hidden. Documents stays outside so files can
                still be opened. */}
            <fieldset disabled={formLocked} style={{ display: 'contents' }}>
            {/* Row 1 and Row 2 share this exact column template (same track sizes, same gap,
                same column count) so their edges line up vertically — Row 2 nests
                Principal/Lease Address and TIN/SEC/Ref inside their own cells rather than
                adding extra top-level columns, which would throw off the gap math. */}
            <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1.6fr_0.7fr] gap-3">
              {/* Name and nationality share the first column, so Row 1's
                  three columns still line up with Row 2's. */}
              <div className="flex flex-col xl:flex-row gap-3 min-w-0">
                <Field compact label="Locator's Name" className="flex-1 min-w-0">
                  <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                    <input
                      className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                      style={{ color: 'var(--text)' }}
                      value={form.business_name}
                      onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))}
                    />
                  </div>
                </Field>
                <Field compact label="Nationality" className="xl:w-40 shrink-0">
                  {/* Same box as Locator's Name, so the two are one height. */}
                  <NationalityInput
                    value={form.nationality}
                    onChange={(v) => setForm((p) => ({ ...p, nationality: v }))}
                  />
                </Field>
              </div>
              <div>
                <Field compact label={officerLevel === 1 ? 'Account Officer' : 'Account Officer'}>
                  {officerLocked ? (
                    <input
                      className="app-form-control app-form-control-sm"
                      readOnly
                      tabIndex={-1}
                      value={officerName(form.account_officer_id || (myUserId != null ? String(myUserId) : ''))}
                      title="Your locators are assigned to you — the Manager can reassign them"
                    />
                  ) : (
                    <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                      <AppSelect
                        options={userOptions}
                        value={form.account_officer_id}
                        onChange={(value) => setForm((p) => ({ ...p, account_officer_id: value || '' }))}
                        placeholder={userOptions.length ? 'Select...' : 'No account officers'}
                        isClearable
                        isDisabled={loadingLocation}
                        compact
                        boxed
                        minHeight={26}
                      />
                    </div>
                  )}
                </Field>
              </div>
              <div>
                <Field compact label="Extension Date">
                  <DatePicker
                    mode="single"
                    fullWidth
                    boxed
                    placeholder="Select date"
                    value={dateInputToDate(form.extension_date)}
                    onChange={(d) => setForm((p) => ({ ...p, extension_date: dateToDateInputValue(d) }))}
                  />
                </Field>
              </div>
            </div>

            {/* Row 2: same grid-cols-[1.8fr_1.6fr_0.7fr] track sizes as Row 1 (see note above),
                so Row 1/Row 2 edges stay pixel-aligned. Principal Address, TIN and SEC Registration
                are on the Stockholders tab's SEC Registration Information card; the Ref. Code is
                on the Lease Agreements card (one per lease). */}
            <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1.6fr_0.7fr] gap-3 items-stretch">
              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <div className="flex-1 flex">
                  <Field compact label="Lease Address" className="h-full flex-1">
                    <textarea
                      className="app-form-control app-form-control-sm flex-1 min-h-[4.5rem] md:min-h-0"
                      value={form.lease_address}
                      disabled={loadingLocation}
                      onChange={(e) => setForm((p) => ({ ...p, lease_address: e.target.value }))}
                    />
                  </Field>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Field compact label="Type of Contract">
                  <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                    <AppSelect
                      options={contractTypeOptions}
                      value={form.contract_type_id}
                      onChange={(value) => setForm((p) => ({ ...p, contract_type_id: value || '' }))}
                      placeholder="Select..."
                      isClearable
                      isDisabled={loadingLocation}
                      compact
                      boxed
                      minHeight={26}
                    />
                  </div>
                </Field>
              </div>

              <div className="flex">
                <Field compact label="Extension Remarks" className="h-full flex-1">
                  <textarea
                    className="app-form-control app-form-control-sm flex-1 min-h-[4.5rem] md:min-h-0"
                    value={form.extension_remarks}
                    disabled={loadingLocation}
                    onChange={(e) => setForm((p) => ({ ...p, extension_remarks: e.target.value }))}
                  />
                </Field>
              </div>
            </div>

            {/* Lease Agreements (A-02/A-03/A-04): one row per lease — the current
                one editable (Ref. Code, Date Signed, and Start/End while there's no
                approved contract), earlier ones as history. The Ref. Code dictates
                the dates, so they sit on one row with the SEC Registration No.
                (the company's, fixed). Every renewal is a new lease with a new
                Ref. Code; Ref. Codes are never reused. */}
            <div
              className="flex flex-col gap-2 rounded-xl border p-3"
              style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
            >
              <div
                className="-mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2"
                style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                  {leaseView ? 'Lease Agreement' : 'Lease Agreements'}
                  {leaseView ? null : (
                    <span className="ml-1.5 font-normal normal-case tracking-normal text-secondary">
                      ({Math.max(leases.length, 1)})
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-secondary">
                  {leaseView ? 'An earlier lease — read only' : 'A renewal starts a new lease with its own Ref. Code'}
                </span>
              </div>
              <div className="min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                <table className="w-full min-w-[60rem] table-fixed text-xs border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--control-bg)' }}>
                      {[
                        ['Ref. Code', '15%'],
                        ['SEC Reg. No.', '12%'],
                        ['Type', '13%'],
                        ['Date Signed', '13%'],
                        ['Start Term', '13%'],
                        ['End Term', '13%'],
                        ['Lease Term', '10%'],
                        ['Status', '11%'],
                      ].map(([h, w]) => (
                        <th
                          key={h}
                          className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                          style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)', width: w }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Current lease: the panel's own fields (not shown while viewing an earlier lease) */}
                    {leaseView ? null : (
                    <tr style={{ backgroundColor: 'var(--surface)' }}>
                      <td className="px-1 py-1 border-b align-top" style={{ borderColor: 'var(--input-border)' }}>
                        <input
                          className="app-form-control app-form-control-sm h-9 w-full"
                          style={refCodeTaken ? { borderColor: '#ef4444' } : undefined}
                          value={form.ref_code}
                          placeholder="Type the Ref. Code"
                          disabled={loadingLocation}
                          onChange={(e) => setForm((p) => ({ ...p, ref_code: e.target.value }))}
                        />
                        {refCodeTaken ? <div className="mt-0.5 px-1 text-[10px] leading-tight text-red-500">{refCodeTaken}</div> : null}
                      </td>
                      <td className="px-2 py-1 border-b align-top" style={{ borderColor: 'var(--input-border)' }}>
                        <div className="flex h-9 items-center truncate" style={{ color: 'var(--text-muted)' }} title="From SEC Registration Information (fixed)">
                          {form.registration_no || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-1 border-b align-top" style={{ borderColor: 'var(--input-border)' }}>
                        <div className="flex h-9 items-center truncate" style={{ color: 'var(--text)' }}>
                          {contractTypeOptions.find((o) => o.value === String(form.contract_type_id ?? ''))?.label || '—'}
                        </div>
                      </td>
                      <td className="px-1 py-1 border-b align-top" style={{ borderColor: 'var(--input-border)' }}>
                        <DatePicker
                          mode="single"
                          fullWidth
                          boxed
                          placeholder="Select date"
                          value={dateInputToDate(form.date_signed)}
                          onChange={(d) => setForm((p) => ({ ...p, date_signed: dateToDateInputValue(d) }))}
                        />
                      </td>
                      {(['start_term', 'end_term'] as const).map((key) => (
                        <td key={key} className="px-1 py-1 border-b align-top" style={{ borderColor: 'var(--input-border)' }}>
                          {termEditable ? (
                            // No approved contract yet: the encoded lease term.
                            <DatePicker
                              mode="single"
                              fullWidth
                              boxed
                              placeholder="Select date"
                              value={dateInputToDate(form[key])}
                              onChange={(d) => setForm((p) => ({ ...p, [key]: dateToDateInputValue(d) }))}
                            />
                          ) : (
                            <div className="flex h-9 items-center px-1" style={{ color: 'var(--text)' }} title="From the approved contract">
                              {fmtDate(editing?.[key])}
                            </div>
                          )}
                        </td>
                      ))}
                      <td className="px-1 py-1 border-b align-top" style={{ borderColor: 'var(--input-border)' }}>
                        <div
                          className="flex h-9 items-center rounded-md px-2 font-semibold tabular-nums"
                          style={{ backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: 'var(--text)' }}
                        >
                          {(termEditable ? formatLeaseTerm(form.start_term, form.end_term) : editing?.lease_term) || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-1 border-b align-top" style={{ borderColor: 'var(--input-border)' }}>
                        <div className="flex h-9 items-center">
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: '#15803d' }}
                          >
                            ● Current
                          </span>
                        </div>
                      </td>
                    </tr>
                    )}
                    {/* Earlier leases: history, read-only. A click opens the lease in
                        its own panel stacked over this one (like a sub-lessee). */}
                    {(leaseView ? (viewedLease ? [viewedLease] : []) : leases.filter((l) => !l.is_current))
                      .map((l) => {
                        return (
                          <tr
                            key={l.id}
                            className={leaseView || !editing ? undefined : 'cursor-pointer hover:bg-[var(--selected-bg)]'}
                            onClick={leaseView || !editing ? undefined : () => setNestedLocator({ locatorId: editing.id, leaseId: l.id })}
                            title={leaseView ? undefined : 'Open this lease'}
                          >
                            <td className="px-2 py-2 border-b font-medium" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                              {l.ref_code || <span className="text-secondary">—</span>}
                              <div className="text-[10px] font-normal text-secondary">{l.application_no || l.contract_no || 'Encoded lease'}</div>
                            </td>
                            <td className="px-2 py-2 border-b text-secondary" style={{ borderColor: 'var(--input-border)' }}>
                              {form.registration_no || '—'}
                            </td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>{l.contract_type_name || '—'}</td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>{fmtDate(l.date_signed)}</td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>{fmtDate(l.start_term)}</td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>{fmtDate(l.end_term)}</td>
                            <td className="px-2 py-2 border-b tabular-nums" style={{ borderColor: 'var(--input-border)' }}>
                              {formatLeaseTerm(l.start_term, l.end_term) || '—'}
                            </td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-secondary" style={{ backgroundColor: 'var(--control-bg)' }}>
                                {l.is_renewal ? 'Renewed' : 'Previous'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Row 4: Sub-Lease (A-07). A sub-lessee is a locator of its own (own
                Locator Information), linked to the locator it sub-leases from.
                - A sub-lessee shows who it sub-leases from (no Sub-Lease box: one level only).
                - Any other locator has the Sub-Lease box; ticked (or with sub-lessees)
                  it lists them, adds a new one, or links an existing locator. */}
            {leaseView ? null : (() => {
              const parent = sublease.sublessor;
              if (parent) {
                const canOpen = Boolean(editing) && proponents.some((p) => p.id === parent.id);
                return (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                    style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
                  >
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-secondary">Sub-lessee of</span>
                    {canOpen ? (
                      <button
                        type="button"
                        className="font-semibold text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                        onClick={() => (embedded ? setIsCreateOpen(false) : openLocatorById(parent.id))}
                        title="Back to this locator's Locator Information"
                      >
                        ← {parent.name}
                      </button>
                    ) : (
                      <span className="font-semibold" style={{ color: 'var(--text)' }}>
                        {parent.name}
                      </span>
                    )}
                    {parent.ref_no ? <span className="text-secondary">{parent.ref_no}</span> : null}
                    {/* Unlink from the sub-lessee's side too (saved locators only). */}
                    {editing && canEdit ? (
                      <button
                        type="button"
                        className="ml-auto text-[10px] font-semibold text-secondary hover:text-red-600"
                        disabled={subleaseSaving}
                        onClick={() =>
                          setSublesseeUnlink({
                            id: editing.id,
                            ref_no: editing.ref_no,
                            ref_code: null,
                            business_name: form.business_name.trim() || editing.business_name,
                            is_active: editing.is_active,
                            account_officer_id: null,
                            start_term: null,
                            end_term: null,
                          })
                        }
                      >
                        Unlink
                      </button>
                    ) : null}
                  </div>
                );
              }

              const subs = sublease.sublessees;
              const activeSubs = subs.filter((s) => Number(s.is_active) === 1).length;
              const showCard = Boolean(editing) && (form.is_sublease || subs.length > 0);
              const mainEnd = editing?.end_term ? String(editing.end_term).slice(0, 10) : '';
              // Link existing: active locators that aren't sub-lessees and have none of their own.
              const linkOptions = editing
                ? proponents
                    .filter(
                      (p) =>
                        p.id !== editing.id &&
                        p.is_active === 1 &&
                        !p.sublessor_id &&
                        !proponents.some((o) => o.sublessor_id === p.id),
                    )
                    .map((p) => ({ value: String(p.id), label: p.business_name, detail: p.ref_no ?? '' }))
                : [];
              return (
                <div className="flex flex-col gap-2">
                  <label
                    className="flex w-fit items-center gap-1.5 text-[9px] font-semibold text-secondary uppercase tracking-widest whitespace-nowrap"
                    title={activeSubs ? 'Unlink its sub-lessees first to untick this' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={form.is_sublease || activeSubs > 0}
                      disabled={loadingLocation || activeSubs > 0}
                      onChange={(e) => setForm((p) => ({ ...p, is_sublease: e.target.checked }))}
                    />
                    Sub-Lease
                    {!editing && form.is_sublease ? (
                      <span className="font-normal normal-case tracking-normal">— add its sub-lessees after saving this locator</span>
                    ) : null}
                  </label>
                  {showCard ? (
                    <div
                      className="flex flex-col gap-2 rounded-xl border p-3"
                      style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
                    >
                      <div
                        className="-mx-3 -mt-3 mb-1 flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2"
                        style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                          Sub-Lessees
                          <span className="ml-1.5 font-normal normal-case tracking-normal text-secondary">({subs.length})</span>
                        </span>
                        <span className="text-[10px] text-secondary">Each sub-lessee has its own Locator Information</span>
                      </div>
                      {subs.length ? (
                        <div className="min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                          <table className="w-full min-w-[44rem] table-fixed text-xs border-collapse">
                            <thead>
                              <tr style={{ backgroundColor: 'var(--control-bg)' }}>
                                {[
                                  ['Sub-Lessee', '34%'],
                                  ['Ref. Code', '15%'],
                                  ['Start Term', '14%'],
                                  ['End Term', '14%'],
                                  ['Status', '13%'],
                                  ['', '10%'],
                                ].map(([h, w], i) => (
                                  <th
                                    key={h || i}
                                    className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                                    style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)', width: w }}
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {subs.map((s) => {
                                const canOpen = proponents.some((p) => p.id === s.id);
                                const end = s.end_term ? String(s.end_term).slice(0, 10) : '';
                                const pastMain = Boolean(mainEnd && end && end > mainEnd);
                                const active = Number(s.is_active) === 1;
                                return (
                                  <tr
                                    key={s.id}
                                    className={canOpen ? 'cursor-pointer hover:bg-[var(--selected-bg)]' : undefined}
                                    onClick={canOpen ? () => setNestedLocator({ locatorId: s.id }) : undefined}
                                    title={canOpen ? 'Open this sub-lessee' : 'Assigned to another Account Officer'}
                                  >
                                    <td className="px-2 py-2 border-b font-medium" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                                      <div className="truncate">{s.business_name}</div>
                                      <div className="text-[10px] font-normal text-secondary">{s.ref_no || '—'}</div>
                                    </td>
                                    <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>{s.ref_code || '—'}</td>
                                    <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>{fmtDate(s.start_term)}</td>
                                    <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>
                                      {fmtDate(s.end_term)}
                                      {pastMain ? (
                                        <div className="text-[10px] font-semibold" style={{ color: '#ea580c' }} title={`Main lease ends ${fmtDate(mainEnd)}`}>
                                          Ends after the main lease
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>
                                      <span
                                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                        style={
                                          active
                                            ? { backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: '#15803d' }
                                            : { backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }
                                        }
                                      >
                                        {active ? 'Active' : 'Inactive'}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2 border-b text-right" style={{ borderColor: 'var(--input-border)' }}>
                                      {canEdit ? (
                                        <button
                                          type="button"
                                          className="text-[10px] font-semibold text-secondary hover:text-red-600"
                                          disabled={subleaseSaving}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSublesseeUnlink(s);
                                          }}
                                        >
                                          Unlink
                                        </button>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-xs text-secondary">No sub-lessees yet.</div>
                      )}
                      {canAdd || canEdit ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {canAdd ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[var(--selected-bg)]"
                              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                              disabled={subleaseSaving || loadingLocation}
                              onClick={addSublessee}
                            >
                              <Plus size={13} /> Add Sub-Lessee
                            </button>
                          ) : null}
                          {canEdit && linkOptions.length ? (
                            <>
                              <span className="text-[10px] text-secondary">or link an existing locator</span>
                              <div style={{ width: 260 }}>
                                <AppSelect
                                  compact
                                  isClearable
                                  options={linkOptions}
                                  value={sublesseeLinkId}
                                  onChange={(value) => setSublesseeLinkId(value || '')}
                                  placeholder="Select locator..."
                                  isDisabled={subleaseSaving}
                                />
                              </div>
                              <button
                                type="button"
                                className="rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[var(--selected-bg)]"
                              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                                disabled={!sublesseeLinkId || subleaseSaving}
                                onClick={() => setSublesseeLinkConfirm(true)}
                              >
                                Link
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })()}

            {/* Contact Person + Authorized Person / Signatory — the locator's two people
                lists (dbo.contact_person / dbo.signatory) in one card, same columns and
                widths, saved together by the card's Save. */}
            <div
              className="flex flex-col gap-3 rounded-xl border p-3"
              style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
            >
              <div
                role="button"
                tabIndex={0}
                aria-expanded={contactsExpanded}
                onClick={() => setContactsOpen(!contactsExpanded)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setContactsOpen(!contactsExpanded);
                  }
                }}
                className={cn(
                  '-mx-3 -mt-3 flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2',
                  contactsExpanded ? 'mb-1 rounded-t-xl border-b' : '-mb-3 rounded-xl',
                )}
                style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {contactsExpanded ? (
                    <ChevronDown size={14} className="shrink-0 text-secondary" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-secondary" />
                  )}
                  {contactsExpanded || contactsEmpty ? (
                    <>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                        Contact Person &amp; Authorized Signatory
                      </span>
                      {!contactsExpanded ? (
                        <span className="ml-1 truncate text-[12px] font-medium text-orange-500">
                          No contact person or signatory yet — click to add.
                        </span>
                      ) : null}
                    </>
                  ) : (
                    // Collapsed: each role's heading followed by its people, instead of the
                    // combined title plus repeated "Contact:" / "Signatory:" labels.
                    <div className="flex min-w-0 items-center gap-3 overflow-hidden text-[12px]">
                      {(
                        [
                          ['Contact Person', contactSummary.contacts],
                          ['Authorized Signatory', contactSummary.signatories],
                        ] as const
                      )
                        .filter(([, people]) => people.length > 0)
                        .map(([role, people], ri) => (
                          <div key={role} className="flex min-w-0 items-center gap-3">
                            {ri > 0 ? <span className="h-4 w-px shrink-0" style={{ backgroundColor: 'var(--input-border)' }} /> : null}
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                              {role}
                            </span>
                            <span className="min-w-0 truncate">
                              {people.map((person, pi) => (
                                <span key={pi}>
                                  {pi > 0 ? <span className="text-secondary">; </span> : null}
                                  <span className="font-medium" style={{ color: 'var(--text)' }}>
                                    {person.name}
                                  </span>
                                  {person.designation ? <span className="text-secondary">, {person.designation}</span> : null}
                                </span>
                              ))}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
                {/* Clicking Save shouldn't also fold the card. */}
                <span className="shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <SectionSaveBar
                    allowed={editing ? canEdit : canAdd}
                    label="Save Contacts & Signatories"
                    isEditing={Boolean(editing)}
                    hasContent={form.contact_persons.length > 0 || form.signatories.length > 0}
                    dirty={sectionDirty.contacts}
                    saving={savingSection === 'contacts'}
                    disabled={saving || loadingLocation}
                    onSave={() => void saveSection('contacts')}
                  />
                </span>
              </div>
              {contactsExpanded && (
                [
                  {
                    title: 'Contact Person',
                    hint: 'Day-to-day contact for notices and follow-ups',
                    nameLabel: 'Contact Person',
                    addLabel: 'Add contact',
                    rows: form.contact_persons,
                    empty: 'No contact persons yet — use Add contact.',
                    set: (next: ContactPersonRow[]) => setForm((p) => ({ ...p, contact_persons: next })),
                    blank: blankContactPersonRow,
                  },
                  {
                    title: 'Authorized Person / Signatory',
                    hint: 'Signs the lease agreement for the locator (per Board Resolution)',
                    nameLabel: 'Signatory',
                    addLabel: 'Add signatory',
                    rows: form.signatories,
                    empty: 'No signatories yet — use Add signatory.',
                    set: (next: SignatoryRow[]) => setForm((p) => ({ ...p, signatories: next })),
                    blank: blankSignatoryRow,
                  },
                ] as const
              ).map((group, gi) => (
                <div
                  key={group.title}
                  className={cn('flex flex-col gap-2', gi > 0 && 'border-t pt-3')}
                  style={{ borderColor: 'var(--input-border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }} title={group.hint}>
                      {group.title}
                      <span className="ml-1.5 text-[11px] font-normal text-secondary">({group.rows.length})</span>
                    </span>
                    <button
                      type="button"
                      disabled={loadingLocation}
                      onClick={() => {
                        setShowRowErrors((prev) => ({ ...prev, contacts: false }));
                        group.set([...group.rows, group.blank()]);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[var(--selected-bg)]"
                      style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                    >
                      <Plus size={12} /> {group.addLabel}
                    </button>
                  </div>
                  <RowsEditor<ContactPersonRow>
                    rows={group.rows}
                    disabled={loadingLocation}
                    emptyText={group.empty}
                    hideSideActions
                    rowNoun={group.nameLabel.toLowerCase()}
                    confirmDelete={askRowDelete}
                    invalidKeys={(row) => (showRowErrors.contacts ? invalidRowKeys(row, CONTACT_RULES) : null)}
                    columns={[
                      { key: 'name', label: group.nameLabel, width: '30%', placeholder: 'Full name' },
                      { key: 'designation', label: 'Designation', width: '22%', placeholder: 'e.g. President' },
                      { key: 'contact_no', label: 'Contact No.', width: '18%', placeholder: '09XX XXX XXXX' },
                      { key: 'email', label: 'Email Address', width: '30%', placeholder: 'name@company.com' },
                    ]}
                    onChange={group.set}
                    blankRow={group.blank}
                  />
                </div>
              ))}
            </div>
            </fieldset>

            {/* Folder-tab strip mirroring the legacy BRIDGE system's Locator's
                Information form. Not sticky: it scrolls away with the panel, so the
                tab's content never slides underneath it. */}
            <div className="-mt-3 pt-4" style={{ backgroundColor: 'var(--surface)' }}>
              <div className="folders">
                <div className="tabs overflow-x-auto">
                  {(['Profile', 'Stockholders', 'Documents'] as const).map((tab) => (
                    <div
                      key={tab}
                      className={`tab ${activeProfileTab === tab ? 'active' : ''}`}
                      onClick={() => setActiveProfileTab(tab)}
                    >
                      {tab}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="contents">
              <fieldset disabled={formLocked && activeProfileTab !== 'Documents'} className="content min-w-0">
                {activeProfileTab === 'Stockholders' ? (
                  <div className="flex flex-col gap-4">
                  {/* Stockholders (dbo.stockholder) — same card layout as the Profile's
                      property schedule: Add and Save in the header. */}
                  <div
                    className="flex flex-col gap-3 rounded-xl border p-3"
                    style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
                  >
                    <div
                      className="-mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2"
                      style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                        Stockholders
                        <span className="ml-1.5 font-normal normal-case tracking-normal text-secondary">({form.stockholders.length})</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={loadingLocation}
                          onClick={() => {
                            setShowRowErrors((prev) => ({ ...prev, stockholders: false }));
                            setForm((p) => ({ ...p, stockholders: [...p.stockholders, blankStockholderRow()] }));
                          }}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[var(--selected-bg)]"
                          style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                        >
                          <Plus size={12} /> Add stockholder
                        </button>
                        {(form.stockholders.length > 0 || sectionDirty.stockholders) && (
                          <SectionSaveBar
                            allowed={editing ? canEdit : canAdd}
                            label="Save Stockholders"
                            isEditing={Boolean(editing)}
                            hasContent={form.stockholders.length > 0}
                            dirty={sectionDirty.stockholders}
                            saving={savingSection === 'stockholders'}
                            disabled={saving || loadingLocation}
                            onSave={() => void saveSection('stockholders')}
                          />
                        )}
                      </div>
                    </div>
                    <RowsEditor<StockholderRow>
                      rows={form.stockholders}
                      disabled={loadingLocation}
                      emptyText="No stockholders yet — use Add stockholder."
                      hideSideActions
                      rowNoun="stockholder"
                      confirmDelete={askRowDelete}
                      invalidKeys={(row) => (showRowErrors.stockholders ? invalidRowKeys(row, STOCKHOLDER_RULES) : null)}
                      columns={[
                        { key: 'name', label: 'Stockholder Name', width: '30%', placeholder: 'Full name' },
                        { key: 'nationality', label: 'Nationality', width: '18%', placeholder: 'Select nationality', options: NATIONALITIES },
                        { key: 'subscribed', label: 'Subscribed', width: '18%', numeric: true, amount: true, placeholder: '0.00' },
                        { key: 'paid', label: 'Paid', width: '18%', numeric: true, amount: true, placeholder: '0.00' },
                        { key: 'ownership', label: 'Ownership %', width: '16%', numeric: true, placeholder: '0' },
                      ]}
                      onChange={(next) => setForm((p) => ({ ...p, stockholders: next }))}
                      blankRow={blankStockholderRow}
                    />
                  </div>

                    {/* SEC Registration Information — modelled on the SEC forms (Company
                        Information, Contact Person Information, purposes, capital), below the
                        stockholders table. Its own contact person, separate from the locator's
                        Contact Person list. */}
                    <div
                      className="flex flex-col gap-3 rounded-xl border p-3"
                      style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
                    >
                      <div
                        className="-mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2"
                        style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                          SEC Registration Information
                        </span>
                        <SectionSaveBar
                          allowed={editing ? canEdit : canAdd}
                          label="Save SEC Registration Information"
                          isEditing={Boolean(editing)}
                          hasContent={[...SEC_PROPONENT_KEYS, ...SEC_DETAIL_KEYS].some((k) => !k.endsWith('_currency') && String(form[k] ?? '').trim() !== '')}
                          dirty={sectionDirty.sec}
                          saving={savingSection === 'sec'}
                          disabled={saving || loadingLocation}
                          onSave={() => void saveSection('sec')}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1">
                          {secTextField('registration_no', 'SEC Registration No.', 'e.g. CS201811260')}
                          {secNoTaken ? <span className="text-[11px] text-red-500">{secNoTaken}</span> : null}
                        </div>
                        <Field compact label="SEC Registration Date">
                          <DatePicker
                            mode="single"
                            fullWidth
                            boxed
                            placeholder="Select date"
                            value={dateInputToDate(form.sec_registration_date)}
                            onChange={(d) => setForm((p) => ({ ...p, sec_registration_date: dateToDateInputValue(d) }))}
                          />
                        </Field>
                        {secTextField('tin', 'TIN Number')}
                      </div>

                      <Field compact label="Principal Office Address">
                        <textarea
                          className="app-form-control app-form-control-sm min-h-[4.5rem]"
                          placeholder="No. / Street / Barangay / City / Town / Province / Zip code"
                          value={form.address}
                          onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                        />
                      </Field>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {secTextField('sec_company_email', "Company's Email Address")}
                        {secTextField('sec_company_telephone', "Company's Telephone No.")}
                        {secTextField('sec_company_mobile', "Company's Mobile No.")}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <CapitalField
                          label="Authorized Capital Stock"
                          amount={form.authorized_capital}
                          currency={form.authorized_capital_currency}
                          disabled={loadingLocation}
                          onAmountChange={(v) => setForm((p) => ({ ...p, authorized_capital: v }))}
                          onCurrencyChange={(v) => setForm((p) => ({ ...p, authorized_capital_currency: v }))}
                        />
                        <CapitalField
                          label="Subscribed Capital"
                          amount={form.subscribed_capital}
                          currency={form.subscribed_capital_currency}
                          disabled={loadingLocation}
                          onAmountChange={(v) => setForm((p) => ({ ...p, subscribed_capital: v }))}
                          onCurrencyChange={(v) => setForm((p) => ({ ...p, subscribed_capital_currency: v }))}
                        />
                        <CapitalField
                          label="Paid-up Capital"
                          amount={form.paid_up_capital}
                          currency={form.paid_up_capital_currency}
                          disabled={loadingLocation}
                          onAmountChange={(v) => setForm((p) => ({ ...p, paid_up_capital: v }))}
                          onCurrencyChange={(v) => setForm((p) => ({ ...p, paid_up_capital_currency: v }))}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field compact label="Primary Purpose">
                          <textarea
                            className="app-form-control app-form-control-sm min-h-[4.5rem]"
                            value={form.sec_primary_purpose}
                            onChange={(e) => setForm((p) => ({ ...p, sec_primary_purpose: e.target.value }))}
                          />
                        </Field>
                        <Field compact label="Secondary Purpose">
                          <textarea
                            className="app-form-control app-form-control-sm min-h-[4.5rem]"
                            value={form.sec_secondary_purpose}
                            onChange={(e) => setForm((p) => ({ ...p, sec_secondary_purpose: e.target.value }))}
                          />
                        </Field>
                      </div>

                      <div className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--input-border)' }}>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-secondary">
                          SEC Contact Person
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                          {secTextField('sec_contact_name', 'Name of Contact Person')}
                          {secTextField('sec_contact_email', 'Email Address')}
                          {secTextField('sec_contact_telephone', 'Telephone No.')}
                          {secTextField('sec_contact_mobile', 'Mobile No.')}
                        </div>
                      </div>
                    </div>

                    {/* GIS (General Information Sheet): the filing date is typed in (saved
                        with the SEC Registration Information); the document is the
                        locator's Compliance upload, read only. */}
                    <div
                      className="flex flex-col gap-3 rounded-xl border p-3"
                      style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
                    >
                      <div
                        className="-mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2"
                        style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                          GIS (General Information Sheet)
                        </span>
                        <SectionSaveBar
                          allowed={editing ? canEdit : canAdd}
                          label="Save GIS"
                          isEditing={Boolean(editing)}
                          hasContent={String(form.sec_gis_date ?? '').trim() !== ''}
                          dirty={sectionDirty.sec}
                          saving={savingSection === 'sec'}
                          disabled={saving || loadingLocation}
                          onSave={() => void saveSection('sec')}
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field compact label="Latest GIS Filing">
                          <DatePicker
                            mode="single"
                            fullWidth
                            boxed
                            placeholder="Select date"
                            value={dateInputToDate(form.sec_gis_date)}
                            onChange={(d) => setForm((p) => ({ ...p, sec_gis_date: dateToDateInputValue(d) }))}
                          />
                        </Field>
                        <Field compact label="GIS Document (Compliance)">
                          <div
                            className="app-form-control app-form-control-sm flex h-9 items-center gap-2 text-[12px]"
                            style={{ backgroundColor: 'var(--control-bg)', cursor: 'default' }}
                            title="Uploaded by the locator on their Compliance page (or by the Compliance Officer)"
                          >
                            {gisDocument ? (
                              <>
                                <span className="truncate font-medium" style={{ color: 'var(--text)' }}>
                                  {gisDocument.original_file_name || 'GIS'}
                                </span>
                                <span className="shrink-0 text-secondary">
                                  · {String(gisDocument.status || '').replace(/_/g, ' ').toLowerCase() || 'uploaded'}
                                  {gisDocument.validity_to ? ` · valid until ${fmtDate(gisDocument.validity_to)}` : ''}
                                </span>
                              </>
                            ) : (
                              <span className="text-secondary">{editing ? 'Not uploaded yet' : 'After the locator is saved'}</span>
                            )}
                          </div>
                        </Field>
                      </div>
                    </div>
                  </div>
                ) : activeProfileTab === 'Documents' ? (
                  <LocatorDocumentsTab
                    proponentId={editing?.id ?? null}
                    contractTypeId={form.contract_type_id ? Number(form.contract_type_id) : null}
                    pending={pendingDocs}
                    onPendingChange={setPendingDocs}
                    readOnly={editing ? !canEdit : !canAdd}
                  />
                ) : activeProfileTab !== 'Profile' ? (
                  <div className="text-xs text-secondary py-8 text-center">{activeProfileTab} — coming soon.</div>
                ) : (
                  <div className="flex flex-col gap-3">

            {/* Business Activities (left, tall) beside Grace Period/%PGRO/%PGRR/Land Use
                (right, two stacked mini-rows) — matches the legacy BRIDGE layout where
                the two sit side by side, not stacked as separate full-width rows. */}
            <div className="flex flex-col md:flex-row gap-3 items-stretch">
              <div className="flex-[0.9] flex">
                {/* Business Activities: what the locator does here, as approved by the
                    board — often the same as the SEC Primary Purpose (Stockholders tab),
                    which can be copied in with one click and then edited. Never copied
                    automatically. */}
                <div className="flex h-full flex-1 flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-widest text-secondary">
                      Business Activities
                    </span>
                    <button
                      type="button"
                      disabled={loadingLocation || !form.sec_primary_purpose.trim()}
                      onClick={() => {
                        const current = form.business_activities.trim();
                        const primary = form.sec_primary_purpose.trim();
                        if (current === primary) return;
                        if (current) setConfirmCopyPurpose(true);
                        else copyPrimaryPurpose();
                      }}
                      title={
                        form.sec_primary_purpose.trim()
                          ? 'Copy the Primary Purpose from the SEC Registration Information card'
                          : 'No Primary Purpose yet — add it on the Stockholders tab (SEC Registration Information)'
                      }
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--selected-bg)]"
                      style={{ color: 'var(--text)' }}
                    >
                      <Copy size={11} /> Same as Primary Purpose
                    </button>
                  </div>
                  <textarea
                    className="app-form-control app-form-control-sm flex-1 min-h-[4.5rem] md:min-h-0"
                    value={form.business_activities}
                    placeholder={form.sec_primary_purpose.trim() || undefined}
                    disabled={loadingLocation}
                    onChange={(e) => setForm((p) => ({ ...p, business_activities: e.target.value }))}
                  />
                  <span className="text-[10px] text-secondary">
                    As approved by the board — often the same as the SEC Primary Purpose.
                  </span>
                </div>
              </div>

              <div className="flex-1 flex flex-col gap-2">
                <div className="grid grid-cols-2 md:flex gap-3">
                  <div className="col-span-2 md:w-[204px]">
                    <Field compact label="Grace Period">
                      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                        <input
                          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                          style={{ color: 'var(--text)' }}
                          value={form.grace_period}
                          disabled={loadingLocation}
                          onChange={(e) => setForm((p) => ({ ...p, grace_period: e.target.value }))}
                        />
                      </div>
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field compact label="Industry">
                      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                        {industryDerived ? (
                          <input
                            className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                            style={{ color: 'var(--text)' }}
                            value={editing?.business_type || '—'}
                            disabled
                            readOnly
                            title="Derived from this locator's most recently filed application — not set here."
                          />
                        ) : (
                          <AppSelect
                            options={industryOptions}
                            value={form.industry_code}
                            onChange={(value) => setForm((p) => ({ ...p, industry_code: value || '' }))}
                            placeholder="Select..."
                            isClearable
                            isDisabled={loadingLocation}
                            compact
                            boxed
                            minHeight={26}
                          />
                        )}
                      </div>
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field compact label="Location">
                      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                        <input
                          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                          style={{ color: 'var(--text)' }}
                          value={form.location}
                          disabled={loadingLocation}
                          placeholder="e.g. G Puyat, Bertaphil V..."
                          onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:flex gap-3">
                  <div className="md:w-24">
                    <Field compact label="% PGRO">
                      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                        <input
                          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                          style={{ color: 'var(--text)' }}
                          value={form.sub_pgro}
                          disabled={loadingLocation}
                          onChange={(e) => setForm((p) => ({ ...p, sub_pgro: e.target.value }))}
                        />
                      </div>
                    </Field>
                  </div>
                  <div className="md:w-24">
                    <Field compact label="% PGRR">
                      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                        <input
                          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                          style={{ color: 'var(--text)' }}
                          value={form.sub_pgrr}
                          disabled={loadingLocation}
                          onChange={(e) => setForm((p) => ({ ...p, sub_pgrr: e.target.value }))}
                        />
                      </div>
                    </Field>
                  </div>
                  <div className="col-span-2 flex-1">
                    <Field compact label="Land Use">
                      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                        <AppSelect
                          options={landUseOptions}
                          value={form.land_use_id}
                          onChange={(value) => setForm((p) => ({ ...p, land_use_id: value || '' }))}
                          placeholder="Select..."
                          isClearable
                          isDisabled={loadingLocation}
                          compact
                          boxed
                          minHeight={26}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              </div>
            </div>

            {/* Property schedule (dbo.proponent_properties) — an inline editable table in a
                card; Add property (Standard / Non-standard) and the schedule's Save are in
                the card header. */}
            <div
              className="flex flex-col gap-3 rounded-xl border p-3"
              style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
            >
              <div
                className="-mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-xl border-b px-3 py-2"
                style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                  Property Schedule
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-secondary">
                    ({leaseView ? (viewedLease?.properties || []).length : form.properties.length})
                  </span>
                </span>
                {/* Editing is for the current lease only; an earlier lease's panel is read only. */}
                <div className={cn('flex items-center gap-2', leaseView && 'hidden')}>
                  <div className="relative">
                    <button
                      type="button"
                      disabled={loadingLocation}
                      onClick={() => setPropertyTypePickerOpen((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[var(--selected-bg)]"
                      style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                      aria-haspopup="menu"
                      aria-expanded={propertyTypePickerOpen}
                    >
                      <Plus size={12} /> Add property
                    </button>
                    {propertyTypePickerOpen ? (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setPropertyTypePickerOpen(false)} />
                        <div
                          role="menu"
                          className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border p-1.5 shadow-xl"
                          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                        >
                          <div className="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-secondary">Select type</div>
                          {(
                            [
                              { type: 'STANDARD', label: 'Standard', hint: 'MGL/MO = Area × Rate/SQM/MO (computed)' },
                              { type: 'NON_STANDARD', label: 'Non-standard', hint: 'Enter every amount by hand — no computation' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.type}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setShowPropertyErrors(false);
                                setForm((p) => ({ ...p, properties: [...p.properties, blankPropertyRow(opt.type)] }));
                                setPropertyTypePickerOpen(false);
                              }}
                              className="w-full text-left rounded-lg px-2.5 py-2 cursor-pointer hover:bg-[var(--selected-bg)]"
                            >
                              <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{opt.label}</div>
                              <div className="text-[10px] text-secondary">{opt.hint}</div>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                  {/* Saves the whole schedule (every row). Also shown after removing the
                      last row, so that removal can be saved. */}
                  {(form.properties.length > 0 || sectionDirty.properties) && (
                    <SectionSaveBar
                      allowed={editing ? canEdit : canAdd}
                      label="Save Property Schedule"
                      isEditing={Boolean(editing)}
                      hasContent={form.properties.length > 0}
                      dirty={sectionDirty.properties}
                      saving={savingSection === 'properties'}
                      disabled={saving || loadingLocation}
                      onSave={() => void saveSection('properties')}
                    />
                  )}
                </div>
              </div>
              {leaseView ? (
                viewedLease ? (
                  <LeasePropertyTable properties={viewedLease.properties || []} />
                ) : (
                  <div className="text-[11px] text-secondary">Loading…</div>
                )
              ) : form.properties.length === 0 ? (
                <div
                  className="rounded-lg border border-dashed px-3 py-2.5 text-[11px] text-secondary"
                  style={{ borderColor: 'var(--input-border)' }}
                >
                  No property schedule yet — use <span className="font-semibold">Add property</span> to add a Standard or
                  Non-standard row.
                </div>
              ) : (
              <div className="min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--control-bg)' }}>
                      {['No.', 'Year', 'Date From', 'Date To', 'Rate', 'Type of Property', 'Area (SQM)', 'Rate/SQM/MO', 'Currency', 'MGL/MO', 'Currency', ''].map(
                        (h, i) => (
                          <th
                            key={`${h}-${i}`}
                            className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                            style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)' }}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {form.properties.map((row, i) => {
                      // Just added, nothing typed (Rate type / currencies are preset): "−", no prompt.
                      const blankRow = isBlankNewRow(row, [
                        'year',
                        'date_from',
                        'date_to',
                        'type_of_property',
                        'area_sqm',
                        'rate_sqm_mo',
                        'mgl_mo',
                      ]);
                      const missing = showPropertyErrors ? missingPropertyFields(row) : null;
                      // Red outline on a blank required field after a blocked save.
                      const miss = (key: keyof PropertyRow) =>
                        missing?.has(key) ? ' [&>*]:rounded-md [&>*]:ring-1 [&>*]:ring-red-500' : '';
                      return (
                      <tr key={i}>
                        <td className="px-2 py-1 border-b text-center" style={{ borderColor: 'var(--input-border)' }}>
                          {i + 1}
                        </td>
                        <td className={`px-1 py-1 border-b${miss('year')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <BoxSelect
                            className="w-[136px] min-w-[136px]"
                            options={PROPERTY_YEARS}
                            value={asOption(PROPERTY_YEARS, row.year)}
                            placeholder="Select year"
                            disabled={loadingLocation}
                            onChange={(value) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { year: value }) : r)),
                              }))
                            }
                          />
                        </td>
                        <td className={`px-1 py-1 border-b w-36${miss('date_from')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <DatePicker
                            mode="single"
                            fullWidth
                            boxed
                            placeholder="Select date"
                            value={dateInputToDate(row.date_from)}
                            onChange={(d: Date | null) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) =>
                                  ri === i ? updatePropertyRow(r, { date_from: dateToDateInputValue(d) }) : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className={`px-1 py-1 border-b w-36${miss('date_to')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <DatePicker
                            mode="single"
                            fullWidth
                            boxed
                            placeholder="Select date"
                            value={dateInputToDate(row.date_to)}
                            onChange={(d: Date | null) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) =>
                                  ri === i ? updatePropertyRow(r, { date_to: dateToDateInputValue(d) }) : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className={`px-1 py-1 border-b whitespace-nowrap${miss('rate_type')}`} style={{ borderColor: 'var(--input-border)' }}>
                          {/* Switchable: Non-standard → Standard recomputes MGL, so it asks first. */}
                          <BoxSelect
                            className="w-[156px] min-w-[156px]"
                            options={[
                              { value: 'STANDARD', label: 'Standard' },
                              { value: 'NON_STANDARD', label: 'Non-standard' },
                            ]}
                            value={row.rate_type}
                            placeholder="Select type"
                            disabled={loadingLocation}
                            title={
                              row.rate_type === 'STANDARD'
                                ? 'MGL/MO = Area × Rate/SQM/MO'
                                : row.rate_type === 'NON_STANDARD'
                                  ? 'Amounts entered by hand'
                                  : 'Choose Standard or Non-standard'
                            }
                            onChange={(value) => {
                              const next = value as PropertyRateType;
                              if (next === row.rate_type) return;
                              const computed = computeStandardMgl(row);
                              const ask =
                                next === 'STANDARD'
                                  ? Boolean(row.mgl_mo.trim()) && row.mgl_mo !== computed
                                  : row.rate_type === 'STANDARD';
                              if (ask) {
                                setRateSwitch({ index: i, to: next, current: row.mgl_mo, computed });
                                return;
                              }
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { rate_type: next }) : r)),
                              }));
                            }}
                          />
                        </td>
                        <td className={`px-1 py-1 border-b${miss('type_of_property')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <BoxSelect
                            className="w-[150px] min-w-[150px]"
                            options={PROPERTY_TYPES}
                            value={asOption(PROPERTY_TYPES, row.type_of_property)}
                            placeholder="Select type"
                            disabled={loadingLocation}
                            onChange={(value) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { type_of_property: value }) : r)),
                              }))
                            }
                          />
                        </td>
                        <td className={`px-1 py-1 border-b${miss('area_sqm')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm w-20"
                            value={row.area_sqm}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { area_sqm: e.target.value }) : r)),
                              }))
                            }
                          />
                        </td>
                        <td className={`px-1 py-1 border-b${miss('rate_sqm_mo')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm w-24"
                            value={row.rate_sqm_mo}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) =>
                                  ri === i ? updatePropertyRow(r, { rate_sqm_mo: formatAmountInput(e.target.value) }) : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className={`px-1 py-1 border-b${miss('rate_currency')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <BoxSelect
                            className="w-[86px] min-w-[86px]"
                            options={CURRENCY_OPTIONS}
                            value={row.rate_currency}
                            disabled={loadingLocation}
                            onChange={(value) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { rate_currency: value }) : r)),
                              }))
                            }
                          />
                        </td>
                        <td className={`px-1 py-1 border-b${miss('mgl_mo')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm w-24"
                            value={row.mgl_mo}
                            disabled={loadingLocation || row.rate_type === 'STANDARD'}
                            readOnly={row.rate_type === 'STANDARD'}
                            title={row.rate_type === 'STANDARD' ? 'Computed: Area × Rate/SQM/MO' : undefined}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) =>
                                  ri === i ? updatePropertyRow(r, { mgl_mo: formatAmountInput(e.target.value) }) : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className={`px-1 py-1 border-b${miss('mgl_currency')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <BoxSelect
                            className="w-[86px] min-w-[86px]"
                            options={CURRENCY_OPTIONS}
                            value={row.mgl_currency}
                            disabled={loadingLocation || row.rate_type === 'STANDARD'}
                            title={row.rate_type === 'STANDARD' ? 'Same as the rate’s currency' : undefined}
                            onChange={(value) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { mgl_currency: value }) : r)),
                              }))
                            }
                          />
                        </td>
                        <td className="px-1 py-1 border-b text-center" style={{ borderColor: 'var(--input-border)' }}>
                          <button
                            type="button"
                            disabled={loadingLocation}
                            onClick={() => {
                              const remove = () =>
                                setForm((p) => ({ ...p, properties: p.properties.filter((_, ri) => ri !== i) }));
                              if (blankRow) remove();
                              else askRowDelete(`property row ${i + 1}`, remove);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--selected-bg)]"
                            style={{ color: blankRow ? 'var(--text-muted)' : '#ef4444' }}
                            title={blankRow ? `Remove empty row ${i + 1}` : `Delete row ${i + 1}`}
                            aria-label={blankRow ? `Remove empty row ${i + 1}` : `Delete row ${i + 1}`}
                          >
                            {blankRow ? <Minus size={14} /> : <Trash2 size={14} />}
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </div>

            {/* Row 6: Advance Lease Payment | Security Deposit | Performance Security —
                one card each so the labels read as separate groups. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div
                className="flex flex-col gap-2 rounded-xl border p-3"
                style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
              >
                <div
                  className="-mx-3 -mt-3 mb-1 rounded-t-xl border-b px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-center"
                  style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
                >
                  Advance Lease Payment
                </div>
                <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                <Field compact inline label="Months MGL">
                  <div className={cn('app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch', FIN_CARD_CONTROL_H)}>
                    <input
                      className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                      style={{ color: 'var(--text)' }}
                      value={form.advance_lease_payment_months}
                      disabled={loadingLocation}
                      onChange={(e) => setForm((p) => ({ ...p, advance_lease_payment_months: e.target.value }))}
                    />
                  </div>
                </Field>
                <CapitalField
                  inline
                  label="Amount"
                  amount={form.advance_lease_payment_amount}
                  currency={form.advance_lease_payment_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, advance_lease_payment_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, advance_lease_payment_currency: v }))}
                />
                <TotalAmountField
                  months={form.advance_lease_payment_months}
                  amount={form.advance_lease_payment_amount}
                  currency={form.advance_lease_payment_currency}
                />
                </div>
              </div>

              <div
                className="flex flex-col gap-2 rounded-xl border p-3"
                style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
              >
                <div
                  className="-mx-3 -mt-3 mb-1 rounded-t-xl border-b px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-center"
                  style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
                >
                  Security Deposit
                </div>
                <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                <Field compact inline label="Months MGL">
                  <div className={cn('app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch', FIN_CARD_CONTROL_H)}>
                    <input
                      className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                      style={{ color: 'var(--text)' }}
                      value={form.security_deposit_months}
                      disabled={loadingLocation}
                      onChange={(e) => setForm((p) => ({ ...p, security_deposit_months: e.target.value }))}
                    />
                  </div>
                </Field>
                <CapitalField
                  inline
                  label="Amount"
                  amount={form.security_deposit_amount}
                  currency={form.security_deposit_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, security_deposit_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, security_deposit_currency: v }))}
                />
                <TotalAmountField
                  months={form.security_deposit_months}
                  amount={form.security_deposit_amount}
                  currency={form.security_deposit_currency}
                />
                </div>
              </div>

              <div
                className="flex flex-col gap-2 rounded-xl border p-3"
                style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)' }}
              >
                <div
                  className="-mx-3 -mt-3 mb-1 rounded-t-xl border-b px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-center"
                  style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
                >
                  Performance Security
                </div>
                <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                <Field compact inline label="Months MGL">
                  <div className={cn('app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch', FIN_CARD_CONTROL_H)}>
                    <input
                      className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                      style={{ color: 'var(--text)' }}
                      value={form.performance_security_months}
                      disabled={loadingLocation}
                      onChange={(e) => setForm((p) => ({ ...p, performance_security_months: e.target.value }))}
                    />
                  </div>
                </Field>
                <CapitalField
                  inline
                  label="Amount"
                  amount={form.performance_security_amount}
                  currency={form.performance_security_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, performance_security_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, performance_security_currency: v }))}
                />
                <TotalAmountField
                  months={form.performance_security_months}
                  amount={form.performance_security_amount}
                  currency={form.performance_security_currency}
                />
                </div>
              </div>
            </div>

            {/* Performance Commitment (was the Investment tab; dbo.proponent_investment):
                what the locator committed to vs. what it actually has — investment
                amount and number of employees. Own Save, like the other cards. */}
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
                <SectionSaveBar
                  allowed={editing ? canEdit : canAdd}
                  label="Save Performance Commitment"
                  isEditing={Boolean(editing)}
                  hasContent={[form.investment_commitment, form.investment_actual, form.employee_commitment, form.employee_actual].some((v) => v.trim() !== '')}
                  dirty={sectionDirty.investment}
                  saving={savingSection === 'investment'}
                  disabled={saving || loadingLocation}
                  onSave={() => void saveSection('investment')}
                />
              </div>
              <div className="grid grid-cols-[max-content_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                <span />
                <span className="text-[9px] font-semibold uppercase tracking-widest text-secondary">Commitment</span>
                <span className="text-[9px] font-semibold uppercase tracking-widest text-secondary">Actual</span>
                {(
                  [
                    { label: 'Investment', commitment: 'investment_commitment', actual: 'investment_actual', amount: true },
                    { label: 'No. of Employees', commitment: 'employee_commitment', actual: 'employee_actual', amount: false },
                  ] as const
                ).map((row) => (
                  <React.Fragment key={row.label}>
                    <span className="text-right text-[12px] font-semibold leading-tight" style={{ color: 'var(--text)' }}>
                      {row.label}
                    </span>
                    {([row.commitment, row.actual] as const).map((key) => (
                      <input
                        key={key}
                        className="app-form-control app-form-control-sm h-9 w-full tabular-nums"
                        inputMode={row.amount ? 'decimal' : 'numeric'}
                        placeholder={row.amount ? '0.00' : '0'}
                        value={form[key]}
                        disabled={loadingLocation}
                        onChange={(e) => {
                          const value = row.amount ? formatAmountInput(e.target.value) : e.target.value.replace(/[^\d]/g, '');
                          setForm((p) => ({ ...p, [key]: value }));
                        }}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>

                  </div>
                )}
              </fieldset>
            </div>
          </div>
          );
        })()}
      </SidePanel>

      <ConfirmModal
        open={rateSwitch !== null}
        title={rateSwitch?.to === 'NON_STANDARD' ? 'Switch to Non-standard?' : 'Switch to Standard?'}
        description={
          !rateSwitch
            ? ''
            : rateSwitch.to === 'NON_STANDARD'
              ? `MGL/MO will no longer be computed from Area × Rate. You will enter the amount value manually.${
                  rateSwitch.current ? ` The current value (${rateSwitch.current}) will be kept.` : ''
                }`
              : `MGL/MO ${rateSwitch.current} will be replaced by Area × Rate${
                  rateSwitch.computed ? ` (${rateSwitch.computed})` : ' — blank until both Area and Rate are filled in'
                }.`
        }
        confirmText={rateSwitch?.to === 'NON_STANDARD' ? 'Switch to Non-standard' : 'Switch to Standard'}
        onCancel={() => setRateSwitch(null)}
        onConfirm={() => {
          if (rateSwitch) {
            const { index, to } = rateSwitch;
            setForm((p) => ({
              ...p,
              properties: p.properties.map((r, ri) => (ri === index ? updatePropertyRow(r, { rate_type: to }) : r)),
            }));
          }
          setRateSwitch(null);
        }}
      />

      <ConfirmModal
        open={confirmCopyPurpose}
        title="Replace Business Activities?"
        description="The Business Activities text will be replaced with the SEC Primary Purpose. You can still edit it after."
        confirmText="Replace"
        onCancel={() => setConfirmCopyPurpose(false)}
        onConfirm={() => {
          copyPrimaryPurpose();
          setConfirmCopyPurpose(false);
        }}
      />

      <ConfirmModal
        open={sublesseeLinkConfirm}
        title="Link sub-lessee?"
        description={`${
          proponents.find((p) => String(p.id) === sublesseeLinkId)?.business_name ?? 'The selected locator'
        } will become a sub-lessee of ${form.business_name.trim() || 'this locator'}. Nothing in either locator is changed or deleted.`}
        confirmText="Link"
        loading={subleaseSaving}
        onCancel={() => setSublesseeLinkConfirm(false)}
        onConfirm={async () => {
          if (editing && sublesseeLinkId) await setSublessorOf(Number(sublesseeLinkId), editing.id);
          setSublesseeLinkConfirm(false);
        }}
      />

      {nestedLocator ? (
        <ProponentsManagement
          embedded={{
            ...nestedLocator,
            onClose: () => {
              setNestedLocator(null);
              void reloadSublease();
            },
          }}
        />
      ) : null}

      <ConfirmModal
        open={sublesseeUnlink !== null}
        title="Unlink sub-lessee?"
        description={`${sublesseeUnlink?.business_name ?? 'This locator'} will no longer be a sub-lessee of ${
          (sublease.sublessor?.name ?? form.business_name.trim()) || 'this locator'
        }. Its own Locator Information is kept.`}
        confirmText="Unlink"
        danger
        loading={subleaseSaving}
        onCancel={() => setSublesseeUnlink(null)}
        onConfirm={async () => {
          if (sublesseeUnlink) await setSublessorOf(sublesseeUnlink.id, null);
          setSublesseeUnlink(null);
        }}
      />

      <ConfirmModal
        open={rowDelete !== null}
        title={`Delete ${rowDelete?.what ?? 'row'}?`}
        description="It's removed from the list now and from the locator when you click Save. Cancel to keep it."
        confirmText="Delete"
        danger
        onCancel={() => setRowDelete(null)}
        onConfirm={() => {
          rowDelete?.proceed();
          setRowDelete(null);
        }}
      />

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate locator?"
        description="This locator will be marked inactive. You can re-activate later."
        confirmText="Deactivate"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateId(null)}
        onConfirm={() => {
          if (confirmDeactivateId !== null) {
            void deactivate(confirmDeactivateId);
          }
        }}
      />

      <ConfirmModal
        open={confirmReactivateId !== null}
        title="Reactivate locator?"
        description="This locator will be marked active again and can be used in transactions."
        confirmText="Reactivate"
        loading={saving}
        onCancel={() => setConfirmReactivateId(null)}
        onConfirm={() => {
          if (confirmReactivateId !== null) {
            void reactivate(confirmReactivateId);
            setConfirmReactivateId(null);
          }
        }}
      />

      {/* Same business already encoded? */}
      <ConfirmModal
        open={duplicateMatches.length > 0}
        title="This locator may already exist"
        description={`Already in the system: ${duplicateMatches
          .map((m) => `${m.ref_no || `#${m.id}`} ${m.business_name} (same ${m.match === 'tin' ? 'TIN' : m.match === 'registration_no' ? 'SEC Registration No.' : 'name'})`)
          .join('; ')}. Save anyway?`}
        confirmText="Save anyway"
        loading={saving}
        onCancel={() => {
          // Not saved: a later full Save shouldn't keep the panel open.
          keepOpenAfterCreateRef.current = false;
          setDuplicateMatches([]);
        }}
        onConfirm={() => {
          setDuplicateMatches([]);
          void save(true);
        }}
      />

      {/* Portal login for an encoded locator */}
      <ConfirmModal
        open={loginOpen}
        title="Create portal login"
        description="For this existing locator, with their real email. Nothing is sent yet: it stays pending until you click Send login now, or until their renewal is filed. They can sign in with the username or the email."
        confirmText="Create login"
        loading={loginSaving}
        confirmDisabled={!loginForm.email.trim()}
        onCancel={() => setLoginOpen(false)}
        onConfirm={() => void createLogin()}
      >
        <div className="space-y-2 pt-1">
          {(
            [
              ['email', 'Email *'],
              ['username', 'Username (optional)'],
              ['full_name', 'Contact name (optional)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-secondary mb-1">{label}</span>
              <input
                className="app-form-control app-form-control-sm w-full"
                type={key === 'email' ? 'email' : 'text'}
                autoComplete="off"
                value={loginForm[key]}
                placeholder={key === 'username' && suggestedUsername ? `${suggestedUsername} (from the Ref No)` : undefined}
                onChange={(e) => setLoginForm((p) => ({ ...p, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </ConfirmModal>

      {/* Send a pending portal login now */}
      <ConfirmModal
        open={sendLoginOpen}
        title="Send portal login?"
        description={`The username${loginInfo?.username ? ` (${loginInfo.username})` : ''} and a temporary password will be emailed to ${loginInfo?.email || 'the locator'}. They'll set their own password at first sign-in.`}
        confirmText="Send login"
        loading={sendingLogin}
        onCancel={() => setSendLoginOpen(false)}
        onConfirm={() => void sendLogin()}
      />
    </div>
  );
}

/** An earlier lease's property schedule (A-03), read only. */
function LeasePropertyTable({ properties }: { properties: any[] }) {
  if (properties.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-2.5 text-[11px] text-secondary" style={{ borderColor: 'var(--input-border)' }}>
        No property schedule on this lease.
      </div>
    );
  }
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr style={{ backgroundColor: 'var(--control-bg)' }}>
            {['No.', 'Year', 'Date From', 'Date To', 'Rate', 'Type of Property', 'Area (SQM)', 'Rate/SQM/MO', 'MGL/MO'].map((h) => (
              <th
                key={h}
                className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {properties.map((r: any, i: number) => (
            <tr key={r.id ?? i}>
              {[
                String(i + 1),
                r.year || '—',
                fmtDate(r.date_from),
                fmtDate(r.date_to),
                r.rate_type === 'STANDARD' ? 'Standard' : r.rate_type === 'NON_STANDARD' ? 'Non-standard' : '—',
                r.type_of_property || '—',
                r.area_sqm || '—',
                r.rate_sqm_mo ? `${r.rate_sqm_mo} ${r.rate_currency || ''}` : '—',
                r.mgl_mo ? `${r.mgl_mo} ${r.mgl_currency || ''}` : '—',
              ].map((v, ci) => (
                <td key={ci} className="px-2 py-1.5 border-b" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-3 py-3 flex flex-col gap-1 shadow-sm"
      style={{
        backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)',
      }}
    >
      <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{label}</span>
      <span className="text-base sm:text-lg font-bold leading-tight" style={{ color: 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

/** The Save button under a section that saves on its own — an icon-only square
 * button (matches the +/- row buttons) so it can sit in the same vertical
 * stack instead of its own full-width row. Disabled until something in that
 * section changed; the label is only used as the tooltip/title now. */
/** The locator's own Ref No; while a renewal is in process its prefix reads
 * REN instead of LOC (same number), so it's clear at a glance it's renewing. */
function displayRef(p: { ref_no: string | null; renewal_application_no?: string | null }) {
  if (!p.ref_no) return '—';
  return p.renewal_application_no ? p.ref_no.replace(/^LOC-/, 'REN-') : p.ref_no;
}

function ChangeRequestBadge() {
  return (
    <span
      className="ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold align-middle whitespace-nowrap"
      style={{ backgroundColor: 'rgba(245,158,11,0.14)', color: '#d97706' }}
      title="The locator asked to change their profile — open to review"
    >
      Change request
    </span>
  );
}

/** Read-only Total Amount on the Advance Lease Payment / Security Deposit /
 * Performance Security cards: Months MGL × Amount, live as you type. The
 * server stores the same figure (proponent_financial_terms.total_amount). */
// One height for the three controls on a financial card (Months MGL, Amount,
// Total Amount), read-only or not.
const FIN_CARD_CONTROL_H = 'h-9';

function TotalAmountField({ months, amount, currency }: { months: string; amount: string; currency: string }) {
  const m = parseAmount(months);
  const a = parseAmount(amount);
  const total =
    m === null || a === null
      ? ''
      : (Math.round(m * a * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <Field compact inline label="Total Amount">
      <div
        className={cn('app-form-control app-form-control-sm flex items-center justify-between gap-2 px-2 font-semibold tabular-nums', FIN_CARD_CONTROL_H)}
        style={{ color: total ? 'var(--text)' : 'var(--text-muted)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
        title="Months MGL × Amount"
      >
        <span>{total}</span>
        <span className="text-[11px] font-semibold text-secondary">{currency || 'PHP'}</span>
      </div>
    </Field>
  );
}

function SectionSaveBar({
  allowed = true,
  label,
  isEditing,
  dirty,
  saving,
  disabled,
  onSave,
  hasContent = true,
}: {
  /** No edit permission: no save button. */
  allowed?: boolean;
  label: string;
  isEditing: boolean;
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
  /** New Locator: whether the section has anything entered yet. */
  hasContent?: boolean;
}) {
  if (!allowed) return null;
  // Only shown when there's something to save:
  //  - existing locator: the section has unsaved changes;
  //  - New Locator (no record yet — this creates it, see saveSection): the
  //    section has something entered.
  // Kept while a save is running so the button doesn't vanish mid-click.
  const visible = saving || (isEditing ? dirty : hasContent);
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={saving || disabled}
      title={saving ? 'Saving…' : !isEditing ? `${label} (creates the locator)` : label}
      className="w-7 h-7 rounded-md flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
    >
      <Save size={14} />
    </button>
  );
}

/** Inline editable table for a locator's child rows (stockholders, contact persons):
 * numbered rows, a text input per cell, "×" to drop a row, "+" to add one. Rows keep
 * their `id` so the server can update them in place instead of recreating them. */
export function RowsEditor<T extends { id?: number }>({
  rows,
  columns,
  disabled,
  emptyText,
  blankRow,
  onChange,
  extraActions,
  hideSideActions,
  invalidKeys,
  confirmDelete,
  rowNoun = 'row',
}: {
  rows: T[];
  /** width: fixed column width (e.g. '30%'); when any column sets one the table
   * uses a fixed layout, so two editors with the same widths line up. */
  /** amount: a money figure, shown with comma separators as it's typed ("4,000,000"). */
  columns: {
    key: keyof T & string;
    label: string;
    className?: string;
    numeric?: boolean;
    amount?: boolean;
    width?: string;
    placeholder?: string;
    /** A fixed dropdown instead of a text box; a saved value that isn't in the list
     * shows as the placeholder (must be picked again). */
    options?: readonly string[];
  }[];
  disabled?: boolean;
  emptyText: string;
  blankRow: () => T;
  onChange: (next: T[]) => void;
  /** Extra buttons (e.g. a section's SectionSaveBar) stacked below +/- in the
   * same vertical column — same layout as the Profile tab's Property Schedule. */
  extraActions?: React.ReactNode;
  /** No side column: the caller renders its own Add button. */
  hideSideActions?: boolean;
  /** Keys of a row to outline in red (a blocked save). */
  invalidKeys?: (row: T) => Set<string> | null;
  /** Asks before a row is deleted; `proceed` removes it. */
  confirmDelete?: (what: string, proceed: () => void) => void;
  /** Used in the delete prompt, e.g. "contact person". */
  rowNoun?: string;
}) {
  const fixed = columns.some((c) => c.width);
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
      <div className="flex-1 min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
        <table className={cn('w-full text-xs border-collapse', fixed && 'table-fixed min-w-[40rem]')}>
          <thead>
            <tr style={{ backgroundColor: 'var(--control-bg)' }}>
              <th
                className="px-2 py-1.5 text-center font-semibold uppercase tracking-wide text-[9px] border-b w-10"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)' }}
              >
                No.
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                  style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)', width: c.width }}
                >
                  {c.label}
                </th>
              ))}
              <th className="border-b w-10" style={{ borderColor: 'var(--input-border)' }} aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-2 py-6 text-center text-secondary">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const blank = isBlankNewRow(row, columns.map((c) => c.key));
                const bad = blank ? null : invalidKeys?.(row) ?? null;
                return (
                <tr key={row.id ?? `new-${i}`}>
                  <td className="px-2 py-1 border-b text-center" style={{ borderColor: 'var(--input-border)' }}>
                    {i + 1}
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn('px-1 py-1 border-b', bad?.has(c.key) && '[&>*]:rounded-md [&>*]:ring-1 [&>*]:ring-red-500')}
                      style={{ borderColor: 'var(--input-border)' }}
                    >
                      {c.options ? (
                        // Searchable: typing filters the list (a native <select>
                        // only jumps by first letter, and not while it's open).
                        <div className={cn('app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch', c.className)}>
                          <AppSelect
                            options={c.options.map((o) => ({ value: o, label: o }))}
                            value={asOption([...c.options], String(row[c.key] ?? ''))}
                            onChange={(value) => onChange(rows.map((r, ri) => (ri === i ? { ...r, [c.key]: value } : r)))}
                            placeholder={c.placeholder || 'Select'}
                            isClearable={false}
                            isDisabled={disabled}
                            compact
                            boxed
                            minHeight={26}
                          />
                        </div>
                      ) : (
                      <input
                        className={cn('app-form-control app-form-control-sm w-full', c.className)}
                        inputMode={c.numeric ? 'decimal' : undefined}
                        placeholder={c.placeholder}
                        value={String(row[c.key] ?? '')}
                        disabled={disabled}
                        onChange={(e) => {
                          const value = c.amount
                            ? formatAmountInput(e.target.value)
                            : c.numeric
                              ? e.target.value.replace(/[^0-9.,]/g, '')
                              : e.target.value;
                          onChange(rows.map((r, ri) => (ri === i ? { ...r, [c.key]: value } : r)));
                        }}
                      />
                      )}
                    </td>
                  ))}
                  <td className="px-1 py-1 border-b text-center" style={{ borderColor: 'var(--input-border)' }}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const remove = () => onChange(rows.filter((_, ri) => ri !== i));
                        if (confirmDelete && !blank) confirmDelete(`${rowNoun} ${i + 1}`, remove);
                        else remove();
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--selected-bg)]"
                      style={{ color: blank ? 'var(--text-muted)' : '#ef4444' }}
                      title={blank ? `Remove empty row ${i + 1}` : `Delete row ${i + 1}`}
                      aria-label={blank ? `Remove empty row ${i + 1}` : `Delete row ${i + 1}`}
                    >
                      {blank ? <Minus size={14} /> : <Trash2 size={14} />}
                    </button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {hideSideActions ? null : (
      <div className="flex flex-row sm:flex-col justify-end gap-1.5 shrink-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...rows, blankRow()])}
          className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: '#22c55e' }}
          title="Add row"
        >
          +
        </button>
        {extraActions}
      </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  compact,
  inline,
  className,
}: {
  label: string;
  children: React.ReactNode;
  compact?: boolean;
  /** Label on the left of the control. Place inline fields inside a
   * `grid grid-cols-[max-content_minmax(0,1fr)]` parent: the label column
   * then fits the longest label, so the rows line up with no dead space. */
  inline?: boolean;
  className?: string;
}) {
  const labelEl = (
    <div
      className={cn(
        'shrink-0 font-semibold',
        inline
          ? // Beside the control: readable size, as written ("Months MGL"), right-aligned against it.
            'text-right text-[12px] leading-tight'
          : cn('text-secondary uppercase tracking-widest', compact ? 'text-[9px]' : 'text-[11px]'),
      )}
      style={inline ? { color: 'var(--text)' } : undefined}
    >
      {label}
    </div>
  );
  if (inline) {
    return (
      <div className={cn('contents', className)}>
        {labelEl}
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col', compact ? 'gap-0.5' : 'gap-1', className)}>
      {labelEl}
      {children}
    </div>
  );
}

/** The Locator panel's dropdown: a searchable AppSelect (type to filter) in an
 * app-form-control box, same as Account Officer / Type of Contract / Nationality.
 * A value not in `options` shows the placeholder. */
function BoxSelect({
  options,
  value,
  onChange,
  placeholder = 'Select',
  disabled,
  className,
  title,
  clearable = false,
}: {
  options: readonly (string | { value: string; label: string })[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  clearable?: boolean;
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div className={cn('app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch', className)} title={title}>
      <AppSelect
        options={opts}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        isClearable={clearable}
        isDisabled={disabled}
        compact
        boxed
        minHeight={26}
      />
    </div>
  );
}

// Vertical tab list for the SidePanel (mirrors a left-side tab-head layout),
// styled with this app's own tokens rather than any reference screenshot's colors.
export function CapitalField({
  label,
  amount,
  currency,
  disabled,
  inline,
  onAmountChange,
  onCurrencyChange,
}: {
  label: string;
  amount: string;
  currency: string;
  disabled?: boolean;
  inline?: boolean;
  onAmountChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
}) {
  return (
    <Field compact inline={inline} label={label}>
      {/* One bordered box for both — amount and currency are borderless
          inside it, split by a thin divider, instead of two separate fields. */}
      <div className={cn('app-form-control app-form-control-sm flex items-stretch p-0 overflow-hidden', inline && FIN_CARD_CONTROL_H)}>
        <input
          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
          style={{ color: 'var(--text)' }}
          value={amount}
          disabled={disabled}
          placeholder="0.00"
          onChange={(e) => onAmountChange(formatAmountInput(e.target.value))}
        />
        <div className="shrink-0 flex items-stretch" style={{ borderLeft: '1px solid var(--input-border)', width: '5.5rem' }}>
          <AppSelect
            options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
            value={currency}
            onChange={onCurrencyChange}
            isClearable={false}
            isDisabled={disabled}
            compact
            boxed
            minHeight={26}
          />
        </div>
      </div>
    </Field>
  );
}
