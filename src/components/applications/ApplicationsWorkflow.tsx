import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { DataTableControls } from '../ui/DataTableControls';
import { AppSelect } from '../ui/AppSelect';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';
import { requestNotificationsRefresh } from '../../lib/notificationRefresh';

const NOTIFICATION_HIGHLIGHT_DURATION_MS = 5000;

// Mirrors server/models/ApplicationWorkflow.js's TYPE_EDITABLE_STATUSES —
// fixing a wrong application_type/is_renewal is allowed for as long as the
// application hasn't moved past Assessment.
const TYPE_EDITABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED', 'RETURNED'];

type ApplicationRow = {
  id: number;
  proponent_id: number;
  proponent_name?: string | null;
  application_no: string;
  application_type: string;
  is_renewal: number;
  status: string;
  requirements_count?: number;
  created_at?: string | null;
};

type ProponentRow = {
  id: number;
  business_name: string;
  is_active: number;
  address?: string | null;
  contact_no?: string | null;
  email?: string | null;
  contact_name?: string | null;
  account_status?: string | null;
};

type ApplicationTypeOption = {
  code: string;
  name: string;
};

type ApplicationsBaseData = {
  applications: ApplicationRow[];
  proponents: ProponentRow[];
  applicationTypes: ApplicationTypeOption[];
};

type AppRequirementRow = {
  id: number;
  application_id: number;
  requirement_id: number;
  requirement_code?: string | null;
  requirement_name?: string | null;
  status: string;
  remarks?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DocumentRow = {
  id: number;
  application_id: number;
  requirement_id: number | null;
  file_name: string;
  original_file_name?: string | null;
  storage_path?: string | null;
  content_type?: string | null;
  file_size_bytes?: number | null;
  requirement_code?: string | null;
  requirement_name?: string | null;
  created_at?: string | null;
};

function api(path: string) {
  return path;
}


type ProgressSummary = {
  total: number;
  verified: number;
  pending: number;
  rejected: number;
  missing: number;
  percent: number;
};

function toUpper(v: string | null | undefined) {
  return String(v || '').trim().toUpperCase();
}

function getBadgeStyles(status: string) {
  const s = toUpper(status);
  if (s === 'VERIFIED' || s === 'APPROVED' || s === 'ACTIVE') {
    return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
  }
  if (s === 'PENDING' || s === 'PENDING_REVIEW') {
    return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
  }
  if (s === 'REJECTED' || s === 'INCOMPLETE') {
    return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  }
  if (s === 'UNDER_REVIEW' || s === 'FOR_APPROVAL') {
    return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
  }
  if (s === 'DISAPPROVED') {
    return { bg: 'rgba(220,38,38,.14)', color: '#dc2626', border: 'rgba(220,38,38,.38)' };
  }
  return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
}

function computeProgress(reqRows: AppRequirementRow[], docRows: DocumentRow[]): ProgressSummary {
  const total = reqRows.length;
  if (!total) return { total: 0, verified: 0, pending: 0, rejected: 0, missing: 0, percent: 0 };

  const hasDocumentByRequirement = new Set<number>(
    docRows.map((d) => Number(d.requirement_id)).filter((n) => Number.isFinite(n))
  );

  let verified = 0;
  let pending = 0;
  let rejected = 0;
  let missing = 0;

  for (const r of reqRows) {
    const status = toUpper(r.status);
    const hasDoc = hasDocumentByRequirement.has(Number(r.requirement_id));
    if (status === 'VERIFIED') verified += 1;
    else if (status === 'REJECTED') rejected += 1;
    else pending += 1;
    if (!hasDoc && status !== 'VERIFIED') missing += 1;
  }

  const percent = Math.round((verified / total) * 100);
  return { total, verified, pending, rejected, missing, percent };
}

function stripNotificationQueryParams(search: string) {
  const raw = String(search || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('?') ? raw.slice(1) : raw;
  const params = new URLSearchParams(normalized);
  params.delete('applicationId');
  params.delete('notificationId');
  params.delete('focus');
  const next = params.toString();
  return next ? `?${next}` : '';
}

export function ApplicationsWorkflow({
  renewalMode,
  locationSearch = '',
  navigate,
}: {
  renewalMode: boolean;
  locationSearch?: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [proponents, setProponents] = useState<ProponentRow[]>([]);
  const [applicationTypes, setApplicationTypes] = useState<ApplicationTypeOption[]>([]);

  const { data: baseData, isLoading: baseLoading, isRevalidating: baseRevalidating, refresh: refreshBase } =
    useSessionStorageCachedResource<ApplicationsBaseData>({
      cacheKey: 'ciac.applications_base.v2',
      ttlMs: 5 * 60 * 1000, // 5 minutes
      fetcher: async () => {
        const [appsRes, propsRes, typesRes] = await Promise.all([
          fetch(api('/api/applications'), { credentials: 'include' }),
          fetch(api('/api/proponents'), { credentials: 'include' }),
          fetch(api('/api/application-types'), { credentials: 'include' }),
        ]);

        const [appsJson, propsJson, typesJson] = await Promise.all([appsRes.json(), propsRes.json(), typesRes.json()]);

        if (!appsRes.ok) throw new Error(appsJson?.message || 'Failed to load applications');
        if (!propsRes.ok) throw new Error(propsJson?.message || 'Failed to load proponents');
        if (!typesRes.ok) throw new Error(typesJson?.message || 'Failed to load application types');

        const applicationsRows: ApplicationRow[] = Array.isArray(appsJson?.data) ? appsJson.data : [];
        const proponentsRows: ProponentRow[] = Array.isArray(propsJson?.data)
          ? propsJson.data.filter((p: any) => Number(p?.is_active) === 1)
          : [];
        const applicationTypeRows: ApplicationTypeOption[] = Array.isArray(typesJson?.data)
          ? typesJson.data
              .filter((t: any) => Number(t?.is_active) === 1)
              .map((t: any) => ({ code: String(t.code), name: String(t.name) }))
          : [];

        return { applications: applicationsRows, proponents: proponentsRows, applicationTypes: applicationTypeRows };
      },
      onError: (e) => {
        const message = e instanceof Error ? e.message : 'Failed to load applications';
        toast.error(message);
      },
    });

  useEffect(() => {
    if (!baseData) return;
    setApplications(baseData.applications);
    setProponents(baseData.proponents);
    setApplicationTypes(baseData.applicationTypes);
  }, [baseData]);

  const [progressByApp, setProgressByApp] = useState<Record<number, ProgressSummary>>({});
  // Editing an application's own type/renewal flag (locator stays fixed —
  // the backend only accepts application_type/is_renewal, never a proponent
  // change) is only ever allowed while it's still DRAFT, same rule the
  // backend enforces.
  const [editOpen, setEditOpen] = useState(false);
  const [editApp, setEditApp] = useState<ApplicationRow | null>(null);
  const [editForm, setEditForm] = useState({ application_type: '', is_renewal: false });
  const consumedNotificationQueryRef = useRef<string>('');
  const consumedStatusQueryRef = useRef<string>('');
  const applicationRowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const [appsSearchQuery, setAppsSearchQuery] = useState('');
  // Pre-applied when landing here from a dashboard stat card (e.g. "Rejected
  // / Returned" -> ?status=REJECTED,RETURNED) so the list is already scoped
  // instead of showing every status mixed together. Stays active (and in the
  // URL) until the officer clears it — unlike the one-shot notification
  // row-highlight below, a status filter is a standing view, not a flash.
  const [statusFilterCodes, setStatusFilterCodes] = useState<string[]>([]);
  const [appsPageSize, setAppsPageSize] = useState(5);
  const [appsPage, setAppsPage] = useState(1);
  const [highlightedApplicationId, setHighlightedApplicationId] = useState<number | null>(null);
  const [highlightedApplicationTick, setHighlightedApplicationTick] = useState(0);
  const [shouldCleanNotificationQuery, setShouldCleanNotificationQuery] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    proponent_id: '',
    application_type: 'DIRECT_LEASE',
    save_as_draft: false,
  });
  // Set while resuming an existing DRAFT (see openContinueDraft) instead of
  // filing a brand new one — same New Application panel, but Save patches
  // this draft's own row (and submits it, unless "Save as draft" is still
  // checked) rather than POSTing a new application.
  const [continuingDraftId, setContinuingDraftId] = useState<number | null>(null);

  const applicationsEffective = baseData?.applications ?? applications;
  const proponentsEffective = baseData?.proponents ?? proponents;
  const applicationTypesEffective = baseData?.applicationTypes ?? applicationTypes;

  // Code -> configured display name (Settings -> Application Types), so the
  // list shows the actual type each application was filed under instead of
  // a generic "New Lease"/"Renewal" label that ignored it entirely.
  const applicationTypeNameByCode = useMemo(() => {
    const map: Record<string, string> = {};
    applicationTypesEffective.forEach((t) => { map[t.code] = t.name; });
    return map;
  }, [applicationTypesEffective]);

  const createFormCanSubmit = useMemo(() => {
    const proponentId = Number(createForm.proponent_id);
    if (!Number.isFinite(proponentId) || proponentId <= 0) return false;
    return true;
  }, [createForm.proponent_id]);

  const proponentSelectOptions = useMemo(
    () => proponentsEffective.map((p) => ({ value: String(p.id), label: p.business_name })),
    [proponentsEffective]
  );

  const selectedCreateProponent = useMemo(
    () => proponentsEffective.find((p) => String(p.id) === createForm.proponent_id) || null,
    [proponentsEffective, createForm.proponent_id]
  );

  const appsByType = useMemo(
    () => applicationsEffective.filter((a) => Number(a.is_renewal) === (renewalMode ? 1 : 0)),
    [applicationsEffective, renewalMode]
  );
  const filteredApps = useMemo(() => {
    const base = statusFilterCodes.length
      ? appsByType.filter((a) => statusFilterCodes.includes(String(a.status || '').toUpperCase()))
      : appsByType;
    const q = appsSearchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((a) => {
      const appNo = String(a.application_no || '').toLowerCase();
      const proponent = String(a.proponent_name || '').toLowerCase();
      const status = String(a.status || '').toLowerCase();
      const type = String(a.application_type || '').toLowerCase();
      return appNo.includes(q) || proponent.includes(q) || status.includes(q) || type.includes(q);
    });
  }, [appsByType, appsSearchQuery, statusFilterCodes]);
  const appsTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredApps.length / Math.max(1, appsPageSize))),
    [filteredApps.length, appsPageSize]
  );
  const pagedApps = useMemo(() => {
    const safePage = Math.min(Math.max(1, appsPage), appsTotalPages);
    const start = (safePage - 1) * appsPageSize;
    return filteredApps.slice(start, start + appsPageSize);
  }, [appsPage, appsPageSize, appsTotalPages, filteredApps]);
  const appsShowingRange = useMemo(() => {
    if (filteredApps.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, appsPage), appsTotalPages);
    return {
      from: (safePage - 1) * appsPageSize + 1,
      to: Math.min(filteredApps.length, safePage * appsPageSize),
    };
  }, [filteredApps.length, appsPage, appsPageSize, appsTotalPages]);
  const appsVisiblePageNumbers = useMemo(() => {
    if (appsTotalPages <= 5) return Array.from({ length: appsTotalPages }, (_, i) => i + 1);
    if (appsPage <= 3) return [1, 2, 3, 4, 5];
    if (appsPage >= appsTotalPages - 2) return [appsTotalPages - 4, appsTotalPages - 3, appsTotalPages - 2, appsTotalPages - 1, appsTotalPages];
    return [appsPage - 2, appsPage - 1, appsPage, appsPage + 1, appsPage + 2];
  }, [appsPage, appsTotalPages]);

  const highlightApplicationRow = useCallback((applicationId: number) => {
    setHighlightedApplicationId(applicationId);
    setHighlightedApplicationTick((current) => current + 1);
  }, []);

  async function loadProgressForApplications(appIds: number[]) {
    if (!appIds.length) {
      setProgressByApp({});
      return;
    }
    try {
      const chunks = await Promise.all(
        appIds.map(async (id) => {
          const [reqRes, docRes] = await Promise.all([
            fetch(api(`/api/applications/${id}/requirements`), { credentials: 'include' }),
            fetch(api(`/api/applications/${id}/documents`), { credentials: 'include' }),
          ]);
          const [reqJson, docJson] = await Promise.all([reqRes.json(), docRes.json()]);
          const reqRows: AppRequirementRow[] = Array.isArray(reqJson?.data) ? reqJson.data : [];
          const docRows: DocumentRow[] = Array.isArray(docJson?.data) ? docJson.data : [];
          return [id, computeProgress(reqRows, docRows)] as const;
        })
      );

      const next: Record<number, ProgressSummary> = {};
      for (const [id, summary] of chunks) next[id] = summary;
      setProgressByApp(next);
    } catch {
      // keep UI usable even if aggregate progress fetch fails
    }
  }


  useEffect(() => {
    const search = String(locationSearch || '').trim();
    if (!search || consumedNotificationQueryRef.current === search) return;
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const rawId = Number(params.get('applicationId') || '');
    if (!Number.isFinite(rawId) || rawId <= 0) return;
    const existsInCurrentTable = appsByType.some((application) => application.id === rawId);
    if (!existsInCurrentTable) return;

    const targetIndex = filteredApps.findIndex((application) => application.id === rawId);
    if (targetIndex === -1) {
      if (appsSearchQuery.trim()) {
        setAppsSearchQuery('');
      }
      return;
    }

    consumedNotificationQueryRef.current = search;
    setAppsPage(Math.floor(targetIndex / Math.max(1, appsPageSize)) + 1);
    setShouldCleanNotificationQuery(true);
    highlightApplicationRow(rawId);
  }, [appsByType, appsPageSize, appsSearchQuery, filteredApps, highlightApplicationRow, locationSearch]);

  useEffect(() => {
    const search = String(locationSearch || '').trim();
    if (!search || consumedStatusQueryRef.current === search) return;
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const raw = params.get('status');
    if (!raw) return;
    consumedStatusQueryRef.current = search;
    const codes = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (codes.length) {
      setStatusFilterCodes(codes);
      setAppsPage(1);
    }
  }, [locationSearch]);

  useEffect(() => {
    if (!highlightedApplicationId) return;
    const row = applicationRowRefs.current[highlightedApplicationId];
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedApplicationId, pagedApps]);

  useEffect(() => {
    if (!highlightedApplicationId) return;
    const timerId = window.setTimeout(() => {
      setHighlightedApplicationId((current) => (current === highlightedApplicationId ? null : current));
    }, NOTIFICATION_HIGHLIGHT_DURATION_MS);
    return () => window.clearTimeout(timerId);
  }, [highlightedApplicationId, highlightedApplicationTick]);

  useEffect(() => {
    if (!shouldCleanNotificationQuery || highlightedApplicationId !== null) return;
    const normalizedSearch = String(locationSearch || '').trim();
    const cleanedSearch = stripNotificationQueryParams(normalizedSearch);
    setShouldCleanNotificationQuery(false);
    consumedNotificationQueryRef.current = '';
    if (cleanedSearch === normalizedSearch) return;
    const nextPathname =
      typeof window !== 'undefined'
        ? window.location.pathname || (renewalMode ? '/applications/renewals' : '/applications/new')
        : renewalMode
          ? '/applications/renewals'
          : '/applications/new';
    navigate(`${nextPathname}${cleanedSearch}`, { replace: true });
  }, [highlightedApplicationId, locationSearch, navigate, renewalMode, shouldCleanNotificationQuery]);

  useEffect(() => {
    loadProgressForApplications(filteredApps.map((a) => a.id));
  }, [filteredApps]);
  useEffect(() => {
    setAppsPage(1);
  }, [appsSearchQuery, appsPageSize, renewalMode]);
  useEffect(() => {
    if (appsPage > appsTotalPages) setAppsPage(appsTotalPages);
  }, [appsPage, appsTotalPages]);

  // This page is Locator/Assessment territory only — it never routes into
  // Approval & Issuance (that's the Account Officer's own module, reached
  // through the Approval Queue or Search, not from here). Every non-draft
  // row opens straight to Assessment's Compliance tab; DRAFT instead
  // resumes filing, since there's no assessment record for it yet.
  function goToApplication(row: ApplicationRow) {
    if (toUpper(row.status) === 'DRAFT') {
      openContinueDraft(row);
      return;
    }
    navigate(`/assessment?applicationId=${row.id}&tab=Compliance`);
  }

  function openEditApplication(row: ApplicationRow) {
    setEditApp(row);
    setEditForm({ application_type: row.application_type, is_renewal: Boolean(row.is_renewal) });
    setEditOpen(true);
  }

  /** Resumes a DRAFT in the same "New Application" panel used to file one —
   * a draft is unfinished filing, not a separate record to "edit", so it
   * gets the create flow back with its own data pre-filled, not the
   * generic Edit Application form. */
  function openContinueDraft(row: ApplicationRow) {
    setContinuingDraftId(row.id);
    setCreateForm({
      proponent_id: String(row.proponent_id),
      application_type: row.application_type,
      save_as_draft: true,
    });
    setIsCreateOpen(true);
  }

  async function saveEditApplication() {
    if (!editApp) return;
    setSaving(true);
    try {
      const res = await fetch(api(`/api/applications/${editApp.id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_type: editForm.application_type, is_renewal: editForm.is_renewal ? 1 : 0 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to update application');
      toast.success('Application updated');
      setEditOpen(false);
      await refreshBase({ showLoading: false });
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update application');
    } finally {
      setSaving(false);
    }
  }

  async function createApplication() {
    const proponentId = Number(createForm.proponent_id);
    if (!Number.isFinite(proponentId)) {
      toast.error('Locator is required');
      return;
    }

    if (continuingDraftId) {
      setSaving(true);
      try {
        const res = await fetch(api(`/api/applications/${continuingDraftId}`), {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            application_type: createForm.application_type.trim() || 'DIRECT_LEASE',
            is_renewal: renewalMode ? 1 : 0,
            proponent_id: proponentId,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to update draft');

        const draftId = continuingDraftId;
        if (createForm.save_as_draft) {
          toast.success(`Draft ${json?.data?.application_no || ''} updated`);
          requestNotificationsRefresh();
          await refreshBase({ showLoading: false });
          setIsCreateOpen(false);
          setContinuingDraftId(null);
        } else {
          // submitApplication() covers its own toast/refresh/notification —
          // only close the panel once it actually succeeds (e.g. the
          // mandatory-document check can still reject it), so a failed
          // submit doesn't look like it silently went through.
          const submitted = await submitApplication(draftId);
          if (submitted) {
            setIsCreateOpen(false);
            setContinuingDraftId(null);
          }
        }
      } catch (error: any) {
        toast.error(error?.message || 'Failed to update draft');
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(api('/api/applications'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proponent_id: proponentId,
          application_type: createForm.application_type.trim() || 'DIRECT_LEASE',
          is_renewal: renewalMode ? 1 : 0,
          save_as_draft: createForm.save_as_draft,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to create application');

      toast.success(
        createForm.save_as_draft
          ? `Draft saved as ${json?.data?.application_no}`
          : `Application ${json?.data?.application_no} created. Requirements auto-generated.`
      );
      if (json?.locatorActivated) {
        toast.success(
          json?.locatorEmailSent
            ? "Locator account activated — login was emailed to them."
            : "Locator account activated, but the email could not be sent — check the server console for the temporary password."
        );
      }
      requestNotificationsRefresh();
      setIsCreateOpen(false);
      setCreateForm((p) => ({ ...p, save_as_draft: false }));
      await refreshBase({ showLoading: false });
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create application');
    } finally {
      setSaving(false);
    }
  }

  /** Moves a DRAFT to SUBMITTED or a RETURNED application to RESUBMITTED —
   * the only transition available from a plain button, matching what the
   * server allows via POST /:id/submit (BRM-06/BRM-07). */
  async function submitApplication(applicationId: number) {
    setSaving(true);
    try {
      const res = await fetch(api(`/api/applications/${applicationId}/submit`), {
        method: 'PATCH',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to submit application');
      toast.success(`Application ${json?.data?.application_no || ''} submitted`);
      if (json?.locatorActivated) {
        toast.success(
          json?.locatorEmailSent
            ? 'Locator account activated — login was emailed to them.'
            : 'Locator account activated, but the email could not be sent — check the server console for the temporary password.'
        );
      }
      requestNotificationsRefresh();
      await refreshBase({ showLoading: false });
      return true;
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit application');
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-center justify-end gap-2">
        <button
          className="rounded-lg px-3 py-2 text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
          style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
          onClick={() => setIsCreateOpen(true)}
        >
          <Plus size={15} />
          New Application
        </button>
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div className="relative group w-full sm:w-72">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
            />
            <input
              value={appsSearchQuery}
              onChange={(e) => setAppsSearchQuery(e.target.value)}
              placeholder="Search applications..."
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
              Filtered: {statusFilterCodes.map((c) => c.replace(/_/g, ' ')).join(', ')}
              <X size={12} />
            </button>
          ) : null}
        </div>
        {baseLoading ? (
          <div className="py-2">
            <TableSkeleton columns={5} rows={5} />
          </div>
        ) : filteredApps.length === 0 ? (
          <EmptyState
            title="No applications found"
            description={
              appsSearchQuery 
                ? 'Try adjusting your search filters.' 
                : 'There are no records here yet. Click "New Application" to get started.'
            }
            action={
              !appsSearchQuery ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={() => setIsCreateOpen(true)}
                >
                  Create Application
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Company / Locator</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Application Type</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Progress</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Status</th>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedApps.map((row) => {
                  const summary = progressByApp[row.id];
                  const percent = summary?.percent ?? 0;
                  const barColor = percent >= 100 ? '#10b981' : percent >= 50 ? '#3b82f6' : '#f59e0b';
                  const badge = getBadgeStyles(row.status);
                  const isHighlighted = row.id === highlightedApplicationId;
                  const highlightStyle = isHighlighted
                    ? {
                        background:
                          'linear-gradient(90deg, rgba(59,130,246,0.14) 0%, rgba(59,130,246,0.07) 34%, rgba(59,130,246,0.02) 100%)',
                        boxShadow: 'inset 3px 0 0 #2563eb, inset 0 0 0 1px rgba(59,130,246,0.22)',
                      }
                    : undefined;
                  return (
                    <tr
                      key={row.id}
                      ref={(node) => {
                        applicationRowRefs.current[row.id] = node;
                      }}
                      className="transition-[background-color,box-shadow] duration-500 cursor-pointer hover:bg-[var(--selected-bg)]"
                      style={{
                        borderTop: '1px solid var(--border-subtle)',
                        ...highlightStyle,
                      }}
                      onClick={() => goToApplication(row)}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-semibold" style={{ color: 'var(--text)' }}>
                          {row.proponent_name || `#${row.proponent_id}`}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                          <div className="text-[11px] text-secondary">{row.application_no}</div>
                          {isHighlighted ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                color: '#1d4ed8',
                                backgroundColor: 'rgba(219,234,254,0.95)',
                                borderColor: 'rgba(59,130,246,0.22)',
                              }}
                            >
                              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#2563eb' }} />
                              From notification
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                          style={{
                            background: renewalMode ? 'rgba(168,85,247,0.18)' : 'rgba(99,102,241,0.18)',
                            color: renewalMode ? '#c084fc' : '#818cf8',
                            borderColor: renewalMode ? 'rgba(168,85,247,0.4)' : 'rgba(99,102,241,0.4)',
                          }}
                        >
                          {applicationTypeNameByCode[row.application_type] || row.application_type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 min-w-[180px]">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 rounded-full overflow-hidden w-[120px]" style={{ backgroundColor: 'var(--input-border)' }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, backgroundColor: barColor }} />
                          </div>
                          <span className="text-[11px] font-semibold">{percent}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
                          style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          {toUpper(row.status) === 'DRAFT' ? (
                            <button
                              className="inline-flex items-center justify-center gap-1 rounded-lg h-8 px-2.5 text-[10px] font-bold uppercase tracking-wide"
                              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                              onClick={() => openContinueDraft(row)}
                              disabled={saving}
                              title="Continue Draft"
                              aria-label="Continue Draft"
                            >
                              Draft <ArrowRight size={12} />
                            </button>
                          ) : toUpper(row.status) === 'RETURNED' ? (
                            <button
                              className="inline-flex items-center justify-center rounded-lg h-8 w-8 text-xs font-semibold"
                              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                              onClick={() => submitApplication(row.id)}
                              disabled={saving}
                              title="Resubmit"
                              aria-label="Resubmit"
                            >
                              <Upload size={14} />
                            </button>
                          ) : null}
                          {TYPE_EDITABLE_STATUSES.includes(toUpper(row.status)) && toUpper(row.status) !== 'DRAFT' ? (
                            <button
                              className="inline-flex items-center justify-center rounded-lg border h-8 w-8 text-xs font-semibold"
                              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                              onClick={() => openEditApplication(row)}
                              disabled={saving}
                              title="Edit Application"
                              aria-label="Edit Application"
                            >
                              <Pencil size={14} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <DataTableControls
          page={appsPage}
          totalPages={appsTotalPages}
          totalItems={filteredApps.length}
          showingFrom={appsShowingRange.from}
          showingTo={appsShowingRange.to}
          visiblePageNumbers={appsVisiblePageNumbers}
          pageSize={appsPageSize}
          pageSizeOptions={[5, 20, 50, 100, 200]}
          onPageSizeChange={setAppsPageSize}
          onPageChange={setAppsPage}
              loading={baseLoading || baseRevalidating}
        />
      </div>

      <SidePanel
        open={isCreateOpen}
        title={continuingDraftId ? 'Continue Application' : renewalMode ? 'New Renewal Application' : 'New Application'}
        subtitle={
          continuingDraftId
            ? 'Finish filing this draft — uncheck "Save as draft" to submit it now.'
            : 'A reference number is generated automatically on save.'
        }
        onClose={() => {
          setIsCreateOpen(false);
          setContinuingDraftId(null);
        }}
        onSave={createApplication}
        saving={saving}
        saveDisabled={!createFormCanSubmit}
        saveLabel={createForm.save_as_draft ? 'Save Draft' : 'Submit Application'}
      >
        <div className="grid grid-cols-1 gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Locator</label>
          <AppSelect
            options={proponentSelectOptions}
            value={createForm.proponent_id}
            onChange={(value) => setCreateForm((p) => ({ ...p, proponent_id: value }))}
            placeholder="Select locator..."
            isDisabled={saving}
          />
          {continuingDraftId ? (
            <div className="text-[10px] text-secondary -mt-2">Still a draft, so the locator can still be changed if this was filed under the wrong one.</div>
          ) : null}

          {selectedCreateProponent ? (
            <div
              className="rounded-lg border px-3 py-2.5 text-xs space-y-1.5"
              style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--surface-hover)' }}
            >
              {selectedCreateProponent.contact_name ? (
                <div style={{ color: 'var(--text)' }} className="font-semibold">
                  {selectedCreateProponent.contact_name}
                </div>
              ) : null}
              <div className="flex items-center gap-1.5 text-secondary">
                <Mail size={12} className="shrink-0" />
                <span className="truncate">{selectedCreateProponent.email || 'No email on file'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-secondary">
                <Phone size={12} className="shrink-0" />
                <span className="truncate">{selectedCreateProponent.contact_no || 'No contact number on file'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-secondary">
                <MapPin size={12} className="shrink-0" />
                <span className="truncate">{selectedCreateProponent.address || 'No address on file'}</span>
              </div>
              {String(selectedCreateProponent.account_status || '').toUpperCase() === 'PENDING' ? (
                <div className="pt-1 text-[11px]" style={{ color: '#f59e0b' }}>
                  Account pending — submitting this application (not saving as draft) will activate it and email
                  their login to {selectedCreateProponent.email || 'the address above'}.
                </div>
              ) : null}
            </div>
          ) : null}

          <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Application Type</label>
          <AppSelect
            options={applicationTypesEffective.map((t) => ({ value: t.code, label: t.name }))}
            value={createForm.application_type}
            onChange={(value) => setCreateForm((p) => ({ ...p, application_type: value }))}
            placeholder="Select application type..."
            isDisabled={saving}
            isClearable={false}
          />

          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer" style={{ borderColor: 'var(--input-border)' }}>
            <input
              type="checkbox"
              className="cursor-pointer"
              checked={createForm.save_as_draft}
              onChange={(e) => setCreateForm((p) => ({ ...p, save_as_draft: e.target.checked }))}
            />
            <span style={{ color: 'var(--text)' }}>Save as draft — finish and submit later</span>
          </label>
        </div>
      </SidePanel>

      <SidePanel
        open={editOpen}
        title="Edit Application"
        subtitle={editApp ? `${editApp.proponent_name || 'Application'} • ${editApp.application_no}` : 'Selected application'}
        onClose={() => setEditOpen(false)}
        onSave={saveEditApplication}
        saving={saving}
        saveDisabled={!editForm.application_type}
        saveLabel="Save Changes"
      >
        <div className="grid grid-cols-1 gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Locator</label>
          <div
            className="rounded-lg border px-3 py-2.5 text-xs"
            style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--surface-hover)', color: 'var(--text-muted)' }}
          >
            {editApp?.proponent_name || '—'}
            <span className="block text-[10px] mt-0.5 opacity-70">Locator can't be changed after filing.</span>
          </div>

          <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Application Type</label>
          <AppSelect
            options={applicationTypesEffective.map((t) => ({ value: t.code, label: t.name }))}
            value={editForm.application_type}
            onChange={(value) => setEditForm((p) => ({ ...p, application_type: value }))}
            placeholder="Select application type..."
            isDisabled={saving}
            isClearable={false}
          />
        </div>
      </SidePanel>
    </div>
  );
}
