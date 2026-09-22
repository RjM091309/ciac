import React, { useEffect, useMemo, useState } from 'react';
import { Search, ShieldAlert } from 'lucide-react';
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
  created_at: string;
};

function api(path: string) {
  return path;
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Login succeeded',
  LOGIN_FAILED: 'Login failed',
  LOGOUT: 'Logged out',
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
};

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
  contact_no: 'contact number',
};

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
// real name — e.g. "locator" rather than the raw "proponent" table name.
const ENTITY_TYPE_LABELS: Record<string, string> = {
  user: 'user',
  role: 'role',
  role_sidebar_menu: 'role',
  role_menu_crud: 'role',
  role_dashboard_widgets: 'role',
  proponent: 'locator',
  application: 'application',
  application_requirement: 'requirement',
  assessment_finding: 'finding',
  assessment_charge: 'charge',
  inspection: 'inspection',
  inspection_finding: 'finding',
  inspection_action: 'corrective action',
  permit: 'permit',
  contract: 'contract',
  approval_level: 'approval level',
  requirement: 'requirement',
  requirement_category: 'requirement category',
  compliance_type: 'compliance type',
  inspection_type: 'inspection type',
  application_type: 'application type',
  department: 'department',
  building: 'building',
  land_use: 'land use',
  type_of_contract: 'type of contract',
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
      return `${typeLabel} "${value.trim()}"`;
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
    case 'LOGIN_FAILED': {
      const reason = typeof d.message === 'string' && d.message ? d.message : 'Sign-in attempt failed';
      return d.locked ? `${reason} Account is now locked.` : reason;
    }
    case 'LOGOUT':
      return 'Signed out of the system';
    case 'USER_CREATED': {
      const parts = [`Created account "${d.username ?? user}"`];
      if (d.autoGeneratedPassword) parts.push('with an auto-generated password');
      if (d.emailSent === true) parts.push('and emailed the credentials');
      else if (d.emailSent === false) parts.push('(credentials email not sent)');
      if (d.deferredActivation) parts.push('— activation deferred');
      return parts.join(' ');
    }
    case 'USER_UPDATED': {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      const labels = fields.map((f) => FIELD_LABELS[f] || humanizeKey(f));
      return labels.length ? `Updated ${user}: changed ${joinList(labels)}` : `Updated ${user}`;
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
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      const labels = fields.map((f) => FIELD_LABELS[f] || humanizeKey(f));
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

/** TOR items 10-12: a compliance-facing view over dbo.audit_logs — login
 * attempts, account changes, and permission changes, filterable and paged
 * server-side. Admin-only. */
export function AuditLog() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState<string[]>([]);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    fetch(api('/api/audit-logs/actions'), { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => setActions(Array.isArray(json?.data) ? json.data : []))
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actorFilter.trim()) params.set('actor', actorFilter.trim());
      if (actionFilter) params.set('action', actionFilter);
      if (fromDate) params.set('from', fromDate.toISOString());
      if (toDate) params.set('to', toDate.toISOString());
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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, actorFilter, actionFilter, fromDate, toDate]);

  useEffect(() => {
    setPage(1);
  }, [actorFilter, actionFilter, fromDate, toDate]);

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

  const actionOptions = useMemo(() => actions.map((a) => ({ value: a, label: ACTION_LABELS[a] || a })), [actions]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="glass-card p-3 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        {/* Phones: the page header right above already says this, so skip the repeat. */}
        <div className="hidden sm:flex items-center gap-2 mb-1">
          <ShieldAlert size={16} style={{ color: 'var(--text)' }} />
          <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            Audit Log
          </h3>
        </div>
        <p className="hidden sm:block text-[11px] text-secondary mb-4">
          Logins, account changes, and permission changes — for monitoring and compliance review.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-4 lg:flex lg:items-center">
          <div className="relative group col-span-2 lg:w-56">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search by username..."
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              className="h-9 rounded-full pl-9 pr-3 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{ backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
            />
          </div>
          <div className="col-span-2 lg:w-56">
            <AppSelect
              options={actionOptions}
              value={actionFilter}
              onChange={setActionFilter}
              placeholder="All actions"
              isClearable
              compact
            />
          </div>
          <div className="min-w-0 lg:w-44">
            <DatePicker mode="single" bordered fullWidth value={fromDate} onChange={setFromDate} placeholder="From date" />
          </div>
          <div className="min-w-0 lg:w-44">
            <DatePicker mode="single" bordered fullWidth value={toDate} onChange={setToDate} placeholder="To date" />
          </div>
        </div>

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
            {rows.map((row) => (
              <div
                key={row.id}
                className="rounded-xl p-3"
                style={{
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'color-mix(in oklab, var(--control-bg) 35%, transparent)',
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
                  {row.ip_address ? ` · ${row.ip_address}` : ''}
                </div>
                <div
                  className="mt-2 rounded-lg px-2 py-1.5 text-[11px] text-secondary"
                  style={{ backgroundColor: 'var(--control-bg)' }}
                >
                  {describeActivity(row)}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {['When', 'Actor', 'Action', 'Entity', 'IP Address', 'Details'].map((col) => (
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
                  return (
                    <tr key={row.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap">{formatDate(row.created_at)}</td>
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
                      <td className="px-3 py-2 text-[11px] text-secondary">{row.ip_address || '—'}</td>
                      <td className="px-3 py-2 text-[11px] text-secondary min-w-[220px] max-w-[360px]">
                        {describeActivity(row)}
                      </td>
                    </tr>
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
