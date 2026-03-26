export type SidebarMenuItem = {
  key: string;
  label: string;
};

export type CrudMenuItem = {
  key: string;
  label: string;
};

export const SIDEBAR_MENU_ITEMS: SidebarMenuItem[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'applications:new', label: 'New Applications' },
  { key: 'applications:renewals', label: 'Renewal Tracking' },
  { key: 'applications:projects', label: 'Project Evaluations' },
  { key: 'verification:pending', label: 'Pending Review' },
  { key: 'verification:audit', label: 'Audit Trail' },
  { key: 'directory:companies', label: 'Company Profiles' },
  { key: 'directory:officers', label: 'Key Officers & Stakeholders' },
  { key: 'directory:site-plans', label: 'Site Development Plans' },
  { key: 'compliance:permits', label: 'CDC/CIAC Permits' },
  { key: 'compliance:bir', label: 'BIR & Tax Records' },
  { key: 'compliance:expiry', label: 'Expiring Permits' },
  { key: 'operations:flowcharts', label: 'Production Flowcharts' },
  { key: 'operations:brochures', label: 'Brochures & Marketing' },
  { key: 'operations:gad', label: 'GAD Programs' },
  { key: 'settings:users', label: 'User Management' },
  { key: 'settings:proponents', label: 'Proponent' },
  { key: 'settings:checklist', label: 'Master Checklist' },
  { key: 'settings:control-panel', label: 'Control Panel' },
];

export const CRUD_MENU_ITEMS: CrudMenuItem[] = [
  { key: 'settings:users', label: 'User Management' },
  { key: 'settings:proponents', label: 'Proponent Management' },
  { key: 'settings:checklist', label: 'Master Checklist' },
];
