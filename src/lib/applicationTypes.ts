// Application types are now File Maintenance-configurable — see
// src/components/FileMaintenance/ApplicationTypes.tsx and the
// dbo.application_types table (server/models/ApplicationType.js). This
// file's static list only seeds the fallback label below (and the initial
// render before a live fetch resolves); the live list is what actually
// drives the "Application Type" dropdown in ApplicationsWorkflow.tsx and
// ProponentApplications.tsx.
export const APPLICATION_TYPES = ['DIRECT_LEASE', 'WAREHOUSE_LEASE', 'SUBLEASE'] as const;

export type ApplicationType = (typeof APPLICATION_TYPES)[number];

export const APPLICATION_TYPE_LABELS: Record<string, string> = {
  DIRECT_LEASE: 'Direct Lease',
  WAREHOUSE_LEASE: 'Warehouse Lease',
  SUBLEASE: 'Sublease',
};

/** Title-cases a code File Maintenance doesn't have a seed label for (e.g.
 * "SHORT_TERM_LEASE" -> "Short Term Lease") so a custom type still reads
 * sensibly anywhere this is called without needing the live list on hand. */
function titleCaseCode(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function applicationTypeLabel(value: string | null | undefined): string {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return '—';
  return APPLICATION_TYPE_LABELS[key] || titleCaseCode(key);
}
