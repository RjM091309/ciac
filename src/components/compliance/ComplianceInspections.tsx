import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { DatePicker, parseYmd, toYmd } from '../ui/DatePicker';
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeleton';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { ComplianceRequirementsManagement } from './ComplianceRequirements';

const MENU_KEY = 'compliance:inspections';

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const STATUS_ORDER = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const RESULTS = ['PASSED', 'PASSED_WITH_FINDINGS', 'FAILED'];
const RESULT_LABELS: Record<string, string> = {
  PASSED: 'Passed',
  PASSED_WITH_FINDINGS: 'Passed w/ Findings',
  FAILED: 'Failed',
};
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];
const ACTION_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'OVERDUE'];

type InspectionRow = {
  id: number;
  application_id: number | null;
  proponent_id: number;
  proponent_name: string | null;
  /** The locator's Ref No and latest application type, as shown on
   * Registered Locator. */
  proponent_ref_no: string | null;
  proponent_business_type: string | null;
  inspection_type_id: number | null;
  inspection_type_name: string | null;
  inspection_type_code: string | null;
  /** Category of the Compliance Requirement inspected; null for older
   * inspections that still carry a retired inspection type. */
  inspection_category: string | null;
  title: string;
  scheduled_date: string | null;
  conducted_date: string | null;
  validity_from: string | null;
  validity_to: string | null;
  assigned_inspector_id: number | null;
  inspector_name: string | null;
  inspector_username: string | null;
  status: string;
  result: string | null;
  total_findings: number;
  open_findings: number;
  open_actions: number;
  overdue_actions: number;
};

type FindingRow = {
  id: number;
  category: string | null;
  severity: string | null;
  description: string;
  recommendation: string | null;
  status: string;
};

type ActionRow = {
  id: number;
  finding_id: number | null;
  finding_description: string | null;
  action_required: string;
  responsible_party: string | null;
  due_date: string | null;
  status: string;
  completed_date: string | null;
  remarks: string | null;
};

type DocRow = {
  id: number;
  doc_kind: string;
  file_name: string;
  storage_path: string;
  created_at: string | null;
};

type ActivityRow = {
  id: number;
  action: string;
  detail: string | null;
  actor_name: string | null;
  actor_username: string | null;
  created_at: string | null;
};

type ComplianceItem = {
  code: string;
  group: 'COMPLIANCE' | 'PERMITS' | 'PERFORMANCE';
  name: string;
  particular: string | null;
  commitment: string | null;
  actual: string | null;
  validity_from: string | null;
  validity_to: string | null;
  status: string;
  remarks: string | null;
  date_submitted: string | null;
};

type DetailPayload = {
  inspection: InspectionRow & { summary: string | null; application_id: number | null; contract_id: number | null };
  findings: FindingRow[];
  corrective_actions: ActionRow[];
  documents: DocRow[];
  activity: ActivityRow[];
};

type Summary = {
  by_status: Record<string, number>;
  by_result: Record<string, number>;
  total: number;
  overdue_actions: number;
  open_findings: number;
  by_proponent: {
    proponent_id: number;
    proponent_name: string;
    total_inspections: number;
    completed_inspections: number;
    failed_inspections: number;
    last_inspection_date: string | null;
    open_findings: number;
    open_actions: number;
    overdue_actions: number;
  }[];
};

type Meta = {
  inspectors: { id: number; full_name: string | null; username: string }[];
  proponents: { id: number; business_name: string }[];
  /** Active Compliance Requirements — what an inspection covers. */
  types: { code: string; name: string; category: string }[];
};

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "Sep 25, 2026 – Sep 25, 2027", or null when neither date is set. */
function fmtValidity(from: string | null | undefined, to: string | null | undefined) {
  if (!from && !to) return null;
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

/** Expired once the end date has passed; expiring within 30 days of it. */
function validityState(to: string | null | undefined): 'expired' | 'expiring' | 'valid' | null {
  if (!to) return null;
  const end = new Date(to);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = (end.getTime() - today.getTime()) / 86_400_000;
  return days < 0 ? 'expired' : days <= 30 ? 'expiring' : 'valid';
}

const VALIDITY_COLOR = { expired: '#ef4444', expiring: '#f59e0b', valid: undefined } as const;

/** A DATE the API sent ("2026-09-25T00:00:00.000Z") as YYYY-MM-DD. */
function ymdOf(v: string | null | undefined) {
  return toYmd(parseYmd(v));
}

function statusBadge(status: string) {
  switch (status) {
    case 'COMPLETED':
      return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
    case 'CANCELLED':
      return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
    case 'IN_PROGRESS':
      return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
    default:
      return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
  }
}

function resultBadge(result: string | null) {
  if (result === 'PASSED') return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
  if (result === 'FAILED') return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  if (result === 'PASSED_WITH_FINDINGS')
    return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
  return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
}

function actionBadge(status: string) {
  if (status === 'DONE') return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
  if (status === 'OVERDUE') return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  if (status === 'IN_PROGRESS')
    return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
  return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
}

const typeBadgeStyle = {
  background: 'rgba(99,102,241,0.18)',
  color: '#818cf8',
  borderColor: 'rgba(99,102,241,0.4)',
};

function statusProgress(status: string) {
  const percent = status === 'COMPLETED' ? 100 : status === 'IN_PROGRESS' ? 50 : status === 'CANCELLED' ? 0 : 0;
  const barColor = percent >= 100 ? '#10b981' : percent >= 50 ? '#3b82f6' : '#f59e0b';
  return { percent, barColor };
}

type LocatorComplianceRow = {
  proponent_id: number;
  proponent_name: string;
  ref_no: string | null;
  business_type: string | null;
  inspections: number;
  total: number;
  complied: number;
  submitted: number;
  pending: number;
  not_complied: number;
  expired: number;
  expiring: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
  items: { code: string; name: string; category: string; status: string; validity_to: string | null }[];
};

const REQUIREMENT_STATUS_ICON: Record<string, typeof CalendarClock> = {
  PENDING: CalendarClock,
  SUBMITTED: ClipboardList,
  COMPLIED: ShieldCheck,
  NOT_COMPLIED: X,
};

const REQ_TOOLTIP_ROW_HEIGHT = 30;

/** Hover breakdown for the Compliance count: each requirement of the locator
 * and its status. Same popover as Assessment's compliance tooltip — portaled
 * with `position: fixed` so the table's overflow wrapper can't clip it. */
function RequirementsTooltip({
  items,
  children,
}: {
  items: LocatorComplianceRow['items'];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean; arrowLeft: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const width = TOOLTIP_WIDTH + 90;

  const computePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const tooltipHeight = items.length * REQ_TOOLTIP_ROW_HEIGHT + TOOLTIP_PADDING;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < tooltipHeight + TOOLTIP_VIEWPORT_MARGIN && rect.top > tooltipHeight + TOOLTIP_VIEWPORT_MARGIN;
    const left = Math.min(Math.max(TOOLTIP_VIEWPORT_MARGIN, rect.left), window.innerWidth - width - TOOLTIP_VIEWPORT_MARGIN);
    const top = openUp ? rect.top - 10 : rect.bottom + 10;
    const arrowLeft = Math.min(Math.max(rect.left + TOOLTIP_ARROW_OFFSET - left, 16), width - 16);
    setPos({ top, left, openUp, arrowLeft });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (items.length === 0) return <>{children}</>;

  const glass = 'color-mix(in oklab, var(--surface) 82%, transparent)';
  const hairline = '1px solid color-mix(in oklab, var(--border) 70%, transparent)';

  return (
    <>
      <span
        ref={triggerRef}
        className="cursor-help border-b border-dotted"
        style={{ borderColor: 'var(--text-muted)' }}
        onMouseEnter={() => {
          computePosition();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </span>
      {createPortal(
        <AnimatePresence>
          {open && pos ? (
            <motion.div
              className="pointer-events-none fixed z-[150] overflow-hidden"
              style={{
                top: pos.openUp ? undefined : pos.top,
                bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                width,
                transformOrigin: `${pos.arrowLeft}px ${pos.openUp ? '100%' : '0%'}`,
                backgroundColor: glass,
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: hairline,
                boxShadow: '0 4px 12px rgba(0,0,0,.10), 0 1px 3px rgba(0,0,0,.08)',
              }}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <span
                className="absolute h-2.5 w-2.5 rotate-45"
                style={{
                  left: pos.arrowLeft - 5,
                  top: pos.openUp ? undefined : -5,
                  bottom: pos.openUp ? -5 : undefined,
                  backgroundColor: glass,
                  borderLeft: pos.openUp ? 'none' : hairline,
                  borderTop: pos.openUp ? 'none' : hairline,
                  borderRight: pos.openUp ? hairline : 'none',
                  borderBottom: pos.openUp ? hairline : 'none',
                }}
              />
              <div className="relative py-2">
                {items.map((it, idx) => {
                  const s = checklistBadge(it.status);
                  const Icon = REQUIREMENT_STATUS_ICON[it.status] || CalendarClock;
                  const vState = validityState(it.validity_to);
                  return (
                    <div
                      key={it.code}
                      className={cn('flex items-center gap-2 px-3', idx !== items.length - 1 && 'border-b')}
                      style={{
                        height: REQ_TOOLTIP_ROW_HEIGHT,
                        borderColor: 'color-mix(in oklab, var(--border) 45%, transparent)',
                      }}
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: s.bg, color: s.color }}
                      >
                        <Icon size={11} strokeWidth={2.5} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium" style={{ color: 'var(--text)' }}>
                        {it.name}
                      </span>
                      {vState === 'expired' || vState === 'expiring' ? (
                        <span className="shrink-0 text-[9px] font-bold uppercase" style={{ color: VALIDITY_COLOR[vState] }}>
                          {vState === 'expired' ? 'Expired' : 'Expiring'}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide" style={{ color: s.color }}>
                        {CHECKLIST_STATUS_LABELS[it.status] || it.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

const TOOLTIP_WIDTH = 250;
const TOOLTIP_ROW_HEIGHT = 42;
const TOOLTIP_PADDING = 16;
const TOOLTIP_VIEWPORT_MARGIN = 8;
const TOOLTIP_ARROW_OFFSET = 16;

/** Hover breakdown for the Progress bar — the bar itself is just a 0/50/100%
 * proxy for `status`, so this surfaces the actual detail behind it (inspector,
 * dates, findings, overdue actions) that got dropped from their own columns
 * when this table was condensed to Locator/Type/Progress/Status/Actions.
 * Same portal-positioned, frosted-glass idiom as the Compliance column
 * tooltip on the Assessment & Evaluation page. */
function InspectionProgressTooltip({ row, children }: { row: InspectionRow; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean; arrowLeft: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  type Row = { Icon: typeof CalendarClock; label: string; value: string; tone?: string };
  const rows: Row[] = [
    { Icon: UserCheck, label: 'Inspector', value: row.inspector_name || row.inspector_username || 'Unassigned' },
    { Icon: CalendarClock, label: 'Scheduled', value: fmtDate(row.scheduled_date) },
    ...(row.conducted_date ? [{ Icon: CalendarClock, label: 'Conducted', value: fmtDate(row.conducted_date) }] : []),
    {
      Icon: FileText,
      label: 'Findings',
      value: row.total_findings ? `${row.open_findings} open / ${row.total_findings} total` : 'None',
      tone: row.open_findings > 0 ? '#ef4444' : undefined,
    },
    ...(row.overdue_actions > 0
      ? [{ Icon: AlertTriangle, label: 'Corrective actions', value: `${row.overdue_actions} overdue`, tone: '#ef4444' }]
      : []),
    ...(row.result ? [{ Icon: ShieldCheck, label: 'Result', value: RESULT_LABELS[row.result] || row.result, tone: resultBadge(row.result).color }] : []),
  ];

  const computePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const tooltipHeight = rows.length * TOOLTIP_ROW_HEIGHT + TOOLTIP_PADDING;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < tooltipHeight + TOOLTIP_VIEWPORT_MARGIN && rect.top > tooltipHeight + TOOLTIP_VIEWPORT_MARGIN;
    const left = Math.min(Math.max(TOOLTIP_VIEWPORT_MARGIN, rect.left), window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_VIEWPORT_MARGIN);
    const top = openUp ? rect.top - 10 : rect.bottom + 10;
    const arrowLeft = Math.min(Math.max(rect.left + TOOLTIP_ARROW_OFFSET - left, 16), TOOLTIP_WIDTH - 16);
    setPos({ top, left, openUp, arrowLeft });
  };

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
    }
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <div
        ref={triggerRef}
        className="cursor-help"
        onMouseEnter={() => {
          computePosition();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </div>
      {createPortal(
        <AnimatePresence>
          {open && pos ? (
            <motion.div
              className="pointer-events-none fixed z-[150] overflow-hidden"
              style={{
                top: pos.openUp ? undefined : pos.top,
                bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                width: TOOLTIP_WIDTH,
                transformOrigin: `${pos.arrowLeft}px ${pos.openUp ? '100%' : '0%'}`,
                backgroundColor: 'color-mix(in oklab, var(--surface) 82%, transparent)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: '1px solid color-mix(in oklab, var(--border) 70%, transparent)',
                boxShadow: '0 4px 12px rgba(0,0,0,.10), 0 1px 3px rgba(0,0,0,.08)',
              }}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <span
                className="absolute h-2.5 w-2.5 rotate-45"
                style={{
                  left: pos.arrowLeft - 5,
                  top: pos.openUp ? undefined : -5,
                  bottom: pos.openUp ? -5 : undefined,
                  backgroundColor: 'color-mix(in oklab, var(--surface) 82%, transparent)',
                  borderLeft: pos.openUp ? 'none' : '1px solid color-mix(in oklab, var(--border) 70%, transparent)',
                  borderTop: pos.openUp ? 'none' : '1px solid color-mix(in oklab, var(--border) 70%, transparent)',
                  borderRight: pos.openUp ? '1px solid color-mix(in oklab, var(--border) 70%, transparent)' : 'none',
                  borderBottom: pos.openUp ? '1px solid color-mix(in oklab, var(--border) 70%, transparent)' : 'none',
                }}
              />
              <div className="relative py-2">
                {rows.map((r, idx) => (
                  <div
                    key={idx}
                    className={cn('flex items-center gap-2.5 px-3.5', idx !== rows.length - 1 && 'border-b')}
                    style={{ height: TOOLTIP_ROW_HEIGHT, borderColor: 'color-mix(in oklab, var(--border) 45%, transparent)' }}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: r.tone ? `color-mix(in oklab, ${r.tone} 15%, transparent)` : 'var(--control-bg)',
                        color: r.tone || 'var(--text-muted)',
                      }}
                    >
                      <r.Icon size={13} strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-secondary">{r.label}</span>
                    <span className="shrink-0 text-[11px] font-semibold text-right" style={{ color: r.tone || 'var(--text)' }}>
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

function isOverdue(a: ActionRow) {
  if (a.status === 'DONE' || !a.due_date) return false;
  const d = new Date(a.due_date);
  return !Number.isNaN(d.getTime()) && d < new Date();
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json;
}

function Badge({ label, styles }: { label: string; styles: { bg: string; color: string; border: string } }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border whitespace-nowrap"
      style={{ backgroundColor: styles.bg, color: styles.color, borderColor: styles.border }}
    >
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-secondary">
      {label}
      {children}
    </label>
  );
}

const inputCls = 'app-input';

function usePagination<T>(items: T[], pageSize: number, page: number) {
  return useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / Math.max(1, pageSize)));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const visible =
      totalPages <= 5
        ? Array.from({ length: totalPages }, (_, i) => i + 1)
        : safePage <= 3
          ? [1, 2, 3, 4, 5]
          : safePage >= totalPages - 2
            ? [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
            : [safePage - 2, safePage - 1, safePage, safePage + 1, safePage + 2];
    return {
      totalPages,
      pageItems: items.slice(start, start + pageSize),
      showingFrom: items.length === 0 ? 0 : start + 1,
      showingTo: Math.min(items.length, safePage * pageSize),
      visiblePageNumbers: visible,
    };
  }, [items, pageSize, page]);
}

export function ComplianceInspections({
  locationSearch = '',
  navigate,
}: {
  locationSearch?: string;
  navigate?: (to: string, opts?: { replace?: boolean }) => void;
} = {}) {
  const { fullAccess, crudPermissions } = useControlPanelAccess();
  const perm = crudPermissions[MENU_KEY] || { can_add: false, can_edit: false, can_delete: false };
  const perms = {
    canAdd: fullAccess || perm.can_add,
    canEdit: fullAccess || perm.can_edit,
    canDelete: fullAccess || perm.can_delete,
  };

  const [tab, setTab] = useState<'inspections' | 'monitor' | 'requirements'>('inspections');
  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [locators, setLocators] = useState<LocatorComplianceRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [meta, setMeta] = useState<Meta>({ inspectors: [], proponents: [], types: [] });
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  // New Inspection modal: `proponentId` pre-selects the locator when it's
  // opened from that locator's drawer.
  const [creating, setCreating] = useState<{
    proponentId?: number;
    /** Types that already have an inspection there, left out of the picker. */
    usedTypeCodes?: string[];
  } | null>(null);
  // Inspections drawer: every inspection of one locator.
  const [drawer, setDrawer] = useState<{ proponentId: number; title: string; subtitle: string } | null>(null);

  const loadList = useCallback(async () => {
    const [locatorJson, listJson, summaryJson] = await Promise.all([
      apiFetch('/api/inspections/locators/compliance'),
      apiFetch('/api/inspections'),
      apiFetch('/api/inspections/summary'),
    ]);
    setLocators(locatorJson.data || []);
    setRows(listJson.data || []);
    setSummary(summaryJson.data || null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const metaJson = await apiFetch('/api/inspections/meta');
        if (!cancelled) setMeta(metaJson.data || { inspectors: [], proponents: [], types: [] });
        await loadList();
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  // Deep-link from a notification's "View" button (?applicationId=...): find
  // the inspection tied to that application (an inspection's own id, not the
  // application id, is what the detail drawer is keyed by) and open it. Waits
  // for the list to finish loading since the match happens against `rows`.
  const consumedNotificationQueryRef = useRef('');
  useEffect(() => {
    if (!navigate || loading) return;
    const search = String(locationSearch || '').trim();
    if (!search || consumedNotificationQueryRef.current === search) return;
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const rawId = Number(params.get('applicationId') || '');
    if (!Number.isFinite(rawId) || rawId <= 0) return;
    consumedNotificationQueryRef.current = search;
    const match = rows.find((r) => Number(r.application_id) === rawId);
    if (match) {
      setTab('inspections');
      setSelectedId(match.id);
    } else {
      toast.info('No inspection is linked to that application yet.');
    }
    params.delete('applicationId');
    params.delete('notificationId');
    params.delete('focus');
    const cleaned = params.toString();
    navigate(`/compliance/inspections${cleaned ? `?${cleaned}` : ''}`, { replace: true });
  }, [locationSearch, navigate, rows, loading]);

  // One row per registered locator, measured against the active Compliance
  // Requirements (File Maintenance). Its checklist and inspections live in
  // the drawer. Pagination counts locators.
  const filteredLocators = useMemo(() => {
    const q = search.trim().toLowerCase();
    return locators.filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (!q) return true;
      return [l.proponent_name, l.ref_no, l.business_type].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [locators, search, statusFilter]);
  const tiles = useMemo(
    () => ({
      locators: locators.length,
      completed: locators.filter((l) => l.status === 'COMPLETED').length,
      inProgress: locators.filter((l) => l.status === 'IN_PROGRESS').length,
      notComplied: locators.reduce((n, l) => n + l.not_complied, 0),
      expiring: locators.reduce((n, l) => n + l.expiring, 0),
      expired: locators.reduce((n, l) => n + l.expired, 0),
    }),
    [locators]
  );
  const openLocator = (l: LocatorComplianceRow) =>
    setDrawer({
      proponentId: l.proponent_id,
      title: l.proponent_name,
      subtitle: [l.ref_no ? `Ref No ${l.ref_no}` : null, l.business_type].filter(Boolean).join(' · ') || 'Locator compliance',
    });

  const pg = usePagination(filteredLocators, pageSize, page);

  const refresh = useCallback(async () => {
    try {
      await loadList();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [loadList]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        <StatTile icon={ClipboardCheck} label="Locators" value={loading ? '—' : tiles.locators} />
        <StatTile icon={ShieldCheck} label="Completed" value={loading ? '—' : tiles.completed} tone="#10b981" />
        <StatTile icon={ClipboardList} label="In Progress" value={loading ? '—' : tiles.inProgress} tone="#3b82f6" />
        <StatTile icon={X} label="Not Complied" value={loading ? '—' : tiles.notComplied} tone="#ef4444" />
        <StatTile icon={CalendarClock} label="Expiring Soon" value={loading ? '—' : tiles.expiring} tone="#f59e0b" />
        <StatTile icon={AlertTriangle} label="Expired" value={loading ? '—' : tiles.expired} tone="#ef4444" />
      </div>

      <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {(
          [
            ['inspections', 'Locators'],
            ['monitor', 'Compliance Monitor'],
            ['requirements', 'Compliance Requirements'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'px-2.5 sm:px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap',
              tab === k ? 'border-[var(--text)] text-[var(--text)]' : 'border-transparent text-secondary hover:text-[var(--text)]'
            )}
          >
            {k === 'monitor' || k === 'requirements' ? (
              <>
                <span className="sm:hidden">{k === 'monitor' ? 'Monitor' : 'Requirements'}</span>
                <span className="hidden sm:inline">{label}</span>
              </>
            ) : (
              label
            )}
          </button>
        ))}
        <div className="ml-auto shrink-0">
          {perms.canAdd && tab === 'inspections' ? (
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold mb-1 whitespace-nowrap"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              onClick={() => setCreating({})}
            >
              <Plus size={13} className="inline mr-1" />
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">New Inspection</span>
            </button>
          ) : null}
        </div>
      </div>

      {tab === 'requirements' ? (
        <ComplianceRequirementsManagement
          onChanged={() => {
            // Locator totals and the New Inspection requirement list both
            // come from this list.
            refresh();
            apiFetch('/api/inspections/meta')
              .then((j) => setMeta(j.data || { inspectors: [], proponents: [], types: [] }))
              .catch(() => undefined);
          }}
        />
      ) : tab === 'monitor' ? (
        <MonitorTab
          summary={summary}
          loading={loading}
          onOpenProponent={(pid, name) =>
            setDrawer({ proponentId: pid, title: name, subtitle: 'All inspections for this locator' })
          }
        />
      ) : (
        <>
          <div
            className="rounded-xl border overflow-hidden shadow-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            {/* Search and filter sit inside the card, like Renewal Tracking. */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 pt-3 sm:px-4 sm:pt-4 pb-1">
              <div className="relative group w-full sm:w-72">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search locator / ref no…"
                  className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
                />
              </div>
              <div className="min-w-0 w-full sm:w-44">
                <AppSelect
                  compact
                  placeholder="All statuses"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: 'IN_PROGRESS', label: 'In Progress' },
                    { value: 'COMPLETED', label: 'Completed' },
                  ]}
                />
              </div>
            </div>
            {loading ? (
              <div className="p-4">
                <TableSkeleton rows={6} />
              </div>
            ) : filteredLocators.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck size={40} className="opacity-40" />}
                title="No locators"
                description={locators.length ? 'Try adjusting your search or filters.' : 'No registered locators yet.'}
              />
            ) : (
              <>
              {/* Phones: one card per locator; tap to open its compliance. */}
              <div className="sm:hidden p-2 space-y-2">
                {pg.pageItems.map((l) => (
                  <button
                    key={l.proponent_id}
                    type="button"
                    className="w-full text-left rounded-xl p-3 cursor-pointer active:bg-[var(--selected-bg)] transition-colors"
                    style={{
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
                    }}
                    onClick={() => openLocator(l)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold leading-snug break-words" style={{ color: 'var(--text)' }}>
                          {l.ref_no || '—'}
                        </div>
                        <div className="mt-0.5 text-[11px] text-secondary break-words">
                          {l.proponent_name}
                          {l.business_type ? ` · ${l.business_type}` : ''}
                        </div>
                      </div>
                      <Badge label={LOCATOR_STATUS_LABELS[l.status]} styles={statusBadge(l.status)} />
                    </div>
                    <div className="mt-2 text-[11px] text-secondary">
                      {l.complied}/{l.total} complied
                      {l.expired > 0 ? <span style={{ color: '#ef4444' }}> · {l.expired} expired</span> : null}
                    </div>
                  </button>
                ))}
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Ref No.</th>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Locator</th>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Application Type</th>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Compliance</th>
                      <th className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.pageItems.map((l) => (
                      <tr
                        key={l.proponent_id}
                        className="transition-colors cursor-pointer hover:bg-[var(--selected-bg)]"
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                        onClick={() => openLocator(l)}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-semibold" style={{ color: 'var(--text)' }}>
                            {l.ref_no || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary">{l.proponent_name}</td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary">{l.business_type || '—'}</td>
                        <td className="px-3 py-2.5 text-[11px] text-secondary">
                          <RequirementsTooltip items={l.items}>
                            {l.complied}/{l.total} complied
                          </RequirementsTooltip>
                          {l.expired > 0 ? (
                            <span className="ml-2 font-semibold" style={{ color: '#ef4444' }}>
                              {l.expired} expired
                            </span>
                          ) : l.expiring > 0 ? (
                            <span className="ml-2 font-semibold" style={{ color: '#f59e0b' }}>
                              {l.expiring} expiring
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge label={LOCATOR_STATUS_LABELS[l.status]} styles={statusBadge(l.status)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
            <div className="px-2 pb-2 sm:p-0">
              <DataTableControls
                page={page}
                totalPages={pg.totalPages}
                totalItems={filteredLocators.length}
                showingFrom={pg.showingFrom}
                showingTo={pg.showingTo}
                visiblePageNumbers={pg.visiblePageNumbers}
                pageSize={pageSize}
                pageSizeOptions={[10, 20, 50, 100]}
                onPageSizeChange={setPageSize}
                onPageChange={setPage}
                loading={loading}
              />
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {drawer != null ? (
          <LocatorInspectionsDrawer
            proponentId={drawer.proponentId}
            title={drawer.title}
            subtitle={drawer.subtitle}
            canEdit={perms.canEdit}
            onChecklistSaved={refresh}
            onClose={() => setDrawer(null)}
          />
        ) : null}
        {selectedId != null ? (
          <InspectionDetail
            inspectionId={selectedId}
            meta={meta}
            perms={perms}
            onClose={() => setSelectedId(null)}
            onMutated={refresh}
          />
        ) : null}
        {creating ? (
          <NewInspection
            meta={meta}
            defaultProponentId={creating.proponentId}
            usedTypeCodes={creating.usedTypeCodes}
            onClose={() => setCreating(null)}
            onCreated={async (id) => {
              setCreating(null);
              await refresh();
              setSelectedId(id);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div
      className="rounded-xl border px-2.5 sm:px-3 py-2.5 shadow-sm min-w-0"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div className="flex items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[10px] uppercase tracking-wide text-secondary">
        <Icon size={12} className="shrink-0" style={{ color: tone }} />
        <span className="truncate">{label}</span>
      </div>
      <div className="text-lg font-bold mt-0.5" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}

function MonitorTab({
  summary,
  loading,
  onOpenProponent,
}: {
  summary: Summary | null;
  loading: boolean;
  onOpenProponent: (proponentId: number, proponentName: string) => void;
}) {
  if (loading) return <TableSkeleton rows={6} />;
  const rows = summary?.by_proponent || [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={40} className="opacity-40" />}
        title="No compliance data"
        description="Once inspections are recorded, per-locator compliance standing shows here."
      />
    );
  }
  const standingOf = (r: (typeof rows)[number]) =>
    r.overdue_actions > 0 || r.failed_inspections > 0
      ? { label: 'At Risk', styles: resultBadge('FAILED') }
      : r.open_findings > 0 || r.open_actions > 0
        ? { label: 'Monitoring', styles: resultBadge('PASSED_WITH_FINDINGS') }
        : { label: 'Compliant', styles: resultBadge('PASSED') };
  return (
    <>
    {/* Phones: one card per locator instead of a 9-column table */}
    <div className="sm:hidden space-y-2">
      {rows.map((r) => {
        const standing = standingOf(r);
        const stats: [string, number, boolean][] = [
          ['Inspections', r.total_inspections, false],
          ['Completed', r.completed_inspections, false],
          ['Failed', r.failed_inspections, r.failed_inspections > 0],
          ['Open findings', r.open_findings, false],
          ['Open actions', r.open_actions, false],
          ['Overdue', r.overdue_actions, r.overdue_actions > 0],
        ];
        return (
          <button
            key={r.proponent_id}
            type="button"
            className="w-full text-left rounded-xl border p-3 cursor-pointer active:bg-[var(--selected-bg)] transition-colors"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
            onClick={() => onOpenProponent(r.proponent_id, r.proponent_name)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-snug break-words" style={{ color: 'var(--text)' }}>
                  {r.proponent_name}
                </div>
                <div className="mt-0.5 text-[11px] text-secondary">Last inspection: {fmtDate(r.last_inspection_date)}</div>
              </div>
              <div className="shrink-0">
                <Badge label={standing.label} styles={standing.styles} />
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-2">
              {stats.map(([label, value, danger]) => (
                <div key={label} className="min-w-0">
                  <div className="text-[9px] uppercase tracking-wider text-secondary truncate">{label}</div>
                  <div
                    className="text-[13px] font-semibold tabular-nums"
                    style={{ color: danger ? '#ef4444' : 'var(--text)' }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </button>
        );
      })}
    </div>

    <div
      className="hidden sm:block rounded-xl border overflow-x-auto shadow-sm"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr
            className="text-[11px] uppercase tracking-wide text-secondary"
            style={{ backgroundColor: 'var(--control-bg)' }}
          >
            <th className="px-3 py-2.5 font-semibold">Locator</th>
            <th className="px-3 py-2.5 font-semibold text-right">Inspections</th>
            <th className="px-3 py-2.5 font-semibold text-right">Completed</th>
            <th className="px-3 py-2.5 font-semibold text-right">Failed</th>
            <th className="px-3 py-2.5 font-semibold text-right">Open Findings</th>
            <th className="px-3 py-2.5 font-semibold text-right">Open Actions</th>
            <th className="px-3 py-2.5 font-semibold text-right">Overdue</th>
            <th className="px-3 py-2.5 font-semibold">Last Inspection</th>
            <th className="px-3 py-2.5 font-semibold">Standing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const standing = standingOf(r);
            return (
              <tr
                key={r.proponent_id}
                className="border-t cursor-pointer hover:bg-[var(--selected-bg)]"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => onOpenProponent(r.proponent_id, r.proponent_name)}
              >
                <td className="px-3 py-2.5 font-semibold">{r.proponent_name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.total_inspections}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.completed_inspections}</td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.failed_inspections ? '#ef4444' : undefined }}>
                  {r.failed_inspections}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.open_findings}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.open_actions}</td>
                <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.overdue_actions ? '#ef4444' : undefined }}>
                  {r.overdue_actions}
                </td>
                <td className="px-3 py-2.5 text-[12px]">{fmtDate(r.last_inspection_date)}</td>
                <td className="px-3 py-2.5">
                  <Badge label={standing.label} styles={standing.styles} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

function LocatorInspectionsDrawer({
  proponentId,
  title,
  subtitle,
  canEdit,
  onChecklistSaved,
  onClose,
}: {
  proponentId: number;
  title: string;
  subtitle: string;
  canEdit: boolean;
  onChecklistSaved: () => void;
  onClose: () => void;
}) {
  // The locator's compliance checklist, one tab per requirement category,
  // plus an Activity tab of changes made to it.
  const [tab, setTab] = useState<ComplianceItem['group'] | 'ACTIVITY'>('COMPLIANCE');
  const [activityKey, setActivityKey] = useState(0);
  const [checklist, setChecklist] = useState<ComplianceItem[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setChecklistLoading(true);
    apiFetch(`/api/inspections/locators/${proponentId}/compliance`)
      .then((j) => {
        if (!cancelled) setChecklist(j.data || []);
      })
      .catch((err) => {
        if (!cancelled) toast.error((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setChecklistLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proponentId]);


  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <motion.div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 h-full w-full max-w-3xl border-l shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>
              {title}
            </div>
            <div className="text-[11px] text-secondary truncate">{subtitle}</div>
          </div>
          <button
            className="rounded-lg p-1 border shrink-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 flex items-center gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          {[
            ...CHECKLIST_GROUPS.map((g) => {
              const inGroup = checklist.filter((it) => it.group === g.key);
              const complied = inGroup.filter((it) => it.status === 'COMPLIED').length;
              return { key: g.key, label: g.label, count: checklistLoading ? '' : `${complied}/${inGroup.length}` };
            }),
            { key: 'ACTIVITY' as const, label: 'Activity', count: '' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'px-2.5 py-2.5 text-[12px] font-semibold border-b-2 -mb-px whitespace-nowrap inline-flex items-center gap-1.5 transition-colors',
                tab === t.key
                  ? 'border-[var(--text)] text-[var(--text)]'
                  : 'border-transparent text-secondary hover:text-[var(--text)]'
              )}
            >
              {t.label}
              {t.count ? <span className="text-[10px] font-bold opacity-60 tabular-nums">{t.count}</span> : null}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'ACTIVITY' ? (
            <LocatorActivity proponentId={proponentId} reloadKey={activityKey} />
          ) : checklistLoading ? (
            <TableSkeleton rows={6} />
          ) : (
            <LocatorChecklist
              proponentId={proponentId}
              items={checklist}
              group={tab}
              canEdit={canEdit}
              onSaved={(saved) => {
                setChecklist((prev) => prev.map((it) => (it.code === saved.code ? saved : it)));
                setActivityKey((k) => k + 1);
                onChecklistSaved();
              }}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}

type LocatorActivityRow = {
  id: number;
  created_at: string;
  actor_name: string | null;
  actor_username: string | null;
  item: string | null;
  status: string | null;
  changes: { field: string; from?: string | null; to?: string | null }[];
};

const CHECKLIST_FIELD_LABELS: Record<string, string> = {
  particular: 'Particular',
  commitment: 'Commitment',
  actual: 'Actual',
  validity_from: 'Validity from',
  validity_to: 'Validity to',
  status: 'Status',
  remarks: 'Remarks',
  date_submitted: 'Date submitted',
};

function fmtChangeValue(field: string, v: string | null | undefined) {
  if (v == null || v === '') return '—';
  if (field === 'status') return CHECKLIST_STATUS_LABELS[v] || v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  return v;
}

function fmtDateTime(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** History of the locator's compliance checklist edits: who changed which
 * requirement, when, and what changed. */
function LocatorActivity({ proponentId, reloadKey }: { proponentId: number; reloadKey: number }) {
  const [rows, setRows] = useState<LocatorActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/inspections/locators/${proponentId}/activity`)
      .then((j) => {
        if (!cancelled) setRows(j.data || []);
      })
      .catch((err) => {
        if (!cancelled) toast.error((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proponentId, reloadKey]);

  if (loading) return <TableSkeleton rows={5} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={40} className="opacity-40" />}
        title="No activity"
        description="Changes to this locator's compliance requirements are logged here."
      />
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((a) => (
        <li key={a.id} className="rounded-xl border px-3 py-2.5 text-[12px]" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold truncate" style={{ color: 'var(--text)' }}>
                {a.item || 'Compliance requirement'}
              </div>
              <div className="text-[10px] text-secondary mt-0.5">
                {a.actor_name || a.actor_username || 'System'} · {fmtDateTime(a.created_at)}
              </div>
            </div>
            {a.status ? (
              <Badge label={(CHECKLIST_STATUS_LABELS[a.status] || a.status).toUpperCase()} styles={checklistBadge(a.status)} />
            ) : null}
          </div>
          {a.changes.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-secondary">
              {a.changes.map((c) => (
                <li key={c.field}>
                  <span className="font-medium" style={{ color: 'var(--text)' }}>
                    {CHECKLIST_FIELD_LABELS[c.field] || c.field}:
                  </span>{' '}
                  {fmtChangeValue(c.field, c.from)} → {fmtChangeValue(c.field, c.to)}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

type Perms ={ canAdd: boolean; canEdit: boolean; canDelete: boolean };
type RunFn = (fn: () => Promise<unknown>, successMsg?: string) => Promise<void>;

const DETAIL_TABS = ['Overview', 'Findings', 'Corrective Actions', 'Reports', 'Activity'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function InspectionDetail({
  inspectionId,
  meta,
  perms,
  onClose,
  onMutated,
}: {
  inspectionId: number;
  meta: Meta;
  perms: Perms;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>('Overview');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const json = await apiFetch(`/api/inspections/${inspectionId}`);
    setData(json.data);
  }, [inspectionId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const run = useCallback<RunFn>(
    async (fn, successMsg) => {
      setBusy(true);
      try {
        await fn();
        await load();
        onMutated();
        if (successMsg) toast.success(successMsg);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load, onMutated]
  );

  const i = data?.inspection;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <motion.div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 h-full w-full max-w-3xl border-l shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
              {i ? i.title : 'Inspection'}
            </div>
            <div className="text-[11px] text-secondary">
              {i ? `${i.proponent_name || '—'} · ${i.inspection_type_name || i.inspection_type_code || 'Inspection'}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {i ? <Badge label={STATUS_LABELS[i.status] || i.status} styles={statusBadge(i.status)} /> : null}
            <button
              className="rounded-lg p-1 border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-4 pt-2 border-b flex gap-1 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          {DETAIL_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors',
                tab === t ? 'border-[var(--text)] text-[var(--text)]' : 'border-transparent text-secondary hover:text-[var(--text)]'
              )}
            >
              {t}
              {t === 'Findings' && data?.findings.length ? ` (${data.findings.length})` : ''}
              {t === 'Corrective Actions' && data?.corrective_actions.length ? ` (${data.corrective_actions.length})` : ''}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading || !data ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-secondary" />
            </div>
          ) : tab === 'Overview' ? (
            <OverviewTab data={data} meta={meta} perms={perms} busy={busy} run={run} />
          ) : tab === 'Findings' ? (
            <FindingsTab data={data} perms={perms} busy={busy} run={run} />
          ) : tab === 'Corrective Actions' ? (
            <ActionsTab data={data} perms={perms} busy={busy} run={run} />
          ) : tab === 'Reports' ? (
            <ReportsTab data={data} perms={perms} busy={busy} run={run} />
          ) : (
            <ActivityTab data={data} />
          )}
        </div>
      </motion.div>
    </div>
  );
}

function OverviewTab({
  data,
  meta,
  perms,
  busy,
  run,
}: {
  data: DetailPayload;
  meta: Meta;
  perms: Perms;
  busy: boolean;
  run: RunFn;
}) {
  const i = data.inspection;
  const [inspectorId, setInspectorId] = useState(i.assigned_inspector_id ? String(i.assigned_inspector_id) : '');
  const [result, setResult] = useState(i.result || 'PASSED');
  const [summary, setSummary] = useState(i.summary || '');
  const [validityFrom, setValidityFrom] = useState(ymdOf(i.validity_from));
  const [validityTo, setValidityTo] = useState(ymdOf(i.validity_to));
  const validityInvalid = Boolean(validityFrom && validityTo && validityTo < validityFrom);
  const validityChanged = validityFrom !== ymdOf(i.validity_from) || validityTo !== ymdOf(i.validity_to);
  const vState = validityState(i.validity_to);
  // The Compliance Requirement this inspection covers. Older inspections
  // carry a retired inspection type instead and start blank here.
  const isLegacyType = Boolean(i.inspection_type_code && !i.inspection_category);
  const currentReq = isLegacyType ? '' : i.inspection_type_code || '';
  const [requirement, setRequirement] = useState(currentReq);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wide text-secondary mb-2">Requirement inspected</div>
        {isLegacyType ? (
          <p className="mb-2 text-[11px]" style={{ color: '#f59e0b' }}>
            This inspection was created with the retired inspection type "{i.inspection_type_name || i.inspection_type_code}".
            Choose the compliance requirement it covers.
          </p>
        ) : null}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <AppSelect
              compact
              placeholder="Select requirement…"
              value={requirement}
              onChange={setRequirement}
              options={meta.types.map((t) => ({
                value: t.code,
                label: `${CHECKLIST_GROUP_LABEL[t.category] || t.category} · ${t.name}`,
              }))}
            />
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit || !requirement || requirement === currentReq}
            onClick={() =>
              run(
                () =>
                  apiFetch(`/api/inspections/${i.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ inspection_type_code: requirement }),
                  }),
                'Requirement saved'
              )
            }
          >
            Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <InfoCell label="Status" value={STATUS_LABELS[i.status] || i.status} />
        <InfoCell label="Result" value={i.result ? RESULT_LABELS[i.result] || i.result : '—'} />
        <InfoCell label="Scheduled" value={fmtDate(i.scheduled_date)} />
        <InfoCell label="Conducted" value={fmtDate(i.conducted_date)} />
        <div className="col-span-2">
          <InfoCell
            label="Validity"
            value={
              fmtValidity(i.validity_from, i.validity_to) ? (
                <span style={{ color: VALIDITY_COLOR[vState || 'valid'] }}>
                  {fmtValidity(i.validity_from, i.validity_to)}
                  {vState === 'expired' ? ' · Expired' : vState === 'expiring' ? ' · Expiring soon' : ''}
                </span>
              ) : (
                '—'
              )
            }
          />
        </div>
      </div>

      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wide text-secondary mb-2">Validity</div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 grid grid-cols-2 gap-2">
            <Field label="From">
              <DatePicker
                mode="single"
                bordered
                fullWidth
                placeholder="Start date"
                value={parseYmd(validityFrom)}
                onChange={(d: Date | null) => setValidityFrom(toYmd(d))}
              />
            </Field>
            <Field label="To">
              <DatePicker
                mode="single"
                bordered
                fullWidth
                placeholder="End date"
                value={parseYmd(validityTo)}
                onChange={(d: Date | null) => setValidityTo(toYmd(d))}
              />
            </Field>
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit || !validityChanged || validityInvalid}
            onClick={() =>
              run(
                () =>
                  apiFetch(`/api/inspections/${i.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ validity_from: validityFrom || null, validity_to: validityTo || null }),
                  }),
                'Validity saved'
              )
            }
          >
            Save
          </button>
        </div>
        {validityInvalid ? (
          <p className="mt-1.5 text-[11px]" style={{ color: '#ef4444' }}>
            The end date can't be before the start date.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wide text-secondary mb-2">Assign inspector</div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <AppSelect
              compact
              placeholder="Select inspector…"
              value={inspectorId}
              onChange={setInspectorId}
              options={meta.inspectors.map((e) => ({ value: String(e.id), label: e.full_name || e.username }))}
            />
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit || !inspectorId}
            onClick={() =>
              run(
                () =>
                  apiFetch(`/api/inspections/${i.id}/assign`, {
                    method: 'PATCH',
                    body: JSON.stringify({ inspector_id: Number(inspectorId) }),
                  }),
                'Inspector assigned'
              )
            }
          >
            <UserCheck size={13} className="inline mr-1" /> Assign
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-3 flex flex-wrap gap-2" style={{ borderColor: 'var(--border)' }}>
        <div className="w-full text-[11px] font-bold uppercase tracking-wide text-secondary mb-1">Status</div>
        {['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'].map((s) => (
          <button
            key={s}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[12px] font-semibold border disabled:opacity-40',
              i.status === s && 'ring-1 ring-[var(--text)]'
            )}
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            disabled={busy || !perms.canEdit || i.status === s}
            onClick={() =>
              run(
                () => apiFetch(`/api/inspections/${i.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: s }) }),
                `Status: ${STATUS_LABELS[s]}`
              )
            }
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Complete inspection</div>
        <Field label="Result">
          <AppSelect
            compact
            isClearable={false}
            value={result}
            onChange={setResult}
            options={RESULTS.map((r) => ({ value: r, label: RESULT_LABELS[r] }))}
          />
        </Field>
        <Field label="Summary">
          <textarea
            className={cn(inputCls, 'min-h-[64px] resize-y')}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !perms.canEdit}
            onClick={() =>
              run(
                () =>
                  apiFetch(`/api/inspections/${i.id}/result`, {
                    method: 'PATCH',
                    body: JSON.stringify({ result, summary: summary.trim() }),
                  }),
                'Inspection completed'
              )
            }
          >
            Mark completed
          </button>
        </div>
      </div>
    </div>
  );
}

const CHECKLIST_GROUPS = [
  { key: 'COMPLIANCE', label: 'Compliance' },
  { key: 'PERMITS', label: 'Permits & Clearances' },
  { key: 'PERFORMANCE', label: 'Performance Commitment' },
] as const;

const CHECKLIST_GROUP_LABEL: Record<string, string> = {
  COMPLIANCE: 'Compliance',
  PERMITS: 'Permits & Clearances',
  PERFORMANCE: 'Performance Commitment',
};

const LOCATOR_STATUS_LABELS: Record<LocatorComplianceRow['status'], string> = {
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
};

const CHECKLIST_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  SUBMITTED: 'Submitted',
  COMPLIED: 'Complied',
  NOT_COMPLIED: 'Not complied',
};

function checklistBadge(status: string) {
  switch (status) {
    case 'COMPLIED':
      return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
    case 'SUBMITTED':
      return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
    case 'NOT_COMPLIED':
      return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
    default:
      return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
  }
}

/** One group of the locator's legacy BRIDGE compliance checklist: fixed
 * requirements, each with Particular (or Commitment/Actual), Validity,
 * Status, Remarks and Date Submitted. Rows read as a summary; Edit opens that
 * one row's form in place. */
function LocatorChecklist({
  proponentId,
  items,
  group,
  canEdit,
  onSaved,
}: {
  proponentId: number;
  items: ComplianceItem[];
  group: ComplianceItem['group'];
  canEdit: boolean;
  onSaved: (item: ComplianceItem) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => setEditing(null), [group]);
  const visible = items.filter((it) => it.group === group);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-secondary">
        {group === 'PERFORMANCE'
          ? 'Commitments the locator made, against what they actually delivered.'
          : 'Required documents for this locator. Record what was submitted, how long it is valid, and whether it complies.'}
      </p>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        {visible.map((it, idx) => (
          <div key={it.code} style={idx > 0 ? { borderTop: '1px solid var(--border)' } : undefined}>
            {editing === it.code ? (
              <ChecklistEditor
                item={it}
                proponentId={proponentId}
                onSaved={(saved) => {
                  onSaved(saved);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <ChecklistRow item={it} canEdit={canEdit} onEdit={() => setEditing(it.code)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChecklistRow({ item, canEdit, onEdit }: { item: ComplianceItem; canEdit: boolean; onEdit: () => void }) {
  const validity = fmtValidity(item.validity_from, item.validity_to);
  const vState = validityState(item.validity_to);
  const isPerformance = item.group === 'PERFORMANCE';
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
          {item.name}
        </div>
        {isPerformance ? (
          item.commitment || item.actual ? (
            <div className="mt-0.5 text-[11px] text-secondary">
              Commitment: <span style={{ color: 'var(--text)' }}>{item.commitment || '—'}</span> · Actual:{' '}
              <span style={{ color: 'var(--text)' }}>{item.actual || '—'}</span>
            </div>
          ) : null
        ) : item.group !== 'PERMITS' && item.particular ? (
          <div className="mt-0.5 text-[11px] text-secondary line-clamp-2">{item.particular}</div>
        ) : null}
        {item.remarks ? (
          <div className="mt-0.5 text-[11px] text-secondary italic line-clamp-2">Remarks: {item.remarks}</div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          <span style={{ color: validity ? VALIDITY_COLOR[vState || 'valid'] || 'var(--text-secondary)' : 'var(--text-secondary)' }}>
            Validity: {validity || '—'}
            {vState === 'expired' ? ' · Expired' : vState === 'expiring' ? ' · Expiring soon' : ''}
          </span>
          <span className="text-secondary">Submitted: {fmtDate(item.date_submitted)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge label={(CHECKLIST_STATUS_LABELS[item.status] || item.status).toUpperCase()} styles={checklistBadge(item.status)} />
        {canEdit ? (
          <button
            type="button"
            className="ml-1 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
            onClick={onEdit}
          >
            <Pencil size={12} />
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ChecklistEditor({
  item,
  proponentId,
  onSaved,
  onCancel,
}: {
  item: ComplianceItem;
  proponentId: number;
  onSaved: (item: ComplianceItem) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    particular: item.particular || '',
    commitment: item.commitment || '',
    actual: item.actual || '',
    validity_from: ymdOf(item.validity_from),
    validity_to: ymdOf(item.validity_to),
    status: item.status || 'PENDING',
    remarks: item.remarks || '',
    date_submitted: ymdOf(item.date_submitted),
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const validityInvalid = Boolean(form.validity_from && form.validity_to && form.validity_to < form.validity_from);
  const isPerformance = item.group === 'PERFORMANCE';

  const save = async () => {
    setBusy(true);
    try {
      const json = await apiFetch(`/api/inspections/locators/${proponentId}/compliance/${item.code}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          validity_from: form.validity_from || null,
          validity_to: form.validity_to || null,
          date_submitted: form.date_submitted || null,
        }),
      });
      toast.success(`${item.name} saved`);
      onSaved(json.data);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 py-3 flex flex-col gap-2.5" style={{ backgroundColor: 'var(--selected-bg)' }}>
      <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
        {item.name}
      </div>

      {isPerformance ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Commitment">
            <input className={inputCls} value={form.commitment} onChange={(e) => set({ commitment: e.target.value })} />
          </Field>
          <Field label="Actual">
            <input className={inputCls} value={form.actual} onChange={(e) => set({ actual: e.target.value })} />
          </Field>
        </div>
      ) : item.group === 'PERMITS' ? null : (
        <Field label="Particular">
          <textarea
            className={cn(inputCls, 'min-h-[52px] resize-y')}
            value={form.particular}
            onChange={(e) => set({ particular: e.target.value })}
            placeholder="e.g. policy / document no., coverage, issuing office"
          />
        </Field>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Field label="Validity from">
          <DatePicker
            mode="single"
            bordered
            fullWidth
            placeholder="Start"
            value={parseYmd(form.validity_from)}
            onChange={(d: Date | null) => set({ validity_from: toYmd(d) })}
          />
        </Field>
        <Field label="Validity to">
          <DatePicker
            mode="single"
            bordered
            fullWidth
            placeholder="End"
            value={parseYmd(form.validity_to)}
            onChange={(d: Date | null) => set({ validity_to: toYmd(d) })}
          />
        </Field>
        <Field label="Status">
          <AppSelect
            compact
            isClearable={false}
            value={form.status}
            onChange={(v) => set({ status: v || 'PENDING' })}
            options={Object.entries(CHECKLIST_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Date submitted">
          <DatePicker
            mode="single"
            bordered
            fullWidth
            placeholder="Select date"
            value={parseYmd(form.date_submitted)}
            onChange={(d: Date | null) => set({ date_submitted: toYmd(d) })}
          />
        </Field>
      </div>
      {validityInvalid ? (
        <p className="-mt-1 text-[11px]" style={{ color: '#ef4444' }}>
          The validity end date can't be before its start date.
        </p>
      ) : null}

      <Field label="Remarks">
        <textarea
          className={cn(inputCls, 'min-h-[52px] resize-y')}
          value={form.remarks}
          onChange={(e) => set({ remarks: e.target.value })}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
          style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
          disabled={busy || validityInvalid}
          onClick={save}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
      <div className="text-[10px] uppercase tracking-wide text-secondary">{label}</div>
      <div className="font-semibold text-[13px]">{value}</div>
    </div>
  );
}

function FindingsTab({ data, perms, busy, run }: { data: DetailPayload; perms: Perms; busy: boolean; run: RunFn }) {
  const id = data.inspection.id;
  const [form, setForm] = useState({ category: '', severity: '', description: '', recommendation: '' });

  const add = () =>
    run(async () => {
      await apiFetch(`/api/inspections/${id}/findings`, {
        method: 'POST',
        body: JSON.stringify({
          category: form.category.trim() || null,
          severity: form.severity || null,
          description: form.description.trim(),
          recommendation: form.recommendation.trim() || null,
        }),
      });
      setForm({ category: '', severity: '', description: '', recommendation: '' });
    }, 'Finding recorded');

  return (
    <div className="flex flex-col gap-3">
      {data.findings.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} className="opacity-40" />}
          title="No findings"
          description="Record inspection findings and recommendations here."
        />
      ) : (
        data.findings.map((f) => (
          <div key={f.id} className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {f.category ? <span className="text-[11px] font-semibold">{f.category}</span> : null}
                {f.severity ? <span className="text-[10px] text-secondary">· {f.severity}</span> : null}
                <Badge
                  label={f.status}
                  styles={
                    f.status === 'RESOLVED'
                      ? resultBadge('PASSED')
                      : f.status === 'WAIVED'
                        ? { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' }
                        : resultBadge('PASSED_WITH_FINDINGS')
                  }
                />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {perms.canEdit && f.status === 'OPEN' ? (
                  <button
                    className="rounded px-2 py-0.5 text-[11px] border disabled:opacity-40"
                    style={{ borderColor: 'var(--border)' }}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          apiFetch(`/api/inspections/findings/${f.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'RESOLVED' }),
                          }),
                        'Finding resolved'
                      )
                    }
                  >
                    Resolve
                  </button>
                ) : null}
                {perms.canDelete ? (
                  <button
                    className="text-secondary hover:text-red-500 disabled:opacity-40"
                    disabled={busy}
                    onClick={() =>
                      run(() => apiFetch(`/api/inspections/findings/${f.id}`, { method: 'DELETE' }), 'Finding deleted')
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="text-[13px] mt-1">{f.description}</div>
            {f.recommendation ? (
              <div className="text-[12px] text-secondary mt-1">
                <span className="font-semibold">Recommendation: </span>
                {f.recommendation}
              </div>
            ) : null}
          </div>
        ))
      )}

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Add finding</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              <input
                className={inputCls}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Structural, Documentary"
              />
            </Field>
            <Field label="Severity">
              <AppSelect
                compact
                value={form.severity}
                onChange={(v) => setForm((f) => ({ ...f, severity: v }))}
                options={SEVERITIES.map((s) => ({ value: s, label: s }))}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              className={cn(inputCls, 'min-h-[56px] resize-y')}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field label="Recommendation">
            <textarea
              className={cn(inputCls, 'min-h-[48px] resize-y')}
              value={form.recommendation}
              onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))}
            />
          </Field>
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.description.trim()}
              onClick={add}
            >
              <Plus size={13} className="inline mr-1" /> Record
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionsTab({ data, perms, busy, run }: { data: DetailPayload; perms: Perms; busy: boolean; run: RunFn }) {
  const id = data.inspection.id;
  const [form, setForm] = useState({ action_required: '', responsible_party: '', due_date: '', finding_id: '' });

  const add = () =>
    run(async () => {
      await apiFetch(`/api/inspections/${id}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          action_required: form.action_required.trim(),
          responsible_party: form.responsible_party.trim() || null,
          due_date: form.due_date || null,
          finding_id: form.finding_id ? Number(form.finding_id) : null,
        }),
      });
      setForm({ action_required: '', responsible_party: '', due_date: '', finding_id: '' });
    }, 'Corrective action added');

  return (
    <div className="flex flex-col gap-3">
      {data.corrective_actions.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={40} className="opacity-40" />}
          title="No corrective actions"
          description="Track what the locator must fix and by when."
        />
      ) : (
        data.corrective_actions.map((a) => {
          const overdue = isOverdue(a);
          return (
            <div key={a.id} className="rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <Badge label={overdue ? 'OVERDUE' : a.status} styles={actionBadge(overdue ? 'OVERDUE' : a.status)} />
                <div className="flex items-center gap-1.5">
                  {perms.canEdit && a.status !== 'DONE' ? (
                    <>
                      <button
                        className="rounded px-2 py-0.5 text-[11px] border disabled:opacity-40"
                        style={{ borderColor: 'var(--border)' }}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              apiFetch(`/api/inspections/actions/${a.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'IN_PROGRESS' }),
                              }),
                            'Marked in progress'
                          )
                        }
                      >
                        In progress
                      </button>
                      <button
                        className="rounded px-2 py-0.5 text-[11px] border disabled:opacity-40"
                        style={{ borderColor: 'var(--border)' }}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              apiFetch(`/api/inspections/actions/${a.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'DONE' }),
                              }),
                            'Marked done'
                          )
                        }
                      >
                        Done
                      </button>
                    </>
                  ) : null}
                  {perms.canDelete ? (
                    <button
                      className="text-secondary hover:text-red-500 disabled:opacity-40"
                      disabled={busy}
                      onClick={() =>
                        run(() => apiFetch(`/api/inspections/actions/${a.id}`, { method: 'DELETE' }), 'Action removed')
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="text-[13px] mt-1">{a.action_required}</div>
              <div className="text-[11px] text-secondary mt-1 flex flex-wrap gap-x-3">
                {a.responsible_party ? <span>Responsible: {a.responsible_party}</span> : null}
                <span style={{ color: overdue ? '#ef4444' : undefined }}>Due: {fmtDate(a.due_date)}</span>
                {a.completed_date ? <span>Completed: {fmtDate(a.completed_date)}</span> : null}
                {a.finding_description ? <span>Finding: {a.finding_description.slice(0, 60)}</span> : null}
              </div>
            </div>
          );
        })
      )}

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Add corrective action</div>
          <Field label="Action required">
            <textarea
              className={cn(inputCls, 'min-h-[56px] resize-y')}
              value={form.action_required}
              onChange={(e) => setForm((f) => ({ ...f, action_required: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Responsible party">
              <input
                className={inputCls}
                value={form.responsible_party}
                onChange={(e) => setForm((f) => ({ ...f, responsible_party: e.target.value }))}
              />
            </Field>
            <Field label="Due date">
              <DatePicker
                mode="single"
                bordered
                fullWidth
                placeholder="Select date"
                value={parseYmd(form.due_date)}
                onChange={(d: Date | null) => setForm((f) => ({ ...f, due_date: toYmd(d) }))}
              />
            </Field>
          </div>
          {data.findings.length ? (
            <Field label="Link to finding (optional)">
              <AppSelect
                compact
                value={form.finding_id}
                onChange={(v) => setForm((f) => ({ ...f, finding_id: v }))}
                options={data.findings.map((f) => ({ value: String(f.id), label: f.description.slice(0, 60) }))}
              />
            </Field>
          ) : null}
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.action_required.trim()}
              onClick={add}
            >
              <Plus size={13} className="inline mr-1" /> Add
            </button>
          </div>
          <span className="hidden">{ACTION_STATUSES.join(',')}</span>
        </div>
      ) : null}
    </div>
  );
}

function ReportsTab({ data, perms, busy, run }: { data: DetailPayload; perms: Perms; busy: boolean; run: RunFn }) {
  const id = data.inspection.id;
  const [form, setForm] = useState({ doc_kind: 'REPORT', file_name: '', storage_path: '' });

  const add = () =>
    run(async () => {
      await apiFetch(`/api/inspections/${id}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          doc_kind: form.doc_kind,
          file_name: form.file_name.trim(),
          storage_path: form.storage_path.trim(),
        }),
      });
      setForm({ doc_kind: 'REPORT', file_name: '', storage_path: '' });
    }, 'Document recorded');

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-secondary">
        File references (path or link) — this system stores document metadata, not the binary.
      </div>
      {data.documents.length === 0 ? (
        <EmptyState
          icon={<FileText size={40} className="opacity-40" />}
          title="No documents"
          description="Attach inspection report and supporting document references."
        />
      ) : (
        <div className="rounded-xl border divide-y" style={{ borderColor: 'var(--border)' }}>
          {data.documents.map((d) => (
            <div key={d.id} className="p-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {d.doc_kind === 'REPORT' ? '📄 ' : '📎 '}
                  {d.file_name}
                </div>
                <div className="text-[11px] text-secondary truncate">{d.storage_path}</div>
              </div>
              {perms.canDelete ? (
                <button
                  className="text-secondary hover:text-red-500 disabled:opacity-40 shrink-0"
                  disabled={busy}
                  onClick={() =>
                    run(() => apiFetch(`/api/inspections/documents/${d.id}`, { method: 'DELETE' }), 'Document removed')
                  }
                >
                  <Trash2 size={13} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {perms.canAdd ? (
        <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-secondary">Add document reference</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kind">
              <AppSelect
                compact
                isClearable={false}
                value={form.doc_kind}
                onChange={(v) => setForm((f) => ({ ...f, doc_kind: v }))}
                options={[
                  { value: 'REPORT', label: 'Inspection Report' },
                  { value: 'SUPPORTING', label: 'Supporting Document' },
                ]}
              />
            </Field>
            <Field label="File name">
              <input
                className={inputCls}
                value={form.file_name}
                onChange={(e) => setForm((f) => ({ ...f, file_name: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Path / link">
            <input
              className={inputCls}
              value={form.storage_path}
              onChange={(e) => setForm((f) => ({ ...f, storage_path: e.target.value }))}
              placeholder="\\server\share\report.pdf or https://…"
            />
          </Field>
          <div className="flex justify-end">
            <button
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              disabled={busy || !form.file_name.trim() || !form.storage_path.trim()}
              onClick={add}
            >
              <Plus size={13} className="inline mr-1" /> Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActivityTab({ data }: { data: DetailPayload }) {
  if (data.activity.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={40} className="opacity-40" />}
        title="No activity"
        description="Inspection actions are logged here."
      />
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {data.activity.map((act) => (
        <li key={act.id} className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border)' }}>
          <div className="flex justify-between">
            <span className="font-semibold">{act.action.replace(/_/g, ' ')}</span>
            <span className="text-secondary">{fmtDate(act.created_at)}</span>
          </div>
          {act.detail ? <div className="text-secondary mt-0.5">{act.detail}</div> : null}
          <div className="text-[10px] text-secondary mt-0.5">{act.actor_name || act.actor_username || 'System'}</div>
        </li>
      ))}
    </ol>
  );
}

function NewInspection({
  meta,
  defaultProponentId,
  usedTypeCodes,
  onClose,
  onCreated,
}: {
  meta: Meta;
  defaultProponentId?: number;
  usedTypeCodes?: string[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [form, setForm] = useState({
    proponent_id: defaultProponentId ? String(defaultProponentId) : '',
    inspection_type_code: '',
    title: '',
    scheduled_date: '',
    assigned_inspector_id: '',
    validity_from: '',
    validity_to: '',
  });
  const [busy, setBusy] = useState(false);
  const availableTypes = useMemo(() => {
    const used = new Set(usedTypeCodes || []);
    return meta.types.filter((t) => !used.has(t.code));
  }, [meta.types, usedTypeCodes]);

  const submit = async () => {
    setBusy(true);
    try {
      const json = await apiFetch('/api/inspections', {
        method: 'POST',
        body: JSON.stringify({
          proponent_id: Number(form.proponent_id),
          inspection_type_code: form.inspection_type_code || null,
          title: form.title.trim(),
          scheduled_date: form.scheduled_date || null,
          validity_from: form.validity_from || null,
          validity_to: form.validity_to || null,
          assigned_inspector_id: form.assigned_inspector_id ? Number(form.assigned_inspector_id) : null,
        }),
      });
      toast.success('Inspection scheduled');
      onCreated(json.data.inspection.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center px-3">
      <motion.div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 w-full max-w-md rounded-2xl border shadow-2xl p-4 flex flex-col gap-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-bold">New Inspection</div>
            {defaultProponentId ? (
              <div className="text-[11px] text-secondary truncate">
                {meta.proponents.find((p) => Number(p.id) === defaultProponentId)?.business_name || '—'}
              </div>
            ) : null}
          </div>
          <button className="text-[var(--text-muted)]" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {/* Opened from a locator's drawer: the locator is already known. */}
        {defaultProponentId ? null : (
          <Field label="Locator">
            <AppSelect
              compact
              placeholder="Select locator…"
              value={form.proponent_id}
              onChange={(v) => setForm((f) => ({ ...f, proponent_id: v }))}
              options={meta.proponents.map((p) => ({ value: String(p.id), label: p.business_name }))}
            />
          </Field>
        )}
        <Field label="Requirement to inspect">
          <AppSelect
            compact
            placeholder="Select requirement…"
            value={form.inspection_type_code}
            onChange={(v) => setForm((f) => ({ ...f, inspection_type_code: v }))}
            options={availableTypes.map((t) => ({
              value: t.code,
              label: `${CHECKLIST_GROUP_LABEL[t.category] || t.category} · ${t.name}`,
            }))}
          />
          {availableTypes.length === 0 ? (
            <p className="mt-1 text-[11px] text-secondary">Every requirement already has an inspection here.</p>
          ) : null}
        </Field>
        <Field label="Title">
          <input
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Annual Safety Inspection 2026"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Scheduled date">
            <DatePicker
              mode="single"
              bordered
              fullWidth
              placeholder="Select date"
              value={parseYmd(form.scheduled_date)}
              onChange={(d: Date | null) => setForm((f) => ({ ...f, scheduled_date: toYmd(d) }))}
            />
          </Field>
          <Field label="Inspector (optional)">
            <AppSelect
              compact
              value={form.assigned_inspector_id}
              onChange={(v) => setForm((f) => ({ ...f, assigned_inspector_id: v }))}
              options={meta.inspectors.map((e) => ({ value: String(e.id), label: e.full_name || e.username }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Validity from (optional)">
            <DatePicker
              mode="single"
              bordered
              fullWidth
              placeholder="Start date"
              value={parseYmd(form.validity_from)}
              onChange={(d: Date | null) => setForm((f) => ({ ...f, validity_from: toYmd(d) }))}
            />
          </Field>
          <Field label="Validity to (optional)">
            <DatePicker
              mode="single"
              bordered
              fullWidth
              placeholder="End date"
              value={parseYmd(form.validity_to)}
              onChange={(d: Date | null) => setForm((f) => ({ ...f, validity_to: toYmd(d) }))}
            />
          </Field>
        </div>
        {form.validity_from && form.validity_to && form.validity_to < form.validity_from ? (
          <p className="-mt-1 text-[11px]" style={{ color: '#ef4444' }}>
            The validity end date can't be before its start date.
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            className="rounded-lg px-3 py-2 text-sm font-semibold border"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            disabled={busy || !form.proponent_id || !form.title.trim()}
            onClick={submit}
          >
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
