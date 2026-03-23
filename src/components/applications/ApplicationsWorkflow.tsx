import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Eye, FileText, Loader2, Plus, Search, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { SidePanel } from '../ui/SidePanel';
import { DataTableControls } from '../ui/DataTableControls';
import { AppSelect } from '../ui/AppSelect';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TextField } from '@mui/material';

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
};

type ApplicationsBaseData = {
  applications: ApplicationRow[];
  proponents: ProponentRow[];
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
  content_type?: string | null;
  file_size_bytes?: number | null;
  requirement_code?: string | null;
  requirement_name?: string | null;
  created_at?: string | null;
};

type ContractRow = {
  id: number;
  application_id: number;
  contract_no?: string | null;
  issue_date?: string | null;
  effective_start?: string | null;
  effective_end?: string | null;
  document_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StatusHistoryRow = {
  id: number;
  from_status?: string | null;
  to_status: string;
  remarks?: string | null;
  changed_at?: string | null;
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
  if (s === 'UNDER_REVIEW') {
    return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
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

function toDateInputValue(v: string | null | undefined) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toDatePickerValue(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatDatePickerValue(v: Date | null) {
  if (!v || Number.isNaN(v.getTime())) return '';
  const yyyy = v.getFullYear();
  const mm = String(v.getMonth() + 1).padStart(2, '0');
  const dd = String(v.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function ApplicationsWorkflow({ renewalMode }: { renewalMode: boolean }) {
  const [saving, setSaving] = useState(false);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [proponents, setProponents] = useState<ProponentRow[]>([]);

  const { data: baseData, isLoading: baseLoading, isRevalidating: baseRevalidating, refresh: refreshBase } =
    useSessionStorageCachedResource<ApplicationsBaseData>({
      cacheKey: 'ciac.applications_base.v1',
      ttlMs: 5 * 60 * 1000, // 5 minutes
      fetcher: async () => {
        const [appsRes, propsRes] = await Promise.all([
          fetch(api('/api/applications'), { credentials: 'include' }),
          fetch(api('/api/proponents'), { credentials: 'include' }),
        ]);

        const [appsJson, propsJson] = await Promise.all([appsRes.json(), propsRes.json()]);

        if (!appsRes.ok) throw new Error(appsJson?.message || 'Failed to load applications');
        if (!propsRes.ok) throw new Error(propsJson?.message || 'Failed to load proponents');

        const applicationsRows: ApplicationRow[] = Array.isArray(appsJson?.data) ? appsJson.data : [];
        const proponentsRows: ProponentRow[] = Array.isArray(propsJson?.data)
          ? propsJson.data.filter((p: any) => Number(p?.is_active) === 1)
          : [];

        return { applications: applicationsRows, proponents: proponentsRows };
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
  }, [baseData]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [requirements, setRequirements] = useState<AppRequirementRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [history, setHistory] = useState<StatusHistoryRow[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedContract, setSelectedContract] = useState<ContractRow | null>(null);
  const [previewRequirementId, setPreviewRequirementId] = useState<number | null>(null);
  const [progressByApp, setProgressByApp] = useState<Record<number, ProgressSummary>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [documentEditorOpen, setDocumentEditorOpen] = useState(false);
  const [documentEditorMode, setDocumentEditorMode] = useState<'insert' | 'update'>('insert');
  const [statusEditorOpen, setStatusEditorOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [contractApp, setContractApp] = useState<ApplicationRow | null>(null);
  const [contractDocuments, setContractDocuments] = useState<DocumentRow[]>([]);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractMode, setContractMode] = useState<'insert' | 'update'>('insert');
  const [contractExistingId, setContractExistingId] = useState<number | null>(null);
  const [contractForm, setContractForm] = useState({
    contract_no: '',
    issue_date: '',
    effective_start: '',
    effective_end: '',
    document_id: '',
  });
  /** Loaded values for update mode — Save stays disabled until something changes. */
  const [contractInitialSnapshot, setContractInitialSnapshot] = useState<typeof contractForm | null>(null);
  const [contractIssueDateOpen, setContractIssueDateOpen] = useState(false);
  const [contractEffectiveStartOpen, setContractEffectiveStartOpen] = useState(false);
  const [contractEffectiveEndOpen, setContractEffectiveEndOpen] = useState(false);
  const [appsSearchQuery, setAppsSearchQuery] = useState('');
  const [appsPageSize, setAppsPageSize] = useState(5);
  const [appsPage, setAppsPage] = useState(1);
  const [checklistSearchQuery, setChecklistSearchQuery] = useState('');
  const [checklistPageSize, setChecklistPageSize] = useState(20);
  const [checklistPage, setChecklistPage] = useState(1);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    proponent_id: '',
    application_no: '',
    application_type: 'DIRECT_LEASE',
  });

  const [statusForm, setStatusForm] = useState({
    to_status: 'UNDER_REVIEW',
    remarks: '',
  });

  const [documentForm, setDocumentForm] = useState({
    requirement_id: '',
    file_name: '',
    original_file_name: '',
    storage_path: '',
    content_type: 'application/pdf',
    file_size_bytes: '245760',
  });

  const applicationsEffective = baseData?.applications ?? applications;
  const proponentsEffective = baseData?.proponents ?? proponents;

  const createFormCanSubmit = useMemo(() => {
    const proponentId = Number(createForm.proponent_id);
    if (!Number.isFinite(proponentId) || proponentId <= 0) return false;
    if (!createForm.application_no.trim()) return false;
    return true;
  }, [createForm.application_no, createForm.proponent_id]);

  const contractFormCanSave = useMemo(() => {
    if (!contractForm.contract_no.trim() || !contractForm.issue_date) return false;
    if (contractMode === 'insert') return true;
    if (!contractInitialSnapshot) return false;
    const s = contractInitialSnapshot;
    return (
      contractForm.contract_no.trim() !== s.contract_no.trim() ||
      contractForm.issue_date !== s.issue_date ||
      contractForm.effective_start !== s.effective_start ||
      contractForm.effective_end !== s.effective_end ||
      contractForm.document_id !== s.document_id
    );
  }, [contractForm, contractMode, contractInitialSnapshot]);

  const proponentSelectOptions = useMemo(
    () => proponentsEffective.map((p) => ({ value: String(p.id), label: p.business_name })),
    [proponentsEffective]
  );

  const appsByType = useMemo(
    () => applicationsEffective.filter((a) => Number(a.is_renewal) === (renewalMode ? 1 : 0)),
    [applicationsEffective, renewalMode]
  );
  const filteredApps = useMemo(() => {
    const q = appsSearchQuery.trim().toLowerCase();
    if (!q) return appsByType;
    return appsByType.filter((a) => {
      const appNo = String(a.application_no || '').toLowerCase();
      const proponent = String(a.proponent_name || '').toLowerCase();
      const status = String(a.status || '').toLowerCase();
      const type = String(a.application_type || '').toLowerCase();
      return appNo.includes(q) || proponent.includes(q) || status.includes(q) || type.includes(q);
    });
  }, [appsByType, appsSearchQuery]);
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

  const selectedApp = useMemo(() => filteredApps.find((a) => a.id === selectedId) || null, [filteredApps, selectedId]);
  const selectedProgress = useMemo(() => computeProgress(requirements, documents), [requirements, documents]);
  const selectedRequirementDisplay = useMemo(() => {
    const requirementId = Number(documentForm.requirement_id);
    if (!Number.isFinite(requirementId)) return '—';
    const requirement = requirements.find((r) => Number(r.requirement_id) === requirementId);
    if (!requirement) return `#${requirementId}`;
    return `${requirement.requirement_code || `REQ-${requirementId}`} - ${requirement.requirement_name || 'Requirement'}`;
  }, [documentForm.requirement_id, requirements]);
  const selectedDocByRequirement = useMemo(() => {
    const map = new Map<number, DocumentRow>();
    for (const d of documents) {
      const key = Number(d.requirement_id);
      if (!Number.isFinite(key)) continue;
      if (!map.has(key)) map.set(key, d);
    }
    return map;
  }, [documents]);

  const selectedContractDoc = useMemo(() => {
    if (!selectedContract?.document_id) return null;
    const id = Number(selectedContract.document_id);
    if (!Number.isFinite(id)) return null;
    return documents.find((d) => d.id === id) || null;
  }, [selectedContract, documents]);
  const filteredChecklistRequirements = useMemo(() => {
    const q = checklistSearchQuery.trim().toLowerCase();
    if (!q) return requirements;
    return requirements.filter((r) => {
      const code = String(r.requirement_code || '').toLowerCase();
      const name = String(r.requirement_name || '').toLowerCase();
      const status = String(r.status || '').toLowerCase();
      return code.includes(q) || name.includes(q) || status.includes(q);
    });
  }, [checklistSearchQuery, requirements]);
  const checklistTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredChecklistRequirements.length / Math.max(1, checklistPageSize))),
    [filteredChecklistRequirements.length, checklistPageSize]
  );
  const pagedChecklistRequirements = useMemo(() => {
    const safePage = Math.min(Math.max(1, checklistPage), checklistTotalPages);
    const start = (safePage - 1) * checklistPageSize;
    return filteredChecklistRequirements.slice(start, start + checklistPageSize);
  }, [checklistPage, checklistPageSize, checklistTotalPages, filteredChecklistRequirements]);
  const checklistShowingRange = useMemo(() => {
    if (filteredChecklistRequirements.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, checklistPage), checklistTotalPages);
    return {
      from: (safePage - 1) * checklistPageSize + 1,
      to: Math.min(filteredChecklistRequirements.length, safePage * checklistPageSize),
    };
  }, [filteredChecklistRequirements.length, checklistPage, checklistPageSize, checklistTotalPages]);
  const checklistVisiblePageNumbers = useMemo(() => {
    if (checklistTotalPages <= 5) return Array.from({ length: checklistTotalPages }, (_, i) => i + 1);
    if (checklistPage <= 3) return [1, 2, 3, 4, 5];
    if (checklistPage >= checklistTotalPages - 2) {
      return [checklistTotalPages - 4, checklistTotalPages - 3, checklistTotalPages - 2, checklistTotalPages - 1, checklistTotalPages];
    }
    return [checklistPage - 2, checklistPage - 1, checklistPage, checklistPage + 1, checklistPage + 2];
  }, [checklistPage, checklistTotalPages]);

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

  async function loadDetails(applicationId: number) {
    setDetailsLoading(true);
    try {
      const [reqRes, docRes, historyRes, contractRes] = await Promise.all([
        fetch(api(`/api/applications/${applicationId}/requirements`), { credentials: 'include' }),
        fetch(api(`/api/applications/${applicationId}/documents`), { credentials: 'include' }),
        fetch(api(`/api/applications/${applicationId}/status-history`), { credentials: 'include' }),
        fetch(api(`/api/contracts/application/${applicationId}`), { credentials: 'include' }),
      ]);
      const [reqJson, docJson, historyJson, contractJson] = await Promise.all([
        reqRes.json(),
        docRes.json(),
        historyRes.json(),
        contractRes.json(),
      ]);
      setRequirements(Array.isArray(reqJson?.data) ? reqJson.data : []);
      setDocuments(Array.isArray(docJson?.data) ? docJson.data : []);
      setHistory(Array.isArray(historyJson?.data) ? historyJson.data : []);
      setSelectedContract(contractJson?.data || null);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load application details');
    } finally {
      setDetailsLoading(false);
    }
  }

  useEffect(() => {
    if (!filteredApps.length) {
      setSelectedId(null);
      setRequirements([]);
      setDocuments([]);
      setHistory([]);
      return;
    }

    const exists = filteredApps.some((a) => a.id === selectedId);
    const nextId = exists ? selectedId : filteredApps[0].id;
    if (nextId !== selectedId) setSelectedId(nextId || null);
  }, [filteredApps, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    loadDetails(selectedId);
  }, [selectedId]);

  useEffect(() => {
    loadProgressForApplications(filteredApps.map((a) => a.id));
  }, [filteredApps]);
  useEffect(() => {
    setAppsPage(1);
  }, [appsSearchQuery, appsPageSize, renewalMode]);
  useEffect(() => {
    if (appsPage > appsTotalPages) setAppsPage(appsTotalPages);
  }, [appsPage, appsTotalPages]);
  useEffect(() => {
    setChecklistPage(1);
  }, [checklistSearchQuery, checklistPageSize, selectedId]);
  useEffect(() => {
    if (checklistPage > checklistTotalPages) setChecklistPage(checklistTotalPages);
  }, [checklistPage, checklistTotalPages]);

  async function openDetails(applicationId: number) {
    setSelectedId(applicationId);
    setPreviewRequirementId(null);
    // Ensure the checklist shows the expected default amount every time the modal opens.
    setChecklistPageSize(20);
    setChecklistPage(1);
    setDetailsOpen(true);
    await loadDetails(applicationId);
  }

  function openStatusEditor(applicationId: number, currentStatus?: string) {
    setSelectedId(applicationId);
    setStatusForm((prev) => ({
      ...prev,
      to_status: String(currentStatus || prev.to_status || 'UNDER_REVIEW'),
    }));
    setStatusEditorOpen(true);
  }

  async function openContractEditor(application: ApplicationRow) {
    const applicationId = application.id;
    setContractApp(application);
    setContractOpen(true);
    setContractLoading(true);
    setContractMode('insert');
    setContractExistingId(null);
    setContractInitialSnapshot(null);
    setContractForm({
      contract_no: '',
      issue_date: '',
      effective_start: '',
      effective_end: '',
      document_id: '',
    });
    setContractDocuments([]);

    try {
      const [contractRes, docsRes] = await Promise.all([
        fetch(api(`/api/contracts/application/${applicationId}`), { credentials: 'include' }),
        fetch(api(`/api/applications/${applicationId}/documents`), { credentials: 'include' }),
      ]);
      const [contractJson, docsJson] = await Promise.all([contractRes.json(), docsRes.json()]);
      const existing: ContractRow | null = contractJson?.data || null;

      setContractDocuments(Array.isArray(docsJson?.data) ? docsJson.data : []);

      if (existing && Number.isFinite(Number(existing.id))) {
        setContractMode('update');
        setContractExistingId(Number(existing.id));
        const loaded = {
          contract_no: existing.contract_no ? String(existing.contract_no) : '',
          issue_date: toDateInputValue(existing.issue_date),
          effective_start: toDateInputValue(existing.effective_start),
          effective_end: toDateInputValue(existing.effective_end),
          document_id: existing.document_id ? String(existing.document_id) : '',
        };
        setContractForm(loaded);
        setContractInitialSnapshot(loaded);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load contract');
      setContractOpen(false);
    } finally {
      setContractLoading(false);
    }
  }

  async function saveContract() {
    if (!contractApp) return;
    if (!contractForm.contract_no.trim()) {
      toast.error('Contract no. is required');
      return;
    }
    if (!contractForm.issue_date) {
      toast.error('Issue date is required');
      return;
    }

    const payload = {
      application_id: contractApp.id,
      contract_no: contractForm.contract_no.trim(),
      issue_date: contractForm.issue_date || null,
      effective_start: contractForm.effective_start || null,
      effective_end: contractForm.effective_end || null,
      document_id: contractForm.document_id ? Number(contractForm.document_id) : null,
    };

    setSaving(true);
    try {
      const isInsert = contractMode === 'insert';
      const url = isInsert ? api('/api/contracts') : api(`/api/contracts/${contractExistingId}`);
      const method = isInsert ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to save contract');

      toast.success(isInsert ? 'Contract created' : 'Contract updated');
      setContractOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save contract');
    } finally {
      setSaving(false);
    }
  }

  function openDocumentEditor(row: AppRequirementRow, mode: 'insert' | 'update') {
    const appId = selectedApp?.id || row.application_id || 0;
    const existing = selectedDocByRequirement.get(Number(row.requirement_id));
    setDocumentEditorMode(mode);
    setDocumentForm({
      requirement_id: String(row.requirement_id),
      file_name: existing?.file_name || `doc_${appId}_${row.requirement_id}.pdf`,
      original_file_name: existing?.original_file_name || `Requirement_${row.requirement_id}.pdf`,
      storage_path: existing?.file_name
        ? `/uploads/applications/${appId}/${existing.file_name}`
        : `/uploads/applications/${appId}/req_${row.requirement_id}.pdf`,
      content_type: existing?.content_type || 'application/pdf',
      file_size_bytes: String(existing?.file_size_bytes || 245760),
    });
    setDocumentEditorOpen(true);
  }

  function handleRequirementAction(row: AppRequirementRow, action: string) {
    if (!action) return;
    if (action === 'preview') {
      setPreviewRequirementId((prev) => (prev === row.requirement_id ? null : row.requirement_id));
      return;
    }
    if (action === 'insert') {
      openDocumentEditor(row, 'insert');
      return;
    }
    if (action === 'update') {
      openDocumentEditor(row, 'update');
    }
  }

  async function createApplication() {
    const proponentId = Number(createForm.proponent_id);
    if (!Number.isFinite(proponentId)) {
      toast.error('Proponent is required');
      return;
    }

    if (!createForm.application_no.trim()) {
      toast.error('Application no. is required');
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
          application_no: createForm.application_no.trim(),
          application_type: createForm.application_type.trim() || 'DIRECT_LEASE',
          is_renewal: renewalMode ? 1 : 0,
          status: 'SUBMITTED',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to create application');

      toast.success('Application created. Requirements auto-generated.');
      setIsCreateOpen(false);
      setCreateForm((p) => ({ ...p, application_no: '' }));
      await refreshBase({ showLoading: false });
      const createdId = Number(json?.data?.id || 0);
      if (createdId) setSelectedId(createdId);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create application');
    } finally {
      setSaving(false);
    }
  }

  async function addSampleDocument() {
    if (!selectedId) return;
    const requirementId = Number(documentForm.requirement_id);
    if (!Number.isFinite(requirementId)) {
      toast.error('Requirement is required');
      return;
    }
    if (!documentForm.file_name.trim() || !documentForm.storage_path.trim()) {
      toast.error('File name and storage path are required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(api('/api/applications/documents'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: selectedId,
          requirement_id: requirementId,
          file_name: documentForm.file_name.trim(),
          original_file_name: documentForm.original_file_name.trim() || null,
          storage_path: documentForm.storage_path.trim(),
          content_type: documentForm.content_type.trim() || null,
          file_size_bytes: Number(documentForm.file_size_bytes) || 0,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to add document');
      toast.success('Document inserted');
      await loadDetails(selectedId);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add document');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus() {
    if (!selectedId) return;
    if (!statusForm.to_status.trim()) {
      toast.error('Status is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(api(`/api/applications/${selectedId}/status`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_status: statusForm.to_status.trim(),
          remarks: statusForm.remarks.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to update status');
      toast.success('Application status updated');
      await refreshBase({ showLoading: false });
      await loadDetails(selectedId);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  }

  async function updateRequirementStatus(row: AppRequirementRow, nextStatus: string) {
    setSaving(true);
    try {
      const res = await fetch(api(`/api/applications/requirements/${row.id}/status`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, remarks: row.remarks ?? null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to update requirement');
      toast.success(`Requirement marked as ${nextStatus}`);
      if (selectedId) await loadDetails(selectedId);
      await refreshBase({ showLoading: false });
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update requirement');
    } finally {
      setSaving(false);
    }
  }

  const detailsTitle = selectedApp?.proponent_name || (renewalMode ? 'Renewal Application' : 'New Application');

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          {renewalMode ? 'Renewal Applications Directory' : 'Proponents Directory'}
        </h3>
        <button
          className="rounded-lg px-3 py-2 text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
          style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
          onClick={() => {
            const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
            const prefix = renewalMode ? 'APP-REN' : 'APP-NEW';
            setCreateForm((p) => ({ ...p, application_no: `${prefix}-${stamp}` }));
            setIsCreateOpen(true);
          }}
        >
          <Plus size={15} />
          New Application
        </button>
      </div>

      <div className="glass-card p-4 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="text-xs text-secondary mb-3">Applications ({filteredApps.length})</div>
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
        </div>
        {baseLoading ? (
          <div className="text-xs text-secondary py-8 text-center">Loading...</div>
        ) : filteredApps.length === 0 ? (
          <div className="text-xs text-secondary py-8 text-center">No records yet. Click "New Application".</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Company / Proponent</th>
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
                  return (
                    <tr key={row.id} className="transition-colors" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold" style={{ color: 'var(--text)' }}>
                          {row.proponent_name || `#${row.proponent_id}`}
                        </div>
                        <div className="text-[11px] text-secondary">{row.application_no}</div>
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
                          {renewalMode ? 'Renewal' : 'New Lease'}
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
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold"
                            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                            onClick={() => openDetails(row.id)}
                            disabled={saving}
                          >
                            {detailsLoading && selectedId === row.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                            View Compliance
                          </button>
                          <button
                            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold"
                            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                            onClick={() => openContractEditor(row)}
                            disabled={saving || contractOpen}
                          >
                            {contractLoading && contractApp?.id === row.id ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                            Contract
                          </button>
                          <button
                            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold"
                            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                            onClick={() => openStatusEditor(row.id, row.status)}
                            disabled={saving}
                          >
                            Update Status
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

      {detailsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-2 sm:px-4" style={{ backgroundColor: 'rgba(0,0,0,.45)' }}>
          <div
            className="w-full max-w-7xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)', height: 'min(82vh, 860px)' }}
          >
            <div className="px-4 sm:px-5 py-3 border-b flex items-start justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <div className="text-lg font-bold" style={{ color: 'var(--text)' }}>{detailsTitle}</div>
                <div className="text-xs text-secondary">
                  {selectedApp ? `Compliance Progress • ${selectedApp.application_no}` : 'Compliance Progress'}
                </div>
              </div>
              <button
                className="rounded-lg px-3 py-1.5 text-xs border"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                onClick={() => setDetailsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="p-4 sm:p-5 flex-1 overflow-hidden flex flex-col min-h-0">
              {!selectedApp ? (
                <div className="py-8 text-center text-sm text-secondary">Select an application.</div>
              ) : (
                <>
                  <div className="rounded-xl border p-2 mb-3 shrink-0" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 65%, transparent)' }}>
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold">Compliance Progress</div>
                      <div className="text-lg font-bold" style={{ color: selectedProgress.percent >= 100 ? '#10b981' : selectedProgress.percent >= 50 ? '#3b82f6' : '#f59e0b' }}>
                        {selectedProgress.percent}%
                      </div>
                    </div>
                    <div className="h-2 rounded-full mt-1.5 overflow-hidden" style={{ backgroundColor: 'var(--input-border)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${selectedProgress.percent}%`,
                          background:
                            selectedProgress.percent >= 100
                              ? 'linear-gradient(90deg,#10b981,#34d399)'
                              : selectedProgress.percent >= 50
                                ? 'linear-gradient(90deg,#3b82f6,#60a5fa)'
                                : 'linear-gradient(90deg,#f59e0b,#fbbf24)',
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
                      <span className="inline-flex items-center gap-1.5" style={{ color: '#10b981' }}>
                        <CheckCircle2 size={14} /> {selectedProgress.verified} Verified
                      </span>
                      <span className="inline-flex items-center gap-1.5" style={{ color: '#f59e0b' }}>
                        <Clock3 size={14} /> {selectedProgress.pending} Pending Review
                      </span>
                      <span className="inline-flex items-center gap-1.5" style={{ color: '#ef4444' }}>
                        <XCircle size={14} /> {selectedProgress.missing + selectedProgress.rejected} Missing/Rejected
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border flex flex-col flex-1 min-h-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 65%, transparent)' }}>
                      <div className="text-sm font-semibold">Requirements Checklist</div>
                      <span className="text-[11px] rounded-full px-2.5 py-1 border" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}>
                        {filteredChecklistRequirements.length} items
                      </span>
                    </div>

                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="px-4 pt-3 shrink-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                          <div className="relative group w-full sm:w-72">
                            <Search
                              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
                              size={14}
                            />
                            <input
                              type="text"
                              placeholder="Search requirements..."
                              value={checklistSearchQuery}
                              onChange={(e) => setChecklistSearchQuery(e.target.value)}
                              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
                              style={{
                                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                        {detailsLoading ? (
                          <div className="p-5 text-sm text-secondary">Loading checklist...</div>
                        ) : filteredChecklistRequirements.length === 0 ? (
                          <div className="p-5 text-sm text-secondary">No requirements found.</div>
                        ) : (
                          <div className="min-w-full">
                            <table className="min-w-full text-left text-xs" style={{ borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Requirement</th>
                                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Updated</th>
                                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Valid From - To</th>
                                  <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Status</th>
                                  <th className="px-2 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Preview</th>
                                  <th className="px-2 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Insert</th>
                                  <th className="px-2 py-2.5 text-[10px] uppercase tracking-wider text-secondary text-right">Update</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pagedChecklistRequirements.map((r, idx) => {
                                  const absoluteIndex = checklistShowingRange.from + idx;
                                  const status = toUpper(r.status);
                                  const hasDoc = selectedDocByRequirement.has(Number(r.requirement_id));
                                  const displayStatus = hasDoc && status === 'PENDING' ? 'PENDING_REVIEW' : status;
                                  const doc = selectedDocByRequirement.get(Number(r.requirement_id));

                                  const isLinkedContractRow =
                                    !!selectedContractDoc && Number(selectedContractDoc.id) === Number(doc?.id);

                                  const effectiveDisplayStatus = isLinkedContractRow ? 'VERIFIED' : displayStatus;
                                  const effectiveBadge = getBadgeStyles(effectiveDisplayStatus);
                                  const rowDocForDate = isLinkedContractRow ? selectedContractDoc ?? doc : doc;

                                  const effectiveDateText =
                                    isLinkedContractRow
                                      ? `${selectedContract?.effective_start ? new Date(selectedContract.effective_start).toLocaleDateString() : '—'} - ${
                                          selectedContract?.effective_end ? new Date(selectedContract.effective_end).toLocaleDateString() : '—'
                                        }`
                                      : '—';

                                  const updatedAtText = r.updated_at
                                    ? new Date(r.updated_at).toLocaleDateString()
                                    : rowDocForDate?.created_at
                                      ? new Date(rowDocForDate.created_at).toLocaleDateString()
                                      : '—';

                                  const docForPreview = rowDocForDate ?? doc;

                                  return (
                                    <React.Fragment key={r.id}>
                                      <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                        <td className="px-4 py-3.5 align-top" style={{ width: 'min(520px, 48vw)' }}>
                                          <div className="font-semibold text-sm truncate">
                                            {absoluteIndex}. {r.requirement_name || r.requirement_code || `Requirement #${r.requirement_id}`}
                                          </div>
                                          <div className="mt-1 text-[11px] text-secondary flex flex-wrap items-center gap-3">
                                            {r.remarks ? (
                                              <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: 'rgba(239,68,68,.12)', color: '#ef4444' }}>
                                                Note: {r.remarks}
                                              </span>
                                            ) : null}
                                          </div>
                                        </td>

                                        <td className="px-3 py-3.5 align-top text-[11px] text-secondary" style={{ whiteSpace: 'nowrap' }}>
                                          {updatedAtText !== '—' ? `Updated: ${updatedAtText}` : 'Updated: —'}
                                        </td>

                                        <td className="px-3 py-3.5 align-top text-[11px] text-secondary">
                                          {effectiveDateText}
                                        </td>

                                        <td className="px-3 py-3.5 align-top">
                                          <select
                                            value={effectiveDisplayStatus || 'PENDING'}
                                            onChange={(e) => updateRequirementStatus(r, e.target.value)}
                                            className="text-xs rounded-lg border py-1.5 pl-2.5 pr-7 bg-transparent"
                                            style={{
                                              borderColor: effectiveBadge.border,
                                              color: effectiveBadge.color,
                                              backgroundColor: effectiveBadge.bg,
                                            }}
                                            disabled={saving}
                                          >
                                            <option value="PENDING">PENDING</option>
                                            <option value="PENDING_REVIEW">PENDING_REVIEW</option>
                                            <option value="VERIFIED">VERIFIED</option>
                                            <option value="REJECTED">REJECTED</option>
                                          </select>
                                        </td>

                                        <td className="px-2 py-3.5 align-top text-right">
                                          <button
                                            className={cn(
                                              'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
                                              !hasDoc && 'opacity-50 cursor-not-allowed'
                                            )}
                                            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                                            disabled={!hasDoc}
                                            onClick={() => handleRequirementAction(r, 'preview')}
                                            title="Preview"
                                          >
                                            <Eye size={13} />
                                          </button>
                                        </td>

                                        <td className="px-2 py-3.5 align-top text-right">
                                          <button
                                            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                                            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                                            onClick={() => handleRequirementAction(r, 'insert')}
                                            title="Insert document"
                                          >
                                            <Upload size={13} />
                                          </button>
                                        </td>

                                        <td className="px-2 py-3.5 align-top text-right">
                                          <button
                                            className={cn(
                                              'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
                                              !hasDoc && 'opacity-50 cursor-not-allowed'
                                            )}
                                            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                                            disabled={!hasDoc}
                                            onClick={() => handleRequirementAction(r, 'update')}
                                            title="Update document"
                                          >
                                            <FileText size={13} />
                                          </button>
                                        </td>
                                      </tr>

                                      {previewRequirementId === r.requirement_id && hasDoc && (
                                        <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                          <td colSpan={7} className="px-4 py-3.5">
                                            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: '#081735' }}>
                                              <div className="flex items-center justify-between">
                                                <div className="inline-flex items-center gap-2 text-slate-300">
                                                  <FileText size={16} />
                                                  <span className="text-xs font-semibold">
                                                    {docForPreview?.original_file_name || docForPreview?.file_name || 'Document preview'}
                                                  </span>
                                                </div>
                                              </div>
                                              <div className="mt-4 text-center py-8 text-slate-400 text-xs">Preview placeholder for file rendering.</div>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <DataTableControls
                      page={checklistPage}
                      totalPages={checklistTotalPages}
                      totalItems={filteredChecklistRequirements.length}
                      showingFrom={checklistShowingRange.from}
                      showingTo={checklistShowingRange.to}
                      visiblePageNumbers={checklistVisiblePageNumbers}
                      pageSize={checklistPageSize}
                      pageSizeOptions={[5, 20, 50, 100, 200]}
                      onPageSizeChange={setChecklistPageSize}
                      onPageChange={setChecklistPage}
                      loading={detailsLoading}
                    />
                  </div>

                </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {documentEditorOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-3" style={{ backgroundColor: 'rgba(0,0,0,.4)' }}>
          <div className="w-full max-w-xl rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-start justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--input-border)' }}>
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                  {documentEditorMode === 'insert' ? 'Insert Document' : 'Update Document'}
                </div>
                <div className="text-xs text-secondary mt-0.5">Requirement: {selectedRequirementDisplay}</div>
              </div>
              <button
                className="rounded-lg px-2 py-1 text-xs border"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                onClick={() => setDocumentEditorOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="pt-3 grid grid-cols-1 gap-2.5">
              <input
                className="app-form-control"
                value={documentForm.file_name}
                onChange={(e) => setDocumentForm((p) => ({ ...p, file_name: e.target.value }))}
                placeholder="File name"
              />
              <input
                className="app-form-control"
                value={documentForm.storage_path}
                onChange={(e) => setDocumentForm((p) => ({ ...p, storage_path: e.target.value }))}
                placeholder="Storage path"
              />
              <button
                className={cn('rounded-lg px-3 py-2 text-sm font-semibold inline-flex items-center justify-center gap-1.5', saving && 'opacity-60 cursor-not-allowed')}
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                disabled={saving}
                onClick={async () => {
                  await addSampleDocument();
                  setDocumentEditorOpen(false);
                }}
              >
                <Upload size={14} />
                {documentEditorMode === 'insert' ? 'Insert Document' : 'Update Document'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {statusEditorOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-3" style={{ backgroundColor: 'rgba(0,0,0,.4)' }}>
          <div className="w-full max-w-lg rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-start justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--input-border)' }}>
              <div>
                <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>Update Application Status</div>
                <div className="text-xs text-secondary mt-0.5">
                  {selectedApp ? `${selectedApp.proponent_name || 'Application'} • ${selectedApp.application_no}` : 'Selected application'}
                </div>
              </div>
              <button
                className="rounded-lg px-2 py-1 text-xs border"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                onClick={() => setStatusEditorOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="pt-3 grid grid-cols-1 gap-2.5">
              <input
                className="app-form-control"
                value={statusForm.to_status}
                onChange={(e) => setStatusForm((p) => ({ ...p, to_status: e.target.value }))}
                placeholder="UNDER_REVIEW"
              />
              <button
                className={cn('rounded-lg px-3 py-2 text-sm font-semibold', saving && 'opacity-60 cursor-not-allowed')}
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                disabled={saving}
                onClick={async () => {
                  await updateStatus();
                  setStatusEditorOpen(false);
                }}
              >
                Update
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SidePanel
        open={contractOpen}
        title={contractMode === 'insert' ? 'Create Contract' : 'Update Contract'}
        subtitle={
          contractApp ? `${contractApp.proponent_name || 'Application'} • ${contractApp.application_no}` : 'Selected application'
        }
        onClose={() => setContractOpen(false)}
        onSave={saveContract}
        saving={saving || contractLoading}
        saveDisabled={!contractFormCanSave}
        saveLabel={contractMode === 'insert' ? 'Save Contract' : 'Save Changes'}
        widthClassName="max-w-2xl"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Contract No.</label>
            <TextField
              size="small"
              value={contractForm.contract_no}
              onChange={(e) => setContractForm((p) => ({ ...p, contract_no: e.target.value }))}
              placeholder="e.g. CN-2026-0001"
              sx={{
                mt: 1,
                width: '100%',
                '& .MuiOutlinedInput-root': {
                  backgroundColor: 'transparent',
                  borderRadius: '0.5rem',
                  boxShadow: 'none',
                  height: '40px',
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'var(--input-border)',
                  borderWidth: '1px',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'var(--nav-active-bg)',
                  borderWidth: '1px',
                },
                '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'var(--nav-active-bg)',
                  borderWidth: '1px',
                },
              }}
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Issue Date</label>
            <DatePicker
              open={contractIssueDateOpen}
              onOpen={() => setContractIssueDateOpen(true)}
              onClose={() => setContractIssueDateOpen(false)}
              value={toDatePickerValue(contractForm.issue_date)}
              onChange={(newValue) => setContractForm((p) => ({ ...p, issue_date: formatDatePickerValue(newValue) }))}
              format="yyyy-MM-dd"
              slotProps={{
                textField: {
                  fullWidth: true,
                  size: 'small',
                  placeholder: 'YYYY-MM-DD',
                  onClick: () => setContractIssueDateOpen(true),
                  sx: {
                    mt: 1,
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: 'transparent',
                      borderRadius: '0.5rem',
                      boxShadow: 'none',
                      height: '40px',
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--input-border)',
                      borderWidth: '1px',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--nav-active-bg)',
                      borderWidth: '1px',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--nav-active-bg)',
                      borderWidth: '1px',
                    },
                  },
                },
              }}
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Effective Start</label>
            <DatePicker
              open={contractEffectiveStartOpen}
              onOpen={() => setContractEffectiveStartOpen(true)}
              onClose={() => setContractEffectiveStartOpen(false)}
              value={toDatePickerValue(contractForm.effective_start)}
              onChange={(newValue) =>
                setContractForm((p) => ({ ...p, effective_start: formatDatePickerValue(newValue) }))
              }
              format="yyyy-MM-dd"
              slotProps={{
                textField: {
                  fullWidth: true,
                  size: 'small',
                  placeholder: 'YYYY-MM-DD',
                  onClick: () => setContractEffectiveStartOpen(true),
                  sx: {
                    mt: 1,
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: 'transparent',
                      borderRadius: '0.5rem',
                      boxShadow: 'none',
                      height: '40px',
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--input-border)',
                      borderWidth: '1px',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--nav-active-bg)',
                      borderWidth: '1px',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--nav-active-bg)',
                      borderWidth: '1px',
                    },
                  },
                },
              }}
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Effective End</label>
            <DatePicker
              open={contractEffectiveEndOpen}
              onOpen={() => setContractEffectiveEndOpen(true)}
              onClose={() => setContractEffectiveEndOpen(false)}
              value={toDatePickerValue(contractForm.effective_end)}
              onChange={(newValue) =>
                setContractForm((p) => ({ ...p, effective_end: formatDatePickerValue(newValue) }))
              }
              format="yyyy-MM-dd"
              slotProps={{
                textField: {
                  fullWidth: true,
                  size: 'small',
                  placeholder: 'YYYY-MM-DD',
                  onClick: () => setContractEffectiveEndOpen(true),
                  sx: {
                    mt: 1,
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: 'transparent',
                      borderRadius: '0.5rem',
                      boxShadow: 'none',
                      height: '40px',
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--input-border)',
                      borderWidth: '1px',
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--nav-active-bg)',
                      borderWidth: '1px',
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'var(--nav-active-bg)',
                      borderWidth: '1px',
                    },
                  },
                },
              }}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Contract Document</label>
            <AppSelect
              options={[
                { value: '', label: 'No document' },
                ...contractDocuments.map((d) => ({
                  value: String(d.id),
                  label: `${d.file_name}${d.requirement_code ? ` (${d.requirement_code})` : ''}`,
                })),
              ]}
              value={contractForm.document_id}
              onChange={(value) => setContractForm((p) => ({ ...p, document_id: value }))}
              placeholder="Select contract document..."
              isDisabled={contractLoading}
              isClearable={false}
            />
          </div>
        </div>
      </SidePanel>

      <SidePanel
        open={isCreateOpen}
        title={renewalMode ? 'New Renewal Application' : 'New Application'}
        subtitle="Creates applications + auto application_requirements + status history"
        onClose={() => setIsCreateOpen(false)}
        onSave={createApplication}
        saving={saving}
        saveDisabled={!createFormCanSubmit}
      >
        <div className="grid grid-cols-1 gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Proponent</label>
          <AppSelect
            options={proponentSelectOptions}
            value={createForm.proponent_id}
            onChange={(value) => setCreateForm((p) => ({ ...p, proponent_id: value }))}
            placeholder="Select proponent..."
            isDisabled={saving}
          />

          <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Application No.</label>
          <input
            className="app-form-control"
            value={createForm.application_no}
            onChange={(e) => setCreateForm((p) => ({ ...p, application_no: e.target.value }))}
          />

          <label className="text-xs font-semibold uppercase tracking-wider text-secondary">Application Type</label>
          <input
            className="app-form-control"
            value={createForm.application_type}
            onChange={(e) => setCreateForm((p) => ({ ...p, application_type: e.target.value }))}
          />
        </div>
      </SidePanel>
    </div>
  );
}
