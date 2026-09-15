import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PERMISSIONS_REFRESH_EVENT } from '../lib/permissionsRefresh';

export type CrudPermission = { can_add: boolean; can_edit: boolean; can_delete: boolean };
export type CrudPermissionMap = Record<string, CrudPermission>;

type ControlPanelAccess = {
  ready: boolean;
  /** True for roles exempt from Control Panel restrictions (currently: admin). */
  fullAccess: boolean;
  sidebarPermissions: Record<string, boolean>;
  crudPermissions: CrudPermissionMap;
  dashboardWidgetPermissions: Record<string, boolean>;
  /** DBM-08: unlike canView (fail-closed), a widget with no saved preference
   * defaults to visible — hiding a dashboard card is a display choice, not a
   * security boundary. */
  canShowWidget: (widgetKey: string) => boolean;
};

const ControlPanelAccessContext = createContext<ControlPanelAccess>({
  ready: false,
  fullAccess: false,
  sidebarPermissions: {},
  crudPermissions: {},
  dashboardWidgetPermissions: {},
  canShowWidget: () => true,
});

function api(path: string) {
  return path;
}

export function ControlPanelAccessProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [fullAccess, setFullAccess] = useState(false);
  const [sidebarPermissions, setSidebarPermissions] = useState<Record<string, boolean>>({});
  const [crudPermissions, setCrudPermissions] = useState<CrudPermissionMap>({});
  const [dashboardWidgetPermissions, setDashboardWidgetPermissions] = useState<Record<string, boolean>>({});

  // Bumped on every load() call so an in-flight fetch that resolves after a
  // newer one started (e.g. two "permissions" SSE events close together)
  // discards its stale result instead of clobbering the newer one.
  const requestIdRef = React.useRef(0);

  // `silent` (used for the live "permissions changed" refresh, see
  // notifyRolePermissionsChanged server-side) never flips `ready` back to
  // false and never fails closed on error — the sidebar/CRUD/widgets stay on
  // whatever was last known-good instead of flashing empty/hidden while a
  // background re-fetch is in flight, and a transient network blip just
  // means it'll catch up on the next event rather than yanking access away.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    const requestId = ++requestIdRef.current;
    if (!silent) setReady(false);
    try {
      const [sRes, cRes, wRes] = await Promise.all([
        fetch(api('/api/control-panel/me/sidebar-menu'), { credentials: 'include' }),
        fetch(api('/api/control-panel/me/menu-crud'), { credentials: 'include' }),
        fetch(api('/api/control-panel/me/dashboard-widgets'), { credentials: 'include' }),
      ]);

      const sJson = await sRes.json().catch(() => ({}));
      const cJson = await cRes.json().catch(() => ({}));
      const wJson = await wRes.json().catch(() => ({}));

      if (!sRes.ok) throw new Error(sJson?.message || 'Failed to load sidebar permissions');
      if (!cRes.ok) throw new Error(cJson?.message || 'Failed to load CRUD permissions');
      if (!wRes.ok) throw new Error(wJson?.message || 'Failed to load dashboard widget permissions');

      const nextSidebar: Record<string, boolean> = {};
      (sJson.data || []).forEach((row: any) => {
        nextSidebar[String(row.menu_key)] = Number(row.is_enabled) === 1 || row.is_enabled === true;
      });

      const nextCrud: CrudPermissionMap = {};
      (cJson.data || []).forEach((row: any) => {
        nextCrud[String(row.menu_key)] = {
          can_add: Number(row.can_add) === 1 || row.can_add === true,
          can_edit: Number(row.can_edit) === 1 || row.can_edit === true,
          can_delete: Number(row.can_delete) === 1 || row.can_delete === true,
        };
      });

      const nextWidgets: Record<string, boolean> = {};
      (wJson.data || []).forEach((row: any) => {
        nextWidgets[String(row.widget_key)] = Number(row.is_enabled) === 1 || row.is_enabled === true;
      });

      if (requestId !== requestIdRef.current) return;
      setFullAccess(Boolean(sJson?.fullAccess) || Boolean(cJson?.fullAccess) || Boolean(wJson?.fullAccess));
      setSidebarPermissions(nextSidebar);
      setCrudPermissions(nextCrud);
      setDashboardWidgetPermissions(nextWidgets);
    } catch {
      if (requestId !== requestIdRef.current) return;
      if (!silent) {
        // Fail closed: if permissions can't be loaded, do not fall back to
        // showing everything. The sidebar/CRUD gates below treat "not ready"
        // as "no access yet", not "unrestricted".
        setFullAccess(false);
        setSidebarPermissions({});
        setCrudPermissions({});
        setDashboardWidgetPermissions({});
      }
    } finally {
      if (requestId === requestIdRef.current && !silent) setReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onPermissionsRefresh() {
      load({ silent: true });
    }
    window.addEventListener(PERMISSIONS_REFRESH_EVENT, onPermissionsRefresh);
    return () => {
      window.removeEventListener(PERMISSIONS_REFRESH_EVENT, onPermissionsRefresh);
    };
  }, [load]);

  const canShowWidget = useMemo(
    () => (widgetKey: string) => {
      if (fullAccess) return true;
      if (!ready) return true; // fail-open while loading — a display preference, not a gate
      if (!(widgetKey in dashboardWidgetPermissions)) return true;
      return dashboardWidgetPermissions[widgetKey];
    },
    [fullAccess, ready, dashboardWidgetPermissions]
  );

  const value = useMemo(
    () => ({
      ready,
      fullAccess,
      sidebarPermissions,
      crudPermissions,
      dashboardWidgetPermissions,
      canShowWidget,
    }),
    [ready, fullAccess, sidebarPermissions, crudPermissions, dashboardWidgetPermissions, canShowWidget]
  );

  return <ControlPanelAccessContext.Provider value={value}>{children}</ControlPanelAccessContext.Provider>;
}

export function useControlPanelAccess() {
  return useContext(ControlPanelAccessContext);
}

