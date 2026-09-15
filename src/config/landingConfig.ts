import type { AppView } from '../layout/AppLayout';
import { CalendarClock, FileCheck, FolderTree, Layers, ShieldCheck, Users } from 'lucide-react';

export type LandingConfig = {
  title: string;
  description: string;
  badge: string;
  icon: any;
  // Used by Control Panel to decide which views show up under "Menu CRUD Permissions".
  // Keep this in the same registry so adding a new CRUD page becomes automatic.
  isCrud?: boolean;
  stats: { label: string; value: string; hint?: string }[];
  table: {
    columns: string[];
    rows: (string | number)[][];
  };
};

export const LANDING_CONFIG: Record<AppView, LandingConfig> = {
  dashboard: {
    title: 'Dashboard',
    description: 'High-level overview of applications, permits, and daily tasks.',
    badge: 'Overview',
    icon: FolderTree,
    stats: [],
    table: { columns: [], rows: [] },
  },
  'applications:new': {
    title: 'New Applications Directory',
    description: 'Recently submitted direct lease applications waiting for initial review.',
    badge: 'Applications',
    icon: FileCheck,
    stats: [
      { label: 'Total New Applications', value: '18', hint: 'Last 30 days' },
      { label: 'Pending Screening', value: '7', hint: ' LOI received, docs incomplete' },
      { label: 'For Board Evaluation', value: '3' },
    ],
    table: {
      columns: ['Locator', 'Project', 'Submitted', 'Missing Docs', 'Status'],
      rows: [
        ['SkyPort Logistics Inc.', 'Cargo Hub Expansion', 'Mar 10, 2026', 'AFS, Bank Cert', 'Pending Verification'],
        ['GreenFuel Terminals Corp.', 'Fuel Depot Lease', 'Mar 09, 2026', 'Board Resolution', 'For Evaluation'],
        ['Atlas Aero Parts', 'Hangar Lease', 'Mar 05, 2026', 'None', 'Ready for Board'],
      ],
    },
  },
  'applications:renewals': {
    title: 'Renewal Tracking',
    description: 'Existing locators with lease agreements due for renewal.',
    badge: 'Renewals',
    icon: FileCheck,
    stats: [
      { label: 'Renewals This Year', value: '32' },
      { label: 'Expiring in 90 Days', value: '6' },
      { label: 'With Pending Requirements', value: '4' },
    ],
    table: {
      columns: ['Locator', 'Lease No.', 'Expiry', 'Days Left', 'Renewal Status'],
      rows: [
        ['NorthGate Foods Corp.', 'DL-2020-018', 'Jun 15, 2026', '95', 'For LOI Submission'],
        ['Delta AeroTech', 'DL-2019-004', 'May 30, 2026', '79', 'Docs Under Review'],
        ['HarborFresh Cold Storage', 'DL-2021-022', 'Apr 21, 2026', '40', 'For Board Approval'],
      ],
    },
  },
  'applications:requirements': {
    title: 'Requirements',
    description: 'Manage requirement definitions for new and renewal applications.',
    badge: 'Applications',
    icon: FileCheck,
    isCrud: true,
    stats: [
      { label: 'Total Requirements', value: '—' },
      { label: 'For New', value: '—' },
      { label: 'For Renewal', value: '—' },
    ],
    table: {
      columns: ['Code', 'Name', 'Category', 'Flags', 'Status'],
      rows: [
        ['SEC-AOI', 'Articles of Incorporation', 'Legal', 'New, Mandatory', 'Active'],
        ['BIR-CLR', 'BIR Tax Clearance', 'Financial', 'New, Renewal, Mandatory', 'Active'],
        ['FSIC', 'Fire Safety Certificate', 'Technical', 'Renewal', 'Inactive'],
      ],
    },
  },
  'assessment:queue': {
    title: 'Assessment & Evaluation',
    description: 'Review submitted applications, evaluate documentary and regulatory compliance, assess fees and charges, record findings, and assign evaluators.',
    badge: 'Assessment',
    icon: FileCheck,
    isCrud: true,
    stats: [
      { label: 'In Assessment', value: '—' },
      { label: 'Unassigned', value: '—' },
      { label: 'Overdue', value: '—', hint: 'More than 5 days assigned' },
    ],
    table: {
      columns: ['Application', 'Locator', 'Stage', 'Evaluator', 'Charges'],
      rows: [
        ['APP-NEW-0001', 'SkyPort Logistics Inc.', 'In Review', 'AO Santos', '₱610,000'],
        ['APP-REN-0007', 'Delta AeroTech', 'For Recommendation', 'AO Cruz', '₱120,000'],
        ['APP-NEW-0012', 'Metro Agro Trading', 'Unassigned', '—', '—'],
      ],
    },
  },
  'approval:queue': {
    title: 'Approval & Issuance',
    description: 'Route endorsed applications through a configurable multi-level approval hierarchy, record approve/return/disapprove decisions and electronic endorsements, and issue approval documents and contracts.',
    badge: 'Approval',
    icon: FileCheck,
    isCrud: true,
    stats: [
      { label: 'In Progress', value: '—' },
      { label: 'Awaiting Start', value: '—' },
      { label: 'Issued', value: '—' },
    ],
    table: {
      columns: ['Application', 'Locator', 'Approval Status', 'Current Level', 'Issued'],
      rows: [
        ['APP-2026-00001', 'SkyPort Logistics Inc.', 'In Progress', 'Division Chief', '—'],
        ['REN-2026-00007', 'Delta AeroTech', 'Approved', '—', 'Approval Order'],
        ['APP-2026-00012', 'Metro Agro Trading', 'Awaiting Start', '—', '—'],
      ],
    },
  },
  'compliance:permits': {
    title: 'Permits',
    description: 'Monitoring of environmental, fire, occupancy and sanitary permits.',
    badge: 'Compliance',
    icon: ShieldCheck,
    // Backend (r_permits.js) already gates create/edit/deactivate behind
    // Control Panel CRUD permissions — this flag was missing, so the CRUD
    // tab never showed a toggle for it and no non-admin role could ever be
    // granted Add/Edit/Delete here, no matter how Control Panel was set.
    isCrud: true,
    stats: [
      { label: 'Valid Permits', value: '211' },
      { label: 'Expiring in 30 Days', value: '8' },
      { label: 'Expired', value: '2', hint: 'Requires urgent follow-up' },
    ],
    table: {
      columns: ['Locator', 'Permit Type', 'Permit No.', 'Expiry', 'Status'],
      rows: [
        ['HarborFresh Cold Storage', 'Occupancy', 'OCC-24-019', 'Mar 31, 2026', 'Expiring'],
        ['GreenFuel Terminals Corp.', 'Fire Safety', 'FSIC-26-088', 'Apr 12, 2026', 'Valid'],
        ['NorthGate Foods Corp.', 'Sanitary', 'SAN-25-103', 'Jan 10, 2026', 'Expired'],
      ],
    },
  },
  'compliance:expiry': {
    title: 'Expiry Permits',
    description: 'Calendar view of all upcoming permit expirations across locators.',
    badge: 'Calendar',
    icon: CalendarClock,
    stats: [
      { label: 'Expiring This Month', value: '14' },
      { label: 'Next 90 Days', value: '29' },
      { label: 'Overdue', value: '3' },
    ],
    table: {
      columns: ['Date', 'Locator', 'Permit', 'Type', 'Days Left'],
      rows: [
        ['Mar 18, 2026', 'HarborFresh Cold Storage', 'Occupancy Permit', 'CDC', '6'],
        ['Mar 22, 2026', 'Delta AeroTech', 'Fire Safety Inspection', 'CDC', '10'],
        ['Apr 03, 2026', 'NorthGate Foods Corp.', 'Tax Clearance', 'BIR', '22'],
      ],
    },
  },
  'compliance:inspections': {
    title: 'Compliance & Inspection',
    description: 'Schedule and assign inspections per type, record findings, recommendations and corrective actions, upload reports, and monitor locator compliance status.',
    badge: 'Compliance',
    icon: ShieldCheck,
    isCrud: true,
    stats: [
      { label: 'Scheduled', value: '—' },
      { label: 'Open Findings', value: '—' },
      { label: 'Overdue Actions', value: '—', hint: 'Corrective actions past due date' },
    ],
    table: {
      columns: ['Inspection', 'Locator', 'Type', 'Status', 'Result'],
      rows: [
        ['Annual Safety Audit', 'SkyPort Logistics Inc.', 'Safety', 'In Progress', '—'],
        ['Engineering Check', 'Delta AeroTech', 'Engineering', 'Completed', 'Passed w/ Findings'],
        ['Performance Commitment', 'Metro Agro Trading', 'Perf. Commitment', 'Scheduled', '—'],
      ],
    },
  },
  'settings:users': {
    title: 'User Management',
    description: 'Manage admin and staff accounts who assist in verification.',
    badge: 'System',
    icon: Users,
    isCrud: true,
    stats: [
      { label: 'Active Users', value: '34' },
      { label: 'Pending Invitations', value: '5' },
      { label: 'Deactivated', value: '3' },
    ],
    table: {
      columns: ['Name', 'Email', 'Role', 'Last Login', 'Status'],
      rows: [
        ['Admin Demo', 'admin@bizreg.com', 'System Admin', 'Mar 11, 2026 09:18', 'Active'],
        ['Joan Cruz', 'j.cruz@ciac.gov', 'Verifier', 'Mar 10, 2026 16:02', 'Active'],
        ['Leo Dizon', 'l.dizon@ciac.gov', 'Account Officer', 'Mar 05, 2026 11:22', 'Active'],
      ],
    },
  },
  'settings:locator-users': {
    title: 'Locator Accounts',
    description: 'Manage login accounts for registered locators, kept separate from staff accounts.',
    badge: 'System',
    icon: Users,
    isCrud: true,
    stats: [
      { label: 'Active Accounts', value: '—' },
      { label: 'Total Accounts', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Username', 'Full Name', 'Email', '2FA', 'Status'],
      rows: [
        ['jdelacruz', 'Juan Dela Cruz', 'j.delacruz@skyport.com', 'On', 'Active'],
        ['mreyes', 'Maria Reyes', 'm.reyes@greenfuel.com', 'On', 'Active'],
      ],
    },
  },
  'settings:requirement-categories': {
    title: 'Requirement Categories',
    description: 'Organize requirements into categories to support filtering and templates.',
    badge: 'Configuration',
    icon: FolderTree,
    isCrud: true,
    stats: [
      { label: 'Categories', value: '—' },
      { label: 'Active Categories', value: '—' },
      { label: 'Updated Recently', value: '—', hint: 'Last 30 days' },
    ],
    table: {
      columns: ['Code', 'Name', 'Description', 'Status'],
      rows: [
        ['LEGAL', 'Legal', 'Company formation and corporate documents.', 'Active'],
        ['FIN', 'Financial', 'Tax clearance and financial permits.', 'Active'],
        ['TECH', 'Technical', 'Technical certifications and inspections.', 'Active'],
      ],
    },
  },
  'settings:inspection-types': {
    title: 'Inspection Types',
    description: 'Configure inspection types used during document verification and compliance checks.',
    badge: 'Configuration',
    icon: FileCheck,
    isCrud: true,
    stats: [
      { label: 'Inspection Types', value: '—' },
      { label: 'Active Types', value: '—' },
      { label: 'Pending Updates', value: '—' },
    ],
    table: {
      columns: ['Type', 'Description', 'Applies To', 'Status'],
      rows: [
        ['ENV', 'Environmental assessment', 'CDC/CIAC permits', 'Active'],
        ['FIRE', 'Fire safety inspection', 'Occupancy / Fire Safety', 'Active'],
        ['SAN', 'Sanitary compliance', 'Sanitary permits', 'Inactive'],
      ],
    },
  },
  'settings:application-types': {
    title: 'Application Types',
    description: 'Define the lease application types locators and staff can select when filing.',
    badge: 'Configuration',
    icon: Layers,
    isCrud: true,
    stats: [
      { label: 'Application Types', value: '—' },
      { label: 'Active Types', value: '—' },
      { label: 'Deactivated', value: '—' },
    ],
    table: {
      columns: ['Code', 'Name', 'Description', 'Status'],
      rows: [
        ['DIRECT_LEASE', 'Direct Lease', '—', 'Active'],
        ['WAREHOUSE_LEASE', 'Warehouse Lease', '—', 'Active'],
        ['SUBLEASE', 'Sublease', '—', 'Active'],
      ],
    },
  },
  'settings:compliance-types': {
    title: 'Compliance Types',
    description: 'Define compliance categories for verification and monitoring workflows.',
    badge: 'Configuration',
    icon: ShieldCheck,
    isCrud: true,
    stats: [
      { label: 'Compliance Types', value: '—' },
      { label: 'Active Types', value: '—' },
      { label: 'Obsolete Types', value: '—' },
    ],
    table: {
      columns: ['Type', 'Description', 'Applies To', 'Status'],
      rows: [
        ['BIR', 'BIR tax compliance', 'Tax-related documents', 'Active'],
        ['DTI', 'DTI/Trade compliance', 'Registration documents', 'Active'],
        ['SEC', 'SEC corporate compliance', 'Corporate documents', 'Active'],
      ],
    },
  },
  'settings:audit-log': {
    title: 'Audit Log',
    description: 'Logins, account changes, and permission changes — for monitoring and compliance review.',
    badge: 'Security',
    icon: FileCheck,
    stats: [],
    table: { columns: [], rows: [] },
  },
  'settings:control-panel': {
    title: 'Control Panel',
    description: 'Configure role-based access to sidebar menus and CRUD-capable modules.',
    badge: 'Configuration',
    icon: FileCheck,
    stats: [
      { label: 'Tabs', value: '2' },
      { label: 'Role Source', value: 'roles table' },
      { label: 'Access Scope', value: 'By Role' },
    ],
    table: {
      columns: ['Configuration', 'Source', 'Behavior', 'Status'],
      rows: [
        ['Sidebar Menu', 'roles + menu map', 'Show/hide menu per role', 'Active'],
        ['Menu CRUD Permissions', 'roles + CRUD map', 'Add/Edit/Delete per role', 'Active'],
        ['Save Action', 'admin API', 'Upsert role permissions', 'Active'],
      ],
    },
  },
};

