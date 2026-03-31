export const NOTIFICATIONS_REFRESH_EVENT = 'ciac:notifications:refresh';

export function requestNotificationsRefresh() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH_EVENT));
}
