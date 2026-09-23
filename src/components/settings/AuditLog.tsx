import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Download, Search, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { TableSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { DatePicker } from '../ui/DatePicker';

type AuditLogRow = {
  id: number;
  actor_id: number | null;
  actor_username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  /** Sign-in session the action happened in (null for older rows). */
  session_id: string | null;
  category: string;
  created_at: string;
};

// Server-side groups (AuditLog.categoryOf) for the Category filter.
const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Sign-ins & sessions',
  accounts: 'Accounts & permissions',
  access: 'File access & exports',
  locators: 'Locators',
  workflow: 'Applications & workflow',
  maintenance: 'File maintenance',
};
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }));

/** "45s", "12m", "2h 14m", "1d 3h". */
function formatDuration(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** One entry of `details.changes` (server/lib/auditDiff.js): a field that
 * actually changed, with its old/new value, or only a flag when the value is
 * secret (masked) or a list (item counts). */
type AuditChange = {
  field: string;
  from?: string | null;
  to?: string | null;
  masked?: boolean;
  from_count?: number;
  to_count?: number;
};

function api(path: string) {
  return path;
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Login succeeded',
  LOGIN_FAILED: 'Login failed',
  LOGOUT: 'Logged out',
  SESSION_EXPIRED: 'Session expired',
  SESSION_REVOKED: 'Session ended',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  USER_PASSWORD_RESET: 'Password reset',
  USER_DEACTIVATED: 'User deactivated',
  USER_REACTIVATED: 'User reactivated',
  USER_SUSPENDED: 'User suspended',
  USER_UNSUSPENDED: 'User reinstated',
  USER_SESSIONS_REVOKED: 'Sessions revoked',
  USER_TOTP_RESET: 'Authenticator reset',
  ROLE_CREATED: 'Role created',
  ROLE_UPDATED: 'Role updated',
  ROLE_DEACTIVATED: 'Role retired',
  ROLE_REACTIVATED: 'Role restored',
  PERMISSIONS_CHANGED: 'Permissions changed',
  USER_APPROVED: 'User approved',
  USER_REJECTED: 'User rejected',
  USER_PASSWORD_SELF_CHANGE: 'Password changed',
  PASSWORD_RESET_REQUESTED: 'Password reset requested',
  PASSWORD_RESET_VIA_EMAIL: 'Password reset via email',
  // Locators / Proponents
  PROPONENT_CREATED: 'Locator created',
  PROPONENT_UPDATED: 'Locator updated',
  PROPONENT_DEACTIVATED: 'Locator deactivated',
  PROPONENT_REACTIVATED: 'Locator reactivated',
  PROPONENT_CHANGE_APPROVED: 'Profile change approved',
  PROPONENT_CHANGE_REJECTED: 'Profile change declined',
  PROPONENT_SELF_SETUP: 'Locator set up own profile',
  PROPONENT_CHANGE_REQUESTED: 'Locator requested profile change',
  PROPONENT_STOCKHOLDERS_UPDATED: 'Stockholders updated',
  PROPONENT_CONTACTS_UPDATED: 'Contacts updated',
  PROPONENT_PROPERTIES_UPDATED: 'Properties updated',
  PROPONENT_INVESTMENT_UPDATED: 'Investment info updated',
  // Applications
  APPLICATION_DRAFT_SAVED: 'Draft saved',
  APPLICATION_SUBMITTED: 'Application submitted',
  APPLICATION_RESUBMITTED: 'Application resubmitted',
  APPLICATION_UPDATED: 'Application updated',
  APPLICATION_DELETED: 'Draft deleted',
  APPLICATION_STATUS_FORCED: 'Status changed (admin override)',
  APPLICATION_APPROVED: 'Application approved',
  APPLICATION_DISAPPROVED: 'Application disapproved',
  DOCUMENT_UPLOADED: 'Document uploaded',
  REQUIREMENT_VERIFIED: 'Requirement verified',
  REQUIREMENT_REJECTED: 'Requirement rejected',
  REQUIREMENT_STATUS_CHANGED: 'Requirement status changed',
  // Assessment
  ASSESSMENT_REOPENED: 'Assessment reopened',
  ASSESSMENT_RECOMMENDATION_SUBMITTED: 'Recommendation submitted',
  ASSESSMENT_FINDING_ADDED: 'Deficiency noted',
  ASSESSMENT_EVALUATOR_ASSIGNED: 'Evaluator assigned',
  ASSESSMENT_STAGE_CHANGED: 'Assessment stage changed',
  ASSESSMENT_FINDING_UPDATED: 'Deficiency updated',
  ASSESSMENT_FINDING_DELETED: 'Deficiency removed',
  ASSESSMENT_CHARGE_ADDED: 'Charge added',
  ASSESSMENT_CHARGE_UPDATED: 'Charge updated',
  ASSESSMENT_CHARGE_DELETED: 'Charge removed',
  REQUIREMENT_ADDED_ADHOC: 'Ad-hoc requirement added',
  // Approval / Issuance
  APPROVAL_REOPENED: 'Approval reopened',
  APPROVAL_STARTED: 'Approval routing started',
  APPROVAL_STEP_DECIDED: 'Approval level decided',
  APPROVAL_STEP_ENDORSED: 'Approval level endorsed',
  APPROVAL_STEP_ASSIGNED: 'Approval level assigned',
  ISSUANCE_ADDED: 'Document issued',
  ISSUANCE_DELETED: 'Issued document removed',
  APPROVAL_CHARGE_ADDED: 'Charge added',
  APPROVAL_CHARGE_UPDATED: 'Charge updated',
  APPROVAL_CHARGE_DELETED: 'Charge removed',
  APPROVAL_LEVEL_CREATED: 'Approval level configured',
  APPROVAL_LEVEL_UPDATED: 'Approval level configuration updated',
  APPROVAL_LEVEL_DELETED: 'Approval level retired',
  CONTRACT_SAVED: 'Contract recorded',
  CONTRACT_CREATED: 'Contract created',
  CONTRACT_UPDATED: 'Contract updated',
  // Permits
  PERMIT_CREATED: 'Permit created',
  PERMIT_UPDATED: 'Permit updated',
  PERMIT_DEACTIVATED: 'Permit deactivated',
  // Inspections
  INSPECTION_SCHEDULED: 'Inspection scheduled',
  INSPECTION_UPDATED: 'Inspection updated',
  INSPECTION_INSPECTOR_ASSIGNED: 'Inspector assigned',
  INSPECTION_STATUS_CHANGED: 'Inspection status changed',
  INSPECTION_RESULT_RECORDED: 'Inspection result recorded',
  INSPECTION_FAILED: 'Inspection failed',
  INSPECTION_FINDING_ADDED: 'Deficiency noted',
  INSPECTION_FINDING_UPDATED: 'Deficiency updated',
  INSPECTION_FINDING_DELETED: 'Deficiency removed',
  INSPECTION_ACTION_ADDED: 'Corrective action added',
  INSPECTION_ACTION_UPDATED: 'Corrective action updated',
  INSPECTION_ACTION_DELETED: 'Corrective action removed',
  INSPECTION_DOCUMENT_ADDED: 'Document attached',
  INSPECTION_DOCUMENT_DELETED: 'Document removed',
  // File Maintenance (requirements catalog, categories, and lookup tables)
  REQUIREMENT_CREATED: 'Requirement created',
  REQUIREMENT_UPDATED: 'Requirement updated',
  REQUIREMENT_DEACTIVATED: 'Requirement deactivated',
  REQUIREMENT_REACTIVATED: 'Requirement reactivated',
  REQUIREMENT_CATEGORY_CREATED: 'Requirement category created',
  REQUIREMENT_CATEGORY_UPDATED: 'Requirement category updated',
  REQUIREMENT_CATEGORY_DEACTIVATED: 'Requirement category deactivated',
  REQUIREMENT_CATEGORY_REACTIVATED: 'Requirement category reactivated',
  COMPLIANCE_TYPE_CREATED: 'Compliance type created',
  COMPLIANCE_TYPE_UPDATED: 'Compliance type updated',
  COMPLIANCE_TYPE_DEACTIVATED: 'Compliance type deactivated',
  COMPLIANCE_TYPE_REACTIVATED: 'Compliance type reactivated',
  INSPECTION_TYPE_CREATED: 'Inspection type created',
  INSPECTION_TYPE_UPDATED: 'Inspection type updated',
  INSPECTION_TYPE_DEACTIVATED: 'Inspection type deactivated',
  INSPECTION_TYPE_REACTIVATED: 'Inspection type reactivated',
  APPLICATION_TYPE_CREATED: 'Application type created',
  APPLICATION_TYPE_UPDATED: 'Application type updated',
  APPLICATION_TYPE_DEACTIVATED: 'Application type deactivated',
  APPLICATION_TYPE_REACTIVATED: 'Application type reactivated',
  DEPARTMENT_CREATED: 'Department created',
  DEPARTMENT_UPDATED: 'Department updated',
  DEPARTMENT_DEACTIVATED: 'Department deactivated',
  DEPARTMENT_REACTIVATED: 'Department reactivated',
  BUILDING_CREATED: 'Building created',
  BUILDING_UPDATED: 'Building updated',
  BUILDING_DEACTIVATED: 'Building deactivated',
  BUILDING_REACTIVATED: 'Building reactivated',
  LAND_USE_CREATED: 'Land use created',
  LAND_USE_UPDATED: 'Land use updated',
  LAND_USE_DEACTIVATED: 'Land use deactivated',
  LAND_USE_REACTIVATED: 'Land use reactivated',
  TYPE_OF_CONTRACT_CREATED: 'Type of contract created',
  TYPE_OF_CONTRACT_UPDATED: 'Type of contract updated',
  TYPE_OF_CONTRACT_DEACTIVATED: 'Type of contract deactivated',
  TYPE_OF_CONTRACT_REACTIVATED: 'Type of contract reactivated',
  // File access / exports
  DOCUMENT_VIEWED: 'Document viewed',
  DOCUMENT_DOWNLOADED: 'Document downloaded',
  CERTIFICATE_VIEWED: 'Certificate viewed',
  CERTIFICATE_DOWNLOADED: 'Certificate downloaded',
  REPORT_EXPORTED: 'Report exported',
  AUDIT_LOG_EXPORTED: 'Audit log exported',
};

// `details.reason` on LOGIN_FAILED (server/models/Auth.js). Admin-facing only
// — the person signing in still just sees the generic message.
const LOGIN_FAILURE_REASONS: Record<string, string> = {
  unknown_user: 'No account with this username or email',
  wrong_password: 'Wrong password',
  account_locked: 'Account is locked after too many failed attempts',
  pending_approval: 'Account is still awaiting approval',
  registration_rejected: 'Registration was rejected',
  suspended: 'Account is suspended',
  deactivated: 'Account is deactivated',
  invalid_mfa_code: 'Wrong authenticator code',
  weak_new_password: 'New password did not meet the requirements',
  unsupported_password_format: 'Stored password is in an unsupported format',
  config_error: 'Sign-in configuration error',
  server_error: 'Server error during sign-in',
};

const REPORT_FILTER_LABELS: Record<string, string> = {
  dateFrom: 'from',
  dateTo: 'to',
  applicationType: 'type',
  status: 'status',
  isRenewal: 'new/renewal',
  search: 'search',
};

// Filter names as recorded in AUDIT_LOG_EXPORTED details.
const AUDIT_FILTER_LABELS: Record<string, string> = {
  q: 'search',
  actor: 'username contains',
  user: 'user',
  action: 'action',
  category: 'category',
  ip: 'IP',
  entityType: 'record type',
  entityId: 'record id',
  session: 'session',
  from: 'from',
  to: 'to',
};

function describeLoginFailure(d: Record<string, unknown>): string {
  const reason = typeof d.reason === 'string' ? d.reason : null;
  // Rows from before reasons were recorded: fall back to the message the user saw.
  if (!reason || !LOGIN_FAILURE_REASONS[reason]) {
    const message = typeof d.message === 'string' && d.message ? d.message : 'Sign-in attempt failed';
    return d.locked ? `${message} Account is now locked.` : message;
  }
  let text = LOGIN_FAILURE_REASONS[reason];
  if (typeof d.attempt === 'number' && typeof d.maxAttempts === 'number') {
    text += ` (attempt ${d.attempt} of ${d.maxAttempts})`;
  }
  if (reason === 'wrong_password' && d.locked) text += ' — account now locked';
  if (typeof d.recentFailures === 'number' && d.recentFailures > 1) {
    const minutes = typeof d.windowMinutes === 'number' ? d.windowMinutes : 15;
    text += ` · ${d.recentFailures} failed attempts for this name in the last ${minutes} min`;
  }
  return text;
}

function describeFileAccess(row: AuditLogRow, d: Record<string, unknown>): string {
  const verb = row.action.endsWith('_VIEWED') ? 'Viewed' : 'Downloaded';
  if (row.action.startsWith('CERTIFICATE_')) {
    const what =
      d.certificate === 'permit'
        ? `permit certificate${d.permit_no ? ` ${String(d.permit_no)}` : ''}`
        : `contract certificate${d.contract_no ? ` ${String(d.contract_no)}` : ''}`;
    return `${verb} ${what}`;
  }
  const file = d.file_name ? `"${String(d.file_name)}"` : 'a document';
  return d.application_no ? `${verb} ${file} from application ${String(d.application_no)}` : `${verb} ${file}`;
}

function describeReportExport(d: Record<string, unknown>): string {
  const format = typeof d.format === 'string' ? d.format.toUpperCase() : 'a file';
  const rows = typeof d.rowCount === 'number' ? ` (${d.rowCount} ${d.rowCount === 1 ? 'row' : 'rows'})` : '';
  const filters = d.filters && typeof d.filters === 'object' ? Object.entries(d.filters as Record<string, unknown>) : [];
  const filterText = filters.length
    ? ` — ${filters.map(([k, v]) => `${REPORT_FILTER_LABELS[k] || humanizeKey(k)}: ${String(v)}`).join(', ')}`
    : ' — no filters';
  return `Exported the applications report to ${format}${rows}${filterText}`;
}

const FIELD_LABELS: Record<string, string> = {
  username: 'username',
  email: 'email',
  phone: 'phone number',
  full_name: 'full name',
  password: 'password',
  is_active: 'active status',
  role_id: 'role',
  business_name: 'business name',
  address: 'address',
  lease_address: 'lease address',
  contact_no: 'contact number',
  role: 'role',
  tin: 'TIN',
  department_id: 'department',
  proponent_id: 'locator',
  account_officer_id: 'account officer',
  assigned_inspector_id: 'inspector',
  contact_persons: 'contact persons',
  is_renewal: 'renewal',
};

function fieldLabel(field: string) {
  return FIELD_LABELS[field] || humanizeKey(field.replace(/_id$/, ''));
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function readChanges(row: AuditLogRow): AuditChange[] | null {
  const changes = (row.details as Record<string, unknown> | null)?.changes;
  return Array.isArray(changes) ? (changes as AuditChange[]) : null;
}

/** "Email: a@x.com → b@x.com" — one line per changed field. */
function describeChange(c: AuditChange): string {
  const label = capitalize(fieldLabel(c.field));
  if (c.masked) return `${label}: changed (value hidden)`;
  if (typeof c.from_count === 'number' || typeof c.to_count === 'number') {
    const from = c.from_count ?? 0;
    const to = c.to_count ?? 0;
    return from === to ? `${label}: edited (${to} ${to === 1 ? 'entry' : 'entries'})` : `${label}: ${from} → ${to} entries`;
  }
  if (!('from' in c) && !('to' in c)) return `${label}: changed`;
  const show = (v: string | null | undefined) => (v == null || v === '' ? '(empty)' : `"${v}"`);
  return `${label}: ${show(c.from)} → ${show(c.to)}`;
}

/** ::1 / 127.0.0.1 is this machine itself; ::ffff:1.2.3.4 is just Node's
 * spelling of an IPv4 client (older rows were stored that way). */
function formatIp(ip: string | null): string {
  if (!ip) return '—';
  const plain = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  return plain === '::1' || plain === '127.0.0.1' ? 'localhost' : plain;
}

/** "Chrome 128 · Windows" from a raw user-agent string — enough to tell a
 * familiar device from an unfamiliar one; the full string is in the tooltip. */
function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const match = (re: RegExp) => ua.match(re);
  let r: RegExpMatchArray | null;
  let browser: string | null = null;
  if ((r = match(/Edg(?:e|A|iOS)?\/(\d+)/))) browser = `Edge ${r[1]}`;
  else if ((r = match(/OPR\/(\d+)/))) browser = `Opera ${r[1]}`;
  else if ((r = match(/SamsungBrowser\/(\d+)/))) browser = `Samsung Internet ${r[1]}`;
  else if ((r = match(/(?:Chrome|CriOS)\/(\d+)/))) browser = `Chrome ${r[1]}`;
  else if ((r = match(/(?:Firefox|FxiOS)\/(\d+)/))) browser = `Firefox ${r[1]}`;
  else if ((r = match(/Version\/(\d+)[\d.]*.*Safari\//))) browser = `Safari ${r[1]}`;
  else if ((r = match(/^(PostmanRuntime|curl|axios|node-fetch|python-requests)\b/i))) browser = r[1];

  let os: string | null = null;
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  const label = [browser, os].filter(Boolean).join(' · ');
  return label || (ua.length > 40 ? `${ua.slice(0, 39)}…` : ua);
}

const PERMISSION_SCOPES: Record<string, string> = {
  role_sidebar_menu: 'sidebar menu access',
  role_menu_crud: 'create/edit/delete permissions',
  role_dashboard_widgets: 'dashboard widget access',
};

function humanizeKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
}

function joinList(items: string[]) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// Human word for each entity_type, shown in the Entity column ahead of the
// real name — e.g. "Locator" rather than the raw "proponent" table name.
const ENTITY_TYPE_LABELS: Record<string, string> = {
  user: 'User',
  role: 'Role',
  role_sidebar_menu: 'Role',
  role_menu_crud: 'Role',
  role_dashboard_widgets: 'Role',
  proponent: 'Locator',
  application: 'Application',
  application_requirement: 'Requirement',
  assessment_finding: 'Finding',
  assessment_charge: 'Charge',
  inspection: 'Inspection',
  inspection_finding: 'Finding',
  inspection_action: 'Corrective action',
  permit: 'Permit',
  contract: 'Contract',
  approval_level: 'Approval level',
  requirement: 'Requirement',
  requirement_category: 'Requirement category',
  compliance_type: 'Compliance type',
  inspection_type: 'Inspection type',
  application_type: 'Application type',
  department: 'Department',
  building: 'Building',
  land_use: 'Land use',
  type_of_contract: 'Type of contract',
  report: 'Report',
};

// Which `details` field holds the real, human-readable name for each
// entity_type — same payloads describeActivity() already reads, reused here
// so the Entity column shows "locator \"Acme Corp\"" instead of a raw
// "proponent #1175" foreign key.
const ENTITY_NAME_FIELDS: Record<string, string[]> = {
  user: ['username'],
  role: ['name'],
  role_sidebar_menu: ['name'],
  role_menu_crud: ['name'],
  role_dashboard_widgets: ['name'],
  proponent: ['business_name'],
  application: ['application_no'],
  application_requirement: ['requirement_name'],
  assessment_finding: ['description'],
  assessment_charge: ['description'],
  inspection: ['title'],
  inspection_finding: ['description'],
  inspection_action: ['action_required'],
  permit: ['permit_no'],
  contract: ['contract_no'],
  approval_level: ['name'],
  requirement: ['name', 'code'],
  requirement_category: ['name'],
  compliance_type: ['name', 'code'],
  inspection_type: ['name', 'code'],
  application_type: ['name', 'code'],
  department: ['name', 'code'],
  building: ['name'],
  land_use: ['name'],
  type_of_contract: ['name'],
};

/** Entity column text: the real name from `details` when available, falling
 * back to the raw "#id" only when nothing more human was ever recorded
 * (e.g. an old row from before that entity_type carried a name, or the
 * target was hard-deleted and no longer resolvable). */
function entityLabel(row: AuditLogRow): string {
  const type = row.entity_type;
  if (!type) return '—';
  const d = (row.details || {}) as Record<string, unknown>;
  const typeLabel = ENTITY_TYPE_LABELS[type] || humanizeKey(type);

  const fields = ENTITY_NAME_FIELDS[type] || [];
  for (const field of fields) {
    const value = d[field];
    if (typeof value === 'string' && value.trim()) {
      return `${typeLabel}: "${value.trim()}"`;
    }
  }

  return row.entity_id != null ? `${typeLabel} #${row.entity_id}` : typeLabel;
}

/** Plain-language description of what the actor did, built from the action
 * code plus its stored details — so reviewers never have to read raw JSON. */
function describeActivity(row: AuditLogRow): string {
  const d = (row.details || {}) as Record<string, unknown>;
  // Prefer a real, human name over the raw database id — the id is still
  // shown in the Entity column, but Details should read like something a
  // reviewer recognizes, not a foreign key.
  const usernameHint = typeof d.username === 'string' && d.username ? d.username : null;
  const roleNameHint = typeof d.name === 'string' && d.name ? d.name : null;
  const target = row.entity_id != null ? `#${row.entity_id}` : '';
  const user = usernameHint ? `user "${usernameHint}"` : `user ${target}`.trim();
  const role = roleNameHint ? `role "${roleNameHint}"` : `role ${target}`.trim();

  switch (row.action) {
    case 'LOGIN_SUCCESS':
      return 'Signed in to the system';
    case 'LOGIN_FAILED':
      return describeLoginFailure(d);
    case 'LOGOUT': {
      const duration = formatDuration(d.duration_seconds);
      return duration ? `Signed out after ${duration}` : 'Signed out of the system';
    }
    case 'SESSION_EXPIRED': {
      const active = formatDuration(d.active_seconds);
      return active
        ? `Session reached its 24h limit without a sign-out — last activity ${active} after sign-in`
        : 'Session reached its 24h limit without a sign-out';
    }
    case 'SESSION_REVOKED': {
      const duration = formatDuration(d.duration_seconds);
      const cause = d.account_inactive
        ? 'the account was deactivated or suspended'
        : 'of a password reset or "sign out of all devices"';
      return `Session ended because ${cause}${duration ? ` (after ${duration})` : ''}`;
    }
    case 'USER_CREATED': {
      const parts = [`Created account "${d.username ?? user}"`];
      if (d.autoGeneratedPassword) parts.push('with an auto-generated password');
      if (d.emailSent === true) parts.push('and emailed the credentials');
      else if (d.emailSent === false) parts.push('(credentials email not sent)');
      if (d.deferredActivation) parts.push('— activation deferred');
      return parts.join(' ');
    }
    case 'USER_UPDATED': {
      // Newer rows carry `changes`, listed under this line by ChangeList.
      if (readChanges(row)) return `Updated ${user}`;
      // Older rows only have `fields` — every field the form sent, changed or not.
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      const labels = fields.map(fieldLabel);
      return labels.length ? `Updated ${user}: saved ${joinList(labels)}` : `Updated ${user}`;
    }
    case 'USER_PASSWORD_RESET': {
      if (d.emailSent === true) return `Reset password for ${user} and emailed the new one`;
      if (d.emailSent === false) return `Reset password for ${user} (email not sent)`;
      return `Set a new password for ${user}`;
    }
    case 'USER_DEACTIVATED':
      return `Deactivated ${user}`;
    case 'USER_REACTIVATED':
      return `Reactivated ${user}`;
    case 'USER_SUSPENDED':
      return `Suspended ${user}`;
    case 'USER_UNSUSPENDED':
      return `Reinstated ${user}`;
    case 'USER_SESSIONS_REVOKED':
      return `Signed ${user} out of all devices`;
    case 'USER_TOTP_RESET':
      return `Reset the authenticator app for ${user}`;
    case 'USER_APPROVED':
      return `Approved registration of ${user}`;
    case 'USER_REJECTED':
      return d.note ? `Rejected registration of ${user} — "${String(d.note)}"` : `Rejected registration of ${user}`;
    case 'USER_PASSWORD_SELF_CHANGE':
      return 'Changed their own password';
    case 'PASSWORD_RESET_REQUESTED':
      return d.emailSent === false ? 'Requested a password reset (email not sent)' : 'Requested a password reset by email';
    case 'PASSWORD_RESET_VIA_EMAIL':
      return 'Set a new password using the emailed reset link';
    case 'ROLE_CREATED':
      return d.name ? `Created role "${String(d.name)}"` : 'Created a role';
    case 'ROLE_UPDATED': {
      const prev = typeof d.previousName === 'string' && d.previousName ? d.previousName : null;
      return prev ? `Renamed role "${prev}" to "${roleNameHint}"` : `Updated ${role}`;
    }
    case 'ROLE_DEACTIVATED':
      return `Retired ${role}`;
    case 'ROLE_REACTIVATED':
      return `Restored ${role}`;
    case 'PERMISSIONS_CHANGED': {
      const scope = PERMISSION_SCOPES[row.entity_type || ''] || 'permissions';
      const count = typeof d.menuCount === 'number' ? d.menuCount : typeof d.widgetCount === 'number' ? d.widgetCount : null;
      return count != null ? `Changed ${scope} for ${role} (${count} entries)` : `Changed ${scope} for ${role}`;
    }

    // --- Locators / Proponents ---
    case 'PROPONENT_CREATED':
      return d.business_name ? `Added locator "${String(d.business_name)}"` : 'Added a locator';
    case 'PROPONENT_UPDATED':
      return d.business_name ? `Updated locator "${String(d.business_name)}"` : 'Updated a locator';
    case 'PROPONENT_DEACTIVATED':
      return d.business_name ? `Deactivated locator "${String(d.business_name)}"` : 'Deactivated a locator';
    case 'PROPONENT_REACTIVATED':
      return d.business_name ? `Reactivated locator "${String(d.business_name)}"` : 'Reactivated a locator';
    case 'PROPONENT_CHANGE_APPROVED':
      return d.business_name ? `Approved profile changes for "${String(d.business_name)}"` : 'Approved a profile change request';
    case 'PROPONENT_CHANGE_REJECTED':
      return d.remarks
        ? `Declined profile changes for "${String(d.business_name ?? '')}" — "${String(d.remarks)}"`
        : `Declined profile changes for "${String(d.business_name ?? '')}"`;
    case 'PROPONENT_SELF_SETUP':
      return d.business_name ? `Set up business profile "${String(d.business_name)}"` : 'Set up their business profile';
    case 'PROPONENT_CHANGE_REQUESTED': {
      if (readChanges(row)) return `Requested changes to "${String(d.business_name ?? '')}"`;
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      const labels = fields.map(fieldLabel);
      return labels.length
        ? `Requested changes to "${String(d.business_name ?? '')}": ${joinList(labels)}`
        : `Requested profile changes for "${String(d.business_name ?? '')}"`;
    }
    case 'PROPONENT_STOCKHOLDERS_UPDATED':
      return `Updated stockholders for "${String(d.business_name ?? '')}"`;
    case 'PROPONENT_CONTACTS_UPDATED':
      return `Updated contacts/signatories for "${String(d.business_name ?? '')}"`;
    case 'PROPONENT_PROPERTIES_UPDATED':
      return `Updated property schedule for "${String(d.business_name ?? '')}"`;
    case 'PROPONENT_INVESTMENT_UPDATED':
      return `Updated investment info for "${String(d.business_name ?? '')}"`;

    // --- Applications ---
    case 'APPLICATION_DRAFT_SAVED':
      return `Saved draft application ${String(d.application_no ?? '')} for ${String(d.proponent_name ?? '')}`.trim();
    case 'APPLICATION_SUBMITTED':
      return `Filed application ${String(d.application_no ?? '')} for ${String(d.proponent_name ?? '')}`.trim();
    case 'APPLICATION_RESUBMITTED':
      return `Resubmitted application ${String(d.application_no ?? '')} for ${String(d.proponent_name ?? '')}`.trim();
    case 'APPLICATION_UPDATED':
      return `Updated application ${String(d.application_no ?? '')}`.trim();
    case 'APPLICATION_DELETED':
      return `Deleted draft application ${String(d.application_no ?? '')}`.trim();
    case 'APPLICATION_STATUS_FORCED':
      return `Forced application ${String(d.application_no ?? '')} to ${String(d.to_status ?? '')}${d.remarks ? ` — "${String(d.remarks)}"` : ''}`;
    case 'DOCUMENT_UPLOADED':
      return `Uploaded "${String(d.file_name ?? 'a document')}" to application ${String(d.application_no ?? '')}`.trim();
    case 'REQUIREMENT_VERIFIED':
      return `Verified requirement "${String(d.requirement_name ?? '')}"`;
    case 'REQUIREMENT_REJECTED':
      return d.remarks
        ? `Rejected requirement "${String(d.requirement_name ?? '')}" — "${String(d.remarks)}"`
        : `Rejected requirement "${String(d.requirement_name ?? '')}"`;
    case 'REQUIREMENT_STATUS_CHANGED':
      return `Updated requirement "${String(d.requirement_name ?? '')}"`;

    // --- Assessment ---
    case 'ASSESSMENT_REOPENED':
      return `Reopened assessment for ${String(d.application_no ?? '')} (${String(d.proponent_name ?? '')})`;
    case 'ASSESSMENT_RECOMMENDATION_SUBMITTED':
      return `Recommended "${String(d.recommendation ?? '')}" for ${String(d.application_no ?? '')}${d.summary ? ` — "${String(d.summary)}"` : ''}`;
    case 'ASSESSMENT_FINDING_ADDED':
      return `Noted a deficiency: "${String(d.description ?? '')}"`;
    case 'ASSESSMENT_EVALUATOR_ASSIGNED':
      return `Assigned ${String(d.evaluator_name ?? 'an evaluator')} to ${String(d.application_no ?? '')} (${String(d.proponent_name ?? '')})`;
    case 'ASSESSMENT_STAGE_CHANGED':
      return `Moved ${String(d.application_no ?? '')} to stage "${String(d.stage ?? '')}"`;
    case 'ASSESSMENT_FINDING_UPDATED':
      return `Updated a deficiency: "${String(d.description ?? '')}"`;
    case 'ASSESSMENT_FINDING_DELETED':
      return `Removed a deficiency: "${String(d.description ?? '')}"`;
    case 'ASSESSMENT_CHARGE_ADDED':
      return `Added charge "${String(d.description ?? '')}"${d.amount ? ` (₱${String(d.amount)})` : ''}`;
    case 'ASSESSMENT_CHARGE_UPDATED':
      return `Updated charge "${String(d.description ?? '')}"`;
    case 'ASSESSMENT_CHARGE_DELETED':
      return `Removed charge "${String(d.description ?? '')}"`;
    case 'REQUIREMENT_ADDED_ADHOC':
      return `Added a one-off requirement: "${String(d.requirement_name ?? '')}"`;

    // --- Approval / Issuance ---
    case 'APPROVAL_REOPENED':
      return `Reopened approval for ${String(d.application_no ?? '')} (${String(d.proponent_name ?? '')})`;
    case 'APPROVAL_STARTED':
      return `Started approval routing for ${String(d.application_no ?? '')} (${String(d.proponent_name ?? '')})`;
    case 'APPLICATION_APPROVED':
      return `Approved application ${String(d.application_no ?? '')} for ${String(d.proponent_name ?? '')}`;
    case 'APPLICATION_DISAPPROVED':
      return `Disapproved application ${String(d.application_no ?? '')} for ${String(d.proponent_name ?? '')}${d.remarks ? ` — "${String(d.remarks)}"` : ''}`;
    case 'APPROVAL_STEP_DECIDED':
      return `Decided an approval level for ${String(d.application_no ?? '')} (${String(d.step_action ?? '')})`;
    case 'APPROVAL_STEP_ENDORSED':
      return `Endorsed ${String(d.application_no ?? '')} to ${String(d.office ?? '')}`;
    case 'APPROVAL_STEP_ASSIGNED':
      return `Assigned an approval level for ${String(d.application_no ?? '')}`;
    case 'ISSUANCE_ADDED':
      return `Issued "${String(d.title ?? '')}"${d.reference_no ? ` (${String(d.reference_no)})` : ''}`;
    case 'ISSUANCE_DELETED':
      return `Removed issued document "${String(d.title ?? '')}"`;
    case 'APPROVAL_CHARGE_ADDED':
      return `Added charge "${String(d.description ?? '')}"${d.amount ? ` (₱${String(d.amount)})` : ''}`;
    case 'APPROVAL_CHARGE_UPDATED':
      return `Updated charge "${String(d.description ?? '')}"`;
    case 'APPROVAL_CHARGE_DELETED':
      return `Removed charge "${String(d.description ?? '')}"`;
    case 'APPROVAL_LEVEL_CREATED':
      return `Configured approval level "${String(d.name ?? '')}"`;
    case 'APPROVAL_LEVEL_UPDATED':
      return `Updated approval level "${String(d.name ?? '')}"`;
    case 'APPROVAL_LEVEL_DELETED':
      return `Retired approval level "${String(d.name ?? '')}"`;
    case 'CONTRACT_SAVED':
      return d.contract_no ? `Recorded contract ${String(d.contract_no)}` : 'Recorded a contract';

    // --- Contracts / Permits ---
    case 'CONTRACT_CREATED':
      return `Created contract ${String(d.contract_no ?? '')}`;
    case 'CONTRACT_UPDATED':
      return `Updated contract ${String(d.contract_no ?? '')}`;
    case 'PERMIT_CREATED':
      return `Issued permit ${String(d.permit_no ?? '')} (${String(d.permit_type ?? '')})`;
    case 'PERMIT_UPDATED':
      return `Updated permit ${String(d.permit_no ?? '')}`;
    case 'PERMIT_DEACTIVATED':
      return `Deactivated permit ${String(d.permit_no ?? '')}`;

    // --- Inspections ---
    case 'INSPECTION_SCHEDULED':
      return `Scheduled inspection "${String(d.title ?? '')}" for ${String(d.proponent_name ?? '')}`;
    case 'INSPECTION_UPDATED':
      return `Updated inspection "${String(d.title ?? '')}"`;
    case 'INSPECTION_INSPECTOR_ASSIGNED':
      return `Assigned ${String(d.inspector_name ?? 'an inspector')} to inspection "${String(d.title ?? '')}"`;
    case 'INSPECTION_STATUS_CHANGED':
      return `Changed inspection "${String(d.title ?? '')}" to ${String(d.status ?? '')}`;
    case 'INSPECTION_RESULT_RECORDED':
      return `Recorded ${String(d.result ?? '')} result for inspection "${String(d.title ?? '')}"`;
    case 'INSPECTION_FAILED':
      return `Inspection "${String(d.title ?? '')}" failed${d.summary ? ` — "${String(d.summary)}"` : ''}`;
    case 'INSPECTION_FINDING_ADDED':
      return `Noted a deficiency: "${String(d.description ?? '')}"`;
    case 'INSPECTION_FINDING_UPDATED':
      return `Updated a deficiency: "${String(d.description ?? '')}"`;
    case 'INSPECTION_FINDING_DELETED':
      return `Removed a deficiency: "${String(d.description ?? '')}"`;
    case 'INSPECTION_ACTION_ADDED':
      return `Added corrective action: "${String(d.action_required ?? '')}"`;
    case 'INSPECTION_ACTION_UPDATED':
      return `Updated corrective action: "${String(d.action_required ?? '')}"${d.status ? ` (${String(d.status)})` : ''}`;
    case 'INSPECTION_ACTION_DELETED':
      return `Removed corrective action: "${String(d.action_required ?? '')}"`;
    case 'INSPECTION_DOCUMENT_ADDED':
      return `Attached "${String(d.file_name ?? 'a document')}" to an inspection`;
    case 'INSPECTION_DOCUMENT_DELETED':
      return `Removed "${String(d.file_name ?? 'a document')}" from an inspection`;

    // --- File access / exports ---
    case 'DOCUMENT_VIEWED':
    case 'DOCUMENT_DOWNLOADED':
    case 'CERTIFICATE_VIEWED':
    case 'CERTIFICATE_DOWNLOADED':
      return describeFileAccess(row, d);
    case 'REPORT_EXPORTED':
      return describeReportExport(d);
    case 'AUDIT_LOG_EXPORTED': {
      const count = typeof d.rowCount === 'number' ? d.rowCount : null;
      const filters = d.filters && typeof d.filters === 'object' ? Object.entries(d.filters as Record<string, unknown>) : [];
      const filterText = filters.length
        ? ` — ${filters.map(([k, v]) => `${AUDIT_FILTER_LABELS[k] || humanizeKey(k)}: ${String(v)}`).join(', ')}`
        : ' — no filters';
      const format = typeof d.format === 'string' ? d.format.toUpperCase() : 'CSV';
      return `Exported the audit log to ${format === 'XLSX' ? 'Excel' : format}${count != null ? ` (${count} ${count === 1 ? 'row' : 'rows'})` : ''}${filterText}`;
    }

    default: {
      // Safety net for any action without a dedicated case above: never
      // surface a raw foreign-key column (…_id / id) here — those belong in
      // the Entity column, not Details, and are meaningless to a reviewer.
      const entries = Object.entries(d).filter(
        ([k, v]) => v != null && typeof v !== 'object' && k !== 'id' && !k.toLowerCase().endsWith('_id')
      );
      const label = ACTION_LABELS[row.action] || humanizeKey(row.action);
      if (entries.length === 0) return label;
      return `${label} — ${entries.map(([k, v]) => `${humanizeKey(k)}: ${String(v)}`).join(', ')}`;
    }
  }
}

function actionTone(action: string): 'good' | 'bad' | 'neutral' {
  if (
    action === 'LOGIN_FAILED' ||
    action.includes('DEACTIVATED') ||
    action.includes('SUSPENDED') ||
    action.includes('REVOKED') ||
    action.includes('REJECTED') ||
    action.includes('DISAPPROVED') ||
    action.includes('FAILED') ||
    action.includes('DELETED')
  ) {
    return 'bad';
  }
  if (
    action === 'LOGIN_SUCCESS' ||
    action.includes('CREATED') ||
    action.includes('REACTIVATED') ||
    action.includes('RESTORED') ||
    action.includes('UNSUSPENDED') ||
    action.includes('APPROVED') ||
    action.includes('VERIFIED') ||
    action.includes('SUBMITTED')
  ) {
    return 'good';
  }
  return 'neutral';
}

function actionBadgeStyle(action: string) {
  const tone = actionTone(action);
  return tone === 'bad'
    ? { backgroundColor: 'rgba(239,68,68,.14)', color: 'rgba(239,68,68,.95)' }
    : tone === 'good'
      ? { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgba(34,197,94,.95)' }
      : { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgba(148,163,184,.95)' };
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Details cell: the one-line summary, then one line per field that
 * actually changed (for update actions that record `changes`). */
function ActivityDetails({ row }: { row: AuditLogRow }) {
  const changes = readChanges(row);
  return (
    <>
      <div>
        {describeActivity(row)}
        {changes && changes.length === 0 ? ' — no fields changed' : ''}
      </div>
      {changes && changes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {changes.map((c, i) => (
            <li key={`${c.field}-${i}`} className="text-[10px] break-words" style={{ color: 'var(--text-muted)' }}>
              • {describeChange(c)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Keys already shown elsewhere in the expanded panel (or meaningless there).
const PANEL_HIDDEN_KEYS = new Set(['changes']);

function formatDetailValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? entries.map(([k, v]) => `${humanizeKey(k)}: ${String(v)}`).join(', ') : '—';
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return formatFullDate(value);
  }
  return String(value);
}

function formatFullDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function PanelField({
  label,
  title,
  wide,
  children,
}: {
  label: string;
  title?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">{label}</div>
      <div className="mt-0.5 text-[13px] leading-snug break-words" style={{ color: 'var(--text)' }} title={title}>
        {children}
      </div>
    </div>
  );
}

function PanelButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      // Tinted from the text colour rather than --border/--control-bg, which
      // sit too close to the panel background in dark mode.
      className="inline-flex items-center rounded-md px-2 h-6 text-[11px] font-semibold border cursor-pointer whitespace-nowrap bg-[color-mix(in_oklab,var(--text)_10%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_20%,transparent)] border-[color-mix(in_oklab,var(--text)_28%,transparent)]"
      style={{ color: 'var(--text)' }}
    >
      {children}
    </button>
  );
}

/** Value with an optional shortcut button beside it (wrapping under it only
 * when the column is too narrow). */
function ValueWithAction({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  );
}

/** Everything recorded for one entry, plus shortcuts to follow the trail:
 * the actor's other activity, the record's full history, and every action
 * taken in the same sign-in session. */
function RowDetailsPanel({
  row,
  onFilterActor,
  onFilterRecord,
  onFilterSession,
}: {
  row: AuditLogRow;
  onFilterActor: (username: string) => void;
  onFilterRecord: (row: AuditLogRow) => void;
  onFilterSession: (row: AuditLogRow) => void;
}) {
  const changes = readChanges(row);
  const extra = Object.entries(row.details || {}).filter(([k]) => !PANEL_HIDDEN_KEYS.has(k));
  const gridClass = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3';
  const sectionStyle = { borderColor: 'var(--border-subtle)' };

  return (
    <div
      className="rounded-lg px-4 py-3 space-y-3"
      style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 60%, transparent)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={gridClass}>
        <PanelField label="When">{formatFullDate(row.created_at)}</PanelField>
        <PanelField label="Action" title={row.action}>
          {ACTION_LABELS[row.action] || humanizeKey(row.action)}
        </PanelField>
        <PanelField label="Actor">
          <ValueWithAction
            action={
              row.actor_username && (
                <PanelButton onClick={() => onFilterActor(row.actor_username as string)}>All activity</PanelButton>
              )
            }
          >
            {row.actor_username || '—'}
            {row.actor_id != null && <span className="text-secondary"> #{row.actor_id}</span>}
          </ValueWithAction>
        </PanelField>
        <PanelField label="Record">
          <ValueWithAction
            action={
              row.entity_type &&
              row.entity_id != null && <PanelButton onClick={() => onFilterRecord(row)}>History</PanelButton>
            }
          >
            {row.entity_type ? entityLabel(row) : '—'}
          </ValueWithAction>
        </PanelField>
        <PanelField label="IP address">{formatIp(row.ip_address)}</PanelField>
        <PanelField label="Device">{describeDevice(row.user_agent) || '—'}</PanelField>
        <PanelField label="Session">
          {row.session_id ? (
            <ValueWithAction action={<PanelButton onClick={() => onFilterSession(row)}>Session activity</PanelButton>}>
              <span className="font-mono">{row.session_id.slice(0, 8)}</span>
            </ValueWithAction>
          ) : (
            <span className="text-secondary">Not recorded</span>
          )}
        </PanelField>
        <PanelField label="Category">{CATEGORY_LABELS[row.category] || row.category}</PanelField>
      </div>

      {changes && changes.length > 0 && (
        <div className="pt-3 border-t" style={sectionStyle}>
          <PanelField label="Changes">
            <ul className="space-y-0.5">
              {changes.map((c, i) => (
                <li key={`${c.field}-${i}`}>{describeChange(c)}</li>
              ))}
            </ul>
          </PanelField>
        </div>
      )}

      {extra.length > 0 && (
        <div className={`pt-3 border-t ${gridClass}`} style={sectionStyle}>
          {extra.map(([k, v]) => {
            const text = formatDetailValue(v);
            return (
              <PanelField key={k} label={humanizeKey(k)} wide={text.length > 40}>
                {text}
              </PanelField>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A record or session the log is narrowed to — shown as a removable chip. */
type ScopeFilter = { label: string; params: Record<string, string> };

/** TOR items 10-12: a compliance-facing view over dbo.audit_logs — login
 * attempts, account changes, and permission changes, filterable and paged
 * server-side. Admin-only. */
export function AuditLog() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<string[]>([]);
  const [actionCategories, setActionCategories] = useState<Record<string, string>>({});
  // What's typed in the search box, and the same text once typing pauses —
  // only the latter triggers a reload.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [recordFilter, setRecordFilter] = useState<ScopeFilter | null>(null);
  const [sessionFilter, setSessionFilter] = useState<ScopeFilter | null>(null);
  const [userFilter, setUserFilter] = useState<ScopeFilter | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch(api('/api/audit-logs/actions'), { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        setActions(Array.isArray(json?.data) ? json.data : []);
        setActionCategories(json?.categories && typeof json.categories === 'object' ? json.categories : {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  function filterParams() {
    const params = new URLSearchParams();
    if (searchQuery) {
      params.set('q', searchQuery);
      // The server knows action codes, not the labels shown here, so also
      // send the actions whose label matches ("locator updated" → PROPONENT_UPDATED).
      const term = searchQuery.toLowerCase();
      const labelMatches = actions.filter((a) => (ACTION_LABELS[a] || '').toLowerCase().includes(term));
      if (labelMatches.length) params.set('qActions', labelMatches.join(','));
    }
    if (actionFilter) params.set('action', actionFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    for (const scope of [userFilter, recordFilter, sessionFilter]) {
      if (scope) Object.entries(scope.params).forEach(([k, v]) => params.set(k, v));
    }
    if (fromDate) params.set('from', fromDate.toISOString());
    if (toDate) params.set('to', toDate.toISOString());
    return params;
  }

  async function load() {
    setLoading(true);
    try {
      const params = filterParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await fetch(api(`/api/audit-logs?${params.toString()}`), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to load audit log');
      setRows(json.data || []);
      setTotal(Number(json.total || 0));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }

  const filterKey = [
    searchQuery,
    // Re-run a search once the action list (for label matches) arrives.
    searchQuery ? actions.length : 0,
    actionFilter,
    categoryFilter,
    JSON.stringify(recordFilter?.params),
    JSON.stringify(sessionFilter?.params),
    JSON.stringify(userFilter?.params),
    fromDate?.getTime(),
    toDate?.getTime(),
  ].join('|');

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterKey]);

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [filterKey]);

  // A category narrows the action list; drop an action that's no longer in it.
  useEffect(() => {
    if (categoryFilter && actionFilter && actionCategories[actionFilter] && actionCategories[actionFilter] !== categoryFilter) {
      setActionFilter('');
    }
  }, [categoryFilter, actionFilter, actionCategories]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / Math.max(1, pageSize))), [total, pageSize]);
  const showingRange = useMemo(() => {
    if (total === 0) return { from: 0, to: 0 };
    const safePage = Math.min(Math.max(1, page), totalPages);
    return { from: (safePage - 1) * pageSize + 1, to: Math.min(total, safePage * pageSize) };
  }, [total, page, pageSize, totalPages]);
  const visiblePageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, 4, 5];
    if (page >= totalPages - 2) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [page - 2, page - 1, page, page + 1, page + 2];
  }, [page, totalPages]);

  const actionOptions = useMemo(
    () =>
      actions
        .filter((a) => !categoryFilter || actionCategories[a] === categoryFilter)
        .map((a) => ({ value: a, label: ACTION_LABELS[a] || a })),
    [actions, actionCategories, categoryFilter]
  );

  function toggleExpanded(id: number) {
    setExpandedId((current) => (current === id ? null : id));
  }

  // The three drill-downs from an expanded entry. Each narrows the list and
  // scrolls back up to the filter bar, where "Back to list" undoes them.
  function scrollToFilters() {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function filterByActor(username: string) {
    setUserFilter({ label: username, params: { user: username } });
    scrollToFilters();
  }

  function filterByRecord(row: AuditLogRow) {
    if (!row.entity_type || row.entity_id == null) return;
    // Role permission changes are stored under several role_* types that all
    // point at the same role; the server widens "role" to all of them.
    const entityType = row.entity_type.startsWith('role') ? 'role' : row.entity_type;
    setRecordFilter({
      label: entityLabel(row),
      params: { entityType, entityId: String(row.entity_id) },
    });
    scrollToFilters();
  }

  function filterBySession(row: AuditLogRow) {
    if (!row.session_id) return;
    setSessionFilter({
      label: `${row.actor_username || 'Unknown'} · ${row.session_id.slice(0, 8)}`,
      params: { session: row.session_id },
    });
    scrollToFilters();
  }

  const hasDrillDown = Boolean(userFilter || recordFilter || sessionFilter);

  function clearDrillDowns() {
    setUserFilter(null);
    setRecordFilter(null);
    setSessionFilter(null);
  }

  function clearAllFilters() {
    setSearchInput('');
    setSearchQuery('');
    setActionFilter('');
    setCategoryFilter('');
    clearDrillDowns();
    setFromDate(null);
    setToDate(null);
  }

  const hasFilters = Boolean(
    searchInput || actionFilter || categoryFilter || hasDrillDown || fromDate || toDate
  );

  /** Plain-language summary of the active filters, for the export's title block. */
  function describeActiveFilters(): string {
    const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const parts: string[] = [];
    if (searchQuery) parts.push(`Search: "${searchQuery}"`);
    if (categoryFilter) parts.push(`Category: ${CATEGORY_LABELS[categoryFilter] || categoryFilter}`);
    if (actionFilter) parts.push(`Action: ${ACTION_LABELS[actionFilter] || actionFilter}`);
    if (userFilter) parts.push(`Activity by: ${userFilter.label}`);
    if (recordFilter) parts.push(`Record: ${recordFilter.label}`);
    if (sessionFilter) parts.push(`Session: ${sessionFilter.label}`);
    if (fromDate || toDate) parts.push(`Dates: ${fromDate ? day(fromDate) : 'start'} to ${toDate ? day(toDate) : 'today'}`);
    return parts.length ? parts.join('    ·    ') : 'None (all entries)';
  }

  /** Downloads every matching row (the server caps it and logs the export)
   * as a formatted Excel file: title block, styled header, sized columns,
   * wrapped details, frozen header and filter buttons. Same wording as the
   * table. exceljs is loaded only when someone exports. */
  async function exportExcel() {
    setExporting(true);
    try {
      const res = await fetch(api(`/api/audit-logs/export?${filterParams().toString()}`), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to export audit log');
      const data: AuditLogRow[] = Array.isArray(json.data) ? json.data : [];
      if (data.length === 0) {
        toast.info('Nothing to export for these filters');
        return;
      }
      const matching = Number(json.total || data.length);

      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = '3CORE';
      workbook.created = new Date();

      const HEADER_ROW = 5;
      const columns = [
        { key: 'when', header: 'When', width: 22 },
        { key: 'actor', header: 'Actor', width: 16 },
        { key: 'action', header: 'Action', width: 26 },
        { key: 'category', header: 'Category', width: 24 },
        { key: 'record', header: 'Record', width: 30 },
        { key: 'details', header: 'Details', width: 72 },
        { key: 'ip', header: 'IP address', width: 17 },
        { key: 'device', header: 'Device', width: 22 },
        { key: 'session', header: 'Session', width: 11 },
      ];
      const sheet = workbook.addWorksheet('Audit Log', {
        views: [{ state: 'frozen', ySplit: HEADER_ROW }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      });
      sheet.columns = columns.map(({ key, width }) => ({ key, width }));
      const lastCol = columns.length;
      const border = { style: 'thin' as const, color: { argb: 'FFE4E4E7' } };

      // Title block: name, when/how much, and which filters produced it.
      const titleLines = [
        { text: '3CORE — Audit Log', font: { bold: true, size: 16, color: { argb: 'FF18181B' } }, height: 26 },
        {
          text: `Exported ${formatFullDate(new Date().toISOString())}  ·  ${data.length.toLocaleString()} ${
            data.length === 1 ? 'entry' : 'entries'
          }${matching > data.length ? ` (newest ${data.length.toLocaleString()} of ${matching.toLocaleString()} matching)` : ''}`,
          font: { size: 10, color: { argb: 'FF52525B' } },
          height: 16,
        },
        { text: `Filters: ${describeActiveFilters()}`, font: { size: 10, color: { argb: 'FF52525B' } }, height: 16 },
      ];
      titleLines.forEach((line, i) => {
        const r = i + 1;
        sheet.mergeCells(r, 1, r, lastCol);
        const cell = sheet.getCell(r, 1);
        cell.value = line.text;
        cell.font = line.font;
        cell.alignment = { vertical: 'middle' };
        sheet.getRow(r).height = line.height;
      });
      sheet.getRow(4).height = 8; // spacer between the title block and the table

      const header = sheet.getRow(HEADER_ROW);
      header.values = columns.map((c) => c.header);
      header.height = 24;
      header.eachCell((cell) => {
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18181B' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.border = { bottom: border };
      });
      sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: lastCol } };

      // Excel doesn't reliably auto-fit wrapped rows in generated files, so
      // estimate each row's height from its longest wrapped cell.
      const linesFor = (text: string, width: number) =>
        text.split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / Math.max(1, width - 2))), 0);

      data.forEach((row, index) => {
        const changes = readChanges(row);
        const created = new Date(row.created_at);
        const values: Record<string, string | Date> = {
          // Excel has no time zones: shift so the cell shows local time.
          when: Number.isNaN(created.getTime())
            ? row.created_at
            : new Date(created.getTime() - created.getTimezoneOffset() * 60000),
          actor: row.actor_username || '',
          action: ACTION_LABELS[row.action] || humanizeKey(row.action),
          category: CATEGORY_LABELS[row.category] || row.category || '',
          record: row.entity_type ? entityLabel(row) : '',
          details: [describeActivity(row), ...(changes || []).map((c) => `• ${describeChange(c)}`)].join('\n'),
          ip: formatIp(row.ip_address),
          device: describeDevice(row.user_agent) || '',
          session: row.session_id ? row.session_id.slice(0, 8) : '',
        };
        const added = sheet.addRow(values);
        const lines = Math.max(
          ...columns.map((c) => (typeof values[c.key] === 'string' ? linesFor(values[c.key] as string, c.width) : 1))
        );
        added.height = Math.max(18, lines * 14 + 4);
        added.eachCell({ includeEmpty: true }, (cell) => {
          cell.font = { size: 10, color: { argb: 'FF27272A' } };
          cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
          cell.border = { bottom: border };
          if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F8' } };
        });
        added.getCell('when').numFmt = 'mmm d, yyyy  h:mm AM/PM';
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `3core-audit-log-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (matching > data.length) {
        toast.warning(`Exported the newest ${data.length.toLocaleString()} of ${matching.toLocaleString()} entries — narrow the filters to get the rest`);
      } else {
        toast.success(`Exported ${data.length.toLocaleString()} ${data.length === 1 ? 'entry' : 'entries'}`);
      }
      // The export itself is now an audit entry; show it if we're on page 1.
      if (page === 1) load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to export audit log');
    } finally {
      setExporting(false);
    }
  }

  const panelFor = (row: AuditLogRow) => (
    <RowDetailsPanel
      row={row}
      onFilterActor={filterByActor}
      onFilterRecord={filterByRecord}
      onFilterSession={filterBySession}
    />
  );

  const inputClass =
    'h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all';
  const inputStyle = { backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div ref={cardRef} className="glass-card p-3 sm:p-5 !border-transparent scroll-mt-4" style={{ backgroundColor: 'var(--surface)' }}>
        {/* Phones: the page header right above already says this, so skip the repeat. */}
        <div className="hidden sm:flex items-center gap-2 mb-1">
          <ShieldAlert size={16} style={{ color: 'var(--text)' }} />
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Audit Log
          </h3>
        </div>
        <p className="hidden sm:block text-[11px] text-secondary mb-4">
          Sign-ins, account and permission changes, record updates, and file access — for monitoring and compliance review.
          Click an entry for full details.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-2 lg:flex lg:flex-wrap lg:items-center">
          <div className="relative group col-span-2 lg:w-72">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search user, action, record, IP, details..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search the audit log"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div className="col-span-2 sm:col-span-1 lg:w-52">
            <AppSelect
              options={CATEGORY_OPTIONS}
              value={categoryFilter}
              onChange={setCategoryFilter}
              placeholder="All categories"
              isClearable
              compact
            />
          </div>
          <div className="col-span-2 sm:col-span-1 lg:w-52">
            <AppSelect
              options={actionOptions}
              value={actionFilter}
              onChange={setActionFilter}
              placeholder="All actions"
              isClearable
              compact
            />
          </div>
          <div className="min-w-0 lg:w-40">
            <DatePicker mode="single" bordered fullWidth value={fromDate} onChange={setFromDate} placeholder="From date" />
          </div>
          <div className="min-w-0 lg:w-40">
            <DatePicker mode="single" bordered fullWidth value={toDate} onChange={setToDate} placeholder="To date" />
          </div>
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || loading || total === 0}
            className={`col-span-2 lg:ml-auto inline-flex items-center justify-center gap-1.5 rounded-lg px-3 h-9 text-[11px] font-semibold border cursor-pointer ${
              exporting || loading || total === 0 ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            title="Download every entry matching these filters as an Excel file"
          >
            <Download size={13} />
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>

        {hasFilters && (
          <div
            className={`mb-4 flex flex-wrap items-center gap-2 sm:gap-3 ${hasDrillDown ? 'rounded-xl px-3 py-2.5' : ''}`}
            style={
              hasDrillDown
                ? {
                    border: '1px solid var(--border)',
                    backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)',
                  }
                : undefined
            }
          >
            {hasDrillDown && (
              <button
                type="button"
                onClick={clearDrillDowns}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 h-9 text-xs font-semibold shadow-sm cursor-pointer"
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              >
                <ArrowLeft size={14} />
                Back to list
              </button>
            )}
            {[
              userFilter && { key: 'user', label: 'Activity by', value: userFilter.label, clear: () => setUserFilter(null) },
              recordFilter && { key: 'record', label: 'Record', value: recordFilter.label, clear: () => setRecordFilter(null) },
              sessionFilter && { key: 'session', label: 'Session', value: sessionFilter.label, clear: () => setSessionFilter(null) },
            ]
              .filter((chip): chip is { key: string; label: string; value: string; clear: () => void } => Boolean(chip))
              .map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1.5 rounded-full pl-3 pr-1.5 h-8 text-xs"
                  style={{ border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text)' }}
                >
                  <span className="text-secondary">{chip.label}:</span>
                  <span className="font-bold">{chip.value}</span>
                  <button
                    type="button"
                    onClick={chip.clear}
                    className="ml-0.5 rounded-full p-1 cursor-pointer hover:bg-[var(--control-bg)]"
                    aria-label={`Remove filter ${chip.label} ${chip.value}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            {hasDrillDown && !loading && (
              <span className="text-xs text-secondary">
                {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
              </span>
            )}
            <button
              type="button"
              onClick={clearAllFilters}
              className="sm:ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-xs font-semibold border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <X size={13} />
              Clear all filters
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-2">
            <TableSkeleton columns={6} rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No matching activity" description="Try widening your filters or date range." />
        ) : (
          <>
          {/* Phones: one card per event instead of a 6-column table */}
          <div className="sm:hidden space-y-2">
            {rows.map((row) => {
              const expanded = expandedId === row.id;
              return (
                <div
                  key={row.id}
                  className="rounded-xl p-3 cursor-pointer"
                  style={{
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => toggleExpanded(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpanded(row.id);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={actionBadgeStyle(row.action)}
                    >
                      {ACTION_LABELS[row.action] || row.action}
                    </span>
                    <span className="shrink-0 text-[10px] text-secondary text-right">{formatDate(row.created_at)}</span>
                  </div>
                  <div className="mt-2 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                    {row.actor_username || '—'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-secondary break-all">
                    {row.entity_type ? entityLabel(row) : 'No entity'}
                    {row.ip_address ? ` · ${formatIp(row.ip_address)}` : ''}
                  </div>
                  {row.user_agent && (
                    <div className="mt-0.5 text-[10px] break-all" style={{ color: 'var(--text-muted)' }} title={row.user_agent}>
                      {describeDevice(row.user_agent)}
                    </div>
                  )}
                  <div
                    className="mt-2 rounded-lg px-2 py-1.5 text-[11px] text-secondary"
                    style={{ backgroundColor: 'var(--control-bg)' }}
                  >
                    <ActivityDetails row={row} />
                  </div>
                  {expanded && <div className="mt-2">{panelFor(row)}</div>}
                </div>
              );
            })}
          </div>

          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['When', 'Actor', 'Action', 'Entity', 'IP / Device', 'Details'].map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-secondary border-b"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const badgeStyle = actionBadgeStyle(row.action);
                  const expanded = expandedId === row.id;
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`cursor-pointer hover:bg-[color-mix(in_oklab,var(--control-bg)_40%,transparent)] ${expanded ? '' : 'border-b last:border-b-0'}`}
                        style={{ borderColor: 'var(--border-subtle)' }}
                        tabIndex={0}
                        aria-expanded={expanded}
                        onClick={() => toggleExpanded(row.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleExpanded(row.id);
                          }
                        }}
                      >
                        <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <ChevronRight
                              size={12}
                              className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                              aria-hidden
                            />
                            {formatDate(row.created_at)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                          {row.actor_username || '—'}
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={badgeStyle}
                          >
                            {ACTION_LABELS[row.action] || row.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-secondary">
                          {row.entity_type ? entityLabel(row) : '—'}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-secondary">
                          <div className="whitespace-nowrap">{formatIp(row.ip_address)}</div>
                          {row.user_agent && (
                            <div className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }} title={row.user_agent}>
                              {describeDevice(row.user_agent)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-secondary min-w-[220px] max-w-[360px]">
                          <ActivityDetails row={row} />
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                          {/* No side padding: the panel spans the full row width. */}
                          <td colSpan={6} className="px-0 pb-3">
                            {panelFor(row)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

            <DataTableControls
              page={page}
              totalPages={totalPages}
              totalItems={total}
              showingFrom={showingRange.from}
              showingTo={showingRange.to}
              visiblePageNumbers={visiblePageNumbers}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100, 200]}
              onPageSizeChange={setPageSize}
              onPageChange={setPage}
              loading={loading}
            />
          </>
        )}
      </div>
    </div>
  );
}
