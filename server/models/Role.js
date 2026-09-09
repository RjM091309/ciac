const { selectData, insertData, updateData, updateSchema } = require("../config/database");

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

async function getRoleById(id) {
  const rows = await selectData(`SELECT TOP (1) id, name, description, is_active FROM roles WHERE id = @param0`, [id]);
  return rows?.[0] || null;
}

async function createRole({ name, description }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("Role name is required");
  const result = await insertData(
    `
    INSERT INTO roles (name, description, is_active)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, 1)
    `,
    [trimmedName, description ?? null]
  );
  const id = result?.recordset?.[0]?.id;
  return getRoleById(id);
}

async function updateRole(id, { name, description }) {
  const sets = [];
  const params = [];
  const pushSet = (frag, value) => {
    sets.push(frag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (name !== undefined) pushSet("name = ?", String(name).trim());
  if (description !== undefined) pushSet("description = ?", description ?? null);
  if (sets.length) {
    params.push(id);
    await updateData(`UPDATE roles SET ${sets.join(", ")} WHERE id = @param${params.length - 1}`, params);
  }
  return getRoleById(id);
}

async function deactivateRole(id) {
  await updateData(`UPDATE roles SET is_active = 0 WHERE id = @param0`, [id]);
  return getRoleById(id);
}

async function reactivateRole(id) {
  await updateData(`UPDATE roles SET is_active = 1 WHERE id = @param0`, [id]);
  return getRoleById(id);
}

async function isRoleInUse(id) {
  const rows = await selectData(`SELECT TOP (1) user_id FROM user_roles WHERE role_id = @param0`, [id]);
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
  getRoleById,
  createRole,
  updateRole,
  deactivateRole,
  reactivateRole,
  isRoleInUse,
};

