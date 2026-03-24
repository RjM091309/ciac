export type Role = 'admin' | 'officer' | 'proponent';

export type NotificationCategory =
  | 'application_status'
  | 'requirement'
  | 'document'
  | 'inspection'
  | 'compliance'
  | 'assessment'
  | 'contract';

export interface NotificationItem {
  id: string;
  roleTargets: Role[];
  category: NotificationCategory;
  title: string;
  message: string;
  createdAt: string;
  isRead: boolean;
  applicationId?: number;
  ownerUserId?: number;
}

export function filterNotificationsForUser(
  notifications: NotificationItem[],
  args: { role: Role; userId?: number | null }
) {
  const { role, userId } = args;
  return notifications
    .filter((item) => {
      if (!item.roleTargets.includes(role)) return false;
      if (role !== 'proponent') return true;
      if (item.ownerUserId == null) return false;
      if (!Number.isFinite(Number(userId))) return false;
      return Number(item.ownerUserId) === Number(userId);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function countUnread(notifications: NotificationItem[]) {
  return notifications.reduce((count, item) => count + (item.isRead ? 0 : 1), 0);
}
