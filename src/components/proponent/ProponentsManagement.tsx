import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Search } from 'lucide-react';
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
};

function blankPropertyRow(): PropertyRow {
  return {
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
};

type DisplayRow = ProponentRow & LocatorDynamicRow;

type UserOption = {
  id: number;
  username: string;
  full_name: string | null;
  is_active: number;
  department_code: string | null;
  department_name: string | null;
};

type ContractTypeOption = {
  id: number;
  name: string;
  is_active: number;
};

// File Maintenance lookup (Land Use) — same shape as the contract types.
type LookupOption = ContractTypeOption;

type LocatorsData = {
  proponents: ProponentRow[];
  dynamic: LocatorDynamicRow[];
  users: UserOption[];
  contractTypes: ContractTypeOption[];
  landUses: LookupOption[];
};

// "Stockholders Information" / "Contact Person" tabs — child tables (dbo.stockholder,
// dbo.contact_person) synced by id on every save (rows removed here are deactivated).
type StockholderRow = {
  id?: number;
  name: string;
  nationality: string;
  subscribed: string;
  paid: string;
  ownership: string;
};

type ContactPersonRow = {
  id?: number;
  name: string;
  designation: string;
  contact_no: string;
  email: string;
};

// Signatories have exactly the same columns as contact persons.
type SignatoryRow = ContactPersonRow;

function blankStockholderRow(): StockholderRow {
  return { name: '', nationality: '', subscribed: '', paid: '', ownership: '' };
}

function blankContactPersonRow(): ContactPersonRow {
  return { name: '', designation: '', contact_no: '', email: '' };
}

const blankSignatoryRow = blankContactPersonRow;

// The sections that can be saved on their own (see saveSection).
type SectionKey = 'stockholders' | 'contacts' | 'properties' | 'investment';

// API rows -> form rows.
function mapStockholderRows(rows: any): StockholderRow[] {
  if (!Array.isArray(rows) || !rows.length) return [blankStockholderRow()];
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name || '',
    nationality: r.nationality || '',
    subscribed: r.subscribed != null ? String(r.subscribed) : '',
    paid: r.paid != null ? String(r.paid) : '',
    ownership: r.ownership != null ? String(r.ownership) : '',
  }));
}

// Contact persons and signatories share the same columns.
function mapContactRows(rows: any): ContactPersonRow[] {
  if (!Array.isArray(rows) || !rows.length) return [blankContactPersonRow()];
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name || '',
    designation: r.designation || '',
    contact_no: r.contact_no || '',
    email: r.email || '',
  }));
}

function mapPropertyRows(rows: any): PropertyRow[] {
  if (!Array.isArray(rows) || !rows.length) return [blankPropertyRow()];
  return rows.map((row: any) => ({
    id: row.id,
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
const toStockholderPayload = (r: StockholderRow) => ({
  id: r.id,
  name: r.name.trim(),
  nationality: r.nationality.trim() || null,
  subscribed: r.subscribed.trim(),
  paid: r.paid.trim(),
  ownership: r.ownership.trim(),
});

const toContactPayload = (r: ContactPersonRow) => ({
  id: r.id,
  name: r.name.trim(),
  designation: r.designation.trim() || null,
  contact_no: r.contact_no.trim() || null,
  email: r.email.trim() || null,
});

const toPropertyPayload = (row: PropertyRow) => ({
  year: row.year.trim() || null,
  date_from: row.date_from || null,
  date_to: row.date_to || null,
  type_of_property: row.type_of_property.trim() || null,
  area_sqm: row.area_sqm.trim() || null,
  rate_sqm_mo: row.rate_sqm_mo.trim() || null,
  rate_currency: row.rate_currency || null,
  mgl_mo: row.mgl_mo.trim() || null,
  mgl_currency: row.mgl_currency || null,
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

// Live thousand-separator formatting for currency-amount inputs (Capital
// Stock, Advance Lease Payment/Security Deposit/Performance Security,
// property schedule Rate/MGL) — strips everything but digits and a single
// decimal point, then re-inserts commas every 3 digits on the integer part.
function formatAmountInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  const intPart = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  const decPart = firstDot === -1 ? '' : cleaned.slice(firstDot + 1).replace(/\./g, '');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return firstDot === -1 ? withCommas : `${withCommas}.${decPart}`;
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
  business_activities: '',
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
  properties: [blankPropertyRow()],
  land_use_id: '',
  stockholders: [blankStockholderRow()],
  contact_persons: [blankContactPersonRow()],
  signatories: [blankSignatoryRow()],
};

export function ProponentsManagement({
  locationSearch = '',
  navigate,
}: {
  locationSearch?: string;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
} = {}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProponentRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Mirrors the legacy BRIDGE system's Locator's Information tab strip —
  // only Profile has content so far, the rest are placeholders.
  const [activeProfileTab, setActiveProfileTab] = useState<
    'Profile' | 'Stockholders Information' | 'Contact Person' | 'Documents' | 'Investment'
  >('Profile');
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [highlightedProponentId, setHighlightedProponentId] = useState<number | null>(null);
  const [highlightedProponentTick, setHighlightedProponentTick] = useState(0);
  const consumedProponentQueryRef = useRef<string>('');
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const cardRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const { data: locatorsData, isLoading, isRevalidating, refresh } = useSessionStorageCachedResource<LocatorsData>({
    cacheKey: 'ciac.locators.v8',
    ttlMs: 5 * 60 * 1000,
    fetcher: async () => {
      const [pRes, dRes, uRes, atRes, luRes] = await Promise.all([
        fetch(api('/api/proponents'), { credentials: 'include' }),
        fetch(api('/api/proponents/locator-list'), { credentials: 'include' }),
        fetch(api('/api/proponents/account-officers'), { credentials: 'include' }),
        fetch(api('/api/proponents/type-of-contract'), { credentials: 'include' }),
        fetch(api('/api/proponents/land-uses'), { credentials: 'include' }),
      ]);

      const pJson = await pRes.json();
      const dJson = await dRes.json();
      const uJson = await uRes.json();
      const atJson = await atRes.json();
      const luJson = await luRes.json();

      if (!pRes.ok) throw new Error(pJson?.message || 'Failed to load proponents');
      if (!dRes.ok) throw new Error(dJson?.message || 'Failed to load locator list');
      if (!uRes.ok) throw new Error(uJson?.message || 'Failed to load account officers');
      if (!atRes.ok) throw new Error(atJson?.message || 'Failed to load types of contract');
      if (!luRes.ok) throw new Error(luJson?.message || 'Failed to load land uses');

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
      };
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : 'Failed to load data';
      setError(message);
      toast.error(message);
    },
  });

  const proponents = locatorsData?.proponents ?? [];
  const users = locatorsData?.users ?? [];

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
        .map((u) => {
          const name = (u.full_name || u.username).replace(/\s*\(Legacy Import\)\s*$/i, '');
          return {
            value: String(u.id),
            label: `${name}${u.is_active === 1 ? '' : ' (inactive)'}`,
            detail: u.department_name ?? '',
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [users, form.account_officer_id],
  );
  const contractTypes = locatorsData?.contractTypes ?? [];
  // Type of Contract comes from File Maintenance > Type of Contract. Only active
  // types are offered, but the locator's current one stays listed even if it was
  // since deactivated, so editing doesn't blank it.
  const hasContract = Boolean(editing?.start_term);
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
      ...rest
    } = f;
    return {
      rest: JSON.stringify(rest),
      sections: {
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

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => {
      const statusStr = p.is_active === 1 ? 'active' : 'inactive';
      return (
        (p.ref_no || '').toLowerCase().includes(q) ||
        (p.business_name || '').toLowerCase().includes(q) ||
        (p.tin || '').toLowerCase().includes(q) ||
        (p.registration_no || '').toLowerCase().includes(q) ||
        (p.contact_no || '').toLowerCase().includes(q) ||
        (p.address || '').toLowerCase().includes(q) ||
        (p.business_type || '').toLowerCase().includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [rows, searchQuery]);

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
  }, [searchQuery, pageSize]);

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

  function openCreate() {
    setEditing(null);
    setForm({
      user_id: '',
      business_name: '',
      registration_no: '',
      tin: '',
      address: '',
      contact_no: '',
      ...BLANK_PROFILE_FORM,
    });
    setActiveProfileTab('Profile');
    setLoaded(null);
    setIsCreateOpen(true);
  }

  // Profile fields aren't part of the bulk /api/proponents list — they're
  // fetched on demand here, only when a specific locator's panel is opened,
  // rather than pulled for every row up front.
  function openEdit(p: ProponentRow) {
    setIsCreateOpen(true);
    setActiveProfileTab('Profile');
    setLoaded(null);
    setEditing(p);
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
        const profileFields = {
          location: data.location || '',
          ref_code: data.ref_code || '',
          lease_address: data.lease_address || '',
          account_officer_id: data.account_officer_id != null ? String(data.account_officer_id) : '',
          sec_registration_date: toDateInputValue(data.sec_registration_date),
          date_signed: toDateInputValue(data.date_signed),
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
          business_activities: data.business_activities || '',
          advance_lease_payment_months: data.advance_lease_payment_months || '',
          advance_lease_payment_amount: data.advance_lease_payment_amount || '',
          advance_lease_payment_currency: data.advance_lease_payment_currency || 'PHP',
          security_deposit_months: data.security_deposit_months || '',
          security_deposit_amount: data.security_deposit_amount || '',
          security_deposit_currency: data.security_deposit_currency || 'PHP',
          performance_security_months: data.performance_security_months || '',
          performance_security_amount: data.performance_security_amount || '',
          performance_security_currency: data.performance_security_currency || 'PHP',
          investment_commitment: data.investment_commitment || '',
          investment_actual: data.investment_actual || '',
          employee_commitment: data.employee_commitment || '',
          employee_actual: data.employee_actual || '',
          properties: mapPropertyRows(data.properties),
          land_use_id: data.land_use_id != null ? String(data.land_use_id) : '',
          stockholders: mapStockholderRows(data.stockholders),
          contact_persons: mapContactRows(data.contact_persons),
          signatories: mapContactRows(data.signatories),
        };
        setForm((prev) => ({ ...prev, ...profileFields }));
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
  async function saveSection(section: SectionKey) {
    if (!editing) return;
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
            : section === 'investment'
              ? {
                  investment_commitment: form.investment_commitment.trim() || null,
                  investment_actual: form.investment_actual.trim() || null,
                  employee_commitment: form.employee_commitment.trim() || null,
                  employee_actual: form.employee_actual.trim() || null,
                }
              : { properties: form.properties.map(toPropertyPayload) };

      const res = await fetch(api(`/api/proponents/${editing.id}/${section}`), {
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
            : section === 'investment'
              ? {
                  investment_commitment: data.investment_commitment || '',
                  investment_actual: data.investment_actual || '',
                  employee_commitment: data.employee_commitment || '',
                  employee_actual: data.employee_actual || '',
                }
              : { properties: mapPropertyRows(data.properties) };
      const nextForm = { ...form, ...saved };
      setForm(nextForm);
      setLoaded((prev) =>
        prev ? { ...prev, sections: { ...prev.sections, [section]: splitForm(nextForm).sections[section] } } : prev,
      );
      toast.success(
        section === 'stockholders'
          ? 'Stockholders saved'
          : section === 'contacts'
            ? 'Contact persons and signatories saved'
            : section === 'investment'
              ? 'Investment figures saved'
              : 'Property schedule saved',
      );
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSavingSection(null);
    }
  }

  async function save() {
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
        stockholders: form.stockholders.map(toStockholderPayload),
        contact_persons: form.contact_persons.map(toContactPayload),
        signatories: form.signatories.map(toContactPayload),
        properties: form.properties.map(toPropertyPayload),
      };

      // Type of Contract lives on the proponent's current contract record,
      // which only exists once editing (create has no contract yet — see
      // Contract.setContractTypeForProponent's no-op note).
      if (editing) {
        payload.contract_type_id = form.contract_type_id ? Number(form.contract_type_id) : null;
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

      setIsCreateOpen(false);
      setError(null);
      await refresh({ showLoading: false });
      toast.success(editing ? 'Locator updated successfully' : 'Locator created successfully');
    } catch (e: any) {
      const message = e?.message || 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
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

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="glass-card p-3 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        {error && (
          <div
            className="mb-3 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}
          >
            {error}
          </div>
        )}

        {/* Search + New Locator share one row on every size. */}
        <div className="flex items-center justify-between gap-2 mb-3">
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
          <button
            className="shrink-0 h-9 rounded-lg px-3 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            onClick={openCreate}
          >
            <Plus size={15} />
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">New Locator</span>
          </button>
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
                : 'There are no locators to show here yet. Create a new locator to get started.'
            }
            action={
              !searchQuery ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={openCreate}
                >
                  Create Locator
                </button>
              ) : undefined
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
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold text-secondary tabular-nums">{p.ref_no || '—'}</span>
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
                      {p.ref_no || '—'}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {p.business_name}
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

      <SidePanel
        open={isCreateOpen}
        title={editing ? 'Locator Information' : 'New Locator'}
        subtitle="Locators master table"
        onClose={() => setIsCreateOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!canSubmit}
        saveLabel={editing ? 'Update' : 'Save'}
        footerNote={
          editing ? (
            <>
              Business Type/Industry and Encoded By are derived automatically from this locator's filed
              applications — they aren't set here. Ref No: {editing.ref_no || '—'}.
            </>
          ) : undefined
        }
        widthClassName="md:max-w-[75vw]"
      >
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
            {/* Row 1 and Row 2 share this exact column template (same track sizes, same gap,
                same column count) so their edges line up vertically — Row 2 nests
                Principal/Lease Address and TIN/SEC/Ref inside their own cells rather than
                adding extra top-level columns, which would throw off the gap math. */}
            <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1.6fr_0.7fr] gap-3">
              <div>
                <Field compact label="Locator's Name">
                  <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                    <input
                      className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                      style={{ color: 'var(--text)' }}
                      value={form.business_name}
                      onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))}
                    />
                  </div>
                </Field>
              </div>
              <div>
                <Field compact label="Account Officer">
                  <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                    <AppSelect
                      options={userOptions}
                      value={form.account_officer_id}
                      onChange={(value) => setForm((p) => ({ ...p, account_officer_id: value || '' }))}
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

            {/* Row 2: same grid-cols-[1.8fr_1.6fr_0.7fr] track sizes as Row 1 (see note above) —
                Principal/Lease Address share the first cell via a nested flex row instead of
                being separate top-level columns, so Row 1/Row 2 edges stay pixel-aligned. */}
            <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1.6fr_0.7fr] gap-3 items-stretch">
              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <div className="flex-1 flex">
                  <Field compact label="Principal Address" className="h-full flex-1">
                    <textarea
                      className="app-form-control app-form-control-sm flex-1 min-h-[4.5rem] md:min-h-0"
                      value={form.address}
                      onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    />
                  </Field>
                </div>

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
                  <div
                    className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch"
                    title={
                      !hasContract
                        ? 'Available once a contract has been issued for this locator (Approval & Issuance).'
                        : undefined
                    }
                  >
                    <AppSelect
                      options={contractTypeOptions}
                      value={form.contract_type_id}
                      onChange={(value) => setForm((p) => ({ ...p, contract_type_id: value || '' }))}
                      placeholder={hasContract ? 'Select...' : 'No contract yet'}
                      isClearable
                      isDisabled={loadingLocation || !hasContract}
                      compact
                      boxed
                      minHeight={26}
                    />
                  </div>
                  {!hasContract ? (
                    <div className="mt-0.5 text-[10px] text-secondary">
                      Available once a contract is issued (Approval &amp; Issuance).
                    </div>
                  ) : null}
                </Field>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1 min-w-0">
                    <Field compact label="TIN Number">
                      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                        <input
                          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                          style={{ color: 'var(--text)' }}
                          value={form.tin}
                          onChange={(e) => setForm((p) => ({ ...p, tin: e.target.value }))}
                        />
                      </div>
                    </Field>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Field compact label="SEC Registration">
                      <DatePicker
                        mode="single"
                        fullWidth
                        boxed
                        placeholder="Select date"
                        value={dateInputToDate(form.sec_registration_date)}
                        onChange={(d) => setForm((p) => ({ ...p, sec_registration_date: dateToDateInputValue(d) }))}
                      />
                    </Field>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Field compact label="Ref. Code">
                      <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                        <input
                          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                          style={{ color: 'var(--text)' }}
                          value={form.ref_code}
                          disabled={loadingLocation}
                          onChange={(e) => setForm((p) => ({ ...p, ref_code: e.target.value }))}
                        />
                      </div>
                    </Field>
                  </div>
                </div>
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

            {/* Row 3: Authorized | Subscribed | Paid-up | Date Signed | Start/End/Lease Term */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:flex gap-3">
              <div className="flex-1 min-w-0">
                <CapitalField
                  label="Authorized Capital Stock"
                  amount={form.authorized_capital}
                  currency={form.authorized_capital_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, authorized_capital: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, authorized_capital_currency: v }))}
                />
              </div>
              <div className="flex-[0.7] min-w-0">
                <CapitalField
                  label="Subscribed Capital"
                  amount={form.subscribed_capital}
                  currency={form.subscribed_capital_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, subscribed_capital: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, subscribed_capital_currency: v }))}
                />
              </div>
              <div className="flex-1 min-w-0">
                <CapitalField
                  label="Paid-up Capital"
                  amount={form.paid_up_capital}
                  currency={form.paid_up_capital_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, paid_up_capital: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, paid_up_capital_currency: v }))}
                />
              </div>
              <div className="flex-[0.6] min-w-0">
                <Field compact label="Date Signed">
                  <DatePicker
                    mode="single"
                    fullWidth
                    boxed
                    placeholder="Select date"
                    value={dateInputToDate(form.date_signed)}
                    onChange={(d) => setForm((p) => ({ ...p, date_signed: dateToDateInputValue(d) }))}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2 flex-[1.2] min-w-0 flex gap-1.5">
                <div className="flex-1 min-w-0">
                  <Field compact label="Start Term">
                    <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                      <input
                        className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                        style={{ color: 'var(--text)' }}
                        value={fmtDate(editing?.start_term)}
                        disabled
                        readOnly
                      />
                    </div>
                  </Field>
                </div>
                <div className="flex-1 min-w-0">
                  <Field compact label="End Term">
                    <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                      <input
                        className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                        style={{ color: 'var(--text)' }}
                        value={fmtDate(editing?.end_term)}
                        disabled
                        readOnly
                      />
                    </div>
                  </Field>
                </div>
                <div className="flex-1 min-w-0">
                  <Field compact label="Lease Term">
                    <div
                      className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch"
                      style={{ backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)' }}
                    >
                      <input
                        className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                        style={{ color: 'var(--text)' }}
                        value={editing?.lease_term || '—'}
                        disabled
                        readOnly
                      />
                    </div>
                  </Field>
                </div>
              </div>
            </div>

            {/* Row 4: Sub-Lease */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-[9px] font-semibold text-secondary uppercase tracking-widest whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={form.is_sublease}
                  disabled={loadingLocation}
                  onChange={(e) => setForm((p) => ({ ...p, is_sublease: e.target.checked }))}
                />
                Sub-Lease
              </label>
            </div>

            {/* Folder-tab strip mirroring the legacy BRIDGE system's Locator's
                Information form — only Profile has content built out so far. */}
            <div className="folders">
              <div className="tabs overflow-x-auto">
                {(['Profile', 'Stockholders Information', 'Contact Person', 'Documents', 'Investment'] as const).map((tab) => (
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
            <div className="contents">
              <div className="content">
                {activeProfileTab === 'Stockholders Information' ? (
                  <div className="flex flex-col gap-3">
                    <RowsEditor<StockholderRow>
                      rows={form.stockholders}
                      disabled={loadingLocation}
                      emptyText="No stockholders yet — use + to add one."
                      columns={[
                        { key: 'name', label: 'Stockholder Name', className: 'min-w-[14rem]' },
                        { key: 'nationality', label: 'Nationality', className: 'w-40' },
                        { key: 'subscribed', label: 'Subscribed', className: 'w-32', numeric: true },
                        { key: 'paid', label: 'Paid', className: 'w-32', numeric: true },
                        { key: 'ownership', label: 'Ownership %', className: 'w-28', numeric: true },
                      ]}
                      onChange={(next) => setForm((p) => ({ ...p, stockholders: next }))}
                      blankRow={blankStockholderRow}
                      extraActions={
                        form.stockholders.length > 0 ? (
                          <SectionSaveBar
                            label="Save Stockholders"
                            isEditing={Boolean(editing)}
                            dirty={sectionDirty.stockholders}
                            saving={savingSection === 'stockholders'}
                            disabled={saving || loadingLocation}
                            onSave={() => void saveSection('stockholders')}
                          />
                        ) : undefined
                      }
                    />
                  </div>
                ) : activeProfileTab === 'Contact Person' ? (
                  <div className="flex flex-col gap-5">
                    {/* Contact people on top, the locator's signatories below — two child tables, same tab. */}
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                        Contact Person
                      </div>
                      <RowsEditor<ContactPersonRow>
                        rows={form.contact_persons}
                        disabled={loadingLocation}
                        emptyText="No contact persons yet — use + to add one."
                        columns={[
                          { key: 'name', label: 'Contact Person', className: 'min-w-[14rem]' },
                          { key: 'designation', label: 'Designation', className: 'w-48' },
                          { key: 'contact_no', label: 'Contact No.', className: 'w-40' },
                          { key: 'email', label: 'Email Address', className: 'min-w-[14rem]' },
                        ]}
                        onChange={(next) => setForm((p) => ({ ...p, contact_persons: next }))}
                        blankRow={blankContactPersonRow}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                        Authorized Person / Signatory
                      </div>
                      <RowsEditor<SignatoryRow>
                        rows={form.signatories}
                        disabled={loadingLocation}
                        emptyText="No signatories yet — use + to add one."
                        columns={[
                          { key: 'name', label: 'Signatory', className: 'min-w-[14rem]' },
                          { key: 'designation', label: 'Designation', className: 'w-48' },
                          { key: 'contact_no', label: 'Contact No.', className: 'w-40' },
                          { key: 'email', label: 'Email Address', className: 'min-w-[14rem]' },
                        ]}
                        onChange={(next) => setForm((p) => ({ ...p, signatories: next }))}
                        blankRow={blankSignatoryRow}
                        extraActions={
                          form.contact_persons.length > 0 || form.signatories.length > 0 ? (
                            <SectionSaveBar
                              label="Save Contacts & Signatories"
                              isEditing={Boolean(editing)}
                              dirty={sectionDirty.contacts}
                              saving={savingSection === 'contacts'}
                              disabled={saving || loadingLocation}
                              onSave={() => void saveSection('contacts')}
                            />
                          ) : undefined
                        }
                      />
                    </div>
                  </div>
                ) : activeProfileTab === 'Investment' ? (
                  <div className="flex flex-col gap-4">
                    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr style={{ backgroundColor: 'var(--control-bg)' }}>
                            <th
                              className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                              style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)' }}
                            />
                            {['Commitment', 'Actual'].map((h) => (
                              <th
                                key={h}
                                className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                                style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)' }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="px-3 py-2 border-b font-semibold" style={{ borderColor: 'var(--input-border)', color: 'var(--text)' }}>
                              Investment
                            </td>
                            <td className="px-2 py-1.5 border-b" style={{ borderColor: 'var(--input-border)' }}>
                              <input
                                className="app-form-control app-form-control-sm w-full"
                                inputMode="decimal"
                                value={form.investment_commitment}
                                disabled={loadingLocation}
                                onChange={(e) => setForm((p) => ({ ...p, investment_commitment: e.target.value }))}
                              />
                            </td>
                            <td className="px-2 py-1.5 border-b" style={{ borderColor: 'var(--input-border)' }}>
                              <input
                                className="app-form-control app-form-control-sm w-full"
                                inputMode="decimal"
                                value={form.investment_actual}
                                disabled={loadingLocation}
                                onChange={(e) => setForm((p) => ({ ...p, investment_actual: e.target.value }))}
                              />
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2 font-semibold" style={{ color: 'var(--text)' }}>No. Employee</td>
                            <td className="px-2 py-1.5">
                              <input
                                className="app-form-control app-form-control-sm w-full"
                                inputMode="decimal"
                                value={form.employee_commitment}
                                disabled={loadingLocation}
                                onChange={(e) => setForm((p) => ({ ...p, employee_commitment: e.target.value }))}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                className="app-form-control app-form-control-sm w-full"
                                inputMode="decimal"
                                value={form.employee_actual}
                                disabled={loadingLocation}
                                onChange={(e) => setForm((p) => ({ ...p, employee_actual: e.target.value }))}
                              />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <SectionSaveBar
                      label="Save Investment"
                      isEditing={Boolean(editing)}
                      dirty={sectionDirty.investment}
                      saving={savingSection === 'investment'}
                      disabled={saving || loadingLocation}
                      onSave={() => void saveSection('investment')}
                    />
                  </div>
                ) : activeProfileTab !== 'Profile' ? (
                  <div className="text-xs text-secondary py-8 text-center">{activeProfileTab} — coming soon.</div>
                ) : (
                  <div className="flex flex-col gap-3">

            {/* Business Activities (left, tall) beside Grace Period/%PGRO/%PGRR/Land Use
                (right, two stacked mini-rows) — matches the legacy BRIDGE layout where
                the two sit side by side, not stacked as separate full-width rows. */}
            <div className="flex flex-col md:flex-row gap-3 items-stretch">
              <div className="flex-[0.9] flex">
                <Field compact label="Business Activities" className="h-full flex-1">
                  <textarea
                    className="app-form-control app-form-control-sm flex-1 min-h-[4.5rem] md:min-h-0"
                    value={form.business_activities}
                    disabled={loadingLocation}
                    onChange={(e) => setForm((p) => ({ ...p, business_activities: e.target.value }))}
                  />
                </Field>
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
                        <input
                          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                          style={{ color: 'var(--text)' }}
                          value={editing?.business_type || '—'}
                          disabled
                          readOnly
                          title="Derived from this locator's most recently filed application — not set here."
                        />
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

            {/* Property schedule (dbo.proponent_properties) — an inline editable
                table synced wholesale on Save, add/remove-row buttons on the right. */}
            <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
              <div className="flex-1 min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--control-bg)' }}>
                      {['No.', 'Year', 'Date From', 'Date To', 'Type of Property', 'Area (SQM)', 'Rate/SQM/MO', 'Currency', 'MGL/MO', 'Currency'].map(
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
                    {form.properties.map((row, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 border-b text-center" style={{ borderColor: 'var(--input-border)' }}>
                          {i + 1}
                        </td>
                        <td className="px-1 py-1 border-b" style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm w-16"
                            value={row.year}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? { ...r, year: e.target.value } : r)),
                              }))
                            }
                          />
                        </td>
                        <td className="px-1 py-1 border-b w-36" style={{ borderColor: 'var(--input-border)' }}>
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
                                  ri === i ? { ...r, date_from: dateToDateInputValue(d) } : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-1 py-1 border-b w-36" style={{ borderColor: 'var(--input-border)' }}>
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
                                  ri === i ? { ...r, date_to: dateToDateInputValue(d) } : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-1 py-1 border-b" style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm w-full min-w-[10rem]"
                            value={row.type_of_property}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? { ...r, type_of_property: e.target.value } : r)),
                              }))
                            }
                          />
                        </td>
                        <td className="px-1 py-1 border-b" style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm w-20"
                            value={row.area_sqm}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? { ...r, area_sqm: e.target.value } : r)),
                              }))
                            }
                          />
                        </td>
                        <td className="px-1 py-1 border-b" style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm w-24"
                            value={row.rate_sqm_mo}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) =>
                                  ri === i ? { ...r, rate_sqm_mo: formatAmountInput(e.target.value) } : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-1 py-1 border-b" style={{ borderColor: 'var(--input-border)' }}>
                          <select
                            className="app-form-control app-form-control-sm w-16"
                            value={row.rate_currency}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? { ...r, rate_currency: e.target.value } : r)),
                              }))
                            }
                          >
                            {CURRENCY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1 border-b" style={{ borderColor: 'var(--input-border)' }}>
                          <input
                            className="app-form-control app-form-control-sm w-24"
                            value={row.mgl_mo}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) =>
                                  ri === i ? { ...r, mgl_mo: formatAmountInput(e.target.value) } : r,
                                ),
                              }))
                            }
                          />
                        </td>
                        <td className="px-1 py-1 border-b" style={{ borderColor: 'var(--input-border)' }}>
                          <select
                            className="app-form-control app-form-control-sm w-16"
                            value={row.mgl_currency}
                            disabled={loadingLocation}
                            onChange={(e) =>
                              setForm((p) => ({
                                ...p,
                                properties: p.properties.map((r, ri) => (ri === i ? { ...r, mgl_currency: e.target.value } : r)),
                              }))
                            }
                          >
                            {CURRENCY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-row sm:flex-col justify-end gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={loadingLocation}
                  onClick={() => setForm((p) => ({ ...p, properties: [...p.properties, blankPropertyRow()] }))}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ backgroundColor: '#22c55e' }}
                  title="Add row"
                >
                  +
                </button>
                <button
                  type="button"
                  disabled={loadingLocation || form.properties.length === 0}
                  onClick={() => setForm((p) => ({ ...p, properties: p.properties.slice(0, -1) }))}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ backgroundColor: '#ef4444' }}
                  title="Remove last row"
                >
                  −
                </button>
                {form.properties.length > 0 && (
                  <SectionSaveBar
                    label="Save Property Schedule"
                    isEditing={Boolean(editing)}
                    dirty={sectionDirty.properties}
                    saving={savingSection === 'properties'}
                    disabled={saving || loadingLocation}
                    onSave={() => void saveSection('properties')}
                  />
                )}
              </div>
            </div>

            {/* Row 6: Advance Lease Payment | Security Deposit | Performance Security */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-2">
                <div className="text-[9px] font-semibold uppercase tracking-widest sm:text-center" style={{ color: 'var(--nav-active-bg)' }}>
                  Advance Lease Payment
                </div>
                <Field compact label="Months MGL">
                  <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
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
                  label="Amount"
                  amount={form.advance_lease_payment_amount}
                  currency={form.advance_lease_payment_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, advance_lease_payment_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, advance_lease_payment_currency: v }))}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-[9px] font-semibold uppercase tracking-widest sm:text-center" style={{ color: 'var(--nav-active-bg)' }}>
                  Security Deposit
                </div>
                <Field compact label="Months MGL">
                  <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
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
                  label="Amount"
                  amount={form.security_deposit_amount}
                  currency={form.security_deposit_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, security_deposit_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, security_deposit_currency: v }))}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-[9px] font-semibold uppercase tracking-widest sm:text-center" style={{ color: 'var(--nav-active-bg)' }}>
                  Performance Security
                </div>
                <Field compact label="Months MGL">
                  <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
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
                  label="Amount"
                  amount={form.performance_security_amount}
                  currency={form.performance_security_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, performance_security_amount: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, performance_security_currency: v }))}
                />
              </div>
            </div>

                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })()}
      </SidePanel>

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
function SectionSaveBar({
  label,
  isEditing,
  dirty,
  saving,
  disabled,
  onSave,
}: {
  label: string;
  isEditing: boolean;
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={!isEditing || !dirty || saving || disabled}
      title={saving ? 'Saving…' : label}
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
function RowsEditor<T extends { id?: number }>({
  rows,
  columns,
  disabled,
  emptyText,
  blankRow,
  onChange,
  extraActions,
}: {
  rows: T[];
  columns: { key: keyof T & string; label: string; className?: string; numeric?: boolean }[];
  disabled?: boolean;
  emptyText: string;
  blankRow: () => T;
  onChange: (next: T[]) => void;
  /** Extra buttons (e.g. a section's SectionSaveBar) stacked below +/- in the
   * same vertical column — same layout as the Profile tab's Property Schedule. */
  extraActions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
      <div className="flex-1 min-w-0 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--input-border)' }}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ backgroundColor: 'var(--control-bg)' }}>
              <th
                className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b w-10"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)' }}
              >
                No.
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-[9px] border-b"
                  style={{ borderColor: 'var(--input-border)', color: 'var(--text-muted)' }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-2 py-6 text-center text-secondary">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={row.id ?? `new-${i}`}>
                  <td className="px-2 py-1 border-b text-center" style={{ borderColor: 'var(--input-border)' }}>
                    {i + 1}
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className="px-1 py-1 border-b" style={{ borderColor: 'var(--input-border)' }}>
                      <input
                        className={cn('app-form-control app-form-control-sm w-full', c.className)}
                        inputMode={c.numeric ? 'decimal' : undefined}
                        value={String(row[c.key] ?? '')}
                        disabled={disabled}
                        onChange={(e) => {
                          const value = c.numeric ? e.target.value.replace(/[^0-9.,]/g, '') : e.target.value;
                          onChange(rows.map((r, ri) => (ri === i ? { ...r, [c.key]: value } : r)));
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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
        <button
          type="button"
          disabled={disabled || rows.length === 0}
          onClick={() => onChange(rows.slice(0, -1))}
          className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: '#ef4444' }}
          title="Remove last row"
        >
          −
        </button>
        {extraActions}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  compact,
  className,
}: {
  label: string;
  children: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', compact ? 'gap-0.5' : 'gap-1', className)}>
      <div
        className={cn(
          'shrink-0 font-semibold text-secondary uppercase tracking-widest',
          compact ? 'text-[9px]' : 'text-[11px]',
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// Vertical tab list for the SidePanel (mirrors a left-side tab-head layout),
// styled with this app's own tokens rather than any reference screenshot's colors.
function CapitalField({
  label,
  amount,
  currency,
  disabled,
  onAmountChange,
  onCurrencyChange,
}: {
  label: string;
  amount: string;
  currency: string;
  disabled?: boolean;
  onAmountChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
}) {
  return (
    <Field compact label={label}>
      {/* One bordered box for both — amount and currency are borderless
          inside it, split by a thin divider, instead of two separate fields. */}
      <div className="app-form-control app-form-control-sm flex items-stretch p-0 overflow-hidden">
        <input
          className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
          style={{ color: 'var(--text)' }}
          value={amount}
          disabled={disabled}
          placeholder="0.00"
          onChange={(e) => onAmountChange(formatAmountInput(e.target.value))}
        />
        <select
          className="shrink-0 border-0 bg-transparent outline-none px-1.5 py-1"
          style={{ color: 'var(--text)', borderLeft: '1px solid var(--input-border)', width: '4.25rem' }}
          value={currency}
          disabled={disabled}
          onChange={(e) => onCurrencyChange(e.target.value)}
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}
