import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Folder, FolderOpen, Minus, Pencil, Plus, RotateCcw, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useSessionStorageCachedResource } from '../../hooks/useSessionStorageCachedResource';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';

const MENU_KEY = 'applications:requirements';
const MENU_KEY_TYPES = 'settings:application-types';
const MENU_KEY_CATEGORIES = 'settings:requirement-categories';

type RequirementRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category_id: number | null;
  category_name?: string | null;
  for_new: number;
  for_renewal: number;
  is_mandatory: number;
  is_active: number;
  // Application type codes this requirement is restricted to. Empty = applies
  // to every application type (the historical, unrestricted default).
  application_types: string[];
  created_by: number | null;
  updated_by: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CategoryRow = {
  id: number;
  name: string;
  description?: string | null;
  is_active: number;
  // Application type codes this category is restricted to. Empty = applies
  // to every application type (same convention as RequirementRow above).
  application_types?: string[];
};

type ApplicationTypeRow = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  is_active: number;
};

type RequirementsData = {
  items: RequirementRow[];
  categories: CategoryRow[];
  applicationTypes: ApplicationTypeRow[];
};

function api(path: string) {
  return path;
}

export function RequirementsManagement() {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const canAdd = fullAccess || perm.can_add;
  const canEdit = fullAccess || perm.can_edit;
  const canDelete = fullAccess || perm.can_delete;
  const permTypes = crudPermissions[MENU_KEY_TYPES] || { can_add: false, can_edit: false, can_delete: false };
  const canAddTypes = fullAccess || permTypes.can_add;
  const canEditTypes = fullAccess || permTypes.can_edit;
  const canDeleteTypes = fullAccess || permTypes.can_delete;
  const permCategories = crudPermissions[MENU_KEY_CATEGORIES] || { can_add: false, can_edit: false, can_delete: false };
  const canAddCategories = fullAccess || permCategories.can_add;
  const canEditCategories = fullAccess || permCategories.can_edit;
  const canDeleteCategories = fullAccess || permCategories.can_delete;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RequirementRow | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
  const [confirmReactivateId, setConfirmReactivateId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [recoverySearch, setRecoverySearch] = useState('');
  const [recoveryPageSize, setRecoveryPageSize] = useState(10);
  const [recoveryPage, setRecoveryPage] = useState(1);

  const { data: requirementsData, isLoading, isRevalidating, refresh } =
    useSessionStorageCachedResource<RequirementsData>({
      cacheKey: 'ciac.requirements.categories_and_items.v1',
      ttlMs: 5 * 60 * 1000, // 5 minutes
      fetcher: async () => {
        const [rRes, cRes, atRes] = await Promise.all([
          fetch(api('/api/requirements'), { credentials: 'include' }),
          fetch(api('/api/requirement-categories'), { credentials: 'include' }),
          fetch(api('/api/application-types'), { credentials: 'include' }),
        ]);

        const rJson = await rRes.json().catch(() => ({}));
        const cJson = await cRes.json().catch(() => ({}));
        const atJson = await atRes.json().catch(() => ({}));

        if (!rRes.ok) throw new Error(rJson?.message || 'Failed to load requirements');
        if (!cRes.ok) throw new Error(cJson?.message || 'Failed to load requirement categories');
        if (!atRes.ok) throw new Error(atJson?.message || 'Failed to load application types');

        return {
          items: (rJson.data || []).map((item: any) => ({
            ...item,
            for_new: Number(item?.for_new) ? 1 : 0,
            for_renewal: Number(item?.for_renewal) ? 1 : 0,
            is_mandatory: Number(item?.is_mandatory) ? 1 : 0,
            is_active: Number(item?.is_active) ? 1 : 0,
            application_types: Array.isArray(item?.application_types) ? item.application_types : [],
          })),
          categories: (cJson.data || []).map((c: any) => ({
            ...c,
            is_active: Number(c?.is_active) ? 1 : 0,
            application_types: Array.isArray(c?.application_types) ? c.application_types : [],
          })),
          applicationTypes: (atJson.data || []).map((t: any) => ({
            id: t.id,
            code: t.code,
            name: t.name,
            description: t.description ?? null,
            is_active: Number(t?.is_active) ? 1 : 0,
          })),
        };
      },
      onError: (e) => {
        const message = e instanceof Error ? e.message : 'Failed to load data';
        setError(message);
        toast.error(message);
      },
    });

  const items = requirementsData?.items ?? [];
  const categories = requirementsData?.categories ?? [];
  const applicationTypes = requirementsData?.applicationTypes ?? [];

  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    category_id: '',
    for_new: true,
    for_renewal: true,
    is_mandatory: true,
    application_types: [] as string[],
  });

  // --- Inline CRUD for Application Type / Requirement Category, launched
  // directly from the tree so managing the catalog doesn't require leaving
  // this page for the dedicated settings screens. ---
  const [editingType, setEditingType] = useState<ApplicationTypeRow | null>(null);
  const [isTypePanelOpen, setIsTypePanelOpen] = useState(false);
  const [confirmDeactivateTypeId, setConfirmDeactivateTypeId] = useState<number | null>(null);
  const [typeForm, setTypeForm] = useState({ code: '', name: '', description: '' });

  const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null);
  const [isCategoryPanelOpen, setIsCategoryPanelOpen] = useState(false);
  const [confirmDeactivateCategoryId, setConfirmDeactivateCategoryId] = useState<number | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', application_types: [] as string[] });

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: String(c.id), label: c.name })),
    [categories]
  );

  const activeApplicationTypes = useMemo(
    () => applicationTypes.filter((t) => t.is_active === 1),
    [applicationTypes]
  );

  const applicationTypeNameByCode = useMemo(() => {
    const map: Record<string, string> = {};
    applicationTypes.forEach((t) => { map[t.code] = t.name; });
    return map;
  }, [applicationTypes]);

  const applicationTypeByCode = useMemo(() => {
    const map = new Map<string, ApplicationTypeRow>();
    applicationTypes.forEach((t) => map.set(t.code, t));
    return map;
  }, [applicationTypes]);

  const categoryById = useMemo(() => {
    const map = new Map<string, CategoryRow>();
    categories.forEach((c) => map.set(String(c.id), c));
    return map;
  }, [categories]);

  function applicationTypesLabel(codes: string[]) {
    if (!codes || codes.length === 0) return 'All types';
    return codes.map((c) => applicationTypeNameByCode[c] || c).join(', ');
  }

  const stats = useMemo(() => {
    const active = items.filter((i) => i.is_active === 1).length;
    const inactive = items.filter((i) => i.is_active === 0).length;
    return { active, inactive, total: items.length };
  }, [items]);

  const activeItems = useMemo(() => items.filter((i) => i.is_active === 1), [items]);
  const deactivatedItems = useMemo(() => items.filter((i) => i.is_active === 0), [items]);

  // --- 3-panel dynamic browser: Application Type -> Requirement Category -> Requirements ---
  // Browsing here uses explicit tagging only — a requirement/category with an
  // empty application_types array ("unrestricted", applies everywhere when
  // actually filing an application) still shows up under "All Types", but
  // does NOT auto-count toward a specific type's node until it's explicitly
  // tagged to it. Otherwise a brand-new type would immediately inherit every
  // unrestricted item's count, which looked like a bug to a non-technical
  // user even though the underlying filing logic was working correctly.
  const [selectedTypeCode, setSelectedTypeCode] = useState<string | null>(null);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
  // Which type folders are expanded in the tree — independent of selection,
  // so more than one can stay open at once (matches a normal file-tree feel).
  const [expandedTypeCodes, setExpandedTypeCodes] = useState<Set<string>>(new Set());

  function appliesToType(item: RequirementRow, code: string) {
    return item.application_types.includes(code);
  }

  const itemsForSelectedType = useMemo(() => {
    if (!selectedTypeCode) return [];
    if (selectedTypeCode === '__all__') return activeItems;
    return activeItems.filter((i) => appliesToType(i, selectedTypeCode));
  }, [activeItems, selectedTypeCode]);

  function categoryAppliesToType(category: CategoryRow, code: string) {
    return (category.application_types || []).includes(code);
  }

  // Built together so a Type's badge always matches exactly what its
  // expanded category list shows (same membership rule, computed once).
  // A category counts under a type if EITHER it's explicitly tagged to that
  // type (the new wiring, lets a freshly-created empty category sort in
  // immediately) OR it already has requirements filed under that type (the
  // legacy signal — keeps pre-existing categories, none of which have ever
  // been manually tagged yet, from vanishing out of every type's tree).
  const { typePanelOptions, categoryOptionsByType } = useMemo(() => {
    const activeCategories = categories.filter((c) => c.is_active === 1);
    const typesToWalk = [
      { code: '__all__', name: 'All Types' },
      ...activeApplicationTypes.map((t) => ({ code: t.code, name: t.name })),
    ];

    const categoryMap = new Map<string, { key: string; name: string; count: number }[]>();
    const typeOptions: { code: string; name: string; count: number }[] = [];

    for (const t of typesToWalk) {
      const itemsForType = t.code === '__all__' ? activeItems : activeItems.filter((i) => appliesToType(i, t.code));
      const countByCategoryId = new Map<string, number>();
      let uncategorized = 0;
      for (const item of itemsForType) {
        if (item.category_id == null) {
          uncategorized += 1;
          continue;
        }
        const key = String(item.category_id);
        countByCategoryId.set(key, (countByCategoryId.get(key) || 0) + 1);
      }
      const relevantCategories =
        t.code === '__all__'
          ? activeCategories
          : activeCategories.filter((c) => categoryAppliesToType(c, t.code) || countByCategoryId.has(String(c.id)));
      const sorted = relevantCategories
        .map((c) => ({ key: String(c.id), name: c.name, count: countByCategoryId.get(String(c.id)) || 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const options = [{ key: '__all__', name: 'All Categories', count: itemsForType.length }, ...sorted];
      if (uncategorized > 0) options.push({ key: '__uncategorized__', name: 'Uncategorized', count: uncategorized });
      categoryMap.set(t.code, options);
      typeOptions.push({ code: t.code, name: t.name, count: sorted.length });
    }

    return { typePanelOptions: typeOptions, categoryOptionsByType: categoryMap };
  }, [activeApplicationTypes, activeItems, categories]);

  const panelFilteredItems = useMemo(() => {
    if (!selectedTypeCode) return activeItems;
    if (!selectedCategoryKey || selectedCategoryKey === '__all__') return itemsForSelectedType;
    if (selectedCategoryKey === '__uncategorized__') return itemsForSelectedType.filter((i) => i.category_id == null);
    return itemsForSelectedType.filter((i) => String(i.category_id) === selectedCategoryKey);
  }, [activeItems, itemsForSelectedType, selectedCategoryKey, selectedTypeCode]);

  function toggleTypeExpand(code: string) {
    setExpandedTypeCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function selectCategory(typeCode: string, key: string) {
    setSelectedTypeCode(typeCode);
    setSelectedCategoryKey(key);
    setExpandedTypeCodes((prev) => new Set(prev).add(typeCode));
  }

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return panelFilteredItems;
    return panelFilteredItems.filter((i) => {
      const flags = [i.for_new ? 'new' : '', i.for_renewal ? 'renewal' : '', i.is_mandatory ? 'mandatory' : 'optional'].join(' ');
      return (
        (i.code || '').toLowerCase().includes(q) ||
        (i.name || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.category_name || '').toLowerCase().includes(q) ||
        flags.includes(q) ||
        applicationTypesLabel(i.application_types).toLowerCase().includes(q)
      );
    });
  }, [panelFilteredItems, searchQuery]);

  const filteredDeactivatedItems = useMemo(() => {
    const q = recoverySearch.trim().toLowerCase();
    if (!q) return deactivatedItems;
    return deactivatedItems.filter((i) => {
      const flags = [i.for_new ? 'new' : '', i.for_renewal ? 'renewal' : '', i.is_mandatory ? 'mandatory' : 'optional'].join(' ');
      return (
        (i.code || '').toLowerCase().includes(q) ||
        (i.name || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.category_name || '').toLowerCase().includes(q) ||
        flags.includes(q) ||
        applicationTypesLabel(i.application_types).toLowerCase().includes(q)
      );
    });
  }, [deactivatedItems, recoverySearch]);

  const canSubmit = useMemo(() => {
    const code = form.code.trim();
    const name = form.name.trim();
    const description = form.description.trim();
    const categoryId = form.category_id.trim();
    const forNew = form.for_new;
    const forRenewal = form.for_renewal;
    const mandatory = form.is_mandatory;

    if (!code || !name) return false;

    if (!editing) {
      return Boolean(code || name || description || categoryId || forNew || forRenewal || mandatory);
    }

    const originalCode = (editing.code || '').trim();
    const originalName = (editing.name || '').trim();
    const originalDescription = (editing.description || '').trim();
    const originalCategoryId = editing.category_id != null ? String(editing.category_id).trim() : '';
    const originalForNew = Number(editing.for_new) === 1;
    const originalForRenewal = Number(editing.for_renewal) === 1;
    const originalMandatory = Number(editing.is_mandatory) === 1;
    const originalTypes = [...(editing.application_types || [])].sort().join(',');
    const currentTypes = [...form.application_types].sort().join(',');

    return (
      code !== originalCode ||
      name !== originalName ||
      description !== originalDescription ||
      categoryId !== originalCategoryId ||
      forNew !== originalForNew ||
      forRenewal !== originalForRenewal ||
      mandatory !== originalMandatory ||
      currentTypes !== originalTypes
    );
  }, [editing, form.category_id, form.code, form.description, form.for_new, form.for_renewal, form.is_mandatory, form.name, form.application_types]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredItems.length / Math.max(1, pageSize))), [filteredItems.length, pageSize]);

  const pagedItems = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize, totalPages]);

  const showingRange = useMemo(() => {
    if (filteredItems.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    return {
      from: (safePage - 1) * pageSize + 1,
      to: Math.min(filteredItems.length, safePage * pageSize),
    };
  }, [filteredItems.length, page, pageSize, totalPages]);

  const visiblePageNumbers = useMemo(() => {
    const current = Math.min(Math.max(1, page), totalPages);
    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, pageSize, selectedTypeCode, selectedCategoryKey]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const recoveryTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredDeactivatedItems.length / Math.max(1, recoveryPageSize))),
    [filteredDeactivatedItems.length, recoveryPageSize]
  );

  const pagedDeactivatedItems = useMemo(() => {
    const safePage = Math.min(Math.max(1, recoveryPage), recoveryTotalPages);
    const start = (safePage - 1) * recoveryPageSize;
    return filteredDeactivatedItems.slice(start, start + recoveryPageSize);
  }, [filteredDeactivatedItems, recoveryPage, recoveryPageSize, recoveryTotalPages]);

  const recoveryShowingRange = useMemo(() => {
    if (filteredDeactivatedItems.length === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, recoveryPage), recoveryTotalPages);
    return {
      from: (safePage - 1) * recoveryPageSize + 1,
      to: Math.min(filteredDeactivatedItems.length, safePage * recoveryPageSize),
    };
  }, [filteredDeactivatedItems.length, recoveryPage, recoveryPageSize, recoveryTotalPages]);

  const recoveryVisiblePageNumbers = useMemo(() => {
    const current = Math.min(Math.max(1, recoveryPage), recoveryTotalPages);
    const start = Math.max(1, current - 1);
    const end = Math.min(recoveryTotalPages, start + 2);
    const adjustedStart = Math.max(1, end - 2);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [recoveryPage, recoveryTotalPages]);

  useEffect(() => {
    setRecoveryPage(1);
  }, [recoverySearch, recoveryPageSize]);

  useEffect(() => {
    if (recoveryPage > recoveryTotalPages) setRecoveryPage(recoveryTotalPages);
  }, [recoveryPage, recoveryTotalPages]);

  function openCreate() {
    setEditing(null);
    setForm({
      code: '',
      name: '',
      description: '',
      // Pre-fill from whatever's picked in Panel 1/2 so adding a new
      // requirement while browsing a specific type/category doesn't force
      // re-selecting the same combination in the form.
      category_id:
        selectedCategoryKey && selectedCategoryKey !== '__all__' && selectedCategoryKey !== '__uncategorized__'
          ? selectedCategoryKey
          : '',
      for_new: true,
      for_renewal: true,
      is_mandatory: true,
      application_types: selectedTypeCode && selectedTypeCode !== '__all__' ? [selectedTypeCode] : [],
    });
    setIsCreateOpen(true);
  }

  function openEdit(item: RequirementRow) {
    setEditing(item);
    setForm({
      code: item.code || '',
      name: item.name || '',
      description: item.description || '',
      category_id: item.category_id != null ? String(item.category_id) : '',
      for_new: Number(item.for_new) === 1,
      for_renewal: Number(item.for_renewal) === 1,
      is_mandatory: Number(item.is_mandatory) === 1,
      application_types: [...(item.application_types || [])],
    });
    setIsCreateOpen(true);
  }

  function toggleApplicationType(code: string) {
    setForm((p) => ({
      ...p,
      application_types: p.application_types.includes(code)
        ? p.application_types.filter((c) => c !== code)
        : [...p.application_types, code],
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id.trim() ? Number(form.category_id) : null,
        for_new: form.for_new ? 1 : 0,
        for_renewal: form.for_renewal ? 1 : 0,
        is_mandatory: form.is_mandatory ? 1 : 0,
        application_types: form.application_types,
      };
      if (!payload.code) throw new Error('Code is required');
      if (!payload.name) throw new Error('Name is required');

      const res = await fetch(api(editing ? `/api/requirements/${editing.id}` : '/api/requirements'), {
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
      toast.success(editing ? 'Requirement updated successfully' : 'Requirement created successfully');
    } catch (e: any) {
      const message = e?.message || 'Save failed';
      setError(message);
      toast.error(message);
      // Category list may be stale (cached client-side); refresh so a bad
      // selection doesn't keep getting offered on the next attempt.
      await refresh({ showLoading: false });
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/requirements/${id}/deactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      setError(null);
      await refresh({ showLoading: false });
      toast.success('Requirement deactivated successfully');
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
      const res = await fetch(api(`/api/requirements/${id}/reactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reactivate failed');
      setError(null);
      await refresh({ showLoading: false });
      toast.success('Requirement reactivated successfully');
      setConfirmReactivateId(null);
    } catch (e: any) {
      const message = e?.message || 'Reactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function openCreateType() {
    setEditingType(null);
    setTypeForm({ code: '', name: '', description: '' });
    setIsTypePanelOpen(true);
  }

  function openEditType(row: ApplicationTypeRow) {
    setEditingType(row);
    setTypeForm({ code: row.code || '', name: row.name || '', description: row.description || '' });
    setIsTypePanelOpen(true);
  }

  async function saveType() {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        code: typeForm.code.trim(),
        name: typeForm.name.trim(),
        description: typeForm.description.trim() || null,
      };
      if (!payload.code) throw new Error('Code is required');
      if (!payload.name) throw new Error('Name is required');

      const res = await fetch(api(editingType ? `/api/application-types/${editingType.id}` : '/api/application-types'), {
        method: editingType ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');
      setIsTypePanelOpen(false);
      setError(null);
      await refresh({ showLoading: false });
      toast.success(editingType ? 'Application type updated successfully' : 'Application type created successfully');
    } catch (e: any) {
      const message = e?.message || 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateType(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/application-types/${id}/deactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      setError(null);
      await refresh({ showLoading: false });
      toast.success('Application type deactivated successfully');
      setConfirmDeactivateTypeId(null);
    } catch (e: any) {
      const message = e?.message || 'Deactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function openCreateCategory() {
    setEditingCategory(null);
    // Wire in the type currently being browsed so the new category sorts
    // under it immediately instead of landing unsorted.
    setCategoryForm({
      name: '',
      description: '',
      application_types: selectedTypeCode && selectedTypeCode !== '__all__' ? [selectedTypeCode] : [],
    });
    setIsCategoryPanelOpen(true);
  }

  function openEditCategory(row: CategoryRow) {
    setEditingCategory(row);
    setCategoryForm({
      name: row.name || '',
      description: row.description || '',
      application_types: [...(row.application_types || [])],
    });
    setIsCategoryPanelOpen(true);
  }

  function toggleCategoryApplicationType(code: string) {
    setCategoryForm((p) => ({
      ...p,
      application_types: p.application_types.includes(code)
        ? p.application_types.filter((c) => c !== code)
        : [...p.application_types, code],
    }));
  }

  async function saveCategory() {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim() || null,
        application_types: categoryForm.application_types,
      };
      if (!payload.name) throw new Error('Category name is required');

      const res = await fetch(
        api(editingCategory ? `/api/requirement-categories/${editingCategory.id}` : '/api/requirement-categories'),
        {
          method: editingCategory ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');
      setIsCategoryPanelOpen(false);
      setError(null);
      await refresh({ showLoading: false });
      toast.success(editingCategory ? 'Category updated successfully' : 'Category created successfully');
    } catch (e: any) {
      const message = e?.message || 'Save failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateCategory(id: number) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/requirement-categories/${id}/deactivate`), { method: 'PATCH', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Deactivate failed');
      setError(null);
      await refresh({ showLoading: false });
      toast.success('Category deactivated successfully');
      setConfirmDeactivateCategoryId(null);
    } catch (e: any) {
      const message = e?.message || 'Deactivate failed';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const canSubmitType = useMemo(() => {
    const code = typeForm.code.trim();
    const name = typeForm.name.trim();
    if (!code || !name) return false;
    if (!editingType) return true;
    const description = typeForm.description.trim();
    return (
      code !== (editingType.code || '').trim() ||
      name !== (editingType.name || '').trim() ||
      description !== (editingType.description || '').trim()
    );
  }, [editingType, typeForm]);

  const canSubmitCategory = useMemo(() => {
    const name = categoryForm.name.trim();
    if (!name) return false;
    if (!editingCategory) return true;
    const description = categoryForm.description.trim();
    const originalTypes = [...(editingCategory.application_types || [])].sort().join(',');
    const currentTypes = [...categoryForm.application_types].sort().join(',');
    return (
      name !== (editingCategory.name || '').trim() ||
      description !== (editingCategory.description || '').trim() ||
      currentTypes !== originalTypes
    );
  }, [editingCategory, categoryForm]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
        <StatCard label="Active Requirements" value={String(stats.active)} />
        <StatCard label="Total Requirements" value={String(stats.total)} />
        <StatCard
          label="Deactivated"
          value={String(stats.inactive)}
          onClick={() => setIsRecoveryOpen(true)}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        {canAdd ? (
          <button
            className="rounded-lg px-3 py-2 text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            onClick={openCreate}
          >
            <Plus size={15} />
            New Requirement
          </button>
        ) : null}
      </div>

      {/* Tree browser: Application Types expand inline to reveal their
          Requirement Categories (several can stay open at once); picking a
          category filters the Requirements table beside it. */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Type/Category tree */}
        <div className="glass-card p-3 w-full lg:w-72 shrink-0 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          {(canAddTypes || canAddCategories) ? (
            <div className="flex items-center gap-1.5 mb-2">
              {canAddTypes ? (
                <button
                  onClick={openCreateType}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold cursor-pointer"
                  style={{ backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
                >
                  <Plus size={11} /> Type
                </button>
              ) : null}
              {canAddCategories ? (
                <button
                  onClick={openCreateCategory}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold cursor-pointer"
                  style={{ backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
                >
                  <Plus size={11} /> Category
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-0.5">
            {typePanelOptions.map((t) => {
              const expanded = expandedTypeCodes.has(t.code);
              const typeCategories = categoryOptionsByType.get(t.code) || [];
              const typeRow = t.code !== '__all__' ? applicationTypeByCode.get(t.code) : null;
              return (
                <div key={t.code}>
                  <div className="group rounded-lg flex items-center gap-0.5 hover:bg-white/5">
                    <button
                      onClick={() => toggleTypeExpand(t.code)}
                      className="flex-1 min-w-0 px-2 py-1.5 text-xs font-semibold cursor-pointer transition-colors flex items-center gap-2"
                    >
                      {expanded ? (
                        <FolderOpen size={15} className="shrink-0 text-secondary" />
                      ) : (
                        <Folder size={15} className="shrink-0 text-secondary" />
                      )}
                      <span className="flex-1 text-left truncate" style={{ color: 'var(--text)' }}>
                        {t.name}
                      </span>
                    </button>

                    {/* Count badge and hover actions share this slot so the
                        row width never jumps between the two states. */}
                    <div className="relative shrink-0 w-12 h-6 mr-1">
                      <div
                        className={cn('absolute inset-0 flex items-center justify-end transition-opacity', typeRow && 'group-hover:opacity-0')}
                      >
                        <span
                          className="rounded-full px-1.5 text-[10px]"
                          style={{ backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }}
                        >
                          {t.count}
                        </span>
                      </div>
                      {typeRow ? (
                        <div className="absolute inset-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canEditTypes ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditType(typeRow);
                              }}
                              className="inline-flex items-center justify-center rounded-md p-1 text-secondary cursor-pointer hover:bg-white/10"
                              title="Edit type"
                              aria-label={`Edit ${typeRow.name}`}
                            >
                              <Pencil size={12} />
                            </button>
                          ) : null}
                          {canDeleteTypes ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeactivateTypeId(typeRow.id);
                              }}
                              className="inline-flex items-center justify-center rounded-md p-1 text-secondary cursor-pointer hover:bg-white/10"
                              title="Deactivate type"
                              aria-label={`Deactivate ${typeRow.name}`}
                            >
                              <Ban size={12} />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {expanded ? (
                    <div className="flex flex-col gap-0.5 mt-0.5 mb-1 ml-[18px] pl-2 border-l" style={{ borderColor: 'var(--border-subtle)' }}>
                      {typeCategories.map((c) => {
                        const active = selectedTypeCode === t.code && selectedCategoryKey === c.key;
                        const catRow = c.key !== '__all__' && c.key !== '__uncategorized__' ? categoryById.get(c.key) : null;
                        return (
                          <div
                            key={c.key}
                            className="group rounded-md flex items-center gap-0.5"
                            style={{ backgroundColor: active ? 'var(--nav-active-bg)' : 'transparent' }}
                          >
                            <button
                              onClick={() => selectCategory(t.code, c.key)}
                              className="flex-1 min-w-0 px-2 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-2"
                              style={{ color: active ? 'var(--nav-active-text)' : 'var(--text)' }}
                            >
                              <Minus size={12} className="shrink-0 opacity-60" />
                              <span className="flex-1 text-left truncate">{c.name}</span>
                            </button>

                            {/* Count badge and hover actions share this slot so the
                                row width never jumps between the two states. */}
                            <div className="relative shrink-0 w-11 h-6 mr-1">
                              <div
                                className={cn('absolute inset-0 flex items-center justify-end transition-opacity', catRow && 'group-hover:opacity-0')}
                              >
                                <span
                                  className="rounded-full px-1.5 text-[10px]"
                                  style={{
                                    backgroundColor: active ? 'color-mix(in oklab, var(--nav-active-text) 20%, transparent)' : 'var(--control-bg)',
                                    color: active ? 'var(--nav-active-text)' : 'var(--text-muted)',
                                  }}
                                >
                                  {c.count}
                                </span>
                              </div>
                              {catRow ? (
                                <div className="absolute inset-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {canEditCategories ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openEditCategory(catRow);
                                      }}
                                      className="inline-flex items-center justify-center rounded-md p-1 cursor-pointer hover:bg-white/10"
                                      style={{ color: active ? 'var(--nav-active-text)' : 'var(--text-muted)' }}
                                      title="Edit category"
                                      aria-label={`Edit ${catRow.name}`}
                                    >
                                      <Pencil size={11} />
                                    </button>
                                  ) : null}
                                  {canDeleteCategories ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmDeactivateCategoryId(catRow.id);
                                      }}
                                      className="inline-flex items-center justify-center rounded-md p-1 cursor-pointer hover:bg-white/10"
                                      style={{ color: active ? 'var(--nav-active-text)' : 'var(--text-muted)' }}
                                      title="Deactivate category"
                                      aria-label={`Deactivate ${catRow.name}`}
                                    >
                                      <Ban size={11} />
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Requirements table, filtered by whatever's picked in the tree */}
        <div className="glass-card p-4 sm:p-5 flex-1 w-full min-w-0 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        {error && (
          <div className="mb-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-subtle)', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        <div className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold uppercase tracking-widest text-secondary">
          Requirements
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div className="relative group w-full sm:w-72">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search requirements..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="py-2">
            <TableSkeleton columns={5} rows={5} />
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            title="No requirements found"
            description={
              searchQuery
                ? 'Try adjusting your search filters.'
                : 'No requirements match this type/category combination yet. Create one to get started.'
            }
            action={
              !searchQuery && canAdd ? (
                <button
                  className="rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={openCreate}
                >
                  Create Requirement
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Code', 'Name', 'Category', 'Flags', 'Actions'].map((col) => (
                    <th
                      key={col}
                      className={cn(
                        'px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary',
                        col === 'Actions' && 'text-right pr-2'
                      )}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((item) => (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{item.code}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{item.name}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">{item.category_name || '-'}</td>
                    <td className="px-3 py-2 text-[11px] text-secondary">
                      <div>
                        {[item.for_new ? 'New' : null, item.for_renewal ? 'Renewal' : null, item.is_mandatory ? 'Mandatory' : 'Optional']
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                      <div className="text-[10px] mt-0.5 opacity-80">{applicationTypesLabel(item.application_types)}</div>
                    </td>
                    <td className="px-3 py-2 pr-2">
                      <div className="flex items-center justify-end gap-2">
                        {canEdit ? (
                          <button
                            className={cn(
                              'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                            )}
                            onClick={() => openEdit(item)}
                            disabled={saving}
                            aria-label={`Edit ${item.name}`}
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            className={cn(
                              'inline-flex items-center justify-center rounded-md p-1.5 text-secondary',
                              saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                            )}
                            onClick={() => setConfirmDeactivateId(item.id)}
                            disabled={saving}
                            aria-label={`Deactivate ${item.name}`}
                            title="Deactivate"
                          >
                            <Ban size={14} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <DataTableControls
              page={page}
              totalPages={totalPages}
              totalItems={filteredItems.length}
              showingFrom={showingRange.from}
              showingTo={showingRange.to}
              visiblePageNumbers={visiblePageNumbers}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100, 200]}
              onPageSizeChange={(value) => setPageSize(value)}
              onPageChange={(p) => setPage(p)}
              loading={isLoading || isRevalidating}
            />
          </div>
        )}
        </div>
      </div>

      <SidePanel
        open={isCreateOpen}
        title={editing ? 'Edit Requirement' : 'New Requirements'}
        subtitle="Requirements master table"
        onClose={() => setIsCreateOpen(false)}
        onSave={save}
        saving={saving}
        saveDisabled={!canSubmit}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Code">
            <input
              className="app-form-control"
              value={form.code}
              onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
            />
          </Field>
          <Field label="Name">
            <input
              className="app-form-control"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>
          <Field label="Category">
            <AppSelect
              options={categoryOptions}
              value={form.category_id}
              onChange={(value) => setForm((p) => ({ ...p, category_id: value || '' }))}
              placeholder="Select category..."
              isClearable
              isDisabled={saving}
            />
          </Field>
          <Field label="Description">
            <input
              className="app-form-control"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <CheckToggle
              label="For New"
              checked={form.for_new}
              onChange={(checked) => setForm((p) => ({ ...p, for_new: checked }))}
            />
            <CheckToggle
              label="For Renewal"
              checked={form.for_renewal}
              onChange={(checked) => setForm((p) => ({ ...p, for_renewal: checked }))}
            />
            <CheckToggle
              label="Mandatory"
              checked={form.is_mandatory}
              onChange={(checked) => setForm((p) => ({ ...p, is_mandatory: checked }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Field label="Application Types">
              {activeApplicationTypes.length === 0 ? (
                <p className="text-[11px] text-secondary">No active application types configured yet.</p>
              ) : (
                <>
                  <p className="text-[11px] text-secondary mb-2">
                    Leave all unchecked to apply this requirement to every application type.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activeApplicationTypes.map((t) => (
                      <CheckToggle
                        key={t.code}
                        label={t.name}
                        checked={form.application_types.includes(t.code)}
                        onChange={() => toggleApplicationType(t.code)}
                      />
                    ))}
                  </div>
                </>
              )}
            </Field>
          </div>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateId !== null}
        title="Deactivate requirement?"
        description="This requirement will be marked inactive. You can re-activate later."
        confirmText="Deactivate"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateId(null)}
        onConfirm={() => {
          if (confirmDeactivateId !== null) void deactivate(confirmDeactivateId);
        }}
      />

      <ConfirmModal
        open={confirmReactivateId !== null}
        title="Reactivate requirement?"
        description="This requirement will be marked active again."
        confirmText="Reactivate"
        loading={saving}
        onCancel={() => setConfirmReactivateId(null)}
        onConfirm={() => {
          if (confirmReactivateId !== null) void reactivate(confirmReactivateId);
        }}
      />

      <SidePanel
        open={isTypePanelOpen}
        title={editingType ? 'Edit Application Type' : 'New Application Type'}
        subtitle="Application types master table"
        onClose={() => setIsTypePanelOpen(false)}
        onSave={saveType}
        saving={saving}
        saveDisabled={!canSubmitType}
      >
        <div className="grid grid-cols-1 gap-3">
          <Field label="Code">
            <input
              className="app-form-control"
              value={typeForm.code}
              onChange={(e) => setTypeForm((p) => ({ ...p, code: e.target.value }))}
              placeholder="e.g. DIRECT_LEASE"
            />
          </Field>
          <Field label="Name">
            <input
              className="app-form-control"
              value={typeForm.name}
              onChange={(e) => setTypeForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Direct Lease"
            />
          </Field>
          <Field label="Description">
            <input
              className="app-form-control"
              value={typeForm.description}
              onChange={(e) => setTypeForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateTypeId !== null}
        title="Deactivate application type?"
        description="Locators and staff will no longer be able to select this type when filing a new application. You can re-activate it later from Application Types settings."
        confirmText="Deactivate"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateTypeId(null)}
        onConfirm={() => {
          if (confirmDeactivateTypeId !== null) void deactivateType(confirmDeactivateTypeId);
        }}
      />

      <SidePanel
        open={isCategoryPanelOpen}
        title={editingCategory ? 'Edit Requirement Category' : 'New Requirement Category'}
        subtitle="Requirement categories master table"
        onClose={() => setIsCategoryPanelOpen(false)}
        onSave={saveCategory}
        saving={saving}
        saveDisabled={!canSubmitCategory}
      >
        <div className="grid grid-cols-1 gap-3">
          <Field label="Name">
            <input
              className="app-form-control"
              value={categoryForm.name}
              onChange={(e) => setCategoryForm((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>
          <Field label="Description">
            <input
              className="app-form-control"
              value={categoryForm.description}
              onChange={(e) => setCategoryForm((p) => ({ ...p, description: e.target.value }))}
            />
          </Field>
          <Field label="Application Types">
            {activeApplicationTypes.length === 0 ? (
              <p className="text-[11px] text-secondary">No active application types configured yet.</p>
            ) : (
              <>
                <p className="text-[11px] text-secondary mb-2">
                  Leave all unchecked to sort this category under every application type.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeApplicationTypes.map((t) => (
                    <CheckToggle
                      key={t.code}
                      label={t.name}
                      checked={categoryForm.application_types.includes(t.code)}
                      onChange={() => toggleCategoryApplicationType(t.code)}
                    />
                  ))}
                </div>
              </>
            )}
          </Field>
        </div>
      </SidePanel>

      <ConfirmModal
        open={confirmDeactivateCategoryId !== null}
        title="Deactivate requirement category?"
        description="Requirements under this category keep their assignment, but this category will no longer be selectable. You can re-activate it later from Requirement Categories settings."
        confirmText="Deactivate"
        danger
        loading={saving}
        onCancel={() => setConfirmDeactivateCategoryId(null)}
        onConfirm={() => {
          if (confirmDeactivateCategoryId !== null) void deactivateCategory(confirmDeactivateCategoryId);
        }}
      />

      <AnimatePresence>
        {isRecoveryOpen ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-3">
            <motion.div
              className="absolute inset-0"
              style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={() => {
                setIsRecoveryOpen(false);
                setRecoverySearch('');
                setRecoveryPage(1);
              }}
            />
            <motion.div
              className="w-full max-w-3xl max-h-[85vh] rounded-2xl border p-4 sm:p-5 relative z-10 flex flex-col"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                    Deactivated Requirements
                  </h3>
                  <p className="text-xs text-secondary">Recover a requirement to make it active again.</p>
                </div>
                <button
                  className="inline-flex items-center justify-center rounded-md p-1.5 text-secondary cursor-pointer hover:bg-white/5"
                  onClick={() => {
                    setIsRecoveryOpen(false);
                    setRecoverySearch('');
                    setRecoveryPage(1);
                  }}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="relative group w-full mb-3">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
                  size={14}
                />
                <input
                  type="text"
                  placeholder="Search deactivated requirements..."
                  value={recoverySearch}
                  onChange={(e) => setRecoverySearch(e.target.value)}
                  className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
                />
              </div>

              {filteredDeactivatedItems.length === 0 ? (
                <EmptyState
                  title="No deactivated requirements"
                  description={
                    recoverySearch
                      ? 'Try adjusting your search.'
                      : 'There are no deactivated requirements to recover.'
                  }
                />
              ) : (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="overflow-auto flex-1">
                    <table className="min-w-full text-left text-xs">
                      <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--surface)' }}>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          {['Code', 'Name', 'Category', 'Flags', 'Actions'].map((col) => (
                            <th
                              key={col}
                              className={cn(
                                'px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary',
                                col === 'Actions' && 'text-right pr-2'
                              )}
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedDeactivatedItems.map((item) => (
                          <tr key={item.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{item.code}</td>
                            <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text)' }}>{item.name}</td>
                            <td className="px-3 py-2 text-[11px] text-secondary">{item.category_name || '-'}</td>
                            <td className="px-3 py-2 text-[11px] text-secondary">
                              <div>
                                {[item.for_new ? 'New' : null, item.for_renewal ? 'Renewal' : null, item.is_mandatory ? 'Mandatory' : 'Optional']
                                  .filter(Boolean)
                                  .join(', ')}
                              </div>
                              <div className="text-[10px] mt-0.5 opacity-80">{applicationTypesLabel(item.application_types)}</div>
                            </td>
                            <td className="px-3 py-2 pr-2">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-secondary',
                                    saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/5'
                                  )}
                                  onClick={() => setConfirmReactivateId(item.id)}
                                  disabled={saving}
                                  aria-label={`Recover ${item.name}`}
                                  title="Recover"
                                >
                                  <RotateCcw size={13} />
                                  Recover
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <DataTableControls
                    page={recoveryPage}
                    totalPages={recoveryTotalPages}
                    totalItems={filteredDeactivatedItems.length}
                    showingFrom={recoveryShowingRange.from}
                    showingTo={recoveryShowingRange.to}
                    visiblePageNumbers={recoveryVisiblePageNumbers}
                    pageSize={recoveryPageSize}
                    pageSizeOptions={[10, 20, 50]}
                    onPageSizeChange={(value) => setRecoveryPageSize(value)}
                    onPageChange={(p) => setRecoveryPage(p)}
                  />
                </div>
              )}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StatCard({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-xl px-3 py-3 flex flex-col gap-1 shadow-sm text-left w-full transition-colors',
        onClick && 'cursor-pointer hover:bg-white/5'
      )}
      style={{
        backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)',
      }}
      title={onClick ? 'View deactivated items' : undefined}
    >
      <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{label}</span>
      <span className="text-base sm:text-lg font-bold leading-tight" style={{ color: 'var(--text)' }}>
        {value}
      </span>
    </Comp>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{label}</div>
      {children}
    </div>
  );
}

function CheckToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      className="flex items-center gap-2 rounded-lg border border-solid border-[var(--input-border)] px-3 py-2 text-xs cursor-pointer transition-all hover:border-[var(--nav-active-bg)] hover:bg-white/5"
    >
      <input 
      type="checkbox" 
      className="cursor-pointer" 
      checked={checked} 
      onChange={(e) => onChange(e.target.checked)} />
      <span style={{ color: 'var(--text)' }} className="cursor-pointer">{label}</span>
    </label>
  );
}
