const { selectData, updateData, updateSchema } = require("../config/database");

async function ensureSchema() {
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
}

async function getSidebarPermissions(roleId) {
  return await selectData(
    `
      SELECT role_id, menu_key, is_enabled
      FROM role_sidebar_menu_permissions
      WHERE role_id = @param0
      ORDER BY menu_key ASC
    `,
    [roleId]
  );
}

async function setSidebarPermissions(roleId, permissions) {
  await updateData(
    `
      DELETE FROM role_sidebar_menu_permissions
      WHERE role_id = @param0
    `,
    [roleId]
  );

  for (const row of permissions) {
    await updateData(
      `
        INSERT INTO role_sidebar_menu_permissions (role_id, menu_key, is_enabled, created_at, updated_at)
        VALUES (@param0, @param1, @param2, SYSUTCDATETIME(), SYSUTCDATETIME())
      `,
      [roleId, String(row.menu_key), row.is_enabled ? 1 : 0]
    );
  }
}

async function getMenuCrudPermissions(roleId) {
  return await selectData(
    `
      SELECT role_id, menu_key, can_add, can_edit, can_delete
      FROM role_menu_crud_permissions
      WHERE role_id = @param0
      ORDER BY menu_key ASC
    `,
    [roleId]
  );
}

async function setMenuCrudPermissions(roleId, permissions) {
  await updateData(
    `
      DELETE FROM role_menu_crud_permissions
      WHERE role_id = @param0
    `,
    [roleId]
  );

  for (const row of permissions) {
    await updateData(
      `
        INSERT INTO role_menu_crud_permissions (role_id, menu_key, can_add, can_edit, can_delete, created_at, updated_at)
        VALUES (@param0, @param1, @param2, @param3, @param4, SYSUTCDATETIME(), SYSUTCDATETIME())
      `,
      [roleId, String(row.menu_key), row.can_add ? 1 : 0, row.can_edit ? 1 : 0, row.can_delete ? 1 : 0]
    );
  }
}

module.exports = {
  ensureSchema,
  getSidebarPermissions,
  setSidebarPermissions,
  getMenuCrudPermissions,
  setMenuCrudPermissions,
};
