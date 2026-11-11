import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSignature,
  FileText,
  Landmark,
  LayoutGrid,
  Lock,
  Minus,
  Plus,
  Save,
  Search,
  Send,
  Target,
  Trash2,
  UserRound,
  Users,
  Settings,
  ClipboardList,
  Factory,
  Hammer,
  CalendarRange,
  TrendingUp,
  Pencil,
} from 'lucide-react';
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
import { PropertyTypesModal, useCanManagePropertyTypes } from '../FileMaintenance/PropertyTypesModal';
import { MglScheduleModal, buildMglSchedule, type MglSourceRow } from './MglScheduleModal';
import { InvestmentYearsModal } from './InvestmentYearsModal';
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
// 1990–2100: CSEZ leases run up to 75 years (e.g. 2010–2085), and an escalation
// fills every period up to the End Term.
const PROPERTY_YEARS = Array.from({ length: 111 }, (_, k) => String(1990 + k));
// Type of Property options come from File Maintenance (/api/proponents/property-types).
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
// ---- Escalation (4-08) ----
// "Every N months, +P%": the row is split into consecutive periods of N months
// up to the later of its own Date To and the lease's End Term (`untilYmd`) —
// typically the first year is entered and escalated to the end; each period's rate (Standard: Rate/SQM, MGL computed;
// Non-standard: MGL, and the rate when there is one) is the previous one × (1 + P%).
const ymdToUtc = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const utcToYmd = (d: Date) => d.toISOString().slice(0, 10);
function addMonthsUtc(date: Date, n: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last)));
}
function escalatePropertyRow(
  row: PropertyRow,
  everyMonths: number,
  percent: number,
  untilYmd = '',
  /** The month of the first increase (e.g. 37 = 36 months at the base rate); default: right after one interval. */
  firstIncreaseMonth = everyMonths + 1,
): PropertyRow[] {
  if (!row.date_from || !row.date_to || row.date_to < row.date_from || !(everyMonths > 0) || !(firstIncreaseMonth > 1)) return [row];
  // Month offset where period k starts: 0, then the first increase, then every N months.
  const offsetOf = (k: number) => (k === 0 ? 0 : firstIncreaseMonth - 1 + (k - 1) * everyMonths);
  const first = ymdToUtc(row.date_from);
  const last = ymdToUtc(untilYmd && untilYmd > row.date_to ? untilYmd : row.date_to);
  const factorOf = (k: number) => Math.pow(1 + percent / 100, k);
  const scaled = (value: string, k: number) => {
    const n = parseAmount(value);
    return n === null ? value : formatMoney(Math.round(n * factorOf(k) * 100) / 100);
  };
  const out: PropertyRow[] = [];
  // To the End Term (a monthly step over a 75-year lease is 900 periods); the cap only guards a runaway date.
  for (let k = 0; k < 1500; k += 1) {
    const start = addMonthsUtc(first, offsetOf(k));
    if (start > last) break;
    const nextStart = addMonthsUtc(first, offsetOf(k + 1));
    const end = new Date(Math.min(nextStart.getTime() - 86_400_000, last.getTime()));
    const base: PropertyRow = {
      ...row,
      id: k === 0 ? row.id : undefined, // the first period keeps the saved row
      year: String(start.getUTCFullYear()),
      date_from: utcToYmd(start),
      date_to: utcToYmd(end),
    };
    out.push(
      row.rate_type === 'STANDARD'
        ? updatePropertyRow(base, { rate_sqm_mo: scaled(row.rate_sqm_mo, k) })
        : { ...base, rate_sqm_mo: scaled(row.rate_sqm_mo, k), mgl_mo: scaled(row.mgl_mo, k) },
    );
  }
  return out.length ? out : [row];
}

/** Same property: same Type of Property and Area (its yearly / escalated rows). */
const samePropertyKey = (r: PropertyRow) => `${String(r.type_of_property || '').trim().toUpperCase()}|${parseAmount(r.area_sqm) ?? ''}`;
/** Indexes of the other rows of the same property that start inside the escalated
 * range — an earlier escalation's rows, replaced so nothing is counted twice. */
function overlappedRowIndexes(rows: PropertyRow[], index: number, made: PropertyRow[]): number[] {
  const row = rows[index];
  if (!row || made.length < 2) return [];
  const from = made[0].date_from;
  const to = made[made.length - 1].date_to;
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => i !== index && samePropertyKey(r) === samePropertyKey(row) && r.date_from > from && r.date_from <= to)
    .map(({ i }) => i);
}

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
  if (!String(row.type_of_property || '').trim()) missing.add('type_of_property');
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
  /** The Account Officer assigned to the locator (null = unassigned). */
  assigned_ao?: string | null;
  /** A renewal still being decided — the Ref No then shows as REN-… (same number). */
  renewal_application_no?: string | null;
  /** The latest Extension Date (Extension Date card). */
  extension_date?: string | null;
};

type DisplayRow = ProponentRow & LocatorDynamicRow;

/** The latest Extension Date when it runs past the End Term ('' otherwise). */
function extendedEnd(endTerm?: string | null, extensionDate?: string | null): string {
  const end = String(endTerm || '').slice(0, 10);
  const ext = String(extensionDate || '').slice(0, 10);
  return end && ext && ext > end ? ext : '';
}

/** The list's Lease Term: up to the Extension Date when the lease is extended
 * (same as the panel's Lease Agreements row). */
function displayLeaseTerm(p: { start_term?: string | null; end_term?: string | null; lease_term?: string | null; extension_date?: string | null }) {
  const to = extendedEnd(p.end_term, p.extension_date);
  return (to && p.start_term ? formatLeaseTerm(String(p.start_term).slice(0, 10), to) : p.lease_term) || '—';
}

// Same amber as the "Renewal in process" badge.
const EXTENDED_COLOR = '#d97706';
const EXTENDED_BADGE_STYLE: React.CSSProperties = {
  color: EXTENDED_COLOR,
  backgroundColor: 'rgba(245,158,11,.12)',
  borderColor: 'rgba(245,158,11,.35)',
};

/** "Extended" chip beside an End Term; hover shows the new end. */
function ExtendedBadge({ to, endTerm }: { to: string; endTerm?: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
      style={EXTENDED_BADGE_STYLE}
      title={`Extended to ${fmtDate(to)}${endTerm ? ` — the term ended ${fmtDate(endTerm)}` : ''}`}
    >
      Extended
    </span>
  );
}

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

/** An existing locator's panel heading: the same by Type of Contract, without
 * "New" (Lessee, Development Partner, Lessee (Supplemental), Sub Lessee). */
function locatorTitle(contractTypeName: string | null | undefined, isSublessee: boolean): string {
  const title = newLocatorTitle(contractTypeName);
  if (title === 'New Locator') return isSublessee ? 'Sub-Lessee Information' : 'Locator Information';
  return title.replace(/^New /, '');
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

// Drawer cards: white body and header with a soft shadow — instead of
// grey-on-grey.
const CARD_STYLE: React.CSSProperties = {
  borderColor: 'var(--input-border)',
  backgroundColor: 'var(--surface)',
  boxShadow: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.06)',
};
const CARD_HEAD_STYLE: React.CSSProperties = {
  borderColor: 'var(--input-border)',
  // A faint tint so each card's header reads as a strip above its body.
  backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, var(--surface))',
};
// Table header rows inside the drawer cards.
const THEAD_ROW_STYLE: React.CSSProperties = {
  backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, var(--surface))',
};

/** Drawer card heading: an icon chip, the title, and an optional count pill. */
function CardTitle({ icon: Icon, children, count }: { icon: React.ElementType; children: React.ReactNode; count?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 12%, transparent)', color: 'var(--nav-active-bg)' }}
      >
        <Icon size={13} strokeWidth={2.2} />
      </span>
      <span className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--text)' }}>
        {children}
      </span>
      {count !== undefined ? (
        <span
          className="rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums text-secondary"
          style={{ backgroundColor: 'var(--control-bg)' }}
        >
          {count}
        </span>
      ) : null}
    </span>
  );
}

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

// ---- Stockholders: Ownership % (computed, read only) ----
// Ownership % = the stockholder's Subscribed ÷ the Subscribed Capital (SEC /
// GIS) × 100; without a Subscribed Capital, ÷ the stockholders' total
// Subscribed. Recomputed on every change and when a locator is loaded.
const amountOf = (v?: string | null) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
function ownershipBase(rows: StockholderRow[], subscribedCapital: string): { base: number; fromCapital: boolean } {
  const capital = amountOf(subscribedCapital);
  if (capital > 0) return { base: capital, fromCapital: true };
  return { base: rows.reduce((sum, r) => sum + amountOf(r.subscribed), 0), fromCapital: false };
}
function ownershipOf(subscribed: string, base: number): string {
  const sub = amountOf(subscribed);
  if (!(base > 0) || !(sub > 0)) return '';
  return String(Math.round((sub / base) * 10000) / 100);
}
/** Every row's Ownership % from the current base (Subscribed Capital changed). */
export function recomputeAllOwnership(rows: StockholderRow[], subscribedCapital: string): StockholderRow[] {
  const { base } = ownershipBase(rows, subscribedCapital);
  return rows.map((r) => ({ ...r, ownership: ownershipOf(r.subscribed, base) }));
}
/** After a stockholders-table edit: Ownership % is read only, so every row is
 * recomputed from its Subscribed. */
export function withOwnership(_prev: StockholderRow[], next: StockholderRow[], subscribedCapital: string): StockholderRow[] {
  return recomputeAllOwnership(next, subscribedCapital);
}

/** Ownership % can't go past 100 — one stockholder or all together (same
 * rule as the server). The message, or null. */
export function ownershipError(rows: StockholderRow[], subscribedCapital = ''): string | null {
  const capital = amountOf(subscribedCapital);
  const totalSubscribed = rows.reduce((sum, r) => sum + amountOf(r.subscribed), 0);
  if (capital > 0 && totalSubscribed > capital + 0.005) {
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return `Total Subscribed (${fmt(totalSubscribed)}) is more than the Subscribed Capital (${fmt(capital)}) — Ownership would go over 100%.`;
  }
  const over = rows.find((r) => amountOf(r.ownership) > 100);
  if (over) return `Ownership % of ${over.name.trim() || 'a stockholder'} can't be more than 100%.`;
  const total = Math.round(rows.reduce((sum, r) => sum + amountOf(r.ownership), 0) * 100) / 100;
  // Each row is rounded to 2 decimals, so the total may be a hair over 100.
  if (total > 100 + 0.005 * rows.length) return `Total Ownership is ${total}% — it can't be more than 100%.`;
  return null;
}

/** Warns while typing (not only on Save): a toast the moment Ownership % goes
 * past 100, cleared once it's back within it. Returns the problem (or null). */
export function useOwnershipNotice(rows: StockholderRow[], subscribedCapital: string, enabled = true): string | null {
  const message = enabled ? ownershipError(rows, subscribedCapital) : null;
  const shown = useRef(false);
  useEffect(() => {
    // One toast when the problem appears (same id = never stacked), not one per keystroke.
    if (message && !shown.current) toast.warning(message, { id: 'ownership-over' });
    shown.current = Boolean(message);
  }, [message]);
  return message;
}

/** The stockholders table's red outlines: the row checks (after a blocked
 * save) plus Subscribed (what drives Ownership %) while it goes over 100. */
export function stockholderInvalidKeys(row: StockholderRow, showRowChecks: boolean, ownershipOver: boolean): Set<string> | null {
  const base = showRowChecks ? invalidRowKeys(row, STOCKHOLDER_RULES) : null;
  if (!ownershipOver) return base;
  const out = new Set<string>(base ?? []);
  out.add('subscribed');
  out.add('ownership');
  return out;
}

/** The stockholders table's Total row: Subscribed, Paid and Ownership %. */
export function stockholderTotals(rows: StockholderRow[]): Partial<Record<string, string>> {
  const sum = (key: 'subscribed' | 'paid' | 'ownership') => rows.reduce((total, r) => total + amountOf(r[key]), 0);
  const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    name: 'Total',
    subscribed: money(sum('subscribed')),
    paid: money(sum('paid')),
    ownership: `${(Math.round(sum('ownership') * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`,
  };
}

/** "Add stockholder" when the Subscribed Capital is already fully subscribed
 * (Ownership at 100%): the notice to show instead of adding a row, or null. */
export function ownershipFullNotice(rows: StockholderRow[], subscribedCapital: string): string | null {
  const capital = amountOf(subscribedCapital);
  if (!(capital > 0)) return null; // no capital: Ownership is shared out of the stockholders' own total
  const totalSubscribed = rows.reduce((sum, r) => sum + amountOf(r.subscribed), 0);
  if (totalSubscribed + 0.005 < capital) return null;
  return `Ownership is already 100% — the Subscribed Capital (${capital.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })}) is fully subscribed. Raise the Subscribed Capital or lower a stockholder's Subscribed first.`;
}

/** Under the stockholders table: totals against the Subscribed Capital. */
export function OwnershipSummary({ rows, subscribedCapital }: { rows: StockholderRow[]; subscribedCapital: string }) {
  if (!rows.length) return null;
  const totalSubscribed = rows.reduce((sum, r) => sum + amountOf(r.subscribed), 0);
  const totalOwnership = Math.round(rows.reduce((sum, r) => sum + amountOf(r.ownership), 0) * 100) / 100;
  const capital = amountOf(subscribedCapital);
  const subscribedOff = capital > 0 && Math.abs(totalSubscribed - capital) > 0.005;
  const ownershipOff = Math.abs(totalOwnership - 100) > 0.005;
  const ownershipOver = Boolean(ownershipError(rows, subscribedCapital));
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px]">
      <span style={{ color: subscribedOff ? '#d97706' : 'var(--text)' }}>
        Total Subscribed: <span className="font-semibold tabular-nums">{fmt(totalSubscribed)}</span>
        {capital > 0 ? (
          <span className="text-secondary">
            {' '}
            of Subscribed Capital <span className="tabular-nums">{fmt(capital)}</span>
            {subscribedOff ? ' — doesn’t match' : ''}
          </span>
        ) : null}
      </span>
      <span style={{ color: ownershipOver ? '#dc2626' : ownershipOff ? '#d97706' : 'var(--text)' }}>
        Total Ownership: <span className="font-semibold tabular-nums">{pct(totalOwnership)}%</span>
        {ownershipOver ? (
          <span className="font-semibold"> — can’t be more than 100% (won’t save)</span>
        ) : ownershipOff ? (
          <span className="text-secondary"> — should be 100%</span>
        ) : null}
      </span>
    </div>
  );
}

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

/** Development Timeline (Performance Commitment, 4-11): four fixed milestones,
 * each with the date it happened and remarks. */
const MILESTONES = [
  { code: 'A', label: 'Submission of Construction Plans', icon: ClipboardList },
  { code: 'B', label: 'Start of Construction', icon: Hammer },
  { code: 'C', label: 'Completion of Construction', icon: Building2 },
  { code: 'D', label: 'Start of Operation', icon: Factory },
] as const;
type MilestoneRow = { code: string; date: string; remarks: string };

/** Performance Commitment per lease year (4-10). */
type InvestmentYearRow = {
  year_no: number;
  investment_commitment: string;
  investment_actual: string;
  employee_commitment: string;
  employee_actual: string;
};
const blankInvestmentYear = (year_no: number): InvestmentYearRow => ({
  year_no,
  investment_commitment: '',
  investment_actual: '',
  employee_commitment: '',
  employee_actual: '',
});
/** Saved years; with none yet but older overall figures, they start as Year 1. */
function mapInvestmentYears(data: any): InvestmentYearRow[] {
  const rows: any[] = Array.isArray(data?.investment_years) ? data.investment_years : [];
  if (rows.length) {
    return rows.map((r) => ({
      year_no: Number(r.year_no),
      investment_commitment: formatMoney(r.investment_commitment),
      investment_actual: formatMoney(r.investment_actual),
      employee_commitment: formatIfNumeric(r.employee_commitment),
      employee_actual: formatIfNumeric(r.employee_actual),
    }));
  }
  const legacy = {
    year_no: 1,
    investment_commitment: formatMoney(data?.investment_commitment),
    investment_actual: formatMoney(data?.investment_actual),
    employee_commitment: formatIfNumeric(data?.employee_commitment),
    employee_actual: formatIfNumeric(data?.employee_actual),
  };
  return [legacy.investment_commitment, legacy.investment_actual, legacy.employee_commitment, legacy.employee_actual].some(Boolean)
    ? [legacy]
    : [];
}
const blankTimeline = (): MilestoneRow[] => MILESTONES.map((m) => ({ code: m.code, date: '', remarks: '' }));
function mapTimeline(rows: any): MilestoneRow[] {
  const byCode = new Map((Array.isArray(rows) ? rows : []).map((r: any) => [String(r.code), r]));
  return MILESTONES.map((m) => {
    const r: any = byCode.get(m.code);
    return { code: m.code, date: r?.date ? String(r.date).slice(0, 10) : '', remarks: r?.remarks || '' };
  });
}

// SEC Registration Information card: the SEC fields kept on dbo.proponents
// plus the ones in dbo.proponent_sec_registration. Saved together by the
// card's own Save (PUT /api/proponents/:id/sec-registration) and by the
// panel's main Save.
const SEC_PROPONENT_KEYS = [
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
  // DTI certificate (registered with DTI)
  'dti_territorial_scope',
  'dti_owner_name',
  'dti_valid_until',
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
    subscribed: r.subscribed != null ? formatMoney(r.subscribed) : '',
    paid: r.paid != null ? formatMoney(r.paid) : '',
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
    area_sqm: formatIfNumeric(row.area_sqm),
    rate_sqm_mo: formatMoney(row.rate_sqm_mo),
    rate_currency: row.rate_currency || 'PHP',
    mgl_mo: formatMoney(row.mgl_mo),
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

/** One lease extension (GET /api/proponents/:id/extensions). id null = typed in
 * before extensions were kept as history (only on the locator itself). */
type ExtensionRow = {
  id: number | null;
  extension_date: string | null;
  remarks: string | null;
  lease_ref_code: string | null;
  encoded_by: string | null;
  created_at: string | null;
};

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
  /** Billing basis (4-04): MONTH or YEAR. */
  rate_period?: string;
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

/** Whole-number counts (No. of Employees): digits only, with commas. */
export function formatCountInput(value: string): string {
  return formatAmountInput(value.replace(/[^\d]/g, ''));
}

/** Loaded free-text amounts: comma-format only a plain number ("1000000" ->
 * "1,000,000"); anything else (e.g. older "USD 1M") is shown as saved. */
/** Money: a plain number shown with commas and always 2 decimals
 * ("10000" -> "10,000.00"); anything else (blank, older free text) as is. */
export function formatMoney(value?: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^[\d,]*(\.\d*)?$/.test(text) || !/\d/.test(text)) return text;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : text;
}

export function formatIfNumeric(value?: unknown): string {
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
  registration_type: '',
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
  development_timeline: blankTimeline(),
  investment_years: [] as InvestmentYearRow[],
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
  dti_territorial_scope: '',
  dti_owner_name: '',
  dti_valid_until: '',
  properties: [] as PropertyRow[],
  // Billing basis of the lease's Property Schedule (4-04): the Rate/SQM and MGL
  // amounts (rate_sqm_mo / mgl_mo) are per month or per year.
  rate_period: 'MONTH' as 'MONTH' | 'YEAR',
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
  // Type of Property (File Maintenance): the dropdown's options, and its pop-up
  // maintenance opened from the Property Schedule's settings button.
  const [propertyTypes, setPropertyTypes] = useState<{ id: number; name: string; is_active: number }[]>([]);
  const [propertyTypesOpen, setPropertyTypesOpen] = useState(false);
  // MGL Schedule pop-up: the Property Schedule broken down month by month.
  const [mglScheduleRow, setMglScheduleRow] = useState<number | null>(null);
  // Escalate (4-08): which row, every how many months, by what percent.
  const [escalate, setEscalate] = useState<{ index: number; start: string; every: string; percent: string } | null>(null);
  // Performance Commitment per lease year: its breakdown opens in a pop-up.
  const [investmentYearsOpen, setInvestmentYearsOpen] = useState(false);
  const canManagePropertyTypes = useCanManagePropertyTypes();
  const loadPropertyTypes = useCallback(async () => {
    try {
      const res = await fetch(api('/api/proponents/property-types'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json?.data)) setPropertyTypes(json.data);
    } catch {
      /* keep what's there */
    }
  }, []);
  useEffect(() => {
    void loadPropertyTypes();
  }, [loadPropertyTypes]);
  /** Active types; a row's saved type that's since been deactivated still shows. */
  const propertyTypeOptions = (current: string) => {
    const names = propertyTypes.filter((t) => Number(t.is_active) === 1).map((t) => t.name);
    const cur = String(current || '').trim();
    return cur && !names.some((n) => n.toUpperCase() === cur.toUpperCase()) ? [cur, ...names] : names;
  };
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
  // '' = all; '__none__' = no Account Officer assigned; else the AO's name.
  const [aoFilter, setAoFilter] = useState('');
  // '' = all; '__none__' = no Industry; else the Industry name.
  const [industryFilter, setIndustryFilter] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [highlightedProponentId, setHighlightedProponentId] = useState<number | null>(null);
  const [highlightedProponentTick, setHighlightedProponentTick] = useState(0);
  const consumedProponentQueryRef = useRef<string>('');
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const cardRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const { data: locatorsData, isLoading, isRevalidating, refresh } = useSessionStorageCachedResource<LocatorsData>({
    cacheKey: 'ciac.locators.v13',
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
        assigned_ao: d?.assigned_ao ?? null,
        renewal_application_no: d?.renewal_application_no ?? null,
        extension_date: d?.extension_date ?? null,
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
  // The latest GIS wherever it was filed (Compliance, Documents tab or an
  // application's GIS requirement) — opened from the GIS card.
  // The DTI certificate found for the locator (Registration card, DTI).
  const [dtiDocument, setDtiDocument] = useState<{ label: string | null; original_file_name: string | null; source: string } | null>(null);
  const [gisDocument, setGisDocument] = useState<{
    source?: 'compliance' | 'locator' | 'application';
    label?: string | null;
    original_file_name: string | null;
    year?: number | null;
    status: string | null;
    validity_to: string | null;
  } | null>(null);
  // Lease Agreements card: every lease of the open locator, and which earlier
  // one's property schedule is being viewed (null = the current lease).
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [viewLeaseId, setViewLeaseId] = useState<number | null>(null);
  // Lease Agreements card: past leases are hidden until "View past leases".
  const [showPastLeases, setShowPastLeases] = useState(false);
  const pastLeaseCount = leases.filter((l) => !l.is_current).length;
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
  // Extensions card: every extension of the open locator (newest first), the
  // new one being typed in, and which one is being removed.
  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [extensionDraft, setExtensionDraft] = useState({ extension_date: '', remarks: '' });
  const [extensionSaving, setExtensionSaving] = useState(false);
  const [extensionRemove, setExtensionRemove] = useState<ExtensionRow | null>(null);
  const [showPastExtensions, setShowPastExtensions] = useState(false);
  // Registration Information card: switching to DTI with stockholders listed asks first.
  const [regTypeConfirm, setRegTypeConfirm] = useState(false);
  const loadExtensions = useCallback(async (proponentId: number) => {
    try {
      const res = await fetch(api(`/api/proponents/${proponentId}/extensions`), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      setExtensions(res.ok && Array.isArray(json?.data) ? json.data : []);
    } catch {
      setExtensions([]);
    }
  }, []);
  /** Adds the typed-in extension (POST), or removes one (DELETE); the card is
   * saved on its own, not by the panel's Update. */
  async function changeExtension(remove?: ExtensionRow) {
    if (!editing) return;
    setExtensionSaving(true);
    try {
      const res = remove
        ? await fetch(api(`/api/proponents/${editing.id}/extensions/${remove.id ?? 'legacy'}`), {
            method: 'DELETE',
            credentials: 'include',
          })
        : await fetch(api(`/api/proponents/${editing.id}/extensions`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ extension_date: extensionDraft.extension_date, remarks: extensionDraft.remarks.trim() }),
          });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Could not save the extension');
      setExtensions(Array.isArray(json?.data) ? json.data : []);
      if (!remove) setExtensionDraft({ extension_date: '', remarks: '' });
      toast.success(remove ? 'Extension removed' : 'Extension added');
      // The list's "Extended" badge reads the latest Extension Date.
      void refresh({ showLoading: false }).catch(() => {});
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the extension');
    } finally {
      setExtensionSaving(false);
    }
  }
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
      rate_period,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      development_timeline,
      investment_years,
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
        properties: JSON.stringify([properties, rate_period]),
        investment: JSON.stringify([
          investment_commitment,
          investment_actual,
          employee_commitment,
          employee_actual,
          development_timeline,
          investment_years,
        ]),
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

  // Filter options built from the list itself, with counts.
  const countOptions = (values: (string | null | undefined)[], noneLabel: string) => {
    const counts = new Map<string, number>();
    let none = 0;
    for (const v of values) {
      const k = (v || '').trim();
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
      else none += 1;
    }
    const opts = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, n]) => ({ value: k, label: k, detail: String(n) }));
    return none ? [{ value: '__none__', label: noneLabel, detail: String(none) }, ...opts] : opts;
  };
  const aoOptions = useMemo(() => countOptions(rows.map((p) => p.assigned_ao), 'Unassigned'), [rows]);
  const industryFilterOptions = useMemo(() => countOptions(rows.map((p) => p.business_type), 'No industry'), [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (v: string | null | undefined, f: string) =>
      !f || (f === '__none__' ? !(v || '').trim() : (v || '').trim() === f);
    const byTerm = rows.filter(
      (p) =>
        (termFilter === 'all' || leaseStatus(p.end_term) === termFilter) &&
        matches(p.assigned_ao, aoFilter) &&
        matches(p.business_type, industryFilter)
    );
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
        (p.assigned_ao || '').toLowerCase().includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [rows, searchQuery, termFilter, aoFilter, industryFilter]);

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
  }, [searchQuery, pageSize, termFilter, aoFilter, industryFilter]);

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
    setDtiDocument(null);
    setExtensions([]);
    setExtensionDraft({ extension_date: '', remarks: '' });
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
    setShowPastLeases(false);
    setInvestmentYearsOpen(false);
    setExtensions([]);
    setExtensionDraft({ extension_date: '', remarks: '' });
    setShowPastExtensions(false);
    setSublease(NO_SUBLEASE);
    setLoaded(null);
    setEditing(p);
    setLoginInfo(null);
    setGisDocument(null);
    setDtiDocument(null);
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
        setDtiDocument(data.dti_document ?? null);
        const profileFields = {
          location: data.location || '',
          ref_code: data.ref_code || '',
          lease_address: data.lease_address || '',
          account_officer_id: data.account_officer_id != null ? String(data.account_officer_id) : '',
          sec_registration_date: toDateInputValue(data.sec_registration_date),
          registration_type: data.registration_type || '',
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
          authorized_capital: formatMoney(data.authorized_capital),
          authorized_capital_currency: data.authorized_capital_currency || 'PHP',
          subscribed_capital: formatMoney(data.subscribed_capital),
          subscribed_capital_currency: data.authorized_capital_currency || data.subscribed_capital_currency || 'PHP',
          paid_up_capital: formatMoney(data.paid_up_capital),
          paid_up_capital_currency: data.authorized_capital_currency || data.paid_up_capital_currency || 'PHP',
          contract_type_id: data.contract_type_id != null ? String(data.contract_type_id) : '',
          industry_code: data.industry_code || '',
          business_activities: data.business_activities || '',
          nationality: data.nationality || '',
          advance_lease_payment_months: data.advance_lease_payment_months || '',
          advance_lease_payment_amount: formatMoney(data.advance_lease_payment_amount),
          advance_lease_payment_currency: data.advance_lease_payment_currency || 'PHP',
          security_deposit_months: data.security_deposit_months || '',
          security_deposit_amount: formatMoney(data.security_deposit_amount),
          security_deposit_currency: data.security_deposit_currency || 'PHP',
          performance_security_months: data.performance_security_months || '',
          performance_security_amount: formatMoney(data.performance_security_amount),
          performance_security_currency: data.performance_security_currency || 'PHP',
          investment_commitment: formatMoney(data.investment_commitment),
          investment_actual: formatMoney(data.investment_actual),
          development_timeline: mapTimeline(data.development_timeline),
          investment_years: mapInvestmentYears(data),
          employee_commitment: formatIfNumeric(data.employee_commitment),
          employee_actual: formatIfNumeric(data.employee_actual),
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
          dti_territorial_scope: data.dti_territorial_scope || '',
          dti_owner_name: data.dti_owner_name || '',
          dti_valid_until: toDateInputValue(data.dti_valid_until),
          properties: mapPropertyRows(data.properties),
          rate_period: (data.rate_period === 'YEAR' ? 'YEAR' : 'MONTH') as 'MONTH' | 'YEAR',
          land_use_id: data.land_use_id != null ? String(data.land_use_id) : '',
          stockholders: recomputeAllOwnership(mapStockholderRows(data.stockholders), formatMoney(data.subscribed_capital)),
          contact_persons: mapContactRows(data.contact_persons),
          signatories: mapContactRows(data.signatories),
        };
        setForm((prev) => ({ ...prev, ...profileFields }));
        setSublease(subleaseFrom(data));
        setViewLeaseId(null);
        void loadLeases(p.id);
        void loadExtensions(p.id);
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
    if (which.stockholders) {
      problems.push([
        'stockholders',
        rowsError('Stockholders', form.stockholders, STOCKHOLDER_RULES) ?? ownershipError(form.stockholders, form.subscribed_capital),
      ]);
    }
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
                  development_timeline: form.development_timeline.map((m) => ({
                    code: m.code,
                    date: m.date || null,
                    remarks: m.remarks.trim() || null,
                  })),
                  // Per lease year (4-10); the overall figures follow from them on the server.
                  investment_years: investmentYearsShown.map((y) => ({
                    year_no: y.year_no,
                    investment_commitment: y.investment_commitment.trim() || null,
                    investment_actual: y.investment_actual.trim() || null,
                    employee_commitment: y.employee_commitment.trim() || null,
                    employee_actual: y.employee_actual.trim() || null,
                  })),
                }
              : { properties: form.properties.map(toPropertyPayload), rate_period: form.rate_period };

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
          ? { stockholders: recomputeAllOwnership(mapStockholderRows(data.stockholders), form.subscribed_capital) }
          : section === 'contacts'
            ? { contact_persons: mapContactRows(data.contact_persons), signatories: mapContactRows(data.signatories) }
            : section === 'sec'
              ? Object.fromEntries(
                  [...SEC_PROPONENT_KEYS, ...SEC_DETAIL_KEYS].map((key) => [
                    key,
                    key === 'sec_registration_date' || key === 'sec_gis_date' || key === 'dti_valid_until'
                      ? toDateInputValue(data[key])
                      : key.endsWith('_currency')
                        ? (key === 'subscribed_capital_currency' || key === 'paid_up_capital_currency'
                            ? data.authorized_capital_currency
                            : null) ||
                          data[key] ||
                          'PHP'
                        : key.endsWith('_capital')
                          ? formatMoney(data[key])
                          : data[key] || '',
                  ]),
                )
            : section === 'investment'
              ? {
                  investment_commitment: formatMoney(data.investment_commitment),
                  investment_actual: formatMoney(data.investment_actual),
                  employee_commitment: formatIfNumeric(data.employee_commitment),
                  employee_actual: formatIfNumeric(data.employee_actual),
                  development_timeline: mapTimeline(data.development_timeline),
                  investment_years: mapInvestmentYears(data),
                }
              : {
                  properties: mapPropertyRows(data.properties),
                  rate_period: (data.rate_period === 'YEAR' ? 'YEAR' : 'MONTH') as 'MONTH' | 'YEAR',
                };
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
        // DTI: the (hidden) stockholders list isn't checked.
        stockholders: regType !== 'DTI' && (sectionDirty.stockholders || (!editing && form.stockholders.length > 0)),
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
        // Extension Date / Remarks: saved by the Extensions card, not here.
        authorized_capital: form.authorized_capital.trim() || null,
        authorized_capital_currency: form.authorized_capital_currency || null,
        subscribed_capital: form.subscribed_capital.trim() || null,
        subscribed_capital_currency: form.subscribed_capital_currency || null,
        paid_up_capital: form.paid_up_capital.trim() || null,
        paid_up_capital_currency: form.paid_up_capital_currency || null,
        business_activities: form.business_activities.trim() || null,
        nationality: form.nationality.trim() || null,
        advance_lease_payment_months: form.advance_lease_payment_months.trim() || null,
        advance_lease_payment_amount: finAmount(form.advance_lease_payment_amount).trim() || null,
        advance_lease_payment_currency: finCurrency(form.advance_lease_payment_currency) || null,
        security_deposit_months: form.security_deposit_months.trim() || null,
        security_deposit_amount: finAmount(form.security_deposit_amount).trim() || null,
        security_deposit_currency: finCurrency(form.security_deposit_currency) || null,
        performance_security_months: form.performance_security_months.trim() || null,
        performance_security_amount: finAmount(form.performance_security_amount).trim() || null,
        performance_security_currency: finCurrency(form.performance_security_currency) || null,
        // Overall Performance Commitment = what the lease years add up to (4-10),
        // and the years themselves.
        ...investmentOverall,
        investment_years: investmentYearsShown.map((y) => ({
          year_no: y.year_no,
          investment_commitment: y.investment_commitment.trim() || null,
          investment_actual: y.investment_actual.trim() || null,
          employee_commitment: y.employee_commitment.trim() || null,
          employee_actual: y.employee_actual.trim() || null,
        })),
        ...secRegistrationPayload(form),
        stockholders: form.stockholders.map(toStockholderPayload),
        contact_persons: form.contact_persons.map(toContactPayload),
        signatories: form.signatories.map(toContactPayload),
        properties: form.properties.map(toPropertyPayload),
        rate_period: form.rate_period,
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
  // Escalate saves the Property Schedule itself once the new rows are in the form.
  const [autoSaveProperties, setAutoSaveProperties] = useState(false);
  useEffect(() => {
    if (!autoSaveProperties) return;
    setAutoSaveProperties(false);
    void saveSection('properties');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveProperties]);
  // Escalation runs to the lease's End Term (when it's later than the row's Date To).
  const leaseEndYmd = String((termEditable ? form.end_term : editing?.end_term) || '').slice(0, 10);
  // Escalate dialog: the rows it would make (2+ = something to escalate).
  const escalatePreview: PropertyRow[] = (() => {
    if (!escalate) return [];
    const row = form.properties[escalate.index];
    const every = Math.floor(Number(escalate.every));
    const start = Math.floor(Number(escalate.start));
    if (!row || !(every > 0) || !(start > 1)) return [];
    const pct = Number(escalate.percent);
    return escalatePropertyRow(row, every, Number.isFinite(pct) ? pct : 0, leaseEndYmd, start);
  })();
  // Rows an earlier escalation made that this one replaces.
  const escalateReplaces = escalate ? overlappedRowIndexes(form.properties, escalate.index, escalatePreview) : [];
  // Performance Commitment per lease year (4-10): one row per year of the lease
  // term (Start–End), plus any saved beyond it or added by hand.
  const leaseYearCount = (() => {
    const start = String((termEditable ? form.start_term : editing?.start_term) || '').slice(0, 10);
    const end = String((termEditable ? form.end_term : editing?.end_term) || '').slice(0, 10);
    if (!start || !end || end < start) return 0;
    const a = ymdToUtc(start);
    const b = ymdToUtc(end);
    const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() >= a.getUTCDate() ? 1 : 0);
    return Math.max(1, Math.ceil(months / 12));
  })();
  const leaseStartYmd = String((termEditable ? form.start_term : editing?.start_term) || '').slice(0, 10);
  const investmentYearsShown: InvestmentYearRow[] = (() => {
    const count = Math.max(leaseYearCount, ...form.investment_years.map((y) => y.year_no), 0);
    return Array.from({ length: count }, (_, k) => form.investment_years.find((y) => y.year_no === k + 1) ?? blankInvestmentYear(k + 1));
  })();
  // The current lease year (or Year 1 before the lease starts), highlighted.
  const currentLeaseYear = (() => {
    if (!leaseStartYmd) return 1;
    const a = ymdToUtc(leaseStartYmd);
    const now = new Date();
    const months = (now.getUTCFullYear() - a.getUTCFullYear()) * 12 + (now.getUTCMonth() - a.getUTCMonth()) - (now.getUTCDate() < a.getUTCDate() ? 1 : 0);
    return Math.min(Math.max(1, Math.floor(months / 12) + 1), Math.max(1, investmentYearsShown.length));
  })();
  const yearsWithFigures = investmentYearsShown.filter((y) =>
    [y.investment_commitment, y.investment_actual, y.employee_commitment, y.employee_actual].some((v) => v.trim()),
  ).length;

  /** The overall figures from the years: investment summed, employees the highest year. */
  const investmentOverall = (() => {
    const pick = (key: keyof Omit<InvestmentYearRow, 'year_no'>, how: 'sum' | 'max') => {
      const values = investmentYearsShown.map((y) => parseAmount(y[key])).filter((n): n is number => n !== null);
      if (!values.length) return null;
      return String(how === 'sum' ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : Math.max(...values));
    };
    return {
      investment_commitment: pick('investment_commitment', 'sum'),
      investment_actual: pick('investment_actual', 'sum'),
      employee_commitment: pick('employee_commitment', 'max'),
      employee_actual: pick('employee_actual', 'max'),
    };
  })();
  const setInvestmentYear = (year_no: number, patch: Partial<InvestmentYearRow>) =>
    setForm((p) => {
      const has = p.investment_years.some((y) => y.year_no === year_no);
      const list = has
        ? p.investment_years.map((y) => (y.year_no === year_no ? { ...y, ...patch } : y))
        : [...p.investment_years, { ...blankInvestmentYear(year_no), ...patch }];
      return { ...p, investment_years: list.sort((x, y) => x.year_no - y.year_no) };
    });
  // Advance Lease Payment / Security Deposit / Performance Security are in
  // months of MGL, so their currency follows the Property Schedule's MGL
  // currency (the first row's; Standard = the rate's) — locked like MGL/MO.
  const scheduleRow = form.properties[0];
  const scheduleCurrency = scheduleRow
    ? (scheduleRow.rate_type === 'STANDARD' ? scheduleRow.rate_currency : scheduleRow.mgl_currency) || ''
    : '';
  const finCurrency = (own: string) => scheduleCurrency || own;
  // Their Amount is the monthly MGL from the Property Schedule: the MGL/MO of
  // the schedule's first period (the rows with the earliest Date From — all
  // properties leased then), so only the Months are typed. Total = Months × Amount.
  const mglBasis = (() => {
    const rows = form.properties.filter((r) => {
      const mgl = r.rate_type === 'STANDARD' ? computeStandardMgl(r) : r.mgl_mo;
      return parseAmount(mgl) !== null;
    });
    if (!rows.length) return '';
    const starts = rows.map((r) => r.date_from).filter(Boolean).sort();
    const first = starts[0];
    const firstPeriod = first ? rows.filter((r) => r.date_from === first) : [rows[0]];
    const total = firstPeriod.reduce(
      (sum, r) => sum + (parseAmount(r.rate_type === 'STANDARD' ? computeStandardMgl(r) : r.mgl_mo) ?? 0),
      0,
    );
    // A yearly lease (4-04): the monthly equivalent, MGL/YR ÷ 12.
    const monthly = form.rate_period === 'YEAR' ? total / 12 : total;
    return (Math.round(monthly * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  })();
  const finAmount = (own: string) => mglBasis || own;
  const finAmountTitle = mglBasis
    ? form.rate_period === 'YEAR'
      ? 'MGL/YR ÷ 12 from the Property Schedule (first period) — set automatically'
      : 'MGL/MO from the Property Schedule (first period) — set automatically'
    : 'Add the Property Schedule first — the Amount is its MGL/MO';
  const finCurrencyTitle = 'Same as the Property Schedule’s MGL currency';
  const regType = registrationTypeOf(form.registration_type);
  const regLabels = registrationLabels(regType);
  // Ownership % over 100: a notice while typing, and the fields outlined.
  const ownershipProblem = useOwnershipNotice(
    form.stockholders,
    form.subscribed_capital,
    activeProfileTab === 'Stockholders' && regType !== 'DTI',
  );
  // The current lease runs past its End Term when the latest Extension Date is
  // later: Lease Agreements shows the new end and the extended term.
  const currentStart = String((termEditable ? form.start_term : editing?.start_term) || '').slice(0, 10);
  const currentEnd = String((termEditable ? form.end_term : editing?.end_term) || '').slice(0, 10);
  const latestExtension = extensions[0]?.extension_date ? String(extensions[0].extension_date).slice(0, 10) : '';
  const extendedTo = latestExtension && currentEnd && latestExtension > currentEnd ? latestExtension : '';
  // Lease Term of the current lease (to the Extension Date when extended).
  const currentLeaseTerm =
    (extendedTo && currentStart
      ? formatLeaseTerm(currentStart, extendedTo)
      : termEditable
      ? formatLeaseTerm(form.start_term, form.end_term)
      : editing?.lease_term) || '';
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
          <div className="w-40 shrink-0 sm:w-48">
            <AppSelect
              compact
              isClearable
              placeholder="All industries"
              value={industryFilter}
              onChange={(value) => setIndustryFilter(String(value || ''))}
              options={industryFilterOptions}
            />
          </div>
          <div className="w-40 shrink-0 sm:w-52">
            <AppSelect
              compact
              isClearable
              placeholder="All Account Officers"
              value={aoFilter}
              onChange={(value) => setAoFilter(String(value || ''))}
              options={aoOptions}
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
                  <span className="shrink-0 text-[10px] font-semibold tabular-nums" title={displayRef(p)}>
                    <RefCodeCell code={p.ref_code} />
                  </span>
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
                    {extendedEnd(p.end_term, p.extension_date) ? (
                      <ExtendedBadge to={extendedEnd(p.end_term, p.extension_date)} endTerm={p.end_term} />
                    ) : null}
                  </div>
                  <div className="min-w-0 text-right">
                    <div className="text-[9px] uppercase tracking-wider text-secondary">Lease term</div>
                    <div className="truncate" style={{ color: 'var(--text)' }}>{displayLeaseTerm(p)}</div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-secondary">AO: {p.assigned_ao || <span className="italic">Unassigned</span>}</div>
              </button>
            ))}
          </div>

          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Ref Code', 'Tenant', 'Address', 'Industry', 'Start Term', 'End Term', 'Lease Term', 'Assigned AO'].map((col) => (
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
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap" style={{ color: 'var(--text)' }} title={displayRef(p)}>
                      <RefCodeCell code={p.ref_code} />
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
                    <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {fmtDate(p.end_term)}
                        {extendedEnd(p.end_term, p.extension_date) ? (
                          <ExtendedBadge to={extendedEnd(p.end_term, p.extension_date)} endTerm={p.end_term} />
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{displayLeaseTerm(p)}</td>
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap">
                      {p.assigned_ao
                        ? <span style={{ color: 'var(--text)' }}>{p.assigned_ao}</span>
                        : <span className="italic text-secondary">Unassigned</span>}
                    </td>
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
        // Upper case, like the File Maintenance names it follows.
        title={(
          leaseView
            ? leaseLabel
              ? `Lease Agreement — ${leaseLabel}`
              : 'Lease Agreement'
            : editing
            ? // Follows the Type of Contract, like a New Locator's heading.
              locatorTitle(
                contractTypeOptions
                  .find((o) => o.value === String(form.contract_type_id ?? ''))
                  ?.label.replace(/ \(inactive\)$/, '') ??
                  // Still loading the details: the list row's type, so the
                  // heading doesn't flash "Locator Information" first.
                  editing.contract_type_name,
                Boolean(sublease.sublessor || editing.sublessor_id),
              )
            : sublease.sublessor
            ? 'Sub Lessee'
            : // Same lookup the Type of Contract select uses to show its value.
              newLocatorTitle(
                contractTypeOptions
                  .find((o) => o.value === String(form.contract_type_id ?? ''))
                  ?.label.replace(/ \(inactive\)$/, ''),
              )
        ).toUpperCase()}
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
        {/* Summary hero: who the locator is and where its current lease stands, at a glance. */}
        {editing && !leaseView ? (() => {
          const name = form.business_name.trim() || editing.business_name || '—';
          const initials =
            name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase() || '?';
          const contractLabel =
            contractTypeOptions
              .find((o) => o.value === String(form.contract_type_id ?? ''))
              ?.label.replace(/ \(inactive\)$/, '') || '';
          const officer = officerName(form.account_officer_id || '');
          const tiles: { icon: React.ElementType; label: string; value: React.ReactNode; hint?: React.ReactNode }[] = [
            { icon: CalendarClock, label: 'Lease Term', value: currentLeaseTerm || '—' },
            {
              icon: FileSignature,
              label: 'Start → End',
              value: currentStart || currentEnd ? `${fmtDate(currentStart)} → ${fmtDate(currentEnd)}` : '—',
              hint: extendedTo ? (
                <span style={{ color: EXTENDED_COLOR }}>Extended to {fmtDate(extendedTo)}</span>
              ) : undefined,
            },
            { icon: UserRound, label: 'Account Officer', value: officer || '—' },
            {
              icon: Users,
              label: 'Sub-Lessees · Extensions',
              value: `${sublease.sublessees.length} · ${extensions.length}`,
            },
          ];
          return (
            <div
              className="mb-4 overflow-hidden rounded-2xl border"
              style={{
                borderColor: 'var(--input-border)',
                background:
                  'linear-gradient(135deg, color-mix(in oklab, var(--nav-active-bg) 10%, var(--surface)) 0%, var(--surface) 70%)',
              }}
            >
              <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-base font-bold" style={{ color: 'var(--text)' }}>
                    {name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-secondary">
                    {editing.ref_no ? (
                      <span>
                        System ID: <span className="tabular-nums font-medium">{editing.ref_no}</span>
                      </span>
                    ) : null}
                    {contractLabel ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{contractLabel}</span>
                      </>
                    ) : null}
                    {form.nationality ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{form.nationality}</span>
                      </>
                    ) : null}
                    {sublease.sublessor ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>Sub-lessee of {sublease.sublessor.name}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                {/* The current lease's Ref. Code, on the right — typed in here and saved
                    with Update. Never reused: checked as it's typed (another locator or an
                    earlier lease) and again by the server on save. */}
                <div className="ml-auto flex shrink-0 flex-col items-end gap-1" style={{ maxWidth: '45%' }}>
                  <label
                    className="group flex max-w-full cursor-text items-center gap-2 rounded-full border py-1.5 pl-3.5 pr-4 transition-colors focus-within:border-[var(--nav-active-bg)] hover:border-[var(--input-border)]"
                    style={{
                      backgroundColor: refCodeTaken
                        ? 'color-mix(in oklab, #ef4444 8%, transparent)'
                        : 'color-mix(in oklab, var(--nav-active-bg) 6%, transparent)',
                      borderColor: refCodeTaken ? '#ef4444' : 'transparent',
                    }}
                    title="Ref. Code (current lease) — click to edit"
                  >
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-secondary">Ref</span>
                    <span className="h-4 w-px shrink-0" style={{ backgroundColor: 'var(--input-border)' }} aria-hidden />
                    <input
                      className="min-w-0 max-w-full bg-transparent text-right text-[17px] font-bold tracking-wide tabular-nums outline-none placeholder:text-[13px] placeholder:font-semibold placeholder:tracking-normal disabled:cursor-default"
                      // Grows with the code so a long one shows whole (e.g. CS2021090024570-…).
                      style={{ color: 'var(--text)', width: `calc(${Math.max(form.ref_code.length, 10) + 1}ch + ${Math.max(form.ref_code.length, 10) * 0.05}em)` }}
                      value={form.ref_code}
                      placeholder="Add Ref. Code"
                      aria-label="Ref. Code (current lease)"
                      disabled={formLocked || leaseView || loadingLocation}
                      onChange={(e) => setForm((p) => ({ ...p, ref_code: e.target.value }))}
                    />
                    {!(formLocked || leaseView || loadingLocation) ? (
                      <Pencil size={12} className="shrink-0 text-secondary opacity-0 transition-opacity group-hover:opacity-70 group-focus-within:opacity-0" aria-hidden />
                    ) : null}
                  </label>
                  {refCodeTaken ? <span className="text-[10px] leading-tight text-red-500">{refCodeTaken}</span> : null}
                </div>
              </div>
              <div
                className="grid grid-cols-2 lg:grid-cols-4 border-t"
                style={{ borderColor: 'var(--input-border)' }}
              >
                {tiles.map((t, i) => (
                  <div
                    key={t.label}
                    className={cn(
                      'flex min-w-0 items-start gap-2.5 px-4 py-3',
                      i % 2 === 1 && 'border-l',
                      i >= 2 && 'border-t lg:border-t-0',
                      i === 2 && 'lg:border-l',
                    )}
                    style={{ borderColor: 'var(--input-border)' }}
                  >
                    <t.icon size={15} className="mt-0.5 shrink-0 text-secondary" />
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-secondary">{t.label}</div>
                      <div className="truncate text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
                        {t.value}
                      </div>
                      {t.hint ? <div className="text-[10px] font-semibold">{t.hint}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
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
            {/* The locator's own details, in a card like the ones below (same
                header strip); the fields keep their places. */}
            <div
              className="flex flex-col gap-3 rounded-2xl border p-3"
              style={CARD_STYLE}
            >
              <div
                className="-mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                style={CARD_HEAD_STYLE}
              >
                <CardTitle icon={Building2}>Locator Details</CardTitle>
              </div>
              {/* Row 1 and Row 2 share this exact column template (same track sizes, same gap,
                  same column count) so their edges line up vertically — Row 2 nests
                  Principal/Lease Address and TIN/SEC/Ref inside their own cells rather than
                  adding extra top-level columns, which would throw off the gap math. */}
              <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1.6fr] gap-3">
                {/* Name and nationality share the first column, so Row 1's
                    two columns still line up with Row 2's. */}
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
                      // Same box as Locator's Name (one height), read-only with a lock.
                      <div
                        className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch"
                        style={{ backgroundColor: 'var(--control-bg)' }}
                        title="Your locators are assigned to you — the Manager can reassign them"
                      >
                        <input
                          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1 cursor-default"
                          style={{ color: 'var(--text-muted)' }}
                          readOnly
                          tabIndex={-1}
                          value={officerName(form.account_officer_id || (myUserId != null ? String(myUserId) : ''))}
                        />
                        <span className="flex items-center pr-2.5 text-secondary">
                          <Lock size={12} />
                        </span>
                      </div>
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
              </div>

              {/* Row 2: same grid-cols-[1.8fr_1.6fr] track sizes as Row 1 (see note above),
                  so Row 1/Row 2 edges stay pixel-aligned. Principal Address, TIN and SEC Registration
                  are on the Stockholders tab's SEC Registration Information card; the Ref. Code is
                  on the Lease Agreements card (one per lease). */}
              <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1.6fr] gap-3 items-stretch">
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

              </div>
            </div>

            {/* Lease Agreements (A-02/A-03/A-04): one row per lease — the current
                one editable (Ref. Code, Date Signed, and Start/End while there's no
                approved contract), earlier ones as history. The Ref. Code dictates
                the dates, so they sit on one row with the SEC Registration No.
                (the company's, fixed). Every renewal is a new lease with a new
                Ref. Code; Ref. Codes are never reused. */}
            <div
              className="flex flex-col gap-2 rounded-2xl border p-3"
              style={CARD_STYLE}
            >
              <div
                className="-mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                style={CARD_HEAD_STYLE}
              >
                <CardTitle icon={FileSignature} count={leaseView ? undefined : Math.max(leases.length, 1)}>
                  {leaseView ? 'Lease Agreement' : 'Lease Agreements'}
                </CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-secondary">
                    {leaseView ? 'An earlier lease — read only' : 'A renewal starts a new lease with its own Ref. Code'}
                  </span>
                  {/* Past leases are folded away by default; this shows / hides them. */}
                  {!leaseView && pastLeaseCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowPastLeases((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer hover:bg-[var(--selected-bg)]"
                      style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                      aria-expanded={showPastLeases}
                    >
                      {showPastLeases ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {showPastLeases ? 'Hide past leases' : `View past leases (${pastLeaseCount})`}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                <table className="w-full min-w-[60rem] table-fixed text-xs border-collapse">
                  <thead>
                    <tr style={THEAD_ROW_STYLE}>
                      {[
                        ['SEC/DTI Reg. No.', '15%'],
                        ['Type', '17%'],
                        ['Date Signed', '15%'],
                        ['Start Term', '15%'],
                        ['End Term', '15%'],
                        ['Lease Term', '11%'],
                        ['Status', '12%'],
                      ].map(([h, w]) => (
                        <th
                          key={h}
                          className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                          style={{ borderColor: 'var(--input-border)', color: 'var(--text)', width: w }}
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
                          {key === 'end_term' && extendedTo ? (
                            <div
                              className="mt-1 flex flex-wrap items-center gap-1 px-1 text-[10px] font-semibold"
                              style={{ color: EXTENDED_COLOR }}
                            >
                              → {fmtDate(extendedTo)}
                              <ExtendedBadge to={extendedTo} endTerm={currentEnd} />
                            </div>
                          ) : null}
                        </td>
                      ))}
                      <td className="px-1 py-1 border-b align-top" style={{ borderColor: 'var(--input-border)' }}>
                        <div
                          className="flex h-9 items-center rounded-md px-2 font-semibold tabular-nums"
                          style={{ backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: 'var(--text)' }}
                        >
                          {currentLeaseTerm || '—'}
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
                    {(leaseView ? (viewedLease ? [viewedLease] : []) : showPastLeases ? leases.filter((l) => !l.is_current) : [])
                      .map((l) => {
                        return (
                          <tr
                            key={l.id}
                            className={leaseView || !editing ? undefined : 'cursor-pointer hover:bg-[var(--selected-bg)]'}
                            onClick={leaseView || !editing ? undefined : () => setNestedLocator({ locatorId: editing.id, leaseId: l.id })}
                            title={leaseView ? undefined : 'Open this lease'}
                          >
                            <td className="px-2 py-2 border-b text-secondary" style={{ borderColor: 'var(--input-border)' }}>
                              {form.registration_no || '—'}
                            </td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>
                              {l.contract_type_name || '—'}
                              <div className="text-[10px] text-secondary">{l.application_no || l.contract_no || 'Encoded lease'}</div>
                            </td>
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

            {/* Extensions: every extension of the lease term, kept as history (newest
                first) — same card as Lease Agreements. Added / removed on their own
                (not by Update); the latest is the locator's Extension Date in reports. */}
            {leaseView ? null : (
            <div
              className="flex flex-col gap-2 rounded-2xl border p-3"
              style={CARD_STYLE}
            >
              <div
                className="-mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                style={CARD_HEAD_STYLE}
              >
                <CardTitle icon={CalendarPlus} count={extensions.length}>Extension Date</CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-secondary">Each extension is kept as history</span>
                  {extensions.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setShowPastExtensions((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer hover:bg-[var(--selected-bg)]"
                      style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                      aria-expanded={showPastExtensions}
                    >
                      {showPastExtensions ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {showPastExtensions ? 'Hide past extensions' : `View past extensions (${extensions.length - 1})`}
                    </button>
                  ) : null}
                </div>
              </div>
              {!editing ? (
                <div className="text-xs text-secondary">Add extensions after saving this locator.</div>
              ) : (
                <div className="min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                  <table className="w-full min-w-[52rem] table-fixed text-xs border-collapse">
                    <thead>
                      <tr style={THEAD_ROW_STYLE}>
                        {[
                          ['Extension Date', '16%'],
                          ['Remarks', '34%'],
                          ['Lease Ref. Code', '13%'],
                          ['Encoded By', '14%'],
                          ['Date Encoded', '12%'],
                          ['Status', '11%'],
                        ].map(([h, w]) => (
                          <th
                            key={h}
                            className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                            style={{ borderColor: 'var(--input-border)', color: 'var(--text)', width: w }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(showPastExtensions ? extensions : extensions.slice(0, 1)).map((x, i) => {
                        const latest = i === 0;
                        return (
                          <tr key={x.id ?? 'legacy'} style={{ backgroundColor: latest ? 'var(--surface)' : undefined }}>
                            <td className="px-2 py-2 border-b font-medium" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                              {fmtDate(x.extension_date)}
                            </td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                              <div className="whitespace-pre-wrap break-words">{x.remarks || '—'}</div>
                            </td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>{x.lease_ref_code || '—'}</td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>
                              {x.encoded_by || (x.id == null ? <span className="text-secondary">Before history</span> : '—')}
                            </td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>{fmtDate(x.created_at)}</td>
                            <td className="px-2 py-2 border-b" style={{ borderColor: 'var(--input-border)' }}>
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                  style={
                                    latest
                                      ? { backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: '#15803d' }
                                      : { backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }
                                  }
                                >
                                  {latest ? '● Latest' : 'Previous'}
                                </span>
                                {canEdit ? (
                                  <button
                                    type="button"
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-md cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--selected-bg)]"
                                    disabled={extensionSaving}
                                    onClick={() => setExtensionRemove(x)}
                                    title="Remove this extension"
                                    aria-label="Remove this extension"
                                  >
                                    <Trash2 size={13} className="text-red-500" />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {extensions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-2 py-2 border-b text-secondary" style={{ borderColor: 'var(--input-border)' }}>
                            No extensions yet.
                          </td>
                        </tr>
                      ) : null}
                      {/* New extension: typed in, then Add (saved right away). */}
                      {canEdit ? (
                        <tr>
                          <td className="px-1 py-1 align-top">
                            <DatePicker
                              mode="single"
                              fullWidth
                              boxed
                              placeholder="Extension date"
                              value={dateInputToDate(extensionDraft.extension_date)}
                              onChange={(d) => setExtensionDraft((p) => ({ ...p, extension_date: dateToDateInputValue(d) }))}
                            />
                          </td>
                          <td colSpan={4} className="px-1 py-1 align-top">
                            <input
                              className="app-form-control app-form-control-sm h-9 w-full"
                              placeholder="Remarks"
                              maxLength={300}
                              value={extensionDraft.remarks}
                              disabled={extensionSaving}
                              onChange={(e) => setExtensionDraft((p) => ({ ...p, remarks: e.target.value }))}
                            />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <button
                              type="button"
                              className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 hover:bg-[var(--selected-bg)]"
                              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                              disabled={!extensionDraft.extension_date || extensionSaving || loadingLocation}
                              onClick={() => void changeExtension()}
                            >
                              <Plus size={13} /> {extensionSaving ? 'Saving…' : 'Add'}
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )}

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
                    className="flex w-fit cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap"
                    style={{
                      borderColor: form.is_sublease || activeSubs > 0 ? 'var(--nav-active-bg)' : 'var(--input-border)',
                      backgroundColor:
                        form.is_sublease || activeSubs > 0
                          ? 'color-mix(in oklab, var(--nav-active-bg) 8%, var(--surface))'
                          : 'var(--surface)',
                      color: 'var(--text)',
                    }}
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
                      className="flex flex-col gap-2 rounded-2xl border p-3"
                      style={CARD_STYLE}
                    >
                      <div
                        className="-mx-3 -mt-3 mb-1 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                        style={CARD_HEAD_STYLE}
                      >
                        <CardTitle icon={Users} count={subs.length}>Sub-Lessees</CardTitle>
                        <span className="text-[10px] text-secondary">Each sub-lessee has its own Locator Information</span>
                      </div>
                      {subs.length ? (
                        <div className="min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                          <table className="w-full min-w-[44rem] table-fixed text-xs border-collapse">
                            <thead>
                              <tr style={THEAD_ROW_STYLE}>
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
                                    style={{ borderColor: 'var(--input-border)', color: 'var(--text)', width: w }}
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
              className="flex flex-col gap-3 rounded-2xl border p-3"
              style={CARD_STYLE}
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
                  contactsExpanded ? 'mb-1 rounded-t-2xl border-b' : '-mb-3 rounded-2xl',
                )}
                style={CARD_HEAD_STYLE}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {contactsExpanded ? (
                    <ChevronDown size={14} className="shrink-0 text-secondary" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-secondary" />
                  )}
                  {contactsExpanded || contactsEmpty ? (
                    <>
                      <span className="shrink-0"><CardTitle icon={UserRound}>Contact Person &amp; Authorized Signatory</CardTitle></span>
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
                    {/* SEC Registration Information — modelled on the SEC forms (Company
                        Information, Contact Person Information, purposes, capital), first on the
                        tab, above the stockholders table. Its own contact person, separate from the locator's
                        Contact Person list. */}
                    <div
                      className="flex flex-col gap-3 rounded-2xl border p-3"
                      style={CARD_STYLE}
                    >
                      <div
                        className="-mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                        style={CARD_HEAD_STYLE}
                      >
                        <CardTitle icon={Landmark}>{regLabels.card}</CardTitle>
                        <SectionSaveBar
                          allowed={editing ? canEdit : canAdd}
                          label={regLabels.save}
                          isEditing={Boolean(editing)}
                          hasContent={[...SEC_PROPONENT_KEYS, ...SEC_DETAIL_KEYS].some((k) => !k.endsWith('_currency') && String(form[k] ?? '').trim() !== '')}
                          dirty={sectionDirty.sec}
                          saving={savingSection === 'sec'}
                          disabled={saving || loadingLocation}
                          onSave={() => void saveSection('sec')}
                        />
                      </div>

                      <RegistrationTypeToggle
                        value={regType}
                        disabled={loadingLocation}
                        onChange={(next) => {
                          // DTI hides the stockholders: ask first when there are any.
                          if (next === 'DTI' && form.stockholders.length > 0) setRegTypeConfirm(true);
                          else setForm((p) => ({ ...p, registration_type: next }));
                        }}
                      />

                      {/* DTI (sole proprietorship): only what the Certificate of Business Name
                          Registration shows; the certificate itself is linked below. */}
                      {regType === 'DTI' ? (
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            <Field compact label="Business Name">
                              <input
                                className="app-form-control app-form-control-sm"
                                value={form.business_name}
                                readOnly
                                tabIndex={-1}
                                style={{ backgroundColor: 'var(--control-bg)' }}
                                title="The Locator's Name (Locator Details)"
                              />
                            </Field>
                            <div className="flex flex-col gap-1">
                              {secTextField('registration_no', 'Business Name No.', 'e.g. 3765278')}
                              {secNoTaken ? <span className="text-[11px] text-red-500">{secNoTaken}</span> : null}
                            </div>
                            <Field compact label="Territorial Scope">
                              <BoxSelect
                                options={['BARANGAY', 'CITY/MUNICIPALITY', 'REGIONAL', 'NATIONAL']}
                                value={form.dti_territorial_scope}
                                onChange={(v) => setForm((p) => ({ ...p, dti_territorial_scope: v }))}
                                placeholder="Select scope"
                                disabled={loadingLocation}
                                clearable
                              />
                            </Field>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            {secTextField('dti_owner_name', 'Issued To (Owner)', 'e.g. JUAN D. DELA CRUZ')}
                            <Field compact label="Valid From">
                              <DatePicker
                                mode="single"
                                fullWidth
                                boxed
                                placeholder="Select date"
                                value={dateInputToDate(form.sec_registration_date)}
                                onChange={(d) =>
                                  setForm((p) => {
                                    const from = dateToDateInputValue(d);
                                    // A Business Name registration is valid for 5 years: suggest the end once.
                                    const until =
                                      !p.dti_valid_until && from
                                        ? utcToYmd(new Date(Date.UTC(Number(from.slice(0, 4)) + 5, Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))))
                                        : p.dti_valid_until;
                                    return { ...p, sec_registration_date: from, dti_valid_until: until };
                                  })
                                }
                              />
                            </Field>
                            <Field compact label="Valid Until">
                              <DatePicker
                                mode="single"
                                fullWidth
                                boxed
                                placeholder="Select date"
                                value={dateInputToDate(form.dti_valid_until)}
                                onChange={(d) => setForm((p) => ({ ...p, dti_valid_until: dateToDateInputValue(d) }))}
                              />
                            </Field>
                          </div>
                          <Field compact label="DTI Certificate">
                            <div
                              className="app-form-control app-form-control-sm flex h-9 items-center gap-2 text-[12px]"
                              style={{ backgroundColor: 'var(--control-bg)', cursor: 'default' }}
                              title="The certificate on the Documents tab, or the DTI requirement of an application"
                            >
                              {dtiDocument && editing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      window.open(`/api/proponents/${editing.id}/dti-document/file?view=1`, '_blank')
                                    }
                                    className="inline-flex min-w-0 items-center gap-1.5 font-medium text-blue-600 hover:underline cursor-pointer"
                                    title="View the DTI certificate"
                                  >
                                    <FileText size={13} className="shrink-0" />
                                    <span className="truncate">{dtiDocument.label || dtiDocument.original_file_name || 'DTI Certificate'}</span>
                                  </button>
                                  <span className="shrink-0 truncate text-secondary">
                                    · {dtiDocument.source === 'application' ? 'Application requirement' : 'Documents tab'}
                                  </span>
                                </>
                              ) : (
                                <span className="text-secondary">
                                  {editing ? 'No DTI certificate uploaded yet — add it on the Documents tab' : 'After the locator is saved'}
                                </span>
                              )}
                            </div>
                          </Field>
                        </div>
                      ) : (
                      <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1">
                          {secTextField('registration_no', regLabels.no, regLabels.noPlaceholder)}
                          {secNoTaken ? <span className="text-[11px] text-red-500">{secNoTaken}</span> : null}
                        </div>
                        <Field compact label={regLabels.date}>
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
                          // Subscribed and Paid-up follow the Authorized Capital Stock's currency.
                          onCurrencyChange={(v) =>
                            setForm((p) => ({
                              ...p,
                              authorized_capital_currency: v,
                              subscribed_capital_currency: v,
                              paid_up_capital_currency: v,
                            }))
                          }
                        />
                        <CapitalField
                          label="Subscribed Capital"
                          amount={form.subscribed_capital}
                          currency={form.authorized_capital_currency}
                          currencyText
                          currencyTitle="Same as the Authorized Capital Stock's currency"
                          disabled={loadingLocation}
                          onAmountChange={(v) =>
                            setForm((p) => ({ ...p, subscribed_capital: v, stockholders: recomputeAllOwnership(p.stockholders, v) }))
                          }
                          onCurrencyChange={() => undefined}
                        />
                        <CapitalField
                          label="Paid-up Capital"
                          amount={form.paid_up_capital}
                          currency={form.authorized_capital_currency}
                          currencyText
                          currencyTitle="Same as the Authorized Capital Stock's currency"
                          disabled={loadingLocation}
                          onAmountChange={(v) => setForm((p) => ({ ...p, paid_up_capital: v }))}
                          onCurrencyChange={() => undefined}
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
                          {regLabels.contact}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                          {secTextField('sec_contact_name', 'Name of Contact Person')}
                          {secTextField('sec_contact_email', 'Email Address')}
                          {secTextField('sec_contact_telephone', 'Telephone No.')}
                          {secTextField('sec_contact_mobile', 'Mobile No.')}
                        </div>
                      </div>
                      </>
                      )}
                    </div>

                  {/* DTI (sole proprietorship): no stockholders. */}
                  {regType === 'DTI' ? null : (
                  <>
                  {/* Stockholders (dbo.stockholder) — same card layout as the Profile's
                      property schedule: Add and Save in the header. */}
                  <div
                    className="flex flex-col gap-3 rounded-2xl border p-3"
                    style={CARD_STYLE}
                  >
                    <div
                      className="-mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                      style={CARD_HEAD_STYLE}
                    >
                      <CardTitle icon={Users} count={form.stockholders.length}>Stockholders</CardTitle>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={loadingLocation}
                          onClick={() => {
                            const full = ownershipFullNotice(form.stockholders, form.subscribed_capital);
                            if (full) {
                              toast.warning(full, { id: 'ownership-full' });
                              return;
                            }
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
                      invalidKeys={(row) => stockholderInvalidKeys(row, showRowErrors.stockholders, Boolean(ownershipProblem))}
                      columns={[
                        { key: 'name', label: 'Stockholder Name', width: '30%', placeholder: 'Full name' },
                        { key: 'nationality', label: 'Nationality', width: '18%', placeholder: 'Select nationality', options: NATIONALITIES },
                        { key: 'subscribed', label: 'Subscribed', width: '18%', numeric: true, amount: true, placeholder: '0.00' },
                        { key: 'paid', label: 'Paid', width: '18%', numeric: true, amount: true, placeholder: '0.00' },
                        { key: 'ownership', label: 'Ownership %', width: '16%', numeric: true, placeholder: '—', readOnly: true },
                      ]}
                      onChange={(next) =>
                        setForm((p) => ({ ...p, stockholders: withOwnership(p.stockholders, next, p.subscribed_capital) }))
                      }
                      blankRow={blankStockholderRow}
                      totals={stockholderTotals(form.stockholders)}
                    />
                    <OwnershipSummary rows={form.stockholders} subscribedCapital={form.subscribed_capital} />
                  </div>
                  </>
                  )}

                    {/* GIS (General Information Sheet): the filing date is typed in (saved
                        with the SEC Registration Information); the document is the
                        locator's Compliance upload, read only. */}
                    <div
                      className="flex flex-col gap-3 rounded-2xl border p-3"
                      style={CARD_STYLE}
                    >
                      <div
                        className="-mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                        style={CARD_HEAD_STYLE}
                      >
                        <CardTitle icon={FileSignature}>GIS (General Information Sheet)</CardTitle>
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
                        <Field compact label="GIS Document">
                          <div
                            className="app-form-control app-form-control-sm flex h-9 items-center gap-2 text-[12px]"
                            style={{ backgroundColor: 'var(--control-bg)', cursor: 'default' }}
                            title="The latest GIS: Compliance upload, Documents tab, or the GIS requirement of an application"
                          >
                            {gisDocument && editing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    window.open(`/api/proponents/${editing.id}/gis-document/file?view=1`, '_blank')
                                  }
                                  className="inline-flex min-w-0 items-center gap-1.5 font-medium text-blue-600 hover:underline cursor-pointer"
                                  title="Open the GIS"
                                >
                                  <FileText size={13} className="shrink-0" />
                                  <span className="truncate">{gisDocument.label || gisDocument.original_file_name || 'GIS'}</span>
                                  <ExternalLink size={11} className="shrink-0 opacity-70" />
                                </button>
                                <span className="shrink-0 truncate text-secondary">
                                  ·{' '}
                                  {gisDocument.source === 'compliance'
                                    ? `Compliance · ${String(gisDocument.status || '').replace(/_/g, ' ').toLowerCase() || 'uploaded'}`
                                    : gisDocument.source === 'application'
                                      ? 'Application requirement'
                                      : 'Documents tab'}
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
                      disabled={loadingLocation}
                      onClick={() => {
                        const current = form.business_activities.trim();
                        const primary = form.sec_primary_purpose.trim();
                        if (current === primary) {
                          if (!current) toast.info('Type the Business Activities or the Primary Purpose first.');
                          return;
                        }
                        // No Primary Purpose yet: the other way round — fill it from the Business Activities.
                        if (!primary) {
                          setForm((p) => ({ ...p, sec_primary_purpose: p.business_activities.trim() }));
                          toast.success('Copied to the Primary Purpose — save it on the Stockholders tab.');
                          return;
                        }
                        if (current) setConfirmCopyPurpose(true);
                        else copyPrimaryPurpose();
                      }}
                      title={
                        form.sec_primary_purpose.trim()
                          ? 'Copy the Primary Purpose from the Registration Information card'
                          : 'No Primary Purpose yet — copies the Business Activities into it'
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
              className="flex flex-col gap-3 rounded-2xl border p-3"
              style={CARD_STYLE}
            >
              <div
                className="-mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                style={CARD_HEAD_STYLE}
              >
                <CardTitle icon={LayoutGrid} count={leaseView ? (viewedLease?.properties || []).length : form.properties.length}>
                  Property Schedule
                </CardTitle>
                {/* Editing is for the current lease only; an earlier lease's panel is read only. */}
                <div className={cn('flex items-center gap-2', leaseView && 'hidden')}>
                  {/* Billing basis (4-04): the Rate/SQM and MGL amounts are per month or per year. */}
                  <div
                    className="inline-flex rounded-md border p-0.5"
                    style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
                    title="Billing basis of this lease: Rate/SQM and MGL per month or per year"
                  >
                    {(
                      [
                        ['MONTH', 'Monthly'],
                        ['YEAR', 'Yearly'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={loadingLocation}
                        aria-pressed={form.rate_period === value}
                        onClick={() => setForm((p) => ({ ...p, rate_period: value }))}
                        className="rounded px-2 py-0.5 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed"
                        style={
                          form.rate_period === value
                            ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                            : { color: 'var(--text-muted)' }
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {canManagePropertyTypes ? (
                    <button
                      type="button"
                      onClick={() => setPropertyTypesOpen(true)}
                      className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md border cursor-pointer hover:bg-[var(--selected-bg)]"
                      style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                      title="Type of Property — File Maintenance"
                      aria-label="Type of Property settings"
                    >
                      <Settings size={13} />
                    </button>
                  ) : null}
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
                  <LeasePropertyTable properties={viewedLease.properties || []} period={viewedLease.rate_period} />
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
              <div className="hover-scrollbar min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                <table className="w-full min-w-[60rem] lg:min-w-0 table-fixed text-xs border-collapse">
                  <colgroup>
                    {['9.5%', '11.5%', '11.5%', '10%', '11.5%', '6.5%', '15.25%', '15.25%', '9%'].map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr style={THEAD_ROW_STYLE}>
                      {[
                        'Year',
                        'Date From',
                        'Date To',
                        'Rate',
                        'Type of Property',
                        'Area (SQM)',
                        form.rate_period === 'YEAR' ? 'Rate/SQM/YR' : 'Rate/SQM/MO',
                        form.rate_period === 'YEAR' ? 'MGL/YR' : 'MGL/MO',
                        '',
                      ].map(
                        (h, i) => (
                          <th
                            key={`${h}-${i}`}
                            className="px-1 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b truncate"
                            style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}
                            title={h || undefined}
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
                        <td className={`px-1 py-1 align-top border-b${miss('year')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <BoxSelect
                            className="w-full min-w-0 h-9"
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
                        <td className={`px-1 py-1 align-top border-b${miss('date_from')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <div className="h-9 min-w-0 [&>*]:h-full">
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
                          </div>
                        </td>
                        <td className={`px-1 py-1 align-top border-b${miss('date_to')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <div className="h-9 min-w-0 [&>*]:h-full">
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
                          </div>
                        </td>
                        <td className={`px-1 py-1 align-top border-b whitespace-nowrap${miss('rate_type')}`} style={{ borderColor: 'var(--input-border)' }}>
                          {/* Switchable: Non-standard → Standard recomputes MGL, so it asks first. */}
                          <BoxSelect
                            className="w-full min-w-0 h-9"
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
                        <td className={`px-1 py-1 align-top border-b${miss('type_of_property')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <BoxSelect
                            className="w-full min-w-0 h-9"
                            options={propertyTypeOptions(row.type_of_property)}
                            value={asOption(propertyTypeOptions(row.type_of_property), row.type_of_property)}
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
                        <td className={`px-1 py-1 align-top border-b${miss('area_sqm')}`} style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm h-9 w-full min-w-0 tabular-nums"
                            value={row.area_sqm}
                            placeholder="0.00"
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) =>
                                  ri === i ? updatePropertyRow(r, { area_sqm: formatAmountInput(e.target.value) }) : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td
                          className={`px-1 py-1 align-top border-b${miss('rate_sqm_mo')}${miss('rate_currency')}`}
                          style={{ borderColor: 'var(--input-border)' }}
                        >
                          <AmountCurrencyBox
                            className="w-full min-w-0 h-9"
                            amount={row.rate_sqm_mo}
                            currency={row.rate_currency}
                            disabled={loadingLocation}
                            onAmountChange={(value) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { rate_sqm_mo: value }) : r)),
                              }))
                            }
                            onCurrencyChange={(value) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { rate_currency: value }) : r)),
                              }))
                            }
                          />
                          {/* Non-standard: Rate/SQM/MO is still required — 0 when there's none. */}
                          {row.rate_type === 'NON_STANDARD' ? (
                            <div className="mt-0.5 px-1 text-[10px] leading-tight text-secondary">Input 0 if blank</div>
                          ) : null}
                        </td>
                        {/* MGL/MO + its currency: Standard computes both (Area × Rate, the rate's currency). */}
                        <td
                          className={`px-1 py-1 align-top border-b${miss('mgl_mo')}${miss('mgl_currency')}`}
                          style={{ borderColor: 'var(--input-border)' }}
                        >
                          <AmountCurrencyBox
                            className="w-full min-w-0 h-9"
                            amount={row.mgl_mo}
                            currency={row.mgl_currency}
                            disabled={loadingLocation}
                            amountDisabled={row.rate_type === 'STANDARD'}
                            currencyDisabled={row.rate_type === 'STANDARD'}
                            readOnly={row.rate_type === 'STANDARD'}
                            title={row.rate_type === 'STANDARD' ? 'Computed: Area × Rate/SQM/MO' : undefined}
                            currencyTitle={row.rate_type === 'STANDARD' ? 'Same as the rate’s currency' : undefined}
                            onAmountChange={(value) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { mgl_mo: value }) : r)),
                              }))
                            }
                            onCurrencyChange={(value) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? updatePropertyRow(r, { mgl_currency: value }) : r)),
                              }))
                            }
                          />
                        </td>
                        <td className="py-1 pl-1 pr-0.5 align-top border-b text-center whitespace-nowrap" style={{ borderColor: 'var(--input-border)' }}>
                          <div className="inline-flex items-center gap-1">
                            {/* Escalate + MGL Schedule, joined like one control. */}
                            <div
                              className="inline-flex h-9 items-stretch overflow-hidden rounded-lg border"
                              style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--surface)' }}
                            >
                              {/* Escalation (4-08): split this row into periods with a rising rate. */}
                              <button
                                type="button"
                                disabled={loadingLocation}
                                onClick={() => setEscalate({ index: i, start: '37', every: '36', percent: '' })}
                                className="inline-flex w-7 items-center justify-center text-secondary transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--selected-bg)] hover:text-[var(--text)]"
                                title={`Escalate row ${i + 1} — e.g. +10% every 36 months`}
                                aria-label={`Escalate row ${i + 1}`}
                              >
                                <TrendingUp size={14} />
                              </button>
                              <span className="w-px self-stretch" style={{ backgroundColor: 'var(--input-border)' }} aria-hidden />
                              {/* This row's MGL Schedule (month-by-month breakdown). */}
                              <button
                                type="button"
                                onClick={() => setMglScheduleRow(i)}
                                className="inline-flex w-7 items-center justify-center text-secondary transition-colors cursor-pointer hover:bg-[var(--selected-bg)] hover:text-[var(--text)]"
                                title={`MGL Schedule of row ${i + 1}`}
                                aria-label={`MGL Schedule of row ${i + 1}`}
                              >
                                <CalendarRange size={14} />
                              </button>
                            </div>
                            <button
                              type="button"
                              disabled={loadingLocation}
                              onClick={() => {
                                const remove = () =>
                                  setForm((p) => ({ ...p, properties: p.properties.filter((_, ri) => ri !== i) }));
                                if (blankRow) remove();
                                else askRowDelete(`property row ${i + 1}`, remove);
                              }}
                              className={`inline-flex h-9 w-8 items-center justify-center rounded-lg border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                                blankRow
                                  ? 'hover:bg-[var(--selected-bg)]'
                                  : 'border-red-500/35 bg-red-500/[0.06] text-red-500 hover:border-red-500 hover:bg-red-500 hover:text-white'
                              }`}
                              style={blankRow ? { borderColor: 'var(--input-border)', color: 'var(--text-muted)' } : undefined}
                              title={blankRow ? `Remove empty row ${i + 1}` : `Delete row ${i + 1}`}
                              aria-label={blankRow ? `Remove empty row ${i + 1}` : `Delete row ${i + 1}`}
                            >
                              {blankRow ? <Minus size={14} /> : <Trash2 size={14} />}
                            </button>
                          </div>
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
                className="flex flex-col gap-2 rounded-2xl border p-3"
                style={CARD_STYLE}
              >
                <div
                  className="-mx-3 -mt-3 mb-1 rounded-t-2xl border-b px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-center"
                  style={{ ...CARD_HEAD_STYLE, color: 'var(--text)' }}
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
                  amount={finAmount(form.advance_lease_payment_amount)}
                  currency={finCurrency(form.advance_lease_payment_currency)}
                  currencyText
                  amountReadOnly
                  amountTitle={finAmountTitle}
                  currencyTitle={finCurrencyTitle}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, advance_lease_payment_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, advance_lease_payment_currency: v }))}
                />
                <TotalAmountField
                  months={form.advance_lease_payment_months}
                  amount={finAmount(form.advance_lease_payment_amount)}
                  currency={finCurrency(form.advance_lease_payment_currency)}
                />
                </div>
              </div>

              <div
                className="flex flex-col gap-2 rounded-2xl border p-3"
                style={CARD_STYLE}
              >
                <div
                  className="-mx-3 -mt-3 mb-1 rounded-t-2xl border-b px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-center"
                  style={{ ...CARD_HEAD_STYLE, color: 'var(--text)' }}
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
                  amount={finAmount(form.security_deposit_amount)}
                  currency={finCurrency(form.security_deposit_currency)}
                  currencyText
                  amountReadOnly
                  amountTitle={finAmountTitle}
                  currencyTitle={finCurrencyTitle}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, security_deposit_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, security_deposit_currency: v }))}
                />
                <TotalAmountField
                  months={form.security_deposit_months}
                  amount={finAmount(form.security_deposit_amount)}
                  currency={finCurrency(form.security_deposit_currency)}
                />
                </div>
              </div>

              <div
                className="flex flex-col gap-2 rounded-2xl border p-3"
                style={CARD_STYLE}
              >
                <div
                  className="-mx-3 -mt-3 mb-1 rounded-t-2xl border-b px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-center"
                  style={{ ...CARD_HEAD_STYLE, color: 'var(--text)' }}
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
                  amount={finAmount(form.performance_security_amount)}
                  currency={finCurrency(form.performance_security_currency)}
                  currencyText
                  amountReadOnly
                  amountTitle={finAmountTitle}
                  currencyTitle={finCurrencyTitle}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, performance_security_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, performance_security_currency: v }))}
                />
                <TotalAmountField
                  months={form.performance_security_months}
                  amount={finAmount(form.performance_security_amount)}
                  currency={finCurrency(form.performance_security_currency)}
                />
                </div>
              </div>
            </div>

            {/* Performance Commitment (was the Investment tab; dbo.proponent_investment):
                what the locator committed to vs. what it actually has — investment
                amount and number of employees. Own Save, like the other cards. */}
            <div
              className="flex flex-col gap-3 rounded-2xl border p-3"
              style={CARD_STYLE}
            >
              <div
                className="-mx-3 -mt-3 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5"
                style={CARD_HEAD_STYLE}
              >
                <CardTitle icon={Target}>Performance Commitment</CardTitle>
                <SectionSaveBar
                  allowed={editing ? canEdit : canAdd}
                  label="Save Performance Commitment"
                  isEditing={Boolean(editing)}
                  hasContent={
                    [form.investment_commitment, form.investment_actual, form.employee_commitment, form.employee_actual].some((v) => v.trim() !== '') ||
                    form.development_timeline.some((m) => m.date || m.remarks.trim()) ||
                    form.investment_years.some((y) =>
                      [y.investment_commitment, y.investment_actual, y.employee_commitment, y.employee_actual].some((v) => v.trim()),
                    )
                  }
                  dirty={sectionDirty.investment}
                  saving={savingSection === 'investment'}
                  disabled={saving || loadingLocation}
                  onSave={() => void saveSection('investment')}
                />
              </div>
              {/* Per lease year (4-10): the totals here; the year-by-year breakdown in a pop-up.
                  Investment = the years added up; Employees = the highest year. */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] text-secondary">
                    {investmentYearsShown.length
                      ? `${investmentYearsShown.length} lease year${investmentYearsShown.length === 1 ? '' : 's'} · ${yearsWithFigures} with figures · Year ${currentLeaseYear} is current`
                      : 'Set the lease Start and End Term to break it down per year'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setInvestmentYearsOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer hover:bg-[var(--selected-bg)]"
                    style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--surface)' }}
                  >
                    <CalendarRange size={12} /> Per-year breakdown
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['Investment', 'investment_commitment', 'investment_actual', 'Total of the years'],
                      ['No. of Employees', 'employee_commitment', 'employee_actual', 'Highest year (peak)'],
                    ] as const
                  ).map(([label, commitKey, actualKey, hint]) => {
                    const commit = investmentOverall[commitKey];
                    const actual = investmentOverall[actualKey];
                    const money = commitKey === 'investment_commitment';
                    const show = (v: string | null) =>
                      v === null ? '—' : money ? formatMoney(v) : Number(v).toLocaleString('en-US');
                    return (
                      <div key={label} className="rounded-xl border p-3" style={{ borderColor: 'var(--input-border)' }}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                            {label}
                          </span>
                          <span className="text-[10px] text-secondary">{hint}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {(
                            [
                              ['Commitment', commit],
                              ['Actual', actual],
                            ] as const
                          ).map(([k, v]) => (
                            <div key={k}>
                              <div className="text-[9px] font-semibold uppercase tracking-widest text-secondary">{k}</div>
                              <div className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                                {show(v)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Development Timeline (4-11): when each milestone happened, with remarks. */}
              <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--input-border)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                    Development Timeline
                  </span>
                  <span className="text-[10px] text-secondary">
                    {form.development_timeline.filter((m) => m.date).length} of {MILESTONES.length} done
                  </span>
                </div>
                {/* A stepper: one step per milestone, done steps filled and joined by the
                    progress line; each step's date and remarks under it. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {MILESTONES.map((m, mi) => {
                    const row = form.development_timeline.find((r) => r.code === m.code) ?? { code: m.code, date: '', remarks: '' };
                    const setRow = (patch: Partial<MilestoneRow>) =>
                      setForm((p) => ({
                        ...p,
                        development_timeline: p.development_timeline.map((r) => (r.code === m.code ? { ...r, ...patch } : r)),
                      }));
                    const done = Boolean(row.date);
                    const nextDone = Boolean(form.development_timeline.find((r) => r.code === MILESTONES[mi + 1]?.code)?.date);
                    const last = mi === MILESTONES.length - 1;
                    return (
                      <div key={m.code} className="relative flex flex-col gap-2">
                        {/* Step marker centred over its card; on wide screens a line runs
                            from this marker's centre to the next one's, across the gap
                            (gap-3 = 0.75rem). */}
                        <div className="relative flex h-8 items-center xl:justify-center">
                          {last ? null : (
                            <span
                              className="absolute left-1/2 top-1/2 hidden h-0.5 -translate-y-1/2 rounded-full xl:block"
                              style={{
                                width: 'calc(100% + 0.75rem)',
                                backgroundColor: done && nextDone ? '#16a34a' : 'var(--input-border)',
                              }}
                              aria-hidden
                            />
                          )}
                          <span
                            className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-[12px] font-bold"
                            style={
                              done
                                ? { backgroundColor: '#16a34a', borderColor: '#16a34a', color: '#fff' }
                                : { backgroundColor: 'var(--surface)', borderColor: 'var(--input-border)', color: 'var(--text-muted)' }
                            }
                            aria-hidden
                          >
                            <m.icon size={15} />
                          </span>
                        </div>
                        <div
                          className="flex flex-1 flex-col gap-2 rounded-xl border p-3"
                          style={{
                            borderColor: done ? 'color-mix(in oklab, #16a34a 45%, var(--input-border))' : 'var(--input-border)',
                            backgroundColor: done ? 'color-mix(in oklab, #22c55e 7%, var(--surface))' : 'var(--surface)',
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-[12px] font-semibold leading-tight" style={{ color: 'var(--text)' }}>
                              {m.label}
                            </div>
                            <span
                              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={
                                done
                                  ? { backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)', color: '#15803d' }
                                  : { backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }
                              }
                            >
                              {done ? 'Done' : 'Pending'}
                            </span>
                          </div>
                          <div className="h-9 [&>*]:h-full">
                            <DatePicker
                              mode="single"
                              fullWidth
                              boxed
                              placeholder="Date"
                              value={dateInputToDate(row.date)}
                              onChange={(d: Date | null) => setRow({ date: dateToDateInputValue(d) })}
                            />
                          </div>
                          <textarea
                            className="app-form-control app-form-control-sm min-h-[3.5rem] w-full resize-y"
                            placeholder="Remarks"
                            maxLength={500}
                            value={row.remarks}
                            disabled={loadingLocation}
                            onChange={(e) => setRow({ remarks: e.target.value })}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
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
        open={escalate !== null}
        title={`Escalate row ${(escalate?.index ?? 0) + 1}`}
        description="The base rate runs until the first increase; from then on the rate goes up by the percent every interval (compounded), up to the lease's End Term. The new rows can still be edited."
        confirmText={editing ? 'Escalate & Save' : 'Escalate'}
        widthClassName="max-w-2xl"
        confirmDisabled={escalatePreview.length < 2 || !escalate || escalate.percent.trim() === '' || !(Number(escalate.percent) > 0)}
        onCancel={() => setEscalate(null)}
        onConfirm={() => {
          if (!escalate) return;
          const every = Math.floor(Number(escalate.every));
          const start = Math.floor(Number(escalate.start));
          const pct = Number(escalate.percent);
          setShowPropertyErrors(false);
          setForm((p) => {
            const made = escalatePropertyRow(p.properties[escalate.index], every, pct, leaseEndYmd, start);
            const replaced = new Set(overlappedRowIndexes(p.properties, escalate.index, made));
            return {
              ...p,
              properties: p.properties.flatMap((r, ri) => (ri === escalate.index ? made : replaced.has(ri) ? [] : [r])),
            };
          });
          setEscalate(null);
          // A saved locator: the new rows are saved right away (after this render,
          // so the save sees them). A New Locator saves them with its first Save.
          if (editing) setAutoSaveProperties(true);
          else toast.success('Row escalated — the new rows are saved with the locator.');
        }}
      >
        {escalate ? (
          <div className="mt-2 flex flex-col gap-2">
            {(() => {
              const row = form.properties[escalate.index];
              return row && (!row.date_from || !row.date_to) ? (
                <div className="text-[11px] text-red-500">Set this row's Date From and Date To first.</div>
              ) : row ? (
                <div className="text-[11px] text-secondary">
                  {fmtDate(row.date_from)} – {fmtDate(row.date_to)} · {row.type_of_property || 'Property'}
                </div>
              ) : null;
            })()}
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                  First increase on month
                </span>
                <input
                  className="app-form-control app-form-control-sm h-9 tabular-nums"
                  inputMode="numeric"
                  value={escalate.start}
                  onChange={(e) => setEscalate((x) => (x ? { ...x, start: e.target.value.replace(/[^\d]/g, '') } : x))}
                  placeholder="e.g. 37"
                  title="e.g. 37: months 1–36 at the base rate, the first increase on month 37"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                  Then every (months)
                </span>
                <input
                  className="app-form-control app-form-control-sm h-9 tabular-nums"
                  inputMode="numeric"
                  value={escalate.every}
                  onChange={(e) => setEscalate((x) => (x ? { ...x, every: e.target.value.replace(/[^\d]/g, '') } : x))}
                  placeholder="e.g. 36"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
                  Increase (%)
                </span>
                <input
                  className="app-form-control app-form-control-sm h-9 tabular-nums"
                  inputMode="decimal"
                  value={escalate.percent}
                  onChange={(e) => setEscalate((x) => (x ? { ...x, percent: e.target.value.replace(/[^\d.]/g, '') } : x))}
                  placeholder="e.g. 10"
                />
              </label>
            </div>
            {escalateReplaces.length ? (
              <div className="rounded-lg border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                Replaces row{escalateReplaces.length > 1 ? 's' : ''} {escalateReplaces.map((i) => i + 1).join(', ')} — the same property's
                earlier rows in these dates — so nothing is counted twice.
              </div>
            ) : null}
            {/* Review before saving: each period's rate and MGL, how many months (or
                years, for a yearly lease) it runs, its subtotal, and the grand total —
                the same figures the MGL Schedule shows. */}
            {escalatePreview.length >= 2 ? (() => {
              const yearly = form.rate_period === 'YEAR';
              const unit = yearly ? 'yr' : 'mo';
              const periods = escalatePreview.map((r, k) => {
                const mglText = r.rate_type === 'STANDARD' ? computeStandardMgl(r) : r.mgl_mo;
                const mgl = parseAmount(mglText) ?? 0;
                const currency = (r.rate_type === 'STANDARD' ? r.rate_currency : r.mgl_currency) || 'PHP';
                const { months } = buildMglSchedule(
                  [{ no: k + 1, label: '', group: 'g', groupLabel: '', from: r.date_from, to: r.date_to, mgl, currency }],
                  yearly ? 12 : 1,
                );
                const subtotal = months.reduce((sum, m) => sum + (m.totals[currency] ?? 0), 0);
                const units = months.length;
                const partial = months.some((m) => m.parts.some((pt) => pt.prorated));
                return { r, k, mglText, currency, subtotal, units, partial };
              });
              const grand = periods.reduce((sum, x) => sum + x.subtotal, 0);
              const currency = periods[0]?.currency || 'PHP';
              const th = 'px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wide border-b';
              return (
                <div className="max-h-64 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0" style={{ backgroundColor: 'var(--control-bg)' }}>
                      <tr>
                        <th className={`${th} text-left`} style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>Period</th>
                        <th className={`${th} text-right`} style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>Rate/SQM</th>
                        <th className={`${th} text-right`} style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>MGL/{unit.toUpperCase()}</th>
                        <th className={`${th} text-right`} style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>{yearly ? 'Years' : 'Months'}</th>
                        <th className={`${th} text-right`} style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((x) => (
                        <tr key={x.k}>
                          <td className="px-2 py-1 border-b whitespace-nowrap" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                            {fmtDate(x.r.date_from)} – {fmtDate(x.r.date_to)}
                          </td>
                          <td className="px-2 py-1 border-b text-right tabular-nums whitespace-nowrap" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                            {x.r.rate_sqm_mo || '—'}
                            {x.k > 0 && Number(escalate.percent) > 0 ? <span className="ml-1 text-[#15803d]">+{escalate.percent}%</span> : null}
                          </td>
                          <td className="px-2 py-1 border-b text-right tabular-nums font-semibold whitespace-nowrap" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                            {x.mglText || '—'}
                          </td>
                          <td className="px-2 py-1 border-b text-right tabular-nums" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                            {x.units}
                            {x.partial ? <span style={{ color: '#b45309' }} title="The last one is prorated (part of a month/year)">*</span> : null}
                          </td>
                          <td className="px-2 py-1 border-b text-right tabular-nums whitespace-nowrap" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                            {formatMoney(Math.round(x.subtotal * 100) / 100)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ backgroundColor: 'var(--control-bg)' }}>
                        <td colSpan={4} className="px-2 py-1.5 text-[11px] font-bold" style={{ color: 'var(--text)' }}>
                          Grand Total · {periods.length} periods
                        </td>
                        <td className="px-2 py-1.5 text-right text-[11px] font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--text)' }}>
                          {formatMoney(Math.round(grand * 100) / 100)} {currency}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  {periods.some((x) => x.partial) ? (
                    <div className="px-2 py-1 text-[10px] text-secondary">
                      <span style={{ color: '#b45309' }}>*</span> includes a prorated (partial) {yearly ? 'year' : 'month'}.
                    </div>
                  ) : null}
                </div>
              );
            })() : (() => {
              const row = form.properties[escalate.index];
              return row?.date_from && row?.date_to && Number(escalate.every) > 0 && Number(escalate.start) > 1 ? (
                <div className="rounded-lg border px-2 py-1.5 text-[11px]" style={{ borderColor: 'rgba(245,158,11,.35)', backgroundColor: 'rgba(245,158,11,.10)', color: '#b45309' }}>
                  Nothing to escalate: the lease ends
                  {leaseEndYmd ? ` (${fmtDate(leaseEndYmd)})` : ''} before month {escalate.start || '—'}. Use an earlier first
                  increase, or set the lease's End Term.
                </div>
              ) : null;
            })()}
          </div>
        ) : null}
      </ConfirmModal>

      <InvestmentYearsModal
        open={investmentYearsOpen}
        years={investmentYearsShown}
        currentYear={currentLeaseYear}
        yearStart={(n) => (leaseStartYmd ? fmtDate(utcToYmd(addMonthsUtc(ymdToUtc(leaseStartYmd), (n - 1) * 12))) : '')}
        totals={{
          investment_commitment: investmentOverall.investment_commitment ? formatMoney(investmentOverall.investment_commitment) : '',
          investment_actual: investmentOverall.investment_actual ? formatMoney(investmentOverall.investment_actual) : '',
          employee_commitment: investmentOverall.employee_commitment
            ? Number(investmentOverall.employee_commitment).toLocaleString('en-US')
            : '',
          employee_actual: investmentOverall.employee_actual ? Number(investmentOverall.employee_actual).toLocaleString('en-US') : '',
        }}
        disabled={loadingLocation || formLocked}
        format={{
          typing: (key, v) => (key.startsWith('investment') ? formatAmountInput(v) : formatCountInput(v)),
          leaving: (key, v) => (key.startsWith('investment') ? formatMoney(v) : v),
        }}
        onChange={(n, patch) => setInvestmentYear(n, patch)}
        onAddYear={() => setInvestmentYear(investmentYearsShown.length + 1, {})}
        onClose={() => setInvestmentYearsOpen(false)}
      />

      <MglScheduleModal
        open={mglScheduleRow !== null}
        period={form.rate_period}
        locatorName={[
          form.business_name.trim() || editing?.business_name || '',
          mglScheduleRow !== null ? `Row ${mglScheduleRow + 1}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        rows={form.properties
          .map((r, i) => ({ r, i }))
          .filter(({ i }) => i === mglScheduleRow)
          .map(({ r, i }): MglSourceRow => ({
          no: i + 1,
          label: [r.type_of_property, r.year].filter(Boolean).join(' · ') || `Row ${i + 1}`,
          // One column per property: same Type of Property and Area (its yearly escalations).
          group: `${String(r.type_of_property || '').trim().toUpperCase()}|${parseAmount(r.area_sqm) ?? ''}`,
          groupLabel: [
            String(r.type_of_property || '').trim() || 'Property',
            parseAmount(r.area_sqm) !== null ? `${formatIfNumeric(r.area_sqm)} SQM` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          from: r.date_from,
          to: r.date_to,
          mgl: parseAmount(r.rate_type === 'STANDARD' ? computeStandardMgl(r) : r.mgl_mo) ?? NaN,
          currency: (r.rate_type === 'STANDARD' ? r.rate_currency : r.mgl_currency) || 'PHP',
        }))}
        onClose={() => setMglScheduleRow(null)}
      />

      <PropertyTypesModal
        open={propertyTypesOpen}
        onClose={() => setPropertyTypesOpen(false)}
        onChanged={() => void loadPropertyTypes()}
      />

      <ConfirmModal
        open={regTypeConfirm}
        title="Switch to DTI?"
        description="A DTI-registered business (sole proprietorship) has no stockholders, so the Stockholders list is hidden. The rows already saved are kept, not deleted — switching back to SEC shows them again."
        confirmText="Switch to DTI"
        onCancel={() => setRegTypeConfirm(false)}
        onConfirm={() => {
          setForm((p) => ({ ...p, registration_type: 'DTI' }));
          setRegTypeConfirm(false);
        }}
      />

      <ConfirmModal
        open={extensionRemove !== null}
        title="Remove this extension?"
        description={`The extension${
          extensionRemove?.extension_date ? ` of ${fmtDate(extensionRemove.extension_date)}` : ''
        } is removed from the history now. The latest one left becomes the locator's Extension Date.`}
        confirmText="Remove"
        danger
        loading={extensionSaving}
        onCancel={() => setExtensionRemove(null)}
        onConfirm={async () => {
          if (extensionRemove) await changeExtension(extensionRemove);
          setExtensionRemove(null);
        }}
      />

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
function LeasePropertyTable({ properties, period }: { properties: any[]; period?: string }) {
  const per = period === 'YEAR' ? 'YR' : 'MO';
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
          <tr style={THEAD_ROW_STYLE}>
            {['No.', 'Year', 'Date From', 'Date To', 'Rate', 'Type of Property', 'Area (SQM)', `Rate/SQM/${per}`, `MGL/${per}`].map((h) => (
              <th
                key={h}
                className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}
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
                r.area_sqm ? formatIfNumeric(r.area_sqm) : '—',
                r.rate_sqm_mo ? `${formatMoney(r.rate_sqm_mo)} ${r.rate_currency || ''}` : '—',
                r.mgl_mo ? `${formatMoney(r.mgl_mo)} ${r.mgl_currency || ''}` : '—',
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
/** The list's identifier column: the Ref. Code the Account Officer types in
 * (unique, never reused — Proponent.assertUniqueField); "Not set" until then.
 * The system Ref No (LOC-…) is in the cell's tooltip. */
function RefCodeCell({ code }: { code: string | null | undefined }) {
  const text = String(code || '').trim();
  if (text) return <span className="font-semibold">{text}</span>;
  return (
    <span
      className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: '#d97706', borderColor: 'rgba(245,158,11,.35)', backgroundColor: 'rgba(245,158,11,.1)' }}
      title="No Ref. Code yet — the Account Officer types it in on the locator's panel"
    >
      Not set
    </span>
  );
}

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
  totals,
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
    /** Computed, not typed (e.g. Ownership %): shown, never edited. */
    readOnly?: boolean;
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
  /** A "Total" row under the table: column key -> the figure to show. */
  totals?: Partial<Record<string, string>>;
}) {
  const fixed = columns.some((c) => c.width);
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
      <div className="flex-1 min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
        <table className={cn('w-full text-xs border-collapse', fixed && 'table-fixed min-w-[40rem]')}>
          <thead>
            <tr style={THEAD_ROW_STYLE}>
              <th
                className="px-2 py-1.5 text-center font-semibold uppercase tracking-wide text-[9px] border-b w-10"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}
              >
                No.
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                  style={{ borderColor: 'var(--input-border)', color: 'var(--text)', width: c.width }}
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
                        className={cn('app-form-control app-form-control-sm w-full', c.className, c.readOnly && 'cursor-default tabular-nums')}
                        style={c.readOnly ? { backgroundColor: 'var(--control-bg)' } : undefined}
                        inputMode={c.numeric ? 'decimal' : undefined}
                        placeholder={c.placeholder}
                        value={String(row[c.key] ?? '')}
                        disabled={disabled}
                        readOnly={c.readOnly}
                        tabIndex={c.readOnly ? -1 : undefined}
                        title={c.readOnly ? 'Computed automatically' : undefined}
                        onBlur={() => {
                          if (!c.amount || c.readOnly) return;
                          const current = String(row[c.key] ?? '');
                          const money = formatMoney(current);
                          if (money !== current) onChange(rows.map((r, ri) => (ri === i ? { ...r, [c.key]: money } : r)));
                        }}
                        onChange={(e) => {
                          if (c.readOnly) return;
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
          {totals && rows.length > 0 ? (
            <tfoot>
              <tr style={THEAD_ROW_STYLE}>
                <td />
                {columns.map((c, ci) => (
                  <td key={c.key} className="px-3 py-2 text-[11px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                    {totals[c.key] ?? (ci === 0 ? 'Total' : '')}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          ) : null}
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
          : cn('uppercase tracking-widest', compact ? 'text-[9px]' : 'text-[11px]'),
      )}
      style={{ color: 'var(--text)' }}
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
/** SEC (corporation / partnership) or DTI (sole proprietorship). Blank = not
 * chosen yet, treated as SEC. */
export type RegistrationType = 'SEC' | 'DTI';
export const registrationTypeOf = (value?: string | null): RegistrationType =>
  String(value || '').toUpperCase() === 'DTI' ? 'DTI' : 'SEC';
/** Labels of the Registration Information card for the chosen agency. */
export function registrationLabels(type: RegistrationType) {
  return type === 'DTI'
    ? {
        card: 'DTI Registration Information',
        no: 'DTI Registration No.',
        noPlaceholder: 'e.g. 1234567',
        date: 'DTI Registration Date',
        contact: 'DTI Contact Person',
        save: 'Save DTI Registration Information',
      }
    : {
        card: 'SEC Registration Information',
        no: 'SEC Registration No.',
        noPlaceholder: 'e.g. CS201811260',
        date: 'SEC Registration Date',
        contact: 'SEC Contact Person',
        save: 'Save SEC Registration Information',
      };
}

/** "Registered with: [SEC] [DTI]" — DTI (sole proprietorship) has no stockholders. */
export function RegistrationTypeToggle({
  value,
  onChange,
  disabled,
}: {
  value: RegistrationType;
  onChange: (value: RegistrationType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
        Registered with
      </span>
      <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}>
        {(
          [
            ['SEC', 'SEC', 'Corporation / partnership'],
            ['DTI', 'DTI', 'Sole proprietorship — no stockholders'],
          ] as const
        ).map(([v, label, hint]) => (
          <button
            key={v}
            type="button"
            title={hint}
            disabled={disabled}
            aria-pressed={value === v}
            onClick={() => value !== v && onChange(v)}
            className="rounded-md px-3 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            style={
              // The chosen one is solid (same as the app's primary buttons) so it reads at a glance.
              value === v
                ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', boxShadow: '0 1px 2px rgba(0,0,0,.15)' }
                : { color: 'var(--text-muted)' }
            }
          >
            {label}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-secondary">
        {value === 'DTI' ? 'Sole proprietorship — no stockholders' : 'Corporation / partnership'}
      </span>
    </div>
  );
}

/** Amount and currency in one bordered box — the amount and the currency
 * are borderless inside it, split by a thin divider. */
export function AmountCurrencyBox({
  amount,
  currency,
  disabled,
  amountDisabled,
  currencyDisabled,
  readOnly,
  className,
  title,
  currencyTitle,
  currencyText,
  onAmountChange,
  onCurrencyChange,
}: {
  amount: string;
  currency: string;
  disabled?: boolean;
  amountDisabled?: boolean;
  currencyDisabled?: boolean;
  /** Show the currency as plain text (no dropdown) — it's set elsewhere. */
  currencyText?: boolean;
  readOnly?: boolean;
  className?: string;
  title?: string;
  currencyTitle?: string;
  onAmountChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
}) {
  return (
    <div className={cn('app-form-control app-form-control-sm flex items-stretch p-0 overflow-hidden', className)}>
      <input
        className="w-0 flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1 tabular-nums"
        style={{ color: amountDisabled ? 'var(--text-muted)' : 'var(--text)' }}
        value={amount}
        disabled={disabled || amountDisabled}
        readOnly={readOnly}
        title={title}
        placeholder="0.00"
        onChange={(e) => onAmountChange(formatAmountInput(e.target.value))}
        onBlur={() => {
          const money = formatMoney(amount);
          if (money !== amount) onAmountChange(money);
        }}
      />
      {currencyText ? (
        <div
          className="shrink-0 flex items-center justify-end px-3 text-[11px] font-semibold text-secondary"
          style={{ borderLeft: '1px solid var(--input-border)', minWidth: '4rem' }}
          title={currencyTitle}
        >
          {currency || 'PHP'}
        </div>
      ) : (
      <div className="shrink-0 flex items-stretch" style={{ borderLeft: '1px solid var(--input-border)', width: '4.75rem' }} title={currencyTitle}>
        <AppSelect
          options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
          value={currency}
          onChange={onCurrencyChange}
          isClearable={false}
          isDisabled={disabled || currencyDisabled}
          compact
          boxed
          minHeight={26}
        />
      </div>
      )}
    </div>
  );
}

export function CapitalField({
  label,
  amount,
  currency,
  disabled,
  inline,
  currencyDisabled,
  currencyTitle,
  currencyText,
  amountReadOnly,
  amountTitle,
  onAmountChange,
  onCurrencyChange,
}: {
  label: string;
  amount: string;
  currency: string;
  disabled?: boolean;
  inline?: boolean;
  /** Currency set elsewhere (e.g. the Property Schedule's MGL currency). */
  currencyDisabled?: boolean;
  currencyTitle?: string;
  /** Show the currency as text, no dropdown. */
  currencyText?: boolean;
  /** Computed elsewhere (e.g. from the Property Schedule's MGL/MO): shown, not typed. */
  amountReadOnly?: boolean;
  amountTitle?: string;
  onAmountChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
}) {
  return (
    <Field compact inline={inline} label={label}>
      <AmountCurrencyBox
        amount={amount}
        currency={currency}
        disabled={disabled}
        currencyDisabled={currencyDisabled}
        currencyTitle={currencyTitle}
        currencyText={currencyText}
        amountDisabled={amountReadOnly}
        readOnly={amountReadOnly}
        title={amountTitle}
        className={inline ? FIN_CARD_CONTROL_H : undefined}
        onAmountChange={onAmountChange}
        onCurrencyChange={onCurrencyChange}
      />
    </Field>
  );
}
