const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureSchema() {
  // users
  await updateSchema(`
    IF OBJECT_ID('dbo.users', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        username NVARCHAR(100) NOT NULL,
        email NVARCHAR(255) NULL,
        password_hash NVARCHAR(255) NOT NULL,
        full_name NVARCHAR(255) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_users_is_active DEFAULT (1),
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_users_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );

      CREATE UNIQUE INDEX UX_users_username ON dbo.users(username);
      CREATE UNIQUE INDEX UX_users_email ON dbo.users(email) WHERE email IS NOT NULL;
    END
  `);

  // user_roles
  await updateSchema(`
    IF OBJECT_ID('dbo.user_roles', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.user_roles (
        user_id INT NOT NULL,
        role_id INT NOT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_user_roles_created_at DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_user_roles PRIMARY KEY (user_id, role_id),
        CONSTRAINT FK_user_roles_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE,
        CONSTRAINT FK_user_roles_role FOREIGN KEY (role_id) REFERENCES dbo.roles(id)
      );

      CREATE INDEX IX_user_roles_role_id ON dbo.user_roles(role_id);
    END
  `);
}

async function listUserRolesMap() {
  const rows = await selectData(
    `
    SELECT
      ur.user_id,
      r.id as role_id,
      r.name as role_name,
      r.description as role_description
    FROM user_roles ur
    INNER JOIN roles r ON r.id = ur.role_id
    `
  );

  const map = new Map();
  for (const row of rows) {
    const userId = row.user_id;
    if (!map.has(userId)) map.set(userId, []);
    map.get(userId).push({
      id: row.role_id,
      name: row.role_name,
      description: row.role_description ?? null,
    });
  }
  return map;
}

async function listUsers() {
  const users = await selectData(
    `
    SELECT
      u.id,
      u.username,
      u.email,
      u.full_name,
      u.is_active,
      u.created_at,
      u.updated_at,
      u.password_hash
    FROM users u
    ORDER BY u.id DESC
    `
  );

  const rolesMap = await listUserRolesMap();

  return users.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    full_name: u.full_name ?? null,
    is_active: u.is_active,
    created_at: u.created_at ?? null,
    updated_at: u.updated_at ?? null,
    roles: rolesMap.get(u.id) || [],
  }));
}

async function getUserById(id) {
  const rows = await selectData(
    `
    SELECT TOP (1)
      u.id,
      u.username,
      u.email,
      u.full_name,
      u.is_active,
      u.created_at,
      u.updated_at
    FROM users u
    WHERE u.id = @param0
    `,
    [id]
  );
  const user = rows?.[0] || null;
  if (!user) return null;

  const roles = await selectData(
    `
    SELECT r.id, r.name, r.description
    FROM user_roles ur
    INNER JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = @param0
    ORDER BY r.name ASC
    `,
    [id]
  );

  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    full_name: user.full_name ?? null,
    is_active: user.is_active,
    created_at: user.created_at ?? null,
    updated_at: user.updated_at ?? null,
    roles: roles.map((r) => ({ id: r.id, name: r.name, description: r.description ?? null })),
  };
}

async function createUser({ username, email, full_name, password, is_active = 1, role_id }) {
  const active = is_active ? 1 : 0;
  const roleId = toInt(role_id);
  const result = await insertData(
    `
    INSERT INTO users (username,email,password_hash,full_name,is_active,created_at,updated_at)
    OUTPUT INSERTED.id
    VALUES (@param0,@param1,@param2,@param3,@param4,GETDATE(),NULL)
    `,
    [username, email, password, full_name, active]
  );

  const newId = result?.recordset?.[0]?.id;
  if (newId && roleId) {
    await setUserPrimaryRole(newId, roleId);
  }
  return await getUserById(newId);
}

async function setUserPrimaryRole(userId, roleId) {
  // user_roles has composite PK (user_id, role_id). A user may have multiple roles.
  // Our UI currently picks a single role. Per request: prefer UPDATE (no delete).
  // Logic:
  // - If (user_id, role_id) already exists => no-op
  // - Else if user has any role row => UPDATE TOP(1) to new role_id (avoids insert)
  // - Else => INSERT new mapping
  await updateData(
    `
    IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = @param0 AND role_id = @param1)
    BEGIN
      -- already mapped, do nothing
      SELECT 1;
    END
    ELSE IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = @param0)
    BEGIN
      UPDATE TOP (1) user_roles
      SET role_id = @param1
      WHERE user_id = @param0;
    END
    ELSE
    BEGIN
      INSERT INTO user_roles (user_id, role_id) VALUES (@param0, @param1);
    END
    `,
    [userId, roleId]
  );
}

async function updateUser(id, { username, email, full_name, password, is_active, role_id }) {
  const sets = [];
  const params = [];
  const pushSet = (sqlFrag, value) => {
    sets.push(sqlFrag.replace("?", `@param${params.length}`));
    params.push(value);
  };

  if (username !== undefined) pushSet("username = ?", username);
  if (email !== undefined) pushSet("email = ?", email);
  if (full_name !== undefined) pushSet("full_name = ?", full_name);
  if (password !== undefined && password !== "") pushSet("password_hash = ?", password);
  if (is_active !== undefined) pushSet("is_active = ?", is_active ? 1 : 0);

  if (sets.length) {
    const query = `
      UPDATE users
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }

  const roleId = toInt(role_id);
  if (roleId) await setUserPrimaryRole(id, roleId);

  return await getUserById(id);
}

async function deactivateUser(id) {
  await updateData(
    `
    UPDATE users
    SET is_active = 0, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id]
  );
  return await getUserById(id);
}

module.exports = {
  ensureSchema,
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser,
};

