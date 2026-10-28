import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSelect } from '../ui/AppSelect';
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeleton';
import { PdfDropzone } from '../ui/PdfDropzone';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { useLiveRefresh } from '../../lib/liveData';
import { LocatorUsersManagement } from '../settings/LocatorUsersManagement';
import { IntakeLetterLink, fmtIntakeDate, type Intake } from './intakeShared';

// New Proponent: the letter (hard copy) comes in, BDO Level 1 records the
// business name, scans in the letter and picks the BDO Level 2. That Level 2
// is emailed, sees it here and files the account and application with the
// Locator Accounts form ("Start application"); it's then theirs to evaluate.
// Listed until submitted — a draft stays here ("Continue draft").

const MENU_KEY = 'applications:proponent-intake';

export function ProponentIntake() {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const canAdd = fullAccess || perm.can_add;
  const canEdit = fullAccess || perm.can_edit;
  const canDelete = fullAccess || perm.can_delete;

  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [loading, setLoading] = useState(true);
  const [officers, setOfficers] = useState<{ value: string; label: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ business_name: string; assigned_to: string; letter: File | null }>({
    business_name: '',
    assigned_to: '',
    letter: null,
  });
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<Intake | null>(null);
  // Level 1 (or admin) records and manages; a Level 2 files their own.
  const [manager, setManager] = useState(false);
  // Level 2 filing one: the Locator Accounts form, opened over this page.
  const [filing, setFiling] = useState<{ intake: Intake | null; applicationId: number | null } | null>(null);
  const filePerm = crudPermissions['settings:locator-users'];
  const canFile = fullAccess || Boolean(filePerm?.can_add);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/intakes', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load');
      setIntakes(Array.isArray(json?.data) ? json.data : []);
      setManager(Boolean(json?.manager));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    fetch('/api/intakes/evaluators', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) =>
        setOfficers((Array.isArray(json?.data) ? json.data : []).map((u: any) => ({ value: String(u.id), label: String(u.full_name || u.username) })))
      )
      .catch(() => setOfficers([]));
  }, [load]);
  useLiveRefresh(() => void load());

  function openNew() {
    setForm({ business_name: '', assigned_to: '', letter: null });
    setOpen(true);
  }

  const ready = Boolean(form.business_name.trim() && form.assigned_to && form.letter);

  async function save() {
    if (!ready || !form.letter) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append('business_name', form.business_name.trim());
      body.append('assigned_to', form.assigned_to);
      body.append('file', form.letter);
      const res = await fetch('/api/intakes', { method: 'POST', credentials: 'include', body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Save failed');
      setOpen(false);
      toast.success(json?.message || 'Sent to the BDO.');
      void load();
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function reassign(intake: Intake, assignedTo: string) {
    if (!assignedTo || Number(assignedTo) === intake.assigned_to) return;
    try {
      const res = await fetch(`/api/intakes/${intake.id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ assigned_to: Number(assignedTo) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Reassign failed');
      toast.success(`Reassigned to ${json?.data?.assigned_name || 'the BDO'}.`);
      void load();
    } catch (e: any) {
      toast.error(e?.message || 'Reassign failed');
    }
  }

  async function cancel(intake: Intake) {
    try {
      const res = await fetch(`/api/intakes/${intake.id}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Cancel failed');
      toast.success(`${intake.business_name} cancelled.`);
      setConfirmCancel(null);
      void load();
    } catch (e: any) {
      toast.error(e?.message || 'Cancel failed');
    }
  }

  const isDraft = (i: Intake) => i.application_status === 'DRAFT';
  const assignee = (i: Intake) =>
    canEdit && !isDraft(i) ? (
      <div className="w-full sm:w-52">
        <AppSelect
          isClearable={false}
          options={officers}
          value={String(i.assigned_to)}
          onChange={(v) => void reassign(i, v || '')}
          placeholder={i.assigned_name || 'BDO'}
        />
      </div>
    ) : (
      <span style={{ color: 'var(--text)' }}>{i.assigned_name || '—'}</span>
    );

  const status = (i: Intake) =>
    isDraft(i) ? (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{ color: '#d97706', backgroundColor: 'rgba(245,158,11,.12)' }}
        title={i.application_no || undefined}
      >
        Draft{i.application_no ? ` · ${i.application_no}` : ''}
      </span>
    ) : (
      <span className="text-[11px] text-secondary">Not started</span>
    );

  // Level 1: cancel one not filed yet. Level 2: file it, or finish the draft.
  const actions = (i: Intake) =>
    manager ? (
      canDelete && !isDraft(i) ? (
        <button
          type="button"
          className="rounded-lg h-8 px-2.5 text-[11px] font-semibold border cursor-pointer"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
          onClick={() => setConfirmCancel(i)}
        >
          Cancel
        </button>
      ) : null
    ) : canFile ? (
      <button
        type="button"
        className="inline-flex items-center justify-center gap-1 rounded-lg h-8 px-3 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
        style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
        onClick={() => setFiling(isDraft(i) ? { intake: null, applicationId: i.application_id } : { intake: i, applicationId: null })}
      >
        {isDraft(i) ? 'Continue draft' : 'Start application'} <ArrowRight size={12} />
      </button>
    ) : null;

  return (
    <div className="space-y-4 sm:space-y-5 mt-3">
      <div className="glass-card p-4 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              {manager ? 'Waiting for their BDO' : 'Assigned to you'}
            </h3>
            <p className="text-[11px] text-secondary">
              {manager
                ? "Sent to a BDO whose application isn't submitted yet."
                : 'File the account and application of each — it leaves this list once submitted.'}
            </p>
          </div>
          {manager && canAdd ? (
            <button
              className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm cursor-pointer"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              onClick={openNew}
            >
              + New Proponent
            </button>
          ) : null}
        </div>

        {loading ? (
          <TableSkeleton columns={4} rows={3} />
        ) : intakes.length === 0 ? (
          <EmptyState
            title={manager ? 'No proponents waiting' : 'Nothing assigned to you'}
            description={
              manager
                ? "When a letter comes in, record the business name, attach the letter and choose the BDO who'll file it."
                : 'New proponents the BDO - MANAGER assigns to you show up here.'
            }
          />
        ) : (
          <>
            {/* Phones: one card each */}
            <div className="sm:hidden space-y-2">
              {intakes.map((i) => (
                <div key={i.id} className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold break-words" style={{ color: 'var(--text)' }}>
                        {i.business_name}
                      </div>
                      <div className="text-[11px] text-secondary">
                        Received {fmtIntakeDate(i.created_at)}
                        {i.created_by_name ? ` by ${i.created_by_name}` : ''}
                      </div>
                    </div>
                    <IntakeLetterLink intake={i} />
                  </div>
                  {manager ? <div className="text-[11px]">{assignee(i)}</div> : null}
                  <div className="flex items-center justify-between gap-2">
                    {status(i)}
                    {actions(i)}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr>
                    {['Business name', 'Letter', ...(manager ? ['Assigned BDO'] : []), 'Status', 'Received', ''].map((col, n) => (
                      <th
                        key={n}
                        className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {intakes.map((i) => (
                    <tr key={i.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                        {i.business_name}
                      </td>
                      <td className="px-3 py-2">
                        <IntakeLetterLink intake={i} />
                      </td>
                      {manager ? <td className="px-3 py-2 text-[11px]">{assignee(i)}</td> : null}
                      <td className="px-3 py-2">{status(i)}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">
                        {fmtIntakeDate(i.created_at)}
                        {i.created_by_name ? <div>{i.created_by_name}</div> : null}
                      </td>
                      <td className="px-3 py-2 text-right">{actions(i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <SidePanel
        open={open}
        title="New Proponent"
        subtitle="From the letter received — the BDO files the application"
        onClose={() => setOpen(false)}
        onSave={save}
        saving={saving}
        saveLabel="Save and assign"
        saveDisabled={!ready}
      >
        <div className="space-y-3">
          <Field label="Business name *">
            <input
              className="app-input"
              value={form.business_name}
              onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))}
              placeholder="e.g. SkyPort Logistics Inc."
            />
          </Field>
          <Field label="Assign to (BDO) *">
            <AppSelect
              isClearable={false}
              options={officers}
              value={form.assigned_to}
              onChange={(v) => setForm((p) => ({ ...p, assigned_to: v || '' }))}
              placeholder={officers.length ? 'Select a BDO' : 'No active BDO users'}
            />
          </Field>
          <Field label="Letter *">
            <PdfDropzone file={form.letter} onFile={(f) => setForm((p) => ({ ...p, letter: f }))} disabled={saving} what="the letter" />
          </Field>
        </div>
      </SidePanel>

      {filing ? (
        <LocatorUsersManagement
          panelsOnly
          startIntake={filing.intake}
          continueApplicationId={filing.applicationId}
          onPanelsDone={() => {
            setFiling(null);
            void load();
          }}
        />
      ) : null}

      <ConfirmModal
        open={confirmCancel !== null}
        title="Cancel this proponent?"
        description={`${confirmCancel?.business_name || ''} will be removed from the BDO's list. Nothing has been filed for it yet.`}
        confirmText="Cancel proponent"
        danger
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => {
          if (confirmCancel) void cancel(confirmCancel);
        }}
      />
    </div>
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
