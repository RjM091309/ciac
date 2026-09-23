import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Ban, KeyRound, LogOut, Pencil, RotateCcw, Search, ShieldCheck, ShieldOff, Smartphone, UserX, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DataTableControls } from '../ui/DataTableControls';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { AddressAutocomplete } from '../ui/AddressAutocomplete';
import { AppSelect } from '../ui/AppSelect';
import { RowActionsMenu, type RowActionItem } from '../ui/RowActionsMenu';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { loadProgressForApplications, type ProgressSummary } from '../../lib/applicationProgress';

const MENU_KEY = 'settings:locator-users';

type Role = {
  id: number;
  name: string;
  description?: string | null;
  is_active?: number;
};

type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'PENDING';

function effectiveStatus(u: { status?: AccountStatus; is_active: number }): AccountStatus {
  if (u.status === 'PENDING') return 'PENDING';
  if (u.status === 'SUSPENDED') return 'SUSPENDED';
  return u.is_active === 1 ? 'ACTIVE' : 'DEACTIVATED';
}

type UserRow = {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  is_active: number;
  status?: AccountStatus;
  is_locked?: boolean;
  totp_enabled?: number;
  created_at?: string | null;
  updated_at?: string | null;
  roles: { id: number; name: string; description?: string | null }[];
};

type UsersRolesData = {
  users: UserRow[];
  roles: Role[];
  // user_ids with a linked, active business profile — "Registered
  // Businesses" on the dashboard counts proponent (business) records, not
  // locator login accounts, so filtering by account status alone doesn't
  // reproduce that number (a Pending-login account can already have an
  // active business on file, and an Active account can have none yet).
  // Plain array, not a Set — useSessionStorageCachedResource round-trips
  // this through JSON via sessionStorage, and JSON.stringify(Set) -> "{}".
  activeBusinessUserIds: number[];
  applicationTypes: { code: string; name: string }[];
  // Company/application info for the merged 1-account-1-application flow —
  // keyed by user_id (via the linked proponent) so each row can show which
  // business and application it created together.
  companyByUserId: Record<number, string>;
  applicationByUserId: Record<number, { id: number; application_no: string; application_type: string; status: string }>;
};

function api(path: string) {
  return path;
}

// This page is the Locator counterpart to UsersManagement — same `users`
// table and API, filtered to the Locator role only so locator accounts don't
// mix with staff accounts in the same list.
function isLocatorRoleName(name: string) {
  return String(name || '').trim().toUpperCase() === 'PROPONENT';
}

export function LocatorUsersManagement({
  locationSearch = '',
  navigate,
}: {
  locationSearch?: string;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
} = {}) {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const canAdd = fullAccess || perm.can_add;
  const canEdit = fullAccess || perm.can_edit;
  const canDelete = fullAccess || perm.can_delete;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  // A DRAFT application has nowhere else to be finished now that New
  // Application's own create/continue flow is gone — clicking a draft's
  // Company/Locator cell (or its "Draft ->" button) opens this instead of
  // navigating to Assessment (which excludes drafts entirely). Shows the
  // same field set as New Locator Account (for context — the account and
  // profile are already fixed at this point, read-only here); only
  // Application Type is actually editable, mirroring
  // ApplicationsWorkflow.tsx's openContinueDraft/submitApplication.
  const [continuingDraft, setContinuingDraft] = useState<{
    id: number;
    userId: number;
    application_no: string;
    application_type: string;
    username: string;
    full_name: string;
    email: string;
    business_name: string;
    address: string;
    lease_address: string;
    contact_no: string;
  } | null>(null);
  const [continuingDraftType, setContinuingDraftType] = useState('DIRECT_LEASE');
  const [continuingDraftSaving, setContinuingDraftSaving] = useState(false);
  const [continuingDraftLoadingProfile, setContinuingDraftLoadingProfile] = useState(false);
  const [continuingDraftFieldErrors, setContinuingDraftFieldErrors] = useState<{ username?: string; email?: string }>({});
  // Pre-applied when landing here from the dashboard's "Registered
  // Businesses" card (?status=ACTIVE) so the list is already scoped instead
  // of showing every status (active/pending/suspended/deactivated) mixed
  // together. Stays active until the officer clears it.
  const [statusFilterCodes, setStatusFilterCodes] = useState<AccountStatus[]>([]);
  // Separate dimension from statusFilterCodes: "has a registered business",
  // matching the dashboard's "Registered Businesses" count (proponent
  // records), not the locator's own login/account status.
  const [hasBusinessFilter, setHasBusinessFilter] = useState(false);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [confirmSuspendId, setConfirmSuspendId] = useState<number | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
  const [confirmResetPasswordId, setConfirmResetPasswordId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const { data: usersRoles, isLoading, isRevalidating, refresh } = useSessionStorageCachedResource<UsersRolesData>({
    cacheKey: 'ciac.users_roles.v1',
    ttlMs: 5 * 60 * 1000, // 5 minutes — shares the cache key with UsersManagement since it's the same underlying data
    fetcher: async () => {
      setError(null);
      const [uRes, rRes, pRes, tRes, aRes] = await Promise.all([
        fetch(api('/api/users'), { credentials: 'include' }),
        fetch(api('/api/roles'), { credentials: 'include' }),
        fetch(api('/api/proponents'), { credentials: 'include' }),
        fetch(api('/api/application-types'), { credentials: 'include' }),
        fetch(api('/api/applications'), { credentials: 'include' }),
      ]);

      const uJson = await uRes.json();
      const rJson = await rRes.json();
      const pJson = await pRes.json().catch(() => ({}));
      const tJson = await tRes.json().catch(() => ({}));
      const aJson = await aRes.json().catch(() => ({}));

      if (!uRes.ok) throw new Error(uJson?.message || 'Failed to load users');
      if (!rRes.ok) throw new Error(rJson?.message || 'Failed to load roles');

      const proponentRows: any[] = pRes.ok && Array.isArray(pJson?.data) ? pJson.data : [];

      const activeBusinessUserIds = Array.from(
        new Set<number>(
          proponentRows.filter((p) => Number(p?.is_active) && p?.user_id != null).map((p) => Number(p.user_id))
        )
      );

      const applicationTypes = (tRes.ok && Array.isArray(tJson?.data) ? tJson.data : [])
        .filter((t: any) => Number(t?.is_active) === 1)
        .map((t: any) => ({ code: String(t.code), name: String(t.name) }));

      // 1 account = 1 application — created together, so each user_id maps
      // to at most one proponent and at most one application. Built here
      // once (rather than searched per row) since this page can list
      // hundreds of accounts.
      const proponentIdByUserId = new Map<number, number>();
      const companyByUserId: Record<number, string> = {};
      for (const p of proponentRows) {
        if (p?.user_id == null) continue;
        proponentIdByUserId.set(Number(p.user_id), Number(p.id));
        companyByUserId[Number(p.user_id)] = String(p.business_name || '');
      }

      const applicationRows: any[] = aRes.ok && Array.isArray(aJson?.data) ? aJson.data : [];
      const applicationByProponentId = new Map<
        number,
        { id: number; application_no: string; application_type: string; status: string }
      >();
      for (const a of applicationRows) {
        if (a?.proponent_id == null) continue;
        applicationByProponentId.set(Number(a.proponent_id), {
          id: Number(a.id),
          application_no: String(a.application_no || ''),
          application_type: String(a.application_type || ''),
          status: String(a.status || ''),
        });
      }
      const applicationByUserId: Record<
        number,
        { id: number; application_no: string; application_type: string; status: string }
      > = {};
      for (const [userId, proponentId] of proponentIdByUserId) {
        const app = applicationByProponentId.get(proponentId);
        if (app) applicationByUserId[userId] = app;
      }

      return {
        users: (uJson.data || []).map((u: any) => ({
          ...u,
          is_active: Number(u?.is_active) ? 1 : 0,
          totp_enabled: Number(u?.totp_enabled) ? 1 : 0,
        })),
        roles: rJson.data || [],
        activeBusinessUserIds,
        applicationTypes,
        companyByUserId,
        applicationByUserId,
      };
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : 'Failed to load data';
      setError(message);
      toast.error(message);
    },
  });

  const allRoles = usersRoles?.roles ?? [];
  const applicationTypeOptions = usersRoles?.applicationTypes ?? [];
  const companyByUserId = usersRoles?.companyByUserId ?? {};
  const applicationByUserId = usersRoles?.applicationByUserId ?? {};
  const applicationTypeNameByCode = useMemo(
    () => Object.fromEntries(applicationTypeOptions.map((t) => [t.code, t.name])),
    [applicationTypeOptions]
  );
  const activeBusinessUserIds = useMemo(
    () => new Set<number>(usersRoles?.activeBusinessUserIds ?? []),
    [usersRoles?.activeBusinessUserIds]
  );
  const locatorRole = useMemo(() => allRoles.find((r) => isLocatorRoleName(r.name)) || null, [allRoles]);

  // A genuine locator account always holds exactly one role (Locator) — the
  // New Locator Account form only ever assigns that single role_id. Matching
  // "holds Locator among possibly several roles" instead would also sweep in
  // a multi-role staff account (e.g. admin also holding Proponent, for the
  // dashboard role-preview switcher) that isn't really a locator.
  const userRows = (Array.isArray(usersRoles?.users) ? usersRoles.users : []).filter(
    (u) => (u.roles || []).length === 1 && isLocatorRoleName(u.roles[0].name)
  );

  const [form, setForm] = useState({
    username: '',
    email: '',
    full_name: '',
    business_name: '',
    address: '',
    lease_address: '',
    contact_no: '',
    application_type: 'DIRECT_LEASE',
    save_as_draft: false,
  });
  const [originalForm, setOriginalForm] = useState<typeof form | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  // Inline, field-level validation errors (e.g. "username already taken") —
  // shown under the offending field itself instead of a toast leaking the
  // raw SQL constraint message, matching ChangePasswordModal's pattern. Also
  // populated live (debounced, while typing) via /api/users/check-availability
  // instead of only surfacing on Save, which the whole point of this is to
  // avoid — nobody should have to submit the form just to find out.
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; email?: string }>({});
  const [checkingField, setCheckingField] = useState<'username' | 'email' | null>(null);

  function useAvailabilityCheck(field: 'username' | 'email', value: string) {
    useEffect(() => {
      const trimmed = value.trim();
      // Unchanged from the account being edited — it already "owns" this
      // value, so there's nothing to check.
      if (editing && trimmed === (originalForm?.[field] || '').trim()) return;
      if (!trimmed) return;
      if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;

      let cancelled = false;
      const timer = window.setTimeout(async () => {
        setCheckingField(field);
        try {
          const params = new URLSearchParams({ field, value: trimmed });
          if (editing) params.set('excludeUserId', String(editing.id));
          const res = await fetch(api(`/api/users/check-availability?${params.toString()}`), { credentials: 'include' });
          const json = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (res.ok && json?.available === false) {
            setFieldErrors((p) => ({ ...p, [field]: `That ${field} is already taken.` }));
          } else {
            setFieldErrors((p) => ({ ...p, [field]: undefined }));
          }
        } catch {
          // Non-fatal — Save still catches a genuine duplicate server-side.
        } finally {
          if (!cancelled) setCheckingField((p) => (p === field ? null : p));
        }
      }, 500);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [field, value, editing]);
  }
  useAvailabilityCheck('username', form.username);
  useAvailabilityCheck('email', form.email);

  const stats = useMemo(() => {
    const active = userRows.filter((u) => u.is_active === 1).length;
    const suspended = userRows.filter((u) => u.status === 'SUSPENDED').length;
    const inactive = userRows.filter((u) => u.is_active === 0).length;
    return { active, suspended, inactive, total: userRows.length };
  }, [userRows]);

  const filteredUsers = useMemo(() => {
    let base = statusFilterCodes.length
      ? userRows.filter((u) => statusFilterCodes.includes(effectiveStatus(u)))
      : userRows;
    if (hasBusinessFilter) {
      base = base.filter((u) => activeBusinessUserIds.has(u.id));
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((u) => {
      const statusStr = u.status === 'SUSPENDED' ? 'suspended' : u.is_active === 1 ? 'active' : 'deactivated inactive';
      return (
        (u.username || '').toLowerCase().includes(q) ||
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        statusStr.includes(q)
      );
    });
  }, [userRows, searchQuery, statusFilterCodes, hasBusinessFilter, activeBusinessUserIds]);

  useEffect(() => {
    const search = String(locationSearch || '').trim();
    if (!search) return;
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const raw = params.get('status');
    if (raw) {
      const codes = raw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s): s is AccountStatus => ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING'].includes(s));
      if (codes.length) setStatusFilterCodes(codes);
    }
    if (params.get('hasBusiness') === '1') setHasBusinessFilter(true);
    // Runs once on mount to consume the deep-link filter — intentionally not
    // re-syncing on every locationSearch change so clearing the chip sticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = useMemo(() => {
    const count = Math.max(1, Math.ceil(filteredUsers.length / Math.max(1, pageSize)));
    return count;
  }, [filteredUsers.length, pageSize]);

  const pagedUsers = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, page, pageSize, totalPages]);

  // Requirements-verification progress for the linked application of each
  // VISIBLE row only (not the full filtered set) — same computation
  // ApplicationsWorkflow.tsx uses, but this page can list hundreds of
  // accounts, so it's scoped to the current page to avoid firing that many
  // parallel requirement/document fetches at once.
  const [progressByApp, setProgressByApp] = useState<Record<number, ProgressSummary>>({});
  useEffect(() => {
    const appIds = Array.from(
      new Set(pagedUsers.map((u) => applicationByUserId[u.id]?.id).filter((id): id is number => Boolean(id)))
    );
    let cancelled = false;
    loadProgressForApplications(appIds, api)
      .then((next) => {
        if (!cancelled) setProgressByApp(next);
      })
      .catch(() => {
        // keep the table usable even if the progress fetch fails
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagedUsers]);

  const showingRange = useMemo(() => {
    if (filteredUsers.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    const from = (safePage - 1) * pageSize + 1;
    const to = Math.min(filteredUsers.length, safePage * pageSize);
    return { from, to };
  }, [filteredUsers.length, page, pageSize, totalPages]);

  const visiblePageNumbers = useMemo(() => {
    const current = Math.min(Math.max(1, page), totalPages);
    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [page, totalPages]);

  const canSubmit = useMemo(() => {
    const username = form.username.trim();
    const email = form.email.trim();
    const fullName = form.full_name.trim();

    if (!username) return false;
    if (!email) return false;
    if (!locatorRole) return false;
    if (fieldErrors.username || fieldErrors.email) return false;
    if (checkingField) return false;

    // Business name is what actually triggers creating/updating the linked
    // proponent profile server-side — address/contact without it would
    // silently go nowhere, so require it once any of them is filled in.
    if (
      (form.address.trim() || form.lease_address.trim() || form.contact_no.trim()) &&
      !form.business_name.trim()
    )
      return false;

    if (!editing) {
      // A locator account created without a business profile lands the
      // locator on the first-login setup wizard instead of the dashboard —
      // requiring the profile up front here skips that extra step entirely.
      // The 1:1 account-to-application rule means creating one always
      // creates the other, so application_type is required too.
      return Boolean(
        username &&
          email &&
          form.business_name.trim() &&
          form.contact_no.trim() &&
          form.address.trim() &&
          form.application_type.trim()
      );
    }

    if (!originalForm) return false;
    return (
      username !== originalForm.username.trim() ||
      email !== originalForm.email.trim() ||
      fullName !== originalForm.full_name.trim() ||
      form.business_name.trim() !== originalForm.business_name.trim() ||
      form.address.trim() !== originalForm.address.trim() ||
      form.lease_address.trim() !== originalForm.lease_address.trim() ||
      form.contact_no.trim() !== originalForm.contact_no.trim()
    );
  }, [editing, form, locatorRole, originalForm, fieldErrors, checkingField]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function openCreate() {
    setEditing(null);
    setOriginalForm(null);
    setFieldErrors({});
    setForm({
      username: '',
      email: '',
      full_name: '',
      business_name: '',
      address: '',
      lease_address: '',
      contact_no: '',
      application_type: 'DIRECT_LEASE',
      save_as_draft: false,
    });
    setIsCreateOpen(true);
  }

  async function openEdit(u: UserRow) {
    setIsCreateOpen(true);
    setEditing(u);
    setFieldErrors({});
    const baseline = {
      username: u.username || '',
      email: u.email || '',
      full_name: u.full_name || '',
      business_name: '',
      address: '',
      lease_address: '',
      contact_no: '',
      // Application-filing fields don't apply on edit (an account's linked
      // application isn't created/changed here) — kept only so `form` has
      // one consistent shape between create and edit.
      application_type: 'DIRECT_LEASE',
      save_as_draft: false,
    };
    setForm(baseline);
    setOriginalForm(baseline);

    setLoadingProfile(true);
    try {
      const res = await fetch(api(`/api/users/${u.id}`), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.data) {
        const withProfile = {
          ...baseline,
          business_name: json.data.business_name || '',
          address: json.data.address || '',
          lease_address: json.data.lease_address || '',
          contact_no: json.data.contact_no || '',
        };
        setForm(withProfile);
        setOriginalForm(withProfile);
      }
    } catch {
      // Plain user fields still work — business profile just stays blank.
    } finally {
      setLoadingProfile(false);
    }
  }

  async function save() {
    if (!locatorRole) {
      toast.error('No Locator role found — set it up in Manage Roles first.');
      return;
    }
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      if (!editing) {
        // Locator Accounts + New Application, merged into one step (the
        // business confirmed 1 account = 1 application) — this single call
        // creates the login account, its business profile, AND its first
        // application together, instead of two separate flows.
        const payload = {
          username: form.username.trim(),
          email: form.email.trim(),
          full_name: form.full_name.trim() || null,
          role_id: locatorRole.id,
          business_name: form.business_name.trim(),
          address: form.address.trim(),
          lease_address: form.lease_address.trim() || undefined,
          contact_no: form.contact_no.trim(),
          application_type: form.application_type,
          save_as_draft: form.save_as_draft,
        };

        if (!payload.username) throw new Error('Username is required');
        if (!payload.email) throw new Error('Email is required');
        if (!payload.business_name) throw new Error('Business name is required');
        if (!payload.contact_no) throw new Error('Contact number is required');
        if (!payload.address) throw new Error('Business address is required');
        if (!payload.application_type) throw new Error('Application type is required');

        const res = await fetch(api('/api/users/locator-with-application'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw Object.assign(new Error(json?.message || 'Save failed'), { field: json?.field });
        }

        setIsCreateOpen(false);
        await refresh({ showLoading: false });
        if (form.save_as_draft) {
          toast.success(json.message || 'Locator account and draft application created.');
        } else if (json.emailSent) {
          toast.success(json.message || 'Locator account and application created — a temporary password was emailed.');
        } else {
          toast.warning(json.message || 'Locator account and application created, but the email could not be sent.');
        }
        return;
      }

      // Edit stays a plain account/profile update — no application involved.
      const payload: any = {
        username: form.username.trim(),
        email: form.email.trim(),
        full_name: form.full_name.trim() || null,
        role_id: locatorRole.id,
      };
      payload.business_name = form.business_name.trim() || undefined;
      payload.address = form.address.trim() || undefined;
      payload.lease_address = form.lease_address.trim() || undefined;
      payload.contact_no = form.contact_no.trim() || undefined;
      // No password field on this form: the backend generates one and emails
      // it when none is supplied, same as an admin-triggered reset.

      if (!payload.username) throw new Error('Username is required');
      if (!payload.email) throw new Error('Email is required');

      const res = await fetch(api(`/api/users/${editing.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw Object.assign(new Error(json?.message || 'Save failed'), { field: json?.field });
      }

      setIsCreateOpen(false);
      await refresh({ showLoading: false });
      toast.success('Locator account updated successfully');
    } catch (e: any) {
      const message = e?.message || 'Save failed';
      if (e?.field === 'username' || e?.field === 'email') {
        // Inline only, under the offending field — no toast, matching
        // ChangePasswordModal's pattern, since a raw "duplicate key" toast
        // just repeats what the field itself now shows more usefully.
        setFieldErrors({ [e.field]: message });
      } else {
        setError(message);
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/deactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      await refresh({ showLoading: false });
      toast.success('Locator account deactivated successfully');
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
      const res = await fetch(api(`/api/users/${id}/reactivate`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reactivate failed');
      await refresh({ showLoading: false });
      toast.success('Locator account reactivated successfully');
      setConfirmReactivateId(null);
    } catch (e: any) {
      const message = e?.message || 'Reactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function suspend(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/suspend`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Suspend failed');
      await refresh({ showLoading: false });
      toast.success('Locator account suspended');
      setConfirmSuspendId(null);
    } catch (e: any) {
      const message = e?.message || 'Suspend failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function unsuspend(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/unsuspend`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Unsuspend failed');
      await refresh({ showLoading: false });
      toast.success('Locator account reinstated');
    } catch (e: any) {
      const message = e?.message || 'Unsuspend failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function revokeSessions(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/revoke-sessions`), { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to revoke sessions');
      toast.success('Active sessions revoked — the locator must log in again');
      setConfirmRevokeId(null);
    } catch (e: any) {
      const message = e?.message || 'Failed to revoke sessions';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  /** Generates a temp password server-side, emails it, and forces the
   * locator to set their own password on next login. */
  async function resetPassword(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/users/${id}/reset-password`), { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to reset password');
      if (json.emailSent) {
        toast.success(json.message || 'Password reset — a new temporary password was emailed.');
      } else {
        toast.warning(json.message || 'Password reset, but the email could not be sent.');
      }
      setConfirmResetPasswordId(null);
    } catch (e: any) {
      const message = e?.message || 'Failed to reset password';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function renderStatusBadges(u: UserRow) {
    return (
      <>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={
            u.status === 'PENDING'
              ? { backgroundColor: 'rgba(59,130,246,.14)', color: 'rgba(59,130,246,.95)' }
              : u.status === 'SUSPENDED'
                ? { backgroundColor: 'rgba(245,158,11,.14)', color: 'rgba(245,158,11,.95)' }
                : u.is_active === 1
                  ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
                  : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' }
          }
          title={u.status === 'PENDING' ? 'Created but not yet activated — activates automatically when their first application is submitted.' : undefined}
        >
          {u.status === 'PENDING'
            ? 'Pending activation'
            : u.status === 'SUSPENDED'
              ? 'Suspended'
              : u.is_active === 1
                ? 'Active'
                : 'Deactivated'}
        </span>
        {u.is_locked && (
          <span
            className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: 'rgba(239,68,68,.14)', color: 'rgba(239,68,68,.95)' }}
            title="Locked out from repeated failed login attempts"
          >
            Locked
          </span>
        )}
      </>
    );
  }

  // Same destination ApplicationsWorkflow.tsx's own goToApplication() uses —
  // a locator account's linked application is opened the same way whether
  // you got there from the Applications queue or from Locator Accounts.
  // DRAFT is the one exception: Assessment excludes drafts entirely, so
  // that click opens the Continue Draft panel instead.
  function goToApplication(u: UserRow, app: { id: number; application_no: string; application_type: string; status: string }) {
    if (app.status === 'DRAFT') {
      setContinuingDraft({
        id: app.id,
        userId: u.id,
        application_no: app.application_no,
        application_type: app.application_type,
        username: u.username,
        full_name: u.full_name || '',
        email: u.email || '',
        business_name: companyByUserId[u.id] || '',
        address: '',
        lease_address: '',
        contact_no: '',
      });
      setContinuingDraftType(app.application_type || 'DIRECT_LEASE');
      setContinuingDraftFieldErrors({});
      // Business profile fields aren't part of the bulk /api/users list —
      // same on-demand fetch openEdit() uses, so the panel doesn't have to
      // wait on them before opening.
      setContinuingDraftLoadingProfile(true);
      fetch(api(`/api/users/${u.id}`), { credentials: 'include' })
        .then((res) => res.json())
        .then((json) => {
          if (!json?.data) return;
          setContinuingDraft((prev) =>
            prev && prev.id === app.id
              ? {
                  ...prev,
                  address: json.data.address || '',
                  lease_address: json.data.lease_address || '',
                  contact_no: json.data.contact_no || '',
                }
              : prev
          );
        })
        .catch(() => {})
        .finally(() => setContinuingDraftLoadingProfile(false));
      return;
    }
    navigate?.(`/assessment?applicationId=${app.id}&tab=Compliance`);
  }

  async function saveContinueDraft(submit: boolean) {
    if (!continuingDraft) return;
    setContinuingDraftSaving(true);
    setContinuingDraftFieldErrors({});
    try {
      // Still a draft, so unlike the account/business fields shown read-only
      // everywhere else, these are genuinely fixable here — same PUT the
      // Edit Locator Account form itself uses.
      const userRes = await fetch(api(`/api/users/${continuingDraft.userId}`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: continuingDraft.username.trim(),
          email: continuingDraft.email.trim(),
          full_name: continuingDraft.full_name.trim() || null,
          business_name: continuingDraft.business_name.trim() || undefined,
          address: continuingDraft.address.trim() || undefined,
          lease_address: continuingDraft.lease_address.trim() || undefined,
          contact_no: continuingDraft.contact_no.trim() || undefined,
        }),
      });
      const userJson = await userRes.json().catch(() => ({}));
      if (!userRes.ok) {
        throw Object.assign(new Error(userJson?.message || 'Failed to update account'), { field: userJson?.field });
      }

      const patchRes = await fetch(api(`/api/applications/${continuingDraft.id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_type: continuingDraftType }),
      });
      const patchJson = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok || !patchJson?.success) throw new Error(patchJson?.message || 'Failed to update draft');

      if (submit) {
        const submitRes = await fetch(api(`/api/applications/${continuingDraft.id}/submit`), {
          method: 'PATCH',
          credentials: 'include',
        });
        const submitJson = await submitRes.json().catch(() => ({}));
        if (!submitRes.ok || !submitJson?.success) throw new Error(submitJson?.message || 'Failed to submit application');
        toast.success(`Application ${submitJson?.data?.application_no || continuingDraft.application_no} submitted`);
        if (submitJson?.locatorActivated) {
          toast.success(
            submitJson?.locatorEmailSent
              ? 'Locator account activated — login was emailed to them.'
              : 'Locator account activated, but the email could not be sent — check the server console for the temporary password.'
          );
        }
      } else {
        toast.success(`Draft ${patchJson?.data?.application_no || continuingDraft.application_no} updated`);
      }

      setContinuingDraft(null);
      await refresh({ showLoading: false });
    } catch (e: any) {
      const message = e?.message || 'Failed to update draft';
      if (e?.field === 'username' || e?.field === 'email') {
        setContinuingDraftFieldErrors({ [e.field]: message });
      } else {
        toast.error(message);
      }
    } finally {
      setContinuingDraftSaving(false);
    }
  }

  function renderUserActions(u: UserRow) {
    const statusActions: (RowActionItem | null)[] =
      u.is_active === 1
        ? [
            canDelete
              ? { key: 'suspend', label: 'Suspend', icon: Ban, onClick: () => setConfirmSuspendId(u.id), disabled: saving }
              : null,
            canDelete
              ? {
                  key: 'deactivate',
                  label: 'Deactivate',
                  icon: UserX,
                  onClick: () => setConfirmDeactivateId(u.id),
                  disabled: saving,
                  danger: true,
                }
              : null,
            canEdit
              ? {
                  key: 'revoke',
                  label: 'Revoke sessions',
                  icon: LogOut,
                  onClick: () => setConfirmRevokeId(u.id),
                  disabled: saving,
                }
              : null,
          ]
        : u.status === 'SUSPENDED'
          ? [
              canEdit
                ? { key: 'unsuspend', label: 'Lift suspension', icon: RotateCcw, onClick: () => void unsuspend(u.id), disabled: saving }
                : null,
            ]
          : u.status === 'PENDING'
            ? [] // Reactivating here would just flip is_active without ever
              // generating/emailing a real password — this account's
              // placeholder password was never sent to anyone. Only the
              // New Application flow (which does both) may activate it.
            : [
                canEdit
                  ? {
                      key: 'reactivate',
                      label: 'Reactivate',
                      icon: RotateCcw,
                      onClick: () => setConfirmReactivateId(u.id),
                      disabled: saving,
                    }
                  : null,
              ];

    return (
      <RowActionsMenu
        ariaLabel={`Actions for ${u.username}`}
        actions={[
          canEdit ? { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => openEdit(u), disabled: saving } : null,
          canEdit
            ? {
                key: 'reset-password',
                label: u.status === 'PENDING' ? 'Resend account email' : 'Reset password',
                icon: KeyRound,
                onClick: () => setConfirmResetPasswordId(u.id),
                disabled: saving,
              }
            : null,
          ...statusActions,
        ]}
      />
    );
  }

  // A DRAFT application is unfinished — the one thing worth doing is
  // finishing it, so that's surfaced directly (matching
  // ApplicationsWorkflow.tsx's own "Draft →" treatment) instead of being
  // buried inside the "..." menu alongside unrelated account actions.
  function renderRowActions(u: UserRow) {
    const app = applicationByUserId[u.id];
    if (app?.status === 'DRAFT') {
      return (
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1 rounded-lg h-8 px-2.5 text-[10px] font-bold uppercase tracking-wide cursor-pointer"
          style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
          onClick={() => goToApplication(u, app)}
        >
          Draft <ArrowRight size={12} />
        </button>
      );
    }
    return renderUserActions(u);
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-4 gap-2 sm:gap-4 mt-3">
        <StatCard label="Active Accounts" value={String(stats.active)} />
        <StatCard label="Total Accounts" value={String(stats.total)} />
        <StatCard label="Suspended" value={String(stats.suspended)} />
        <StatCard label="Deactivated" value={String(stats.inactive)} />
      </div>

      <div
        className="glass-card p-4 sm:p-5 !border-transparent"
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Locator Account List
          </h3>
          {canAdd ? (
            <button
              className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              onClick={openCreate}
              disabled={!locatorRole}
              title={locatorRole ? undefined : 'No Locator role found — set it up in Manage Roles first.'}
            >
              + New Record
            </button>
          ) : null}
        </div>

        {error && (
          <div className="mb-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div className="relative group w-full sm:w-72">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search locator accounts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
          </div>
          {statusFilterCodes.length > 0 ? (
            <button
              type="button"
              onClick={() => setStatusFilterCodes([])}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold cursor-pointer shrink-0"
              style={{ backgroundColor: 'rgba(59,130,246,.14)', color: '#3b82f6', border: '1px solid rgba(59,130,246,.38)' }}
              title="Clear status filter"
            >
              Filtered: {statusFilterCodes.map((c) => c.charAt(0) + c.slice(1).toLowerCase()).join(', ')}
              <X size={12} />
            </button>
          ) : null}
          {hasBusinessFilter ? (
            <button
              type="button"
              onClick={() => setHasBusinessFilter(false)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold cursor-pointer shrink-0"
              style={{ backgroundColor: 'rgba(59,130,246,.14)', color: '#3b82f6', border: '1px solid rgba(59,130,246,.38)' }}
              title="Clear filter"
            >
              Filtered: Has registered business
              <X size={12} />
            </button>
          ) : null}
        </div>

        {isLoading ? (
          <div className="py-2">
            <TableSkeleton columns={5} rows={5} />
          </div>
        ) : filteredUsers.length === 0 ? (
          <EmptyState
            title="No locator accounts found"
            description={
              searchQuery
                ? 'Try adjusting your search filters.'
                : 'There are no locator accounts to show here yet. Create one to get started.'
            }
            action={
              !searchQuery && canAdd ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={openCreate}
                  disabled={!locatorRole}
                >
                  Create Locator Account
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
          {/* Phones: one card per account instead of a 6-column table */}
          <div className="sm:hidden space-y-2">
            {pagedUsers.map((u) => (
              <div
                key={u.id}
                className="rounded-xl p-3"
                style={{
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold leading-snug break-words" style={{ color: 'var(--text)' }}>
                      {u.full_name || u.username}
                    </div>
                    <div className="mt-0.5 text-[11px] text-secondary break-all">@{u.username}</div>
                    {u.email ? <div className="text-[11px] text-secondary break-all">{u.email}</div> : null}
                  </div>
                  <div className="shrink-0 flex flex-wrap justify-end gap-1 max-w-[45%]">{renderStatusBadges(u)}</div>
                </div>

                {companyByUserId[u.id] ? (
                  <div
                    className="mt-2 pt-2 border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="text-[9px] uppercase tracking-wider text-secondary mb-1">Company / Locator</div>
                    {applicationByUserId[u.id] ? (
                      <button
                        type="button"
                        className="w-full text-left cursor-pointer rounded-md -mx-1.5 -my-1 px-1.5 py-1 transition-colors hover:bg-[var(--control-bg)] active:bg-[var(--selected-bg)]"
                        onClick={() => goToApplication(u, applicationByUserId[u.id])}
                      >
                        <div className="text-[12px] font-semibold break-words" style={{ color: 'var(--text)' }}>
                          {companyByUserId[u.id]}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-secondary">{applicationByUserId[u.id].application_no}</span>
                          <span
                            className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium"
                            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                          >
                            {applicationTypeNameByCode[applicationByUserId[u.id].application_type] ||
                              applicationByUserId[u.id].application_type}
                          </span>
                        </div>
                      </button>
                    ) : (
                      <div className="text-[12px] font-semibold break-words" style={{ color: 'var(--text)' }}>
                        {companyByUserId[u.id]}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    {u.totp_enabled === 1 ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }}
                      >
                        <ShieldCheck size={11} /> 2FA
                      </span>
                    ) : (
                      <span className="text-[10px] text-secondary">2FA off</span>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-0.5 -mr-1.5">{renderRowActions(u)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['Company / Locator', 'Username', 'Full Name', 'Email', 'Application Type', '2FA', 'Status', 'Progress', 'Actions'].map((col) => (
                    <th
                      key={col}
                      className={cn(
                        'px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b',
                        col === 'Actions' && 'text-right pr-2'
                      )}
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((u) => (
                  <tr key={u.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px]">
                      {companyByUserId[u.id] ? (
                        applicationByUserId[u.id] ? (
                          <button
                            type="button"
                            className="text-left cursor-pointer rounded-md -mx-1.5 -my-1 px-1.5 py-1 transition-colors hover:bg-[var(--control-bg)] active:bg-[var(--selected-bg)]"
                            onClick={() => goToApplication(u, applicationByUserId[u.id])}
                          >
                            <div className="font-semibold" style={{ color: 'var(--text)' }}>{companyByUserId[u.id]}</div>
                            <div className="mt-0.5 text-secondary">{applicationByUserId[u.id].application_no}</div>
                          </button>
                        ) : (
                          <div style={{ color: 'var(--text)' }}>{companyByUserId[u.id]}</div>
                        )
                      ) : (
                        <span className="text-secondary">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>
                      {u.username}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{u.full_name || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{u.email || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">
                      {applicationByUserId[u.id]
                        ? applicationTypeNameByCode[applicationByUserId[u.id].application_type] ||
                          applicationByUserId[u.id].application_type
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {u.totp_enabled === 1 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }}
                        >
                          <ShieldCheck size={11} /> On
                        </span>
                      ) : (
                        <span className="text-secondary">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {renderStatusBadges(u)}
                    </td>
                    <td className="px-3 py-2 text-[11px] min-w-[150px]">
                      {applicationByUserId[u.id] ? (
                        (() => {
                          const percent = progressByApp[applicationByUserId[u.id].id]?.percent ?? 0;
                          const barColor = percent >= 100 ? '#10b981' : percent >= 50 ? '#3b82f6' : '#f59e0b';
                          return (
                            <div className="flex items-center gap-2">
                              <div className="h-2 rounded-full overflow-hidden w-[90px]" style={{ backgroundColor: 'var(--input-border)' }}>
                                <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, backgroundColor: barColor }} />
                              </div>
                              <span className="font-semibold">{percent}%</span>
                            </div>
                          );
                        })()
                      ) : (
                        <span className="text-secondary">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 pr-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {renderRowActions(u)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

            <DataTableControls
              page={page}
              totalPages={totalPages}
              totalItems={filteredUsers.length}
              showingFrom={showingRange.from}
              showingTo={showingRange.to}
              visiblePageNumbers={visiblePageNumbers}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100, 200]}
              onPageSizeChange={(value) => setPageSize(value)}
              onPageChange={(p) => setPage(p)}
              loading={isLoading || isRevalidating}
            />
          </>
        )}
      </div>

      <SidePanel
        open={isCreateOpen}
        title={editing ? 'Edit Locator Account' : 'New Locator Account'}
        subtitle="Users table, locked to the Locator role"
        onClose={() => setIsCreateOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!canSubmit}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Username" error={fieldErrors.username} hint={checkingField === 'username' ? 'Checking availability…' : null}>
            <input
              className="app-input"
              value={form.username}
              onChange={(e) => {
                setForm((p) => ({ ...p, username: e.target.value }));
                if (fieldErrors.username) setFieldErrors((p) => ({ ...p, username: undefined }));
              }}
              style={fieldErrors.username ? { borderColor: '#ef4444' } : undefined}
            />
          </Field>
          <Field label="Full name">
            <input
              className="app-input"
              value={form.full_name}
              onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
            />
          </Field>
          <Field label="Email" error={fieldErrors.email} hint={checkingField === 'email' ? 'Checking availability…' : null}>
            <input
              type="email"
              required
              className="app-input"
              value={form.email}
              onChange={(e) => {
                setForm((p) => ({ ...p, email: e.target.value }));
                if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
              }}
              style={fieldErrors.email ? { borderColor: '#ef4444' } : undefined}
            />
          </Field>
          {!editing ? (
            <Field label="Application type *">
              <AppSelect
                isClearable={false}
                options={
                  applicationTypeOptions.length > 0
                    ? applicationTypeOptions.map((t) => ({ value: t.code, label: t.name }))
                    : [{ value: 'DIRECT_LEASE', label: 'Direct Lease' }]
                }
                value={form.application_type}
                onChange={(value) => setForm((p) => ({ ...p, application_type: value }))}
              />
            </Field>
          ) : null}
        </div>

        {!editing ? (
          <label className="mt-2 flex items-center gap-2 text-[12px] cursor-pointer">
            <input
              type="checkbox"
              checked={form.save_as_draft}
              onChange={(e) => setForm((p) => ({ ...p, save_as_draft: e.target.checked }))}
            />
            Save as draft — finish and submit later
          </label>
        ) : null}

        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          {editing ? (
            <p className="text-[11px] text-secondary mb-3">
              {loadingProfile ? 'Loading current business profile…' : "Edits here update the locator's business profile directly."}
            </p>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={editing ? 'Business name' : 'Business name *'}>
              <input
                className="app-input"
                value={form.business_name}
                onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))}
                placeholder="e.g. SkyPort Logistics Inc."
                disabled={loadingProfile}
                required={!editing}
              />
            </Field>
            <Field label={editing ? 'Contact number' : 'Contact number *'}>
              <input
                className="app-input"
                value={form.contact_no}
                onChange={(e) => setForm((p) => ({ ...p, contact_no: e.target.value }))}
                placeholder="09XX XXX XXXX"
                disabled={loadingProfile}
                required={!editing}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label={editing ? 'Principal Address' : 'Principal Address *'}>
                <AddressAutocomplete
                  value={form.address}
                  onChange={(address) => setForm((p) => ({ ...p, address }))}
                  className="app-input"
                  placeholder="Start typing to search, or type the full address"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Lease Address">
                <AddressAutocomplete
                  value={form.lease_address}
                  onChange={(lease_address) => setForm((p) => ({ ...p, lease_address }))}
                  className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                  style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                  placeholder="Start typing to search, or type the full address"
                  disabled={loadingProfile}
                />
              </Field>
            </div>
          </div>
        </div>


        {editing ? (
          <TotpSection user={editing} onChanged={() => refresh({ showLoading: false })} />
        ) : null}
      </SidePanel>

      <SidePanel
        open={continuingDraft !== null}
        title="Continue Draft"
        subtitle={continuingDraft ? continuingDraft.application_no : undefined}
        onClose={() => setContinuingDraft(null)}
        onSave={() => saveContinueDraft(true)}
        saving={continuingDraftSaving}
        saveLabel="Submit Application"
      >
        {continuingDraft ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Username" error={continuingDraftFieldErrors.username}>
                <input
                  className="app-input"
                  value={continuingDraft.username}
                  onChange={(e) => {
                    const value = e.target.value;
                    setContinuingDraft((p) => (p ? { ...p, username: value } : p));
                    if (continuingDraftFieldErrors.username) setContinuingDraftFieldErrors((p) => ({ ...p, username: undefined }));
                  }}
                  style={continuingDraftFieldErrors.username ? { borderColor: '#ef4444' } : undefined}
                />
              </Field>
              <Field label="Full name">
                <input
                  className="app-input"
                  value={continuingDraft.full_name}
                  onChange={(e) => {
                    const value = e.target.value;
                    setContinuingDraft((p) => (p ? { ...p, full_name: value } : p));
                  }}
                />
              </Field>
              <Field label="Email" error={continuingDraftFieldErrors.email}>
                <input
                  type="email"
                  className="app-input"
                  value={continuingDraft.email}
                  onChange={(e) => {
                    const value = e.target.value;
                    setContinuingDraft((p) => (p ? { ...p, email: value } : p));
                    if (continuingDraftFieldErrors.email) setContinuingDraftFieldErrors((p) => ({ ...p, email: undefined }));
                  }}
                  style={continuingDraftFieldErrors.email ? { borderColor: '#ef4444' } : undefined}
                />
              </Field>
              <Field label="Application type *">
                <AppSelect
                  isClearable={false}
                  options={
                    applicationTypeOptions.length > 0
                      ? applicationTypeOptions.map((t) => ({ value: t.code, label: t.name }))
                      : [{ value: 'DIRECT_LEASE', label: 'Direct Lease' }]
                  }
                  value={continuingDraftType}
                  onChange={setContinuingDraftType}
                />
              </Field>
            </div>

            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-[11px] text-secondary mb-3">
                {continuingDraftLoadingProfile ? 'Loading business profile…' : "Still a draft — the account and business profile can still be corrected here."}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Business name">
                  <input
                    className="app-input"
                    value={continuingDraft.business_name}
                    disabled={continuingDraftLoadingProfile}
                    onChange={(e) => {
                      const value = e.target.value;
                      setContinuingDraft((p) => (p ? { ...p, business_name: value } : p));
                    }}
                  />
                </Field>
                <Field label="Contact number">
                  <input
                    className="app-input"
                    value={continuingDraft.contact_no}
                    disabled={continuingDraftLoadingProfile}
                    onChange={(e) => {
                      const value = e.target.value;
                      setContinuingDraft((p) => (p ? { ...p, contact_no: value } : p));
                    }}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Principal Address">
                    <AddressAutocomplete
                      value={continuingDraft.address}
                      onChange={(address) => setContinuingDraft((p) => (p ? { ...p, address } : p))}
                      className="app-input"
                      placeholder="Start typing to search, or type the full address"
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Lease Address">
                    <AddressAutocomplete
                      value={continuingDraft.lease_address}
                      onChange={(lease_address) => setContinuingDraft((p) => (p ? { ...p, lease_address } : p))}
                      className="app-input"
                      placeholder="Start typing to search, or type the full address"
                      disabled={continuingDraftLoadingProfile}
                    />
                  </Field>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="mt-4 w-full rounded-lg border px-3 py-2 text-[12px] font-semibold disabled:opacity-50 cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
              disabled={continuingDraftSaving}
              onClick={() => saveContinueDraft(false)}
            >
              Save Draft (don't submit yet)
            </button>
          </>
        ) : null}
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate this locator account?"
        description="This locator will no longer be able to access the portal unless reactivated."
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
        title="Reactivate this locator account?"
        description="This locator will regain access to the portal."
        confirmText="Reactivate"
        loading={saving}
        onCancel={() => setConfirmReactivateId(null)}
        onConfirm={() => {
          if (confirmReactivateId !== null) {
            void reactivate(confirmReactivateId);
          }
        }}
      />

      <ConfirmModal
        open={confirmSuspendId !== null}
        title="Suspend this locator account?"
        description="A temporary hold — easier to lift than a deactivation. The locator can't log in, and any active session ends immediately."
        confirmText="Suspend"
        danger
        loading={saving}
        onCancel={() => setConfirmSuspendId(null)}
        onConfirm={() => {
          if (confirmSuspendId !== null) void suspend(confirmSuspendId);
        }}
      />

      <ConfirmModal
        open={confirmRevokeId !== null}
        title="Revoke active sessions?"
        description="Ends this locator's current login everywhere immediately, without waiting for it to expire on its own. They'll need to sign in again."
        confirmText="Revoke"
        danger
        loading={saving}
        onCancel={() => setConfirmRevokeId(null)}
        onConfirm={() => {
          if (confirmRevokeId !== null) void revokeSessions(confirmRevokeId);
        }}
      />

      <ConfirmModal
        open={confirmResetPasswordId !== null}
        title="Reset this locator's password?"
        description="A new temporary password is generated and emailed to the locator. They'll be required to set their own password the next time they sign in."
        confirmText="Reset & Email"
        danger
        loading={saving}
        onCancel={() => setConfirmResetPasswordId(null)}
        onConfirm={() => {
          if (confirmResetPasswordId !== null) void resetPassword(confirmResetPasswordId);
        }}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-2 sm:px-3 py-2.5 sm:py-3 flex flex-col justify-between gap-1 shadow-sm min-w-0"
      style={{
        backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)',
      }}
    >
      <span className="text-[9px] sm:text-[10px] font-semibold text-secondary uppercase tracking-wide sm:tracking-widest leading-tight break-words">
        {label}
      </span>
      <span className="text-lg font-bold leading-tight" style={{ color: 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{label}</div>
      {children}
      {error ? (
        <p className="text-[10px] font-medium" style={{ color: '#ef4444' }}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-[10px] font-medium text-secondary">{hint}</p>
      ) : null}
    </div>
  );
}

function TotpSection({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(user.totp_enabled === 1);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(user.totp_enabled === 1);
    setConfirming(false);
  }, [user.id, user.totp_enabled]);

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch(api(`/api/users/${user.id}/totp/reset`), {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to reset authenticator');
      setEnabled(false);
      setConfirming(false);
      toast.success('Authenticator reset — the locator sets it up again on next login');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reset authenticator');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-5 rounded-lg border p-3 sm:p-4 space-y-3"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone size={15} className="text-secondary" />
          <span className="text-[11px] font-semibold text-secondary uppercase tracking-widest">
            Two-factor authentication
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={
            enabled
              ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
              : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' }
          }
        >
          {enabled ? <ShieldCheck size={11} /> : <ShieldOff size={11} />}
          {enabled ? 'Enrolled' : 'Not enrolled'}
        </span>
      </div>

      {enabled ? (
        <div className="space-y-2">
          <p className="text-[11px] text-secondary">
            This locator set up their authenticator and is asked for a 6-digit code at every login. Reset it if they
            lost their device — they will be walked through setup again on their next login.
          </p>
          {confirming ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: '#dc2626', color: '#fff' }}
              >
                <ShieldOff size={13} />
                {busy ? 'Resetting…' : 'Confirm reset'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="text-[11px] font-medium text-secondary hover:text-primary cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold border cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}
            >
              <ShieldOff size={13} />
              Reset authenticator
            </button>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-secondary">
          This locator will set up their authenticator app themselves the next time they log in. Nothing to do here.
        </p>
      )}
    </div>
  );
}
