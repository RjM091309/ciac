export function getStatusBadgeStyles(status: string | null | undefined) {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'VERIFIED' || s === 'APPROVED' || s === 'ACTIVE') {
    return { bg: 'rgba(16,185,129,.14)', color: '#10b981', border: 'rgba(16,185,129,.38)' };
  }
  if (s === 'PENDING' || s === 'PENDING_REVIEW' || s === 'SUBMITTED' || s === 'FOR_REVIEW') {
    return { bg: 'rgba(245,158,11,.14)', color: '#f59e0b', border: 'rgba(245,158,11,.38)' };
  }
  if (s === 'REJECTED' || s === 'INCOMPLETE') {
    return { bg: 'rgba(239,68,68,.14)', color: '#ef4444', border: 'rgba(239,68,68,.38)' };
  }
  if (s === 'UNDER_REVIEW') {
    return { bg: 'rgba(59,130,246,.14)', color: '#3b82f6', border: 'rgba(59,130,246,.38)' };
  }
  return { bg: 'rgba(148,163,184,.14)', color: '#94a3b8', border: 'rgba(148,163,184,.28)' };
}
