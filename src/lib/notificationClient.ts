import { NotificationItem, Role } from './notifications';

function mapNotificationRows(rows: any[], userRole: Role, userId?: number | null): NotificationItem[] {
  return rows.map((row: any) => {
    const rawStatus = String(row?.status ?? '').trim();
    const statusNum = Number(rawStatus);
    const statusText = rawStatus.toUpperCase();
    const rawCategory = String(row?.event_type ?? '').trim().toLowerCase();
    const category =
      rawCategory === 'requirement' ||
      rawCategory === 'document' ||
      rawCategory === 'inspection' ||
      rawCategory === 'compliance' ||
      rawCategory === 'assessment' ||
      rawCategory === 'contract'
        ? rawCategory
        : 'application_status';
    const applicationId = Number(row?.application_id);
    const hasApplicationId = Number.isFinite(applicationId) && applicationId > 0;
    const targetPath = hasApplicationId
      ? Number(row?.application_is_renewal) === 1
        ? '/applications/renewals'
        : '/applications/new'
      : undefined;
    const isRead =
      statusNum === 2 || statusText === 'READ' || statusText === 'SEEN' || statusText === 'READ_BY_USER';

    return {
      id: String(row?.id ?? ''),
      roleTargets: [userRole],
      category,
      eventType: rawCategory || category,
      title: String(row?.subject || row?.channel || 'Notification'),
      message: String(row?.body || row?.error_message || ''),
      createdAt: String(row?.created_at || row?.updated_at || new Date().toISOString()),
      isRead,
      applicationId: hasApplicationId ? applicationId : undefined,
      applicationNumber: row?.application_no ? String(row.application_no) : undefined,
      targetPath,
      ownerUserId: Number(userId || 0),
    } satisfies NotificationItem;
  });
}

export async function fetchNotificationsList(args: {
  backendUrl: string;
  userRole: Role;
  userId?: number | null;
  limit?: number;
}) {
  const { backendUrl, userRole, userId, limit = 50 } = args;
  try {
    const baseUrl = String(backendUrl || '').replace(/\/+$/, '');
    let res = await fetch(`${baseUrl}/api/notifications/me?limit=${encodeURIComponent(String(limit))}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      res = await fetch(`/api/notifications/me?limit=${encodeURIComponent(String(limit))}`, {
        credentials: 'include',
      });
    }
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json?.success) return [];
    const rows = Array.isArray(json?.data) ? json.data : [];
    return mapNotificationRows(rows, userRole, userId);
  } catch {
    return [];
  }
}

export async function markNotificationReadRequest(backendUrl: string, id: string) {
  const baseUrl = String(backendUrl || '').replace(/\/+$/, '');
  let res = await fetch(`${baseUrl}/api/notifications/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
    credentials: 'include',
  });
  if (!res.ok) {
    res = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      credentials: 'include',
    });
  }
  return res.ok;
}

export async function markAllNotificationsReadRequest(backendUrl: string) {
  const baseUrl = String(backendUrl || '').replace(/\/+$/, '');
  let res = await fetch(`${baseUrl}/api/notifications/read-all`, {
    method: 'PATCH',
    credentials: 'include',
  });
  if (!res.ok) {
    res = await fetch('/api/notifications/read-all', {
      method: 'PATCH',
      credentials: 'include',
    });
  }
  return res.ok;
}

export function formatNotificationTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

export function getNotificationCategoryLabel(value: string | undefined) {
  const normalized = String(value || 'application_status').trim().toLowerCase();
  switch (normalized) {
    case 'application_status':
      return 'Application';
    case 'requirement':
      return 'Requirement';
    case 'document':
      return 'Document';
    case 'inspection':
      return 'Inspection';
    case 'compliance':
      return 'Compliance';
    case 'assessment':
      return 'Assessment';
    case 'contract':
      return 'Contract';
    default:
      return normalized.replace(/_/g, ' ');
  }
}
