import { NotificationItem, Role } from './notifications';

function mapNotificationRows(rows: any[], userRole: Role, userId?: number | null): NotificationItem[] {
  return rows.map((row: any) => {
    const rawStatus = String(row?.status ?? '').trim();
    const statusNum = Number(rawStatus);
    const statusText = rawStatus.toUpperCase();
    const rawCategory = String(row?.event_type ?? '').trim().toLowerCase();
    // approval_ready is a distinct eventType (so the frontend can toast for
    // exactly that handoff, see AppHeader.tsx) but shares the 'approval'
    // category/routing — it's still an Approval Queue item.
    const category =
      rawCategory === 'requirement' ||
      rawCategory === 'document' ||
      rawCategory === 'inspection' ||
      rawCategory === 'compliance' ||
      rawCategory === 'assessment' ||
      rawCategory === 'approval' ||
      rawCategory === 'contract'
        ? rawCategory
        : rawCategory === 'approval_ready'
          ? 'approval'
          : 'application_status';
    const applicationId = Number(row?.application_id);
    const hasApplicationId = Number.isFinite(applicationId) && applicationId > 0;
    const requirementId = Number(row?.requirement_id);
    const hasRequirementId = Number.isFinite(requirementId) && requirementId > 0;
    // Route to whichever module actually owns this event, not always
    // Applications — an assessment/compliance/approval notification should
    // deep-link back into that module's own detail view, not dump the user
    // onto the New/Renewal Applications queue. Document and requirement
    // events are raised while an application's compliance is being
    // evaluated, so those deep-link into the Evaluation Queue too.
    const targetPath = hasApplicationId
      ? userRole === 'proponent'
        ? '/me/applications'
        : category === 'assessment' || category === 'document' || category === 'requirement'
          ? '/assessment'
          : category === 'compliance' || category === 'inspection'
            ? '/compliance/inspections'
            : category === 'approval'
              ? '/approval'
              : Number(row?.application_is_renewal) === 1
                ? '/applications/renewals'
                : '/applications/new'
      : undefined;
    const isRead =
      statusNum === 2 || statusText === 'READ' || statusText === 'SEEN' || statusText === 'READ_BY_USER';
    const rawActorRole = String(row?.actor_role ?? '').trim().toLowerCase();
    const actorRole: Role | null =
      rawActorRole === 'admin' || rawActorRole === 'officer' || rawActorRole === 'proponent' ? rawActorRole : null;

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
      requirementId: hasRequirementId ? requirementId : undefined,
      targetPath,
      ownerUserId: Number(userId || 0),
      actorRole,
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

export async function deleteNotificationRequest(backendUrl: string, id: string) {
  const baseUrl = String(backendUrl || '').replace(/\/+$/, '');
  let res = await fetch(`${baseUrl}/api/notifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  }
  return res.ok;
}

export async function clearAllNotificationsRequest(backendUrl: string) {
  const baseUrl = String(backendUrl || '').replace(/\/+$/, '');
  let res = await fetch(`${baseUrl}/api/notifications/clear-all`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    res = await fetch('/api/notifications/clear-all', {
      method: 'DELETE',
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
    case 'approval':
      return 'Approval';
    case 'approval_ready':
      return 'Ready for Approval';
    case 'contract':
      return 'Contract';
    default:
      return normalized.replace(/_/g, ' ');
  }
}
