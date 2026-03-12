import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AppLayout, AppView } from './layout/AppLayout';
import { Dashboard } from './components/dashboard/Dashboard';
import { SubHeader } from './components/SubHeader';
import { FileCheck, FolderTree, ShieldCheck, Users, CalendarClock } from 'lucide-react';

// --- Types ---
type Role = 'admin' | 'officer' | 'proponent';

interface UserData {
  id: number;
  email: string;
  name: string;
  role: Role;
}

// --- Main App ---

export default function App() {
  const defaultUser: UserData = {
    id: 1,
    email: 'admin@bizreg.com',
    name: 'Admin Demo',
    role: 'admin',
  };

  const [user, setUser] = useState<UserData>(defaultUser);
  const [view, setView] = useState<AppView>('dashboard');

  return (
    <>
      <AppLayout view={view} onViewChange={setView} onLogout={() => setUser(defaultUser)}>
        {view === 'dashboard' ? (
          <SubHeader />
        ) : (
          <SubHeader
            title={LANDING_CONFIG[view].title}
            description={LANDING_CONFIG[view].description}
            badge={LANDING_CONFIG[view].badge}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25, ease: [0.22, 0.8, 0.35, 1] }}
            className="h-full"
          >
            {view === 'dashboard' ? <Dashboard /> : <SectionLanding view={view} />}
          </motion.div>
        </AnimatePresence>
      </AppLayout>
    </>
  );
}

type LandingConfig = {
  title: string;
  description: string;
  badge: string;
  icon: any;
  stats: { label: string; value: string; hint?: string }[];
  table: {
    columns: string[];
    rows: (string | number)[][];
  };
};

const LANDING_CONFIG: Record<AppView, LandingConfig> = {
  dashboard: {
    title: 'Dashboard',
    description: 'High-level overview of applications, permits, and daily tasks.',
    badge: 'Overview',
    icon: FolderTree,
    stats: [],
    table: { columns: [], rows: [] },
  },
  'applications:new': {
    title: 'New Applications',
    description: 'Recently submitted direct lease applications waiting for initial review.',
    badge: 'Applications',
    icon: FileCheck,
    stats: [
      { label: 'Total New Applications', value: '18', hint: 'Last 30 days' },
      { label: 'Pending Screening', value: '7', hint: ' LOI received, docs incomplete' },
      { label: 'For Board Evaluation', value: '3' },
    ],
    table: {
      columns: ['Proponent', 'Project', 'Submitted', 'Missing Docs', 'Status'],
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
      columns: ['Proponent', 'Lease No.', 'Expiry', 'Days Left', 'Renewal Status'],
      rows: [
        ['NorthGate Foods Corp.', 'DL-2020-018', 'Jun 15, 2026', '95', 'For LOI Submission'],
        ['Delta AeroTech', 'DL-2019-004', 'May 30, 2026', '79', 'Docs Under Review'],
        ['HarborFresh Cold Storage', 'DL-2021-022', 'Apr 21, 2026', '40', 'For Board Approval'],
      ],
    },
  },
  'applications:projects': {
    title: 'Project Evaluations',
    description: 'Monitoring of notarized project evaluations and technical reviews.',
    badge: 'Evaluation',
    icon: FileCheck,
    stats: [
      { label: 'Projects Under Evaluation', value: '9' },
      { label: 'Average Evaluation Age', value: '18 days' },
      { label: 'Technical Clarifications', value: '5', hint: 'Awaiting proponent reply' },
    ],
    table: {
      columns: ['Project', 'Proponent', 'Evaluator', 'Stage', 'Last Action'],
      rows: [
        ['Cold Chain Facility', 'HarborFresh Cold Storage', 'Engr. Santos', 'Technical Review', 'Requested load profile'],
        ['Fuel Depot Expansion', 'GreenFuel Terminals Corp.', 'Engr. Cruz', 'For Board', 'Endorsed to CIAC Board'],
        ['Maintenance Hangar', 'Atlas Aero Parts', 'Engr. Dela Cruz', 'Initial Review', 'Site visit scheduled'],
      ],
    },
  },
  'verification:pending': {
    title: 'Pending Document Verification',
    description: 'Queue of SEC, DTI, BIR and permit documents awaiting admin verification.',
    badge: 'Verification',
    icon: FileCheck,
    stats: [
      { label: 'Total Pending', value: '24' },
      { label: 'Over SLA (3 days)', value: '5' },
      { label: 'Assigned to You', value: '11' },
    ],
    table: {
      columns: ['Document', 'Type', 'Proponent', 'Uploaded', 'Assigned To'],
      rows: [
        ['SEC Registration 2026-0310', 'SEC', 'SkyPort Logistics Inc.', 'Mar 10, 2026', 'You'],
        ['BIR 2303-2026-019', 'BIR COR', 'NorthGate Foods Corp.', 'Mar 09, 2026', 'Admin D. Ramos'],
        ['DTI Permit 24-8931', 'DTI', 'HarborFresh Cold Storage', 'Mar 08, 2026', 'You'],
      ],
    },
  },
  'verification:audit': {
    title: 'Verification Audit Trail',
    description: 'History of verification decisions for each critical document.',
    badge: 'Audit',
    icon: ShieldCheck,
    stats: [
      { label: 'Docs Verified This Week', value: '63' },
      { label: 'Rejected Uploads', value: '4', hint: 'Mostly blurred scans' },
      { label: 'Average Verification Time', value: '2h 18m' },
    ],
    table: {
      columns: ['Date & Time', 'Action', 'Document', 'Proponent', 'By'],
      rows: [
        ['Mar 11, 2026 15:42', 'Approved', 'BIR Tax Clearance 24-019', 'GreenFuel Terminals Corp.', 'Admin J. Cruz'],
        ['Mar 11, 2026 10:05', 'Rejected', 'SEC AOI Scan', 'Atlas Aero Parts', 'Admin Demo'],
        ['Mar 10, 2026 09:31', 'Approved', 'DTI Certificate 24-778', 'HarborFresh Cold Storage', 'Admin Demo'],
      ],
    },
  },
  'directory:companies': {
    title: 'Proponent Directory',
    description: 'Master list of all registered proponents and active locators.',
    badge: 'CRM',
    icon: Users,
    stats: [
      { label: 'Total Proponents', value: '142' },
      { label: 'Active Leases', value: '87' },
      { label: 'Prospects', value: '24' },
    ],
    table: {
      columns: ['Company', 'Industry', 'Status', 'Last Activity', 'Account Officer'],
      rows: [
        ['SkyPort Logistics Inc.', 'Logistics', 'Active Locator', 'Site visit (Mar 08)', 'AO Santos'],
        ['GreenFuel Terminals Corp.', 'Fuel', 'For Board Approval', 'Submission of AFS', 'AO Dizon'],
        ['Metro Agro Trading', 'Agri-processing', 'Prospect', 'Initial LOI', 'AO Reyes'],
      ],
    },
  },
  'directory:officers': {
    title: 'Key Officers & Stakeholders',
    description: 'Directory of stockholders and key officers with submitted IDs and resumes.',
    badge: 'KYC',
    icon: Users,
    stats: [
      { label: 'Profiles With Complete IDs', value: '212' },
      { label: 'With Expiring IDs', value: '9' },
      { label: 'Missing Resumes', value: '6' },
    ],
    table: {
      columns: ['Name', 'Company', 'Role', 'ID Status', 'Last Updated'],
      rows: [
        ['Maria L. Santos', 'SkyPort Logistics Inc.', 'President', 'Verified', 'Mar 02, 2026'],
        ['John P. Reyes', 'GreenFuel Terminals Corp.', 'Corporate Secretary', 'ID expiring in 60 days', 'Feb 28, 2026'],
        ['Anna K. Dizon', 'HarborFresh Cold Storage', 'Treasurer', 'Pending HR review', 'Mar 01, 2026'],
      ],
    },
  },
  'directory:site-plans': {
    title: 'Site Development Plans',
    description: 'Repository of approved and proposed site development plans.',
    badge: 'Site Plans',
    icon: FolderTree,
    stats: [
      { label: 'Approved Plans', value: '32' },
      { label: 'For Technical Review', value: '5' },
      { label: 'For CIAC Board', value: '3' },
    ],
    table: {
      columns: ['Project', 'Location', 'Plan Version', 'Status', 'Last Review'],
      rows: [
        ['Cargo Hub Expansion', 'North Apron', 'Rev. 3', 'Approved', 'Feb 20, 2026'],
        ['Fuel Depot Modernization', 'Fuel Farm Zone', 'Rev. 1', 'For Board', 'Mar 04, 2026'],
        ['Cold Storage Warehouse', 'Logistics Park', 'Rev. 2', 'Tech Review', 'Mar 06, 2026'],
      ],
    },
  },
  'compliance:permits': {
    title: 'CDC/CIAC Permits',
    description: 'Monitoring of environmental, fire, occupancy and sanitary permits.',
    badge: 'Compliance',
    icon: ShieldCheck,
    stats: [
      { label: 'Valid Permits', value: '211' },
      { label: 'Expiring in 30 Days', value: '8' },
      { label: 'Expired', value: '2', hint: 'Requires urgent follow-up' },
    ],
    table: {
      columns: ['Proponent', 'Permit Type', 'Permit No.', 'Expiry', 'Status'],
      rows: [
        ['HarborFresh Cold Storage', 'Occupancy', 'OCC-24-019', 'Mar 31, 2026', 'Expiring'],
        ['GreenFuel Terminals Corp.', 'Fire Safety', 'FSIC-26-088', 'Apr 12, 2026', 'Valid'],
        ['NorthGate Foods Corp.', 'Sanitary', 'SAN-25-103', 'Jan 10, 2026', 'Expired'],
      ],
    },
  },
  'compliance:bir': {
    title: 'BIR & Tax Records',
    description: 'Centralized view of BIR Tax Clearances, Certificates, and POS/CRM permits.',
    badge: 'Tax',
    icon: FileCheck,
    stats: [
      { label: 'Valid BIR Clearances', value: '79' },
      { label: 'POS/CRM Registered', value: '65' },
      { label: 'For BIR Update', value: '5' },
    ],
    table: {
      columns: ['Proponent', 'Document', 'Reference No.', 'Validity', 'Status'],
      rows: [
        ['SkyPort Logistics Inc.', 'BIR Tax Clearance', 'TC-26-045', 'Dec 31, 2026', 'Valid'],
        ['Metro Agro Trading', 'BIR 2303 COR', 'COR-24-993', 'N/A', 'Verified'],
        ['Delta AeroTech', 'POS/CRM Permit', 'POS-25-118', 'Dec 31, 2025', 'For Renewal'],
      ],
    },
  },
  'compliance:expiry': {
    title: 'Expiry Calendar',
    description: 'Calendar view of all upcoming permit expirations across proponents.',
    badge: 'Calendar',
    icon: CalendarClock,
    stats: [
      { label: 'Expiring This Month', value: '14' },
      { label: 'Next 90 Days', value: '29' },
      { label: 'Overdue', value: '3' },
    ],
    table: {
      columns: ['Date', 'Proponent', 'Permit', 'Type', 'Days Left'],
      rows: [
        ['Mar 18, 2026', 'HarborFresh Cold Storage', 'Occupancy Permit', 'CDC', '6'],
        ['Mar 22, 2026', 'Delta AeroTech', 'Fire Safety Inspection', 'CDC', '10'],
        ['Apr 03, 2026', 'NorthGate Foods Corp.', 'Tax Clearance', 'BIR', '22'],
      ],
    },
  },
  'operations:flowcharts': {
    title: 'Production Flowcharts',
    description: 'Uploaded production and process flow diagrams for proponents.',
    badge: 'Operations',
    icon: FolderTree,
    stats: [
      { label: 'Uploaded Flowcharts', value: '27' },
      { label: 'With Safety Review', value: '18' },
      { label: 'For Update Request', value: '4' },
    ],
    table: {
      columns: ['Proponent', 'Process', 'Version', 'Status', 'Last Review'],
      rows: [
        ['NorthGate Foods Corp.', 'Frozen Goods Processing', 'v1.4', 'Approved', 'Feb 18, 2026'],
        ['Metro Agro Trading', 'Grain Milling', 'v0.9', 'For HSE Review', 'Mar 02, 2026'],
        ['GreenFuel Terminals Corp.', 'Fuel Offloading', 'v1.1', 'For Update', 'Feb 25, 2026'],
      ],
    },
  },
  'operations:brochures': {
    title: 'Brochures & Marketing',
    description: 'Digital library of brochures and marketing materials for proponents.',
    badge: 'Marketing',
    icon: FolderTree,
    stats: [
      { label: 'Uploaded Brochures', value: '54' },
      { label: 'With CIAC Branding', value: '21' },
      { label: 'Pending Review', value: '7' },
    ],
    table: {
      columns: ['Proponent', 'Material', 'Version', 'Status', 'Last Updated'],
      rows: [
        ['SkyPort Logistics Inc.', 'Corporate Profile 2026', 'v2', 'Approved', 'Mar 01, 2026'],
        ['Delta AeroTech', 'Hangar Services Flyer', 'v1', 'For Branding Review', 'Mar 07, 2026'],
        ['HarborFresh Cold Storage', 'Cold Chain Solutions', 'v3', 'Approved', 'Feb 20, 2026'],
      ],
    },
  },
  'operations:gad': {
    title: 'GAD Programs',
    description: 'Tracking of Gender and Development-related programs and initiatives.',
    badge: 'GAD',
    icon: Users,
    stats: [
      { label: 'Active GAD Programs', value: '12' },
      { label: 'Completed This Year', value: '4' },
      { label: 'With Submitted Reports', value: '9' },
    ],
    table: {
      columns: ['Program', 'Proponent', 'Coverage', 'Status', 'Next Milestone'],
      rows: [
        ['Women in Logistics Training', 'SkyPort Logistics Inc.', 'Q1 2026', 'Ongoing', 'Final training batch'],
        ['Safe Workplace Campaign', 'GreenFuel Terminals Corp.', '2025–2026', 'Ongoing', 'Survey rollout'],
        ['Inclusive Hiring Drive', 'Metro Agro Trading', 'Q4 2025', 'Completed', 'Impact report review'],
      ],
    },
  },
  'settings:users': {
    title: 'User Management',
    description: 'Manage admin and staff accounts who assist in verification.',
    badge: 'System',
    icon: Users,
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
  'settings:checklist': {
    title: 'Master Checklist',
    description: 'Configure required and optional documents per application type.',
    badge: 'Configuration',
    icon: FileCheck,
    stats: [
      { label: 'Checklist Templates', value: '5' },
      { label: 'Last Updated By', value: 'Admin Demo' },
      { label: 'Pending Change Requests', value: '2' },
    ],
    table: {
      columns: ['Template', 'Application Type', 'Required Docs', 'Optional Docs', 'Last Updated'],
      rows: [
        ['Direct Lease – New', 'New Locator', '14', '3', 'Mar 09, 2026'],
        ['Direct Lease – Renewal', 'Existing Locator', '10', '4', 'Mar 02, 2026'],
        ['Warehouse Only', 'Storage Lease', '8', '2', 'Feb 20, 2026'],
      ],
    },
  },
};

function SectionLanding({ view }: { view: AppView }) {
  const config = LANDING_CONFIG[view];

  if (!config || view === 'dashboard') return null;

  const Icon = config.icon;

  return (
    <>
      <div className="space-y-4 sm:space-y-5">
        {config.stats.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
              {config.stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl px-3 py-3 border flex flex-col gap-1"
                  style={{
                    backgroundColor: 'var(--control-bg)',
                    borderColor: 'var(--border-subtle)',
                  }}
                >
                  <span className="text-[10px] font-semibold text-secondary uppercase tracking-widest">
                    {stat.label}
                  </span>
                  <span
                    className="text-base sm:text-lg font-bold leading-tight"
                    style={{ color: 'var(--text)' }}
                  >
                    {stat.value}
                  </span>
                  {stat.hint && <span className="text-[10px] text-secondary">{stat.hint}</span>}
                </div>
              ))}
            </div>
          )}

        <div
          className="glass-card p-4 sm:p-5 !border-transparent"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3
              className="text-sm font-bold tracking-tight"
              style={{ color: 'var(--text)' }}
            >
              {config.title} List
            </h3>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm"
              style={{
                backgroundColor: 'var(--nav-active-bg)',
                color: 'var(--nav-active-text)',
              }}
            >
              + New Record
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr>
                  {config.table.columns.map((col) => (
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
                {config.table.rows.map((row, idx) => (
                  <tr key={idx} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    {row.map((cell, i) => (
                      <td key={i} className="px-3 py-2 text-[11px] text-secondary">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
