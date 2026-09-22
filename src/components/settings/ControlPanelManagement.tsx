import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Loader2, Plus, Save } from 'lucide-react';
import Select, { components, type OptionProps, type StylesConfig } from 'react-select';
import { toast } from 'sonner';
import { Skeleton, TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { AppSelect } from '../ui/AppSelect';
import { LANDING_CONFIG } from '../../config/landingConfig';
import { roleDisplayName } from '../../lib/roleDisplay';

type Role = {
  id: number;
  name: string;
  description?: string | null;
  is_active?: number;
};

type SidebarPermissionMap = Record<string, boolean>;
type CrudPermissionMap = Record<string, { can_add: boolean; can_edit: boolean; can_delete: boolean }>;
type WidgetPermissionMap = Record<string, boolean>;

type MenuItem = {
  key: string;
  label: string;
};

function api(path: string) {
  return path;
}

// DBM-08: the officer/proponent dashboard cards an admin can toggle per
// role. Admin's own dashboard is exempt (fullAccess), so this list only ever
// affects what Officer/Proponent accounts see.
const DASHBOARD_WIDGETS: MenuItem[] = [
  { key: 'dashboard:stats', label: 'Stat Cards' },
  { key: 'dashboard:attention', label: 'Needs Attention List (Officer)' },
  { key: 'dashboard:table', label: 'Applications Table' },
];

// The Locator portal's fixed self-service menu (ProponentSidebar) — separate
// from sidebarMenuItems above since it isn't one of the admin/officer AppView
// pages LANDING_CONFIG describes. Reuses the same role_sidebar_menu_permissions
// table/keys, but defaults to visible (fail-open) when unset, unlike the
// fail-closed sidebarMenuItems above — see ProponentSidebar's canView.
const PROPONENT_MENU_ITEMS: MenuItem[] = [
  { key: 'me:applications', label: 'My Applications' },
  { key: 'me:contracts-permits', label: 'Contracts & Permits' },
  { key: 'me:profile', label: 'My Business Profile' },
  { key: 'me:activity', label: 'Activity History' },
];
const PROPONENT_MENU_KEYS = new Set(PROPONENT_MENU_ITEMS.map((item) => item.key));

/** Fixed widths so CRUD header labels line up with toggle columns. Grid only
 * from `sm` up — on phones each module stacks its switches under the name. */
const CRUD_TOGGLE_COLS_CLASS =
  'sm:grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.25rem] sm:items-center gap-x-3';

/** Pill switch: thumb stays inside track (flex + translateX only — avoids absolute + conflicting translate bugs). */
function PermissionToggle({
  checked,
  onChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  'aria-label'?: string;
}) {
  /** Track is w-[3.25rem] with px-0.5: inner ≈ 3rem; thumb w-6 → travel 1.5rem */
  const thumbTravel = '1.5rem';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative box-border flex h-7 w-[3.25rem] shrink-0 items-center overflow-hidden rounded-full px-0.5 py-0 transition-[background-color,box-shadow] duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nav-active-bg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
      style={{
        backgroundColor: checked ? 'var(--nav-active-bg)' : 'rgba(148, 163, 184, 0.28)',
        boxShadow: checked ? '0 0 0 1px rgba(255,255,255,0.12) inset' : '0 0 0 1px var(--border-subtle) inset',
      }}
    >
      <Check
        className="pointer-events-none absolute left-1.5 top-1/2 z-0 h-3 w-3 -translate-y-1/2 transition-opacity duration-150"
        strokeWidth={3}
        style={{
          color: 'var(--nav-active-text, #fff)',
          opacity: checked ? 0.95 : 0,
        }}
      />
      <span
        className="pointer-events-none relative z-[1] h-6 w-6 shrink-0 rounded-full bg-white shadow-md transition-transform duration-200 ease-out"
        style={{
          transform: checked ? `translateX(${thumbTravel})` : 'translateX(0)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

type ApprovalLevel = {
  id: number;
  level_no: number;
  name: string;
  role_id: number | null;
  role_name: string | null;
  is_active: number | boolean;
  assignees: { id: number; full_name: string | null; username: string }[];
};

type Approver = { id: number; full_name: string | null; username: string };
type ApproverOption = { value: number; label: string };

const approverSelectStyles: StylesConfig<ApproverOption, true> = {
  control: (base, state) => ({
    ...base,
    minHeight: 32,
    backgroundColor: 'var(--input-bg)',
    borderStyle: 'solid',
    borderWidth: '1px',
    borderColor: state.isFocused ? 'var(--nav-active-bg)' : 'var(--input-border)',
    borderRadius: '0.5rem',
    boxShadow: 'none',
    cursor: 'pointer',
  }),
  valueContainer: (base) => ({ ...base, padding: '2px 8px', gap: 4 }),
  input: (base) => ({ ...base, color: 'var(--text)', margin: 0 }),
  placeholder: (base) => ({ ...base, color: 'var(--text-muted)', fontSize: 12 }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 14%, transparent)',
    borderRadius: 6,
  }),
  multiValueLabel: (base) => ({ ...base, color: 'var(--nav-active-bg)', fontSize: 11, padding: '2px 4px' }),
  multiValueRemove: (base) => ({
    ...base,
    color: 'var(--nav-active-bg)',
    cursor: 'pointer',
    ':hover': { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' },
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (base) => ({
    ...base,
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--input-border)',
    boxShadow: '0 10px 30px rgba(0,0,0,.25)',
    overflow: 'hidden',
  }),
  menuList: (base) => ({ ...base, scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }),
  option: (base) => ({ ...base, fontSize: 12, backgroundColor: 'transparent', cursor: 'pointer' }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base) => ({ ...base, padding: 4, color: 'var(--text-muted)' }),
  clearIndicator: (base) => ({ ...base, padding: 4, color: 'var(--text-muted)' }),
};

/** Custom checkbox-row Option — react-select's isMulti already gives a
 * dropdown + removable chips instead of the native multi-select listbox, but
 * the default option row doesn't show a checkbox, so this adds one. */
function ApproverOptionRow(props: OptionProps<ApproverOption, true>) {
  return (
    <components.Option {...props}>
      <div className="flex items-center gap-2">
        <span
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border"
          style={{
            borderColor: props.isSelected ? 'var(--nav-active-bg)' : 'var(--input-border)',
            backgroundColor: props.isSelected ? 'var(--nav-active-bg)' : 'transparent',
          }}
        >
          {props.isSelected ? <Check size={10} color="var(--nav-active-text)" /> : null}
        </span>
        <span style={{ color: 'var(--text)' }}>{props.label}</span>
      </div>
    </components.Option>
  );
}

/** Dropdown multi-select of candidate approvers (real users, not roles) — a
 * level can be narrowed to specific individuals instead of a role name.
 * Selecting none leaves the level open to anyone with Approval & Issuance
 * access. */
function ApproverMultiSelectField({
  approvers,
  selectedIds,
  disabled,
  onChange,
}: {
  approvers: Approver[];
  selectedIds: number[];
  disabled?: boolean;
  onChange: (userIds: number[]) => void;
}) {
  const options: ApproverOption[] = approvers.map((a) => ({ value: a.id, label: a.full_name || a.username }));
  if (approvers.length === 0) {
    return (
      <p className="text-[11px] text-secondary">
        No eligible approvers yet — grant a role Sidebar access to Approval & Issuance first.
      </p>
    );
  }
  return (
    <Select<ApproverOption, true>
      isMulti
      options={options}
      value={options.filter((o) => selectedIds.includes(o.value))}
      isDisabled={disabled}
      closeMenuOnSelect={false}
      hideSelectedOptions={false}
      placeholder="Select approvers..."
      classNamePrefix="app-select"
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      menuPlacement="auto"
      menuPosition="fixed"
      styles={approverSelectStyles}
      components={{ Option: ApproverOptionRow }}
      onChange={(opts) => onChange((opts ? Array.from(opts) : []).map((o) => o.value))}
      noOptionsMessage={() => 'No matches found'}
    />
  );
}

/** Embedded directly under the "Approval & Issuance" row (not its own
 * Sidebar Menu Permissions page, not its own CRUD toggle) — the approval
 * ladder (dbo.approval_levels) is a single GLOBAL config, not something that
 * varies per role the way Add/Edit/Delete switches do, so it belongs here as
 * live content rather than as one more per-role permission row. Reachable
 * only by whoever can already open Control Panel itself. */
function ApprovalWorkflowLevelsSection() {
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  // Candidate pool for the per-level "Approvers" multi-select — the same
  // set listApprovers() already computes server-side (admins + anyone whose
  // role currently has approval:queue sidebar access), so if only Assessment
  // Officer has that module enabled, this list is effectively just their
  // users plus admin.
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', assigneeIds: [] as number[] });

  const load = useCallback(async () => {
    const res = await fetch(api('/api/approvals/levels?includeInactive=1'), { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || 'Failed to load approval levels');
    setLevels(json.data || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [, approversRes] = await Promise.all([
          load(),
          fetch(api('/api/approvals/approvers'), { credentials: 'include' }),
        ]);
        const approversJson = await approversRes.json().catch(() => ({}));
        if (approversRes.ok) setApprovers(approversJson.data || []);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<Response>, msg?: string) => {
      setBusy(true);
      try {
        const res = await fn();
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.message || 'Request failed');
        await load();
        if (msg) toast.success(msg);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Approval Workflow Setup</div>
        <p className="text-[11px] text-secondary mt-0.5">
          Ordered levels every new approval routes through — a global setting, not per-role. Existing approvals keep the
          ladder they started with.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-secondary" size={18} />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {levels.map((lvl, idx) => (
              <div
                key={lvl.id}
                className="rounded-lg border p-2.5 flex flex-col gap-2"
                style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)', opacity: lvl.is_active ? 1 : 0.5 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 flex items-center gap-1 text-[13px] font-semibold">
                    <span className="shrink-0" style={{ color: 'var(--text)' }}>
                      L{lvl.level_no} ·
                    </span>
                    <input
                      key={`${lvl.id}-${lvl.name}`}
                      defaultValue={lvl.name}
                      disabled={busy}
                      placeholder="Describe this level, e.g. Legal review before endorsement"
                      aria-label={`Description for level ${lvl.level_no}`}
                      className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-[13px] font-semibold bg-transparent border border-transparent hover:border-[var(--border-subtle)] focus:outline-none transition-colors"
                      style={{ color: 'var(--text)', borderColor: 'transparent' }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'var(--nav-active-bg)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'transparent';
                        const next = e.target.value.trim();
                        if (!next) {
                          e.target.value = lvl.name;
                          toast.error('Description cannot be empty');
                          return;
                        }
                        if (next === lvl.name) return;
                        run(
                          () =>
                            fetch(api(`/api/approvals/levels/${lvl.id}`), {
                              method: 'PUT',
                              credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ name: next }),
                            }),
                          'Description updated'
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[11px] border disabled:opacity-40 cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)' }}
                      disabled={busy || idx === 0}
                      onClick={() =>
                        run(async () => {
                          const prev = levels[idx - 1];
                          await fetch(api(`/api/approvals/levels/${lvl.id}`), {
                            method: 'PUT',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level_no: prev.level_no }),
                          });
                          return fetch(api(`/api/approvals/levels/${prev.id}`), {
                            method: 'PUT',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level_no: lvl.level_no }),
                          });
                        }, 'Reordered')
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[11px] border disabled:opacity-40 cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)' }}
                      disabled={busy || idx === levels.length - 1}
                      onClick={() =>
                        run(async () => {
                          const next = levels[idx + 1];
                          await fetch(api(`/api/approvals/levels/${lvl.id}`), {
                            method: 'PUT',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level_no: next.level_no }),
                          });
                          return fetch(api(`/api/approvals/levels/${next.id}`), {
                            method: 'PUT',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level_no: lvl.level_no }),
                          });
                        }, 'Reordered')
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[11px] border disabled:opacity-40 cursor-pointer"
                      style={{ borderColor: 'var(--border-subtle)' }}
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            fetch(api(`/api/approvals/levels/${lvl.id}`), {
                              method: 'PUT',
                              credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ is_active: !lvl.is_active }),
                            }),
                          lvl.is_active ? 'Level disabled' : 'Level enabled'
                        )
                      }
                    >
                      {lvl.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <ApproverMultiSelectField
                    approvers={approvers}
                    selectedIds={(lvl.assignees || []).map((a) => a.id)}
                    disabled={busy}
                    onChange={(nextIds) =>
                      run(
                        () =>
                          fetch(api(`/api/approvals/levels/${lvl.id}`), {
                            method: 'PUT',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ assignee_user_ids: nextIds }),
                          }),
                        'Approvers updated'
                      )
                    }
                  />
                </div>
              </div>
            ))}
            {levels.length === 0 ? (
              <p className="text-[11px] text-secondary text-center py-2">No levels configured yet.</p>
            ) : null}
          </div>

          <div className="rounded-lg border p-2.5 flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-secondary">Add level</div>
            <input
              className="rounded-md border px-2 py-1.5 text-[12px]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Description, e.g. Legal review before endorsement"
            />
            <div className="flex flex-col gap-1">
              <ApproverMultiSelectField
                approvers={approvers}
                selectedIds={form.assigneeIds}
                disabled={busy}
                onChange={(nextIds) => setForm((f) => ({ ...f, assigneeIds: nextIds }))}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50 cursor-pointer"
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                disabled={busy || !form.name.trim()}
                onClick={() =>
                  run(
                    () =>
                      fetch(api('/api/approvals/levels'), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: form.name.trim(),
                          assignee_user_ids: form.assigneeIds,
                        }),
                      }),
                    'Level added'
                  ).then(() => setForm({ name: '', assigneeIds: [] }))
                }
              >
                <Plus size={13} className="inline mr-1" /> Add
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ControlPanelManagement({ locationSearch }: { locationSearch?: string } = {}) {
  const [activeTab, setActiveTab] = useState<'sidebar' | 'crud' | 'widgets'>('sidebar');
  const [roles, setRoles] = useState<Role[]>([]);
  // Pre-selects the role named in ?roleId=... (e.g. arriving here via
  // RolesPanel's "Configure in Control Panel" nudge right after creating a
  // role) — loadRoles()'s own `prev || ...` fallback below only picks a
  // default when this is still empty, so a query-param value always wins.
  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    () => new URLSearchParams(locationSearch || '').get('roleId') || ''
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sidebarPermissions, setSidebarPermissions] = useState<SidebarPermissionMap>({});
  const [crudPermissions, setCrudPermissions] = useState<CrudPermissionMap>({});
  const [widgetPermissions, setWidgetPermissions] = useState<WidgetPermissionMap>({});

  const isExcludedRole = (role: Role) => String(role.name || '').trim().toLowerCase() === 'admin';

  const sidebarMenuItems: MenuItem[] = useMemo(
    () => Object.entries(LANDING_CONFIG).map(([key, cfg]) => ({ key, label: cfg.title })),
    []
  );

  // Every CRUD-capable menu, regardless of current Sidebar visibility — this
  // stays the full set so saveCrudPermissions() (below) never drops a
  // hidden menu's already-configured Add/Edit/Delete permissions just
  // because it isn't rendered this session. Re-checking a Sidebar box later
  // brings its previously-saved CRUD row right back.
  const crudMenuItems: MenuItem[] = useMemo(
    () =>
      Object.entries(LANDING_CONFIG)
        .filter(([, cfg]) => Boolean((cfg as any)?.isCrud))
        .map(([key, cfg]) => ({ key, label: (cfg as any).title })),
    []
  );

  // What actually RENDERS as a togglable row — scoped to menus the selected
  // role can even SEE in their sidebar. A CRUD toggle for a menu they don't
  // have Sidebar access to would be dead configuration (they can never
  // reach that screen to use it) and reads as the two tabs disagreeing
  // about what this role can do. Reactive to sidebarPermissions, not just
  // the saved value, so unchecking a Sidebar box drops the row immediately.
  const visibleCrudMenuItems: MenuItem[] = useMemo(
    () => crudMenuItems.filter((item) => Boolean(sidebarPermissions[item.key])),
    [crudMenuItems, sidebarPermissions]
  );

  const selectedRole = useMemo(
    () => roles.find((r) => String(r.id) === selectedRoleId) || null,
    [roles, selectedRoleId]
  );
  const isLocatorRoleSelected = String(selectedRole?.name || '').trim().toUpperCase() === 'PROPONENT';

  // The Locator role's own menu items ride along in the same "Sidebar Menu
  // Permissions" card/columns as everything else — a separate box just for
  // one role read as a stray, disconnected section. Split into 3 evenly-sized
  // columns (instead of a fixed 10/rest split) so a short remainder column
  // doesn't end up mostly empty next to a full one.
  const sidebarMenuColumns = useMemo(() => {
    const items = isLocatorRoleSelected ? [...sidebarMenuItems, ...PROPONENT_MENU_ITEMS] : sidebarMenuItems;
    const perColumn = Math.ceil(items.length / 3) || 1;
    return [
      { offset: 0, items: items.slice(0, perColumn) },
      { offset: perColumn, items: items.slice(perColumn, perColumn * 2) },
      { offset: perColumn * 2, items: items.slice(perColumn * 2) },
    ];
  }, [sidebarMenuItems, isLocatorRoleSelected]);

  async function loadRoles() {
    setLoading(true);
    try {
      const res = await fetch(api('/api/roles'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load roles');
      const nextRoles = (json.data || []) as Role[];
      const allowedRoles = nextRoles.filter((r) => !isExcludedRole(r));
      setRoles(allowedRoles);
      if (allowedRoles.length > 0) {
        setSelectedRoleId((prev) => prev || String(allowedRoles[0].id));
      } else {
        setSelectedRoleId('');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  async function loadSidebarPermissions(roleId: string) {
    const res = await fetch(api(`/api/control-panel/sidebar-menu/${roleId}`), { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || 'Failed to load sidebar permissions');
    const next: SidebarPermissionMap = {};
    (json?.data || []).forEach((row: any) => {
      next[String(row.menu_key)] = Number(row.is_enabled) === 1 || row.is_enabled === true;
    });
    setSidebarPermissions(next);
  }

  async function loadCrudPermissions(roleId: string) {
    const res = await fetch(api(`/api/control-panel/menu-crud/${roleId}`), { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || 'Failed to load CRUD permissions');
    const next: CrudPermissionMap = {};
    (json?.data || []).forEach((row: any) => {
      next[String(row.menu_key)] = {
        can_add: Number(row.can_add) === 1 || row.can_add === true,
        can_edit: Number(row.can_edit) === 1 || row.can_edit === true,
        can_delete: Number(row.can_delete) === 1 || row.can_delete === true,
      };
    });
    setCrudPermissions(next);
  }

  useEffect(() => {
    loadRoles();
  }, []);

  async function loadWidgetPermissions(roleId: string) {
    const res = await fetch(api(`/api/control-panel/dashboard-widgets/${roleId}`), { credentials: 'include' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || 'Failed to load dashboard widget permissions');
    const next: WidgetPermissionMap = {};
    (json?.data || []).forEach((row: any) => {
      next[String(row.widget_key)] = Number(row.is_enabled) === 1 || row.is_enabled === true;
    });
    setWidgetPermissions(next);
  }

  useEffect(() => {
    if (!selectedRoleId) return;
    const run = async () => {
      try {
        await Promise.all([
          loadSidebarPermissions(selectedRoleId),
          loadCrudPermissions(selectedRoleId),
          loadWidgetPermissions(selectedRoleId),
        ]);
      } catch (e: any) {
        toast.error(e?.message || 'Failed to load control panel data');
      }
    };
    run();
  }, [selectedRoleId]);

  async function saveSidebarPermissions() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const payload = [
        ...sidebarMenuItems.map((item) => ({
          menu_key: item.key,
          is_enabled: Boolean(sidebarPermissions[item.key]),
        })),
        // Only part of this role's saved set when it's the Locator role being
        // edited — otherwise saving another role's sidebar would silently
        // wipe the Locator portal menu rows (this save replaces the full set
        // for the role, not just the keys shown on screen).
        ...(isLocatorRoleSelected
          ? PROPONENT_MENU_ITEMS.map((item) => ({
              menu_key: item.key,
              is_enabled: sidebarPermissions[item.key] ?? true,
            }))
          : []),
      ];
      const res = await fetch(api(`/api/control-panel/sidebar-menu/${selectedRoleId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ permissions: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save sidebar permissions');
      toast.success('Sidebar menu permissions saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save sidebar permissions');
    } finally {
      setSaving(false);
    }
  }

  async function saveWidgetPermissions() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const payload = DASHBOARD_WIDGETS.map((item) => ({
        widget_key: item.key,
        // Missing key defaults to visible (fail-open) — write that default
        // back explicitly so "no row yet" and "explicitly turned on" agree.
        is_enabled: widgetPermissions[item.key] ?? true,
      }));
      const res = await fetch(api(`/api/control-panel/dashboard-widgets/${selectedRoleId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ permissions: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save dashboard widget permissions');
      toast.success('Dashboard widget permissions saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save dashboard widget permissions');
    } finally {
      setSaving(false);
    }
  }

  async function saveCrudPermissions() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const payload = crudMenuItems.map((item) => ({
        menu_key: item.key,
        can_add: Boolean(crudPermissions[item.key]?.can_add),
        can_edit: Boolean(crudPermissions[item.key]?.can_edit),
        can_delete: Boolean(crudPermissions[item.key]?.can_delete),
      }));
      const res = await fetch(api(`/api/control-panel/menu-crud/${selectedRoleId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ permissions: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save CRUD permissions');
      toast.success('Menu CRUD permissions saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save CRUD permissions');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="mt-3">
        <div
          role="tablist"
          aria-label="Control Panel Tabs"
          className="flex rounded-xl border p-1"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
        >
          {(
            [
              ['sidebar', 'Sidebar', 'Menu Permissions', 'Sidebar'],
              ['crud', 'CRUD', 'Permissions', 'CRUD'],
              ['widgets', 'Dashboard', 'Widgets', 'Widgets'],
            ] as const
          ).map(([key, caption, title, shortTitle]) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              className="flex-1 min-w-0 rounded-lg px-2 sm:px-3 py-2 flex flex-col gap-0.5 text-center sm:text-left transition-colors cursor-pointer"
              style={
                activeTab === key
                  ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                  : { backgroundColor: 'transparent', color: 'var(--text)' }
              }
              onClick={() => setActiveTab(key)}
            >
              <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-widest opacity-80">{caption}</span>
              {/* Phones: one short word per tab so all three fit without wrapping. */}
              <span className="sm:hidden text-[12px] font-bold leading-tight tracking-tight">{shortTitle}</span>
              <span className="hidden sm:block text-sm font-bold leading-tight tracking-tight">{title}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        {loading && !roles.length ? (
          <div className="py-2">
            <Skeleton className="h-[200px] w-full rounded-xl" />
          </div>
        ) : !selectedRoleId ? (
          <EmptyState
            title="No roles found"
            description="There are no roles available to manage permissions for."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 sm:gap-4">
            {/* Phones/tablets: a role dropdown instead of the tall role list,
                so the permission switches are visible without scrolling. */}
            <div className="lg:hidden space-y-1">
              <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">Role</div>
              <AppSelect
                value={selectedRoleId}
                onChange={(v) => v && setSelectedRoleId(v)}
                options={roles.map((role) => ({ value: String(role.id), label: roleDisplayName(role.name) }))}
                isClearable={false}
              />
              {selectedRole?.description ? (
                <div className="text-[10px] text-secondary">{selectedRole.description}</div>
              ) : null}
            </div>

            <div
              className="hidden lg:block rounded-xl border p-3 h-fit"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
            >
              <div className="mb-2 text-[10px] font-semibold text-secondary uppercase tracking-widest">Roles</div>
              <div className="space-y-1.5">
                {roles.map((role) => {
                  const isActive = String(role.id) === selectedRoleId;
                  return (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRoleId(String(role.id))}
                      className="w-full rounded-lg px-2.5 py-2 text-left text-[11px] cursor-pointer"
                      style={
                        isActive
                          ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                          : { backgroundColor: 'transparent', color: 'var(--text)' }
                      }
                    >
                      <div className="font-semibold leading-tight">{roleDisplayName(role.name)}</div>
                      <div
                        className="text-[10px] opacity-70 leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                        title={role.description || `ID ${role.id}`}
                      >
                        {role.description || `ID ${role.id}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 sm:rounded-xl sm:border sm:p-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">
                    {activeTab === 'sidebar'
                      ? 'Sidebar Menu Permissions'
                      : activeTab === 'crud'
                        ? 'Menu CRUD Permissions'
                        : 'Dashboard Widget Visibility'}
                  </div>
                  <div className="text-[12px] text-secondary">
                    {activeTab === 'sidebar'
                      ? `Showing sidebar menus for ${selectedRole ? roleDisplayName(selectedRole.name) : 'selected role'}`
                      : activeTab === 'crud'
                        ? `Configure CRUD modules for ${selectedRole ? roleDisplayName(selectedRole.name) : 'selected role'}`
                        : `Choose which dashboard cards ${selectedRole ? roleDisplayName(selectedRole.name) : 'this role'} sees`}
                  </div>
                </div>
                <button
                  type="button"
                  className="group relative inline-flex shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-3 py-1.5 text-[11px] font-semibold tracking-wide shadow-sm transition-[transform,box-shadow,filter,opacity] duration-200 ease-out hover:brightness-110 hover:shadow-md active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
                  style={{
                    backgroundColor: 'var(--nav-active-bg)',
                    color: 'var(--nav-active-text)',
                    boxShadow:
                      '0 1px 2px rgba(0,0,0,0.12), 0 4px 14px color-mix(in srgb, var(--nav-active-bg) 45%, transparent)',
                  }}
                  onClick={
                    activeTab === 'sidebar'
                      ? saveSidebarPermissions
                      : activeTab === 'crud'
                        ? saveCrudPermissions
                        : saveWidgetPermissions
                  }
                  disabled={saving || loading}
                >
                  <span
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 50%)',
                    }}
                  />
                  {saving ? (
                    <Loader2 className="relative h-3.5 w-3.5 shrink-0 animate-spin opacity-95" aria-hidden />
                  ) : (
                    <Save className="relative h-3.5 w-3.5 shrink-0 opacity-95 transition-transform duration-200 group-hover:scale-105" aria-hidden />
                  )}
                  <span className="relative">{saving ? 'Saving…' : 'Save changes'}</span>
                </button>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {activeTab === 'sidebar' ? (
                  <motion.div
                    key={`sidebar-${selectedRoleId}`}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="space-y-2"
                  >
                    <div
                      className="space-y-2 rounded-xl border p-2"
                      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
                    >
                      <div
                        className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2 border rounded-lg text-[10px] font-semibold uppercase tracking-widest text-secondary"
                        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
                      >
                        <span className="min-w-0">Menu Item</span>
                        <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                          Visible
                        </span>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        {sidebarMenuColumns
                          .filter((c) => c.items.length > 0)
                          .map((column) => (
                          <div key={`sidebar-column-${column.offset}`} className="space-y-2">
                            {column.items.map((item) => {
                              const enabled = PROPONENT_MENU_KEYS.has(item.key)
                                ? sidebarPermissions[item.key] ?? true
                                : Boolean(sidebarPermissions[item.key]);
                              return (
                              <div
                                key={item.key}
                                className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2.5 border rounded-lg transition-colors"
                                style={{
                                  borderColor: 'var(--border-subtle)',
                                  backgroundColor: enabled ? 'var(--surface)' : 'transparent',
                                }}
                              >
                                <span className="min-w-0 text-[11px]" style={{ color: 'var(--text)' }}>
                                  {item.label}
                                </span>
                                <div className="flex min-h-[1.75rem] items-center justify-center">
                                  <PermissionToggle
                                    aria-label={`${item.label} sidebar visible`}
                                    checked={enabled}
                                    onChange={(next) =>
                                      setSidebarPermissions((prev) => ({
                                        ...prev,
                                        [item.key]: next,
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : activeTab === 'crud' ? (
                  <motion.div
                    key={`crud-${selectedRoleId}`}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="space-y-2"
                  >
                    <div
                      className={`hidden sm:grid ${CRUD_TOGGLE_COLS_CLASS} gap-y-1 px-3 py-2 border rounded-lg text-[10px] font-semibold uppercase tracking-widest text-secondary`}
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <span className="min-w-0">Module</span>
                      <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                        Add
                      </span>
                      <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                        Edit
                      </span>
                      <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">
                        Delete
                      </span>
                    </div>
                    {visibleCrudMenuItems.length === 0 ? (
                      <p className="text-[11px] text-secondary px-3 py-4 text-center">
                        No CRUD-capable modules are enabled for this role in Sidebar Menu Permissions yet.
                      </p>
                    ) : null}
                    {visibleCrudMenuItems.map((item) => {
                      const row = crudPermissions[item.key] || {
                        can_add: false,
                        can_edit: false,
                        can_delete: false,
                      };
                      const hints = (LANDING_CONFIG as any)[item.key]?.crudHints as
                        | { add?: string; edit?: string; delete?: string }
                        | undefined;
                      const isApprovalQueue = item.key === 'approval:queue';
                      return (
                        <React.Fragment key={item.key}>
                        <div
                          className="border rounded-lg overflow-hidden"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                        <div
                          className={`group block sm:grid ${CRUD_TOGGLE_COLS_CLASS} gap-y-1 px-3 py-2.5 transition-colors`}
                        >
                          <div className="min-w-0 flex flex-col gap-0.5">
                            <span className="text-[11px] font-medium" style={{ color: 'var(--text)' }}>
                              {item.label}
                            </span>
                            {hints ? (
                              <span className="text-[10px] leading-snug text-secondary">
                                {hints.add ? <>Add — {hints.add}. </> : null}
                                {hints.edit ? <>Edit — {hints.edit}. </> : null}
                                {hints.delete ? <>Delete — {hints.delete}.</> : null}
                              </span>
                            ) : null}
                          </div>
                          {/* Phones: switches sit under the name with their own labels; from sm the wrapper dissolves into the grid columns. */}
                          <div className="mt-2 grid grid-cols-3 gap-2 sm:contents">
                          <div className="flex flex-col sm:flex-row min-h-[1.75rem] items-center justify-center gap-1">
                            <span className="sm:hidden text-[9px] font-semibold uppercase tracking-wider text-secondary">Add</span>
                            <PermissionToggle
                              aria-label={`${item.label} add permission`}
                              checked={row.can_add}
                              onChange={(next) =>
                                setCrudPermissions((prev) => ({
                                  ...prev,
                                  [item.key]: {
                                    can_add: next,
                                    can_edit: prev[item.key]?.can_edit || false,
                                    can_delete: prev[item.key]?.can_delete || false,
                                  },
                                }))
                              }
                            />
                          </div>
                          <div className="flex flex-col sm:flex-row min-h-[1.75rem] items-center justify-center gap-1">
                            <span className="sm:hidden text-[9px] font-semibold uppercase tracking-wider text-secondary">Edit</span>
                            <PermissionToggle
                              aria-label={`${item.label} edit permission`}
                              checked={row.can_edit}
                              onChange={(next) =>
                                setCrudPermissions((prev) => ({
                                  ...prev,
                                  [item.key]: {
                                    can_add: prev[item.key]?.can_add || false,
                                    can_edit: next,
                                    can_delete: prev[item.key]?.can_delete || false,
                                  },
                                }))
                              }
                            />
                          </div>
                          <div className="flex flex-col sm:flex-row min-h-[1.75rem] items-center justify-center gap-1">
                            <span className="sm:hidden text-[9px] font-semibold uppercase tracking-wider text-secondary">Delete</span>
                            <PermissionToggle
                              aria-label={`${item.label} delete permission`}
                              checked={row.can_delete}
                              onChange={(next) =>
                                setCrudPermissions((prev) => ({
                                  ...prev,
                                  [item.key]: {
                                    can_add: prev[item.key]?.can_add || false,
                                    can_edit: prev[item.key]?.can_edit || false,
                                    can_delete: next,
                                  },
                                }))
                              }
                            />
                          </div>
                          </div>
                        </div>
                        {isApprovalQueue ? (
                          <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}>
                            <ApprovalWorkflowLevelsSection />
                          </div>
                        ) : null}
                        </div>
                        </React.Fragment>
                      );
                    })}
                    <p className="text-[11px] text-secondary pt-2 border-t mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      Turning off a switch hides the matching Add, Edit, or Delete controls for this role in that module.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key={`widgets-${selectedRoleId}`}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="space-y-2"
                  >
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2 border rounded-lg text-[10px] font-semibold uppercase tracking-widest text-secondary"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <span className="min-w-0">Dashboard Card</span>
                      <span className="flex min-h-[1.75rem] items-center justify-center text-center leading-none">Visible</span>
                    </div>
                    {DASHBOARD_WIDGETS.map((item) => (
                      <div
                        key={item.key}
                        className="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-x-3 gap-y-1 px-3 py-2.5 border rounded-lg transition-colors"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <span className="min-w-0 text-[11px]" style={{ color: 'var(--text)' }}>
                          {item.label}
                        </span>
                        <div className="flex min-h-[1.75rem] items-center justify-center">
                          <PermissionToggle
                            aria-label={`${item.label} visible`}
                            checked={widgetPermissions[item.key] ?? true}
                            onChange={(next) =>
                              setWidgetPermissions((prev) => ({ ...prev, [item.key]: next }))
                            }
                          />
                        </div>
                      </div>
                    ))}
                    <p className="text-[11px] text-secondary pt-2 border-t mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      New cards default to visible until turned off here — this never affects the Administrator role.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
