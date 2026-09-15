// Mirrors notificationRefresh.ts's bridge pattern: AppHeader.tsx's single
// EventSource connection (SSE) is the one place that actually listens to the
// server, and re-broadcasts as a plain window event so other parts of the
// app (here, ControlPanelAccessContext) can react without each opening
// their own SSE connection. Fired when the server pushes a "permissions"
// event — see server/controller/c_control_panel.js's
// notifyRolePermissionsChanged, called right after a Control Panel save.
export const PERMISSIONS_REFRESH_EVENT = 'ciac:permissions:refresh';

export function requestPermissionsRefresh() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PERMISSIONS_REFRESH_EVENT));
}
