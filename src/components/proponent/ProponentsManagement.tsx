import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
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
  // Contract-derived, read-only here — same "no contract yet = blank" rule
  // as the Locators List columns. contract_type_code IS settable (writes to
  // the current contract, see Contract.setContractTypeForProponent).
  start_term: string | null;
  end_term: string | null;
  lease_term: string | null;
  contract_type_code: string | null;
  contract_type_name: string | null;
  created_by: number | null;
  updated_by: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_active: number;
};

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
};

type ApplicationTypeOption = {
  code: string;
  name: string;
  is_active: number;
};

type LocatorsData = {
  proponents: ProponentRow[];
  dynamic: LocatorDynamicRow[];
  users: UserOption[];
  applicationTypes: ApplicationTypeOption[];
};

function api(path: string) {
  return path;
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
  contract_type_code: '',
};

export function ProponentsManagement() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProponentRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const { data: locatorsData, isLoading, isRevalidating, refresh } = useSessionStorageCachedResource<LocatorsData>({
    cacheKey: 'ciac.locators.v3',
    ttlMs: 5 * 60 * 1000,
    fetcher: async () => {
      const [pRes, dRes, uRes, atRes] = await Promise.all([
        fetch(api('/api/proponents'), { credentials: 'include' }),
        fetch(api('/api/proponents/locator-list'), { credentials: 'include' }),
        fetch(api('/api/users'), { credentials: 'include' }),
        fetch(api('/api/application-types'), { credentials: 'include' }),
      ]);

      const pJson = await pRes.json();
      const dJson = await dRes.json();
      const uJson = await uRes.json();
      const atJson = await atRes.json();

      if (!pRes.ok) throw new Error(pJson?.message || 'Failed to load proponents');
      if (!dRes.ok) throw new Error(dJson?.message || 'Failed to load locator list');
      if (!uRes.ok) throw new Error(uJson?.message || 'Failed to load users');
      if (!atRes.ok) throw new Error(atJson?.message || 'Failed to load application types');

      const nextProponents: ProponentRow[] = (pJson.data || []).map((p: any) => ({
        ...p,
        is_active: Number(p?.is_active) ? 1 : 0,
      }));

      const nextDynamic: LocatorDynamicRow[] = dJson.data || [];

      const nextUsers: UserOption[] = (uJson.data || []).map((u: any) => ({
        ...u,
        is_active: Number(u?.is_active) ? 1 : 0,
      }));

      const nextApplicationTypes: ApplicationTypeOption[] = atJson.data || [];

      return { proponents: nextProponents, dynamic: nextDynamic, users: nextUsers, applicationTypes: nextApplicationTypes };
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

  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        value: String(u.id),
        label: u.full_name ? `${u.full_name} (${u.username})` : u.username,
      })),
    [users],
  );
  const applicationTypes = locatorsData?.applicationTypes ?? [];
  // "TOC_"-prefixed codes are the Type of Contract entries imported into the
  // shared application_types catalog (see import-contract-types.js) —
  // distinct from the lease-type/Industry codes the same table also holds.
  const contractTypeOptions = useMemo(
    () =>
      applicationTypes
        .filter((t) => t.is_active && t.code.startsWith('TOC_'))
        .map((t) => ({ value: t.code, label: t.name })),
    [applicationTypes],
  );
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
    setIsCreateOpen(true);
  }

  // Profile fields aren't part of the bulk /api/proponents list — they're
  // fetched on demand here, only when a specific locator's panel is opened,
  // rather than pulled for every row up front.
  function openEdit(p: ProponentRow) {
    setIsCreateOpen(true);
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
          contract_type_code: data.contract_type_code || '',
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

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        user_id: form.user_id.trim() ? Number(form.user_id) : null,
        business_name: form.business_name.trim(),
        registration_no: form.registration_no.trim() || null,
        tin: form.tin.trim() || null,
        address: form.address.trim() || null,
        contact_no: form.contact_no.trim() || null,
        location: form.location.trim() || null,
      };

      // Profile fields are only settable once a locator exists (createProponent
      // deliberately keeps new-locator creation to the bare essentials above).
      if (editing) {
        Object.assign(payload, {
          ref_code: form.ref_code.trim() || null,
          lease_address: form.lease_address.trim() || null,
          account_officer_id: form.account_officer_id.trim() ? Number(form.account_officer_id) : null,
          sec_registration_date: form.sec_registration_date || null,
          date_signed: form.date_signed || null,
          grace_period: form.grace_period.trim() || null,
          is_sublease: form.is_sublease,
          sub_pgro: form.sub_pgro.trim() || null,
          sub_pgrr: form.sub_pgrr.trim() || null,
          land_use: form.land_use.trim() || null,
          extension_date: form.extension_date || null,
          extension_remarks: form.extension_remarks.trim() || null,
          authorized_capital: form.authorized_capital.trim() || null,
          authorized_capital_currency: form.authorized_capital_currency || null,
          subscribed_capital: form.subscribed_capital.trim() || null,
          subscribed_capital_currency: form.subscribed_capital_currency || null,
          paid_up_capital: form.paid_up_capital.trim() || null,
          paid_up_capital_currency: form.paid_up_capital_currency || null,
          contract_type_code: form.contract_type_code || null,
        });
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
                type="button"
                className="w-full text-left rounded-xl p-3 cursor-pointer active:bg-[var(--selected-bg)] transition-colors"
                style={{
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
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
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
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
        widthClassName="max-w-[75vw]"
      >
        {!editing ? (
          // New locator: only what createProponent actually accepts — Profile
          // fields (below) only make sense once the locator exists.
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
            <Field compact label="Business name" className="col-span-2">
              <input
                className="app-form-control app-form-control-sm"
                value={form.business_name}
                onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))}
              />
            </Field>
            <Field compact label="Linked user">
              <AppSelect
                options={userOptions}
                value={form.user_id}
                onChange={(value) => setForm((p) => ({ ...p, user_id: value || '' }))}
                placeholder="Select..."
                isClearable
                isDisabled={saving}
              />
            </Field>
            <Field compact label="Registration no">
              <input
                className="app-form-control app-form-control-sm"
                value={form.registration_no}
                onChange={(e) => setForm((p) => ({ ...p, registration_no: e.target.value }))}
              />
            </Field>
            <Field compact label="TIN">
              <input
                className="app-form-control app-form-control-sm"
                value={form.tin}
                onChange={(e) => setForm((p) => ({ ...p, tin: e.target.value }))}
              />
            </Field>
            <Field compact label="Contact no">
              <input
                className="app-form-control app-form-control-sm"
                value={form.contact_no}
                onChange={(e) => setForm((p) => ({ ...p, contact_no: e.target.value }))}
              />
            </Field>
            <Field compact label="Address" className="col-span-2">
              <input
                className="app-form-control app-form-control-sm"
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
              />
            </Field>
          </div>
        ) : (
          // Editing: same field groupings/positions as the legacy BRIDGE
          // system's Locator's Information form — one flex row per visual
          // row of the reference form, each field given a width fraction
          // matching it (no shared grid-row-height coupling between
          // differently-sized rows, which is what caused the cramped
          // overlap in an earlier attempt at this layout).
          <div className="flex flex-col gap-3">
            {/* Row 1 and Row 2 share this exact column template (same track sizes, same gap,
                same column count) so their edges line up vertically — Row 2 nests
                Principal/Lease Address and TIN/SEC/Ref inside their own cells rather than
                adding extra top-level columns, which would throw off the gap math. */}
            <div className="grid grid-cols-[1.8fr_1.6fr_0.7fr] gap-3">
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
            <div className="grid grid-cols-[1.8fr_1.6fr_0.7fr] gap-3 items-stretch">
              <div className="flex gap-3 items-stretch">
                <div className="flex-1 flex">
                  <Field compact label="Principal Address" className="h-full flex-1">
                    <textarea
                      className="app-form-control app-form-control-sm flex-1 min-h-0"
                      value={form.address}
                      onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                    />
                  </Field>
                </div>

                <div className="flex-1 flex">
                  <Field compact label="Lease Address" className="h-full flex-1">
                    <textarea
                      className="app-form-control app-form-control-sm flex-1 min-h-0"
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
                      value={form.contract_type_code}
                      onChange={(value) => setForm((p) => ({ ...p, contract_type_code: value || '' }))}
                      placeholder="Select..."
                      isClearable
                      isDisabled={loadingLocation}
                      compact
                      boxed
                      minHeight={26}
                    />
                  </div>
                </Field>
                <div className="flex gap-2">
                  <div className="flex-1">
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
                  <div className="flex-1">
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
                  <div className="flex-1">
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
                    className="app-form-control app-form-control-sm flex-1 min-h-0"
                    value={form.extension_remarks}
                    disabled={loadingLocation}
                    onChange={(e) => setForm((p) => ({ ...p, extension_remarks: e.target.value }))}
                  />
                </Field>
              </div>
            </div>

            {/* Row 3: Authorized | Subscribed | Paid-up | Date Signed | Start/End/Lease Term */}
            <div className="flex gap-3">
              <div className="flex-1">
                <CapitalField
                  label="Authorized Capital Stock"
                  amount={form.authorized_capital}
                  currency={form.authorized_capital_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, authorized_capital: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, authorized_capital_currency: v }))}
                />
              </div>
              <div className="flex-[0.7]">
                <CapitalField
                  label="Subscribed Capital"
                  amount={form.subscribed_capital}
                  currency={form.subscribed_capital_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, subscribed_capital: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, subscribed_capital_currency: v }))}
                />
              </div>
              <div className="flex-1">
                <CapitalField
                  label="Paid-up Capital"
                  amount={form.paid_up_capital}
                  currency={form.paid_up_capital_currency}
                  disabled={loadingLocation}
                  onAmountChange={(v) => setForm((p) => ({ ...p, paid_up_capital: v }))}
                  onCurrencyChange={(v) => setForm((p) => ({ ...p, paid_up_capital_currency: v }))}
                />
              </div>
              <div className="flex-[0.6]">
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
              <div className="flex-[1.2] flex gap-1.5">
                <div className="flex-1">
                  <Field compact label="Start Term">
                    <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                      <input
                        className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                        style={{ color: 'var(--text)' }}
                        value={fmtDate(editing.start_term)}
                        disabled
                        readOnly
                      />
                    </div>
                  </Field>
                </div>
                <div className="flex-1">
                  <Field compact label="End Term">
                    <div className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch">
                      <input
                        className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                        style={{ color: 'var(--text)' }}
                        value={fmtDate(editing.end_term)}
                        disabled
                        readOnly
                      />
                    </div>
                  </Field>
                </div>
                <div className="flex-1">
                  <Field compact label="Lease Term">
                    <div
                      className="app-form-control app-form-control-sm p-0 overflow-hidden flex items-stretch"
                      style={{ backgroundColor: 'color-mix(in oklab, #22c55e 18%, transparent)' }}
                    >
                      <input
                        className="flex-1 min-w-0 border-0 bg-transparent outline-none px-2 py-1"
                        style={{ color: 'var(--text)' }}
                        value={editing.lease_term || '—'}
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
          </div>
        )}
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
          onChange={(e) => onAmountChange(e.target.value)}
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
