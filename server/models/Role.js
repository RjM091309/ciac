const { selectData, updateSchema } = require("../config/database");

async function listRoles() {
  return await selectData("SELECT * FROM roles WHERE is_active = 1 ORDER BY name ASC");
}

/** roles.name has a UNIQUE index, so this is deterministic (never more than one match). */
async function getActiveRoleIdByName(roleName) {
  if (!roleName) return null;
  const rows = await selectData(
    `
      SELECT TOP (1) id
      FROM roles
      WHERE LOWER(name) = LOWER(@param0) AND is_active = 1
    `,
    [roleName]
  );
  const id = Number(rows?.[0]?.id);
  return Number.isFinite(id) ? id : null;
}

async function roleExists(roleId) {
  const rows = await selectData(
    `SELECT TOP (1) id FROM roles WHERE id = @param0 AND is_active = 1`,
    [roleId]
  );
  return rows.length > 0;
}

async function ensureSchema() {
  // roles
  await updateSchema(`
    IF OBJECT_ID('dbo.roles', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.roles (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        description NVARCHAR(255) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_roles_is_active DEFAULT (1)
      );

      CREATE UNIQUE INDEX UX_roles_name ON dbo.roles(name);
    END
  `);
}

module.exports = {
  listRoles,
  getActiveRoleIdByName,
  roleExists,
  ensureSchema,
};

