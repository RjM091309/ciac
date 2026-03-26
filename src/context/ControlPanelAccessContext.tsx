import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type CrudPermission = { can_add: boolean; can_edit: boolean; can_delete: boolean };
export type CrudPermissionMap = Record<string, CrudPermission>;

type ControlPanelAccess = {
  ready: boolean;
  sidebarPermissions: Record<string, boolean>;
  crudPermissions: CrudPermissionMap;
};

const ControlPanelAccessContext = createContext<ControlPanelAccess>({
  ready: false,
  sidebarPermissions: {},
  crudPermissions: {},
});

function api(path: string) {
  return path;
}

export function ControlPanelAccessProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [sidebarPermissions, setSidebarPermissions] = useState<Record<string, boolean>>({});
  const [crudPermissions, setCrudPermissions] = useState<CrudPermissionMap>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setReady(false);
      let didError = false;
      try {
        const [sRes, cRes] = await Promise.all([
          fetch(api('/api/control-panel/me/sidebar-menu'), { credentials: 'include' }),
          fetch(api('/api/control-panel/me/menu-crud'), { credentials: 'include' }),
        ]);

        const sJson = await sRes.json().catch(() => ({}));
        const cJson = await cRes.json().catch(() => ({}));

        if (!sRes.ok) throw new Error(sJson?.message || 'Failed to load sidebar permissions');
        if (!cRes.ok) throw new Error(cJson?.message || 'Failed to load CRUD permissions');

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

        if (cancelled) return;
        setSidebarPermissions(nextSidebar);
        setCrudPermissions(nextCrud);
      } catch {
        didError = true;
        // If permissions can't be loaded, keep UI permissive (do not hide everything).
        if (cancelled) return;
        setSidebarPermissions({});
        setCrudPermissions({});
        return;
      } finally {
        if (!cancelled && !didError) setReady(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      ready,
      sidebarPermissions,
      crudPermissions,
    }),
    [ready, sidebarPermissions, crudPermissions]
  );

  return <ControlPanelAccessContext.Provider value={value}>{children}</ControlPanelAccessContext.Provider>;
}

export function useControlPanelAccess() {
  return useContext(ControlPanelAccessContext);
}

