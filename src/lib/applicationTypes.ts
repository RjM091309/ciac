// Canonical lease-application types (BRM). Mirrors APPLICATION_TYPES in
// server/models/ApplicationWorkflow.js — keep the two lists in sync.
export const APPLICATION_TYPES = ['DIRECT_LEASE', 'WAREHOUSE_LEASE', 'SUBLEASE'] as const;

export type ApplicationType = (typeof APPLICATION_TYPES)[number];

export const APPLICATION_TYPE_LABELS: Record<string, string> = {
  DIRECT_LEASE: 'Direct Lease',
  WAREHOUSE_LEASE: 'Warehouse Lease',
  SUBLEASE: 'Sublease',
};

export function applicationTypeLabel(value: string | null | undefined): string {
  const key = String(value || '').trim().toUpperCase();
  return APPLICATION_TYPE_LABELS[key] || (value ? String(value) : '—');
}
