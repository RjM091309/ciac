const { selectData, updateSchema, runInTransaction } = require("../config/database");
const cache = require("../config/cache");

// Every guarded request reads its role's permissions (m_auth.js), so each
// role's three permission lists are cached and dropped whenever Control Panel
// saves them. Rows are copied out so a caller can't mutate the cached ones.
const cacheKey = (kind, roleId) => `cpp:${kind}:${Number(roleId)}`;
async function cachedRows(kind, roleId, load) {
  const rows = await cache.remember(cacheKey(kind, roleId), load);
  return rows.map((row) => ({ ...row }));
}

// Once per process: the DDL below is idempotent but not free, and
// ensureSchema() is awaited at the top of most queries in this file.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = createSchema().catch((error) => {
      schemaReady = null; // retry on the next call if the DDL failed
      throw error;
    });
  }
  return schemaReady;
}

async function createSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.role_sidebar_menu_permissions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.role_sidebar_menu_permissions (
        role_id INT NOT NULL,
        menu_key NVARCHAR(100) NOT NULL,
        is_enabled BIT NOT NULL CONSTRAINT DF_role_sidebar_menu_permissions_is_enabled DEFAULT (1),
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_role_sidebar_menu_permissions_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        CONSTRAINT PK_role_sidebar_menu_permissions PRIMARY KEY (role_id, menu_key),
        CONSTRAINT FK_role_sidebar_menu_permissions_role FOREIGN KEY (role_id) REFERENCES dbo.roles(id)
      );
    END
  `);

  await updateSchema(`
    IF OBJECT_ID('dbo.role_menu_crud_permissions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.role_menu_crud_permissions (
        role_id INT NOT NULL,
        menu_key NVARCHAR(100) NOT NULL,
        can_add BIT NOT NULL CONSTRAINT DF_role_menu_crud_permissions_can_add DEFAULT (0),
        can_edit BIT NOT NULL CONSTRAINT DF_role_menu_crud_permissions_can_edit DEFAULT (0),
        can_delete BIT NOT NULL CONSTRAINT DF_role_menu_crud_permissions_can_delete DEFAULT (0),
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_role_menu_crud_permissions_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        CONSTRAINT PK_role_menu_crud_permissions PRIMARY KEY (role_id, menu_key),
        CONSTRAINT FK_role_menu_crud_permissions_role FOREIGN KEY (role_id) REFERENCES dbo.roles(id)
      );
    END
  `);

  // Which dashboard widgets a role sees (DBM-08). Same shape/pattern as the
  // sidebar table above, just keyed by widget instead of by menu.
  await updateSchema(`
    IF OBJECT_ID('dbo.role_dashboard_widget_permissions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.role_dashboard_widget_permissions (
        role_id INT NOT NULL,
        widget_key NVARCHAR(100) NOT NULL,
        is_enabled BIT NOT NULL CONSTRAINT DF_role_dashboard_widget_permissions_is_enabled DEFAULT (1),
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_role_dashboard_widget_permissions_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        CONSTRAINT PK_role_dashboard_widget_permissions PRIMARY KEY (role_id, widget_key),
        CONSTRAINT FK_role_dashboard_widget_permissions_role FOREIGN KEY (role_id) REFERENCES dbo.roles(id)
      );
    END
  `);
}

async function getSidebarPermissions(roleId) {
  await ensureSchema();
  return cachedRows("sidebar", roleId, () =>
    selectData(
      `
        SELECT role_id, menu_key, is_enabled
        FROM role_sidebar_menu_permissions
        WHERE role_id = @param0
        ORDER BY menu_key ASC
      `,
      [roleId]
    )
  );
}

async function setSidebarPermissions(roleId, permissions) {
  await ensureSchema();
  // Delete + re-insert must be atomic: if any row fails to insert mid-loop,
  // a non-transactional version would leave the role with zero (or partial)
  // sidebar permissions until an admin retries the save.
  await runInTransaction(async (tx) => {
    await tx.query(
      `DELETE FROM role_sidebar_menu_permissions WHERE role_id = @param0`,
      [roleId]
    );

    for (const row of permissions) {
      await tx.query(
        `
          INSERT INTO role_sidebar_menu_permissions (role_id, menu_key, is_enabled, created_at, updated_at)
          VALUES (@param0, @param1, @param2, SYSUTCDATETIME(), SYSUTCDATETIME())
        `,
        [roleId, String(row.menu_key), row.is_enabled ? 1 : 0]
      );
    }
  });
  cache.del(cacheKey("sidebar", roleId));
}

async function getMenuCrudPermissions(roleId) {
  await ensureSchema();
  return cachedRows("crud", roleId, () =>
    selectData(
      `
        SELECT role_id, menu_key, can_add, can_edit, can_delete
        FROM role_menu_crud_permissions
        WHERE role_id = @param0
        ORDER BY menu_key ASC
      `,
      [roleId]
    )
  );
}

async function setMenuCrudPermissions(roleId, permissions) {
  await ensureSchema();
  await runInTransaction(async (tx) => {
    await tx.query(
      `DELETE FROM role_menu_crud_permissions WHERE role_id = @param0`,
      [roleId]
    );

    for (const row of permissions) {
      await tx.query(
        `
          INSERT INTO role_menu_crud_permissions (role_id, menu_key, can_add, can_edit, can_delete, created_at, updated_at)
          VALUES (@param0, @param1, @param2, @param3, @param4, SYSUTCDATETIME(), SYSUTCDATETIME())
        `,
        [roleId, String(row.menu_key), row.can_add ? 1 : 0, row.can_edit ? 1 : 0, row.can_delete ? 1 : 0]
      );
    }
  });
  cache.del(cacheKey("crud", roleId));
}

/** Fail-closed: a menu with no saved row for this role is treated as hidden. */
async function isSidebarVisible(roleId, menuKey) {
  const row = (await getSidebarPermissions(roleId)).find((r) => r.menu_key === menuKey);
  if (!row) return false;
  return Number(row.is_enabled) === 1;
}

const CRUD_ACTION_COLUMNS = { add: "can_add", edit: "can_edit", delete: "can_delete" };

/** Fail-closed: a menu with no saved row for this role is treated as no permission. */
async function hasCrudPermission(roleId, menuKey, action) {
  const column = CRUD_ACTION_COLUMNS[action];
  if (!column) return false;
  const row = (await getMenuCrudPermissions(roleId)).find((r) => r.menu_key === menuKey);
  if (!row) return false;
  return Number(row[column]) === 1;
}

/** Ids of every role with `menuKey` enabled in its sidebar. */
async function listRoleIdsWithMenu(menuKey) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT role_id FROM role_sidebar_menu_permissions WHERE menu_key = @param0 AND is_enabled = 1`,
    [menuKey]
  );
  return new Set(rows.map((r) => Number(r.role_id)));
}

async function getDashboardWidgetPermissions(roleId) {
  await ensureSchema();
  return cachedRows("widgets", roleId, () =>
    selectData(
      `
        SELECT role_id, widget_key, is_enabled
        FROM role_dashboard_widget_permissions
        WHERE role_id = @param0
        ORDER BY widget_key ASC
      `,
      [roleId]
    )
  );
}

async function setDashboardWidgetPermissions(roleId, permissions) {
  await ensureSchema();
  await runInTransaction(async (tx) => {
    await tx.query(`DELETE FROM role_dashboard_widget_permissions WHERE role_id = @param0`, [roleId]);
    for (const row of permissions) {
      await tx.query(
        `
          INSERT INTO role_dashboard_widget_permissions (role_id, widget_key, is_enabled, created_at, updated_at)
          VALUES (@param0, @param1, @param2, SYSUTCDATETIME(), SYSUTCDATETIME())
        `,
        [roleId, String(row.widget_key), row.is_enabled ? 1 : 0]
      );
    }
  });
  cache.del(cacheKey("widgets", roleId));
}

/** Fail-OPEN, unlike sidebar/CRUD access above: a widget is a display
 * preference, not a security boundary, so one with no saved row for this
 * role defaults to visible instead of vanishing the moment this feature
 * ships, for every role, until an admin revisits Control Panel. */
async function isDashboardWidgetVisible(roleId, widgetKey) {
  const row = (await getDashboardWidgetPermissions(roleId)).find((r) => r.widget_key === widgetKey);
  if (!row) return true;
  return Number(row.is_enabled) === 1;
}

module.exports = {
  ensureSchema,
  getSidebarPermissions,
  setSidebarPermissions,
  getMenuCrudPermissions,
  setMenuCrudPermissions,
  isSidebarVisible,
  hasCrudPermission,
  listRoleIdsWithMenu,
  getDashboardWidgetPermissions,
  setDashboardWidgetPermissions,
  isDashboardWidgetVisible,
};
