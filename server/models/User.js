const { selectData, insertData, updateData, updateSchema } = require("../config/database");
const bcrypt = require("bcryptjs");

let hasPhoneColumnCache = null;
let hasTotpColumnsCache = null;

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function hashPasswordIfNeeded(password) {
  const value = String(password ?? "");
  if (!value) return value;
  if (value.startsWith("$2")) return value;
  return bcrypt.hash(value, 10);
}

async function hasPhoneColumn() {
  if (hasPhoneColumnCache !== null) return hasPhoneColumnCache;
  const rows = await selectData(
    `
    SELECT CAST(CASE WHEN COL_LENGTH('dbo.users', 'phone') IS NULL THEN 0 ELSE 1 END AS INT) AS has_phone
    `
  );
  hasPhoneColumnCache = Number(rows?.[0]?.has_phone) === 1;
  return hasPhoneColumnCache;
}

async function hasTotpColumns() {
  if (hasTotpColumnsCache !== null) return hasTotpColumnsCache;
  const rows = await selectData(
    `
    SELECT CAST(CASE
      WHEN COL_LENGTH('dbo.users', 'totp_secret') IS NULL THEN 0
      WHEN COL_LENGTH('dbo.users', 'totp_enabled') IS NULL THEN 0
      ELSE 1 END AS INT) AS has_totp
    `
  );
  hasTotpColumnsCache = Number(rows?.[0]?.has_totp) === 1;
  return hasTotpColumnsCache;
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
        phone NVARCHAR(32) NULL,
        password_hash NVARCHAR(255) NOT NULL,
        full_name NVARCHAR(255) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_users_is_active DEFAULT (1),
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_users_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );

      CREATE UNIQUE INDEX UX_users_username ON dbo.users(username);
      CREATE UNIQUE INDEX UX_users_email ON dbo.users(email) WHERE email IS NOT NULL;
      CREATE UNIQUE INDEX UX_users_phone ON dbo.users(phone) WHERE phone IS NOT NULL;
    END
  `);

  // Must run in a separate batch from CREATE INDEX: SQL Server validates the whole batch
  // before execution, so "CREATE INDEX ... (phone)" fails if phone was added in the same batch.
  await updateSchema(`
    IF COL_LENGTH('dbo.users', 'phone') IS NULL
      ALTER TABLE dbo.users ADD phone NVARCHAR(32) NULL;
  `);

  await updateSchema(`
    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'UX_users_phone'
        AND object_id = OBJECT_ID('dbo.users')
    )
      CREATE UNIQUE INDEX UX_users_phone ON dbo.users(phone) WHERE phone IS NOT NULL;
  `);
  hasPhoneColumnCache = null;

  // Two-factor (Google Authenticator / TOTP) columns.
  // totp_secret holds the AES-256-GCM encrypted Base32 secret (see server/lib/totp.js).
  await updateSchema(`
    IF COL_LENGTH('dbo.users', 'totp_secret') IS NULL
      ALTER TABLE dbo.users ADD totp_secret NVARCHAR(512) NULL;
  `);
  await updateSchema(`
    IF COL_LENGTH('dbo.users', 'totp_enabled') IS NULL
      ALTER TABLE dbo.users ADD totp_enabled BIT NOT NULL CONSTRAINT DF_users_totp_enabled DEFAULT (0);
  `);
  hasTotpColumnsCache = null;

  // Account status: richer than is_active — distinguishes an admin-imposed,
  // easily-reversed SUSPENDED state from a longer-term DEACTIVATED one. Login
  // and every existing is_active-gated query keep working unchanged since
  // is_active stays the single source of truth for "can log in"; status is
  // the display/audit label layered on top.
  await updateSchema(`
    IF COL_LENGTH('dbo.users', 'status') IS NULL
      ALTER TABLE dbo.users ADD status NVARCHAR(20) NOT NULL CONSTRAINT DF_users_status DEFAULT ('ACTIVE');
  `);
  // One-time backfill for rows that predate the status column — cheap no-op
  // once migrated, since deactivateUser/suspendUser set status explicitly.
  await updateSchema(`
    UPDATE dbo.users SET status = 'DEACTIVATED' WHERE is_active = 0 AND status = 'ACTIVE';
  `);

  // Account lockout after repeated failed logins (TOR: configurable failed
  // login attempts). Threshold/duration are read from env at check time —
  // see server/models/Auth.js.
  await updateSchema(`
    IF COL_LENGTH('dbo.users', 'failed_login_attempts') IS NULL
      ALTER TABLE dbo.users ADD failed_login_attempts INT NOT NULL CONSTRAINT DF_users_failed_attempts DEFAULT (0);
  `);
  await updateSchema(`
    IF COL_LENGTH('dbo.users', 'locked_until') IS NULL
      ALTER TABLE dbo.users ADD locked_until DATETIME2(3) NULL;
  `);

  // Bumped whenever an already-issued JWT should stop working before its
  // natural 24h expiry — deactivation/suspension, an admin password reset, or
  // an explicit "revoke sessions" action. Embedded in the JWT payload and
  // checked per-request in m_auth.js.
  await updateSchema(`
    IF COL_LENGTH('dbo.users', 'token_version') IS NULL
      ALTER TABLE dbo.users ADD token_version INT NOT NULL CONSTRAINT DF_users_token_version DEFAULT (0);
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
  const includePhone = await hasPhoneColumn();
  const includeTotp = await hasTotpColumns();
  const users = await selectData(
    `
    SELECT
      u.id,
      u.username,
      u.email,
      ${includePhone ? "u.phone" : "NULL AS phone"},
      ${includeTotp ? "u.totp_enabled" : "CAST(0 AS BIT) AS totp_enabled"},
      u.full_name,
      u.is_active,
      u.status,
      u.locked_until,
      u.created_at,
      u.updated_at,
      u.password_hash
    FROM users u
    ORDER BY u.id DESC
    `
  );

  const rolesMap = await listUserRolesMap();
  const now = Date.now();

  return users.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    phone: u.phone ?? null,
    totp_enabled: Number(u.totp_enabled) ? 1 : 0,
    full_name: u.full_name ?? null,
    is_active: u.is_active,
    status: u.status || (Number(u.is_active) ? "ACTIVE" : "DEACTIVATED"),
    is_locked: Boolean(u.locked_until && new Date(u.locked_until).getTime() > now),
    created_at: u.created_at ?? null,
    updated_at: u.updated_at ?? null,
    roles: rolesMap.get(u.id) || [],
  }));
}

async function getUserById(id) {
  const includePhone = await hasPhoneColumn();
  const includeTotp = await hasTotpColumns();
  const rows = await selectData(
    `
    SELECT TOP (1)
      u.id,
      u.username,
      u.email,
      ${includePhone ? "u.phone" : "NULL AS phone"},
      ${includeTotp ? "u.totp_enabled" : "CAST(0 AS BIT) AS totp_enabled"},
      u.full_name,
      u.is_active,
      u.status,
      u.locked_until,
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
    phone: user.phone ?? null,
    totp_enabled: Number(user.totp_enabled) ? 1 : 0,
    full_name: user.full_name ?? null,
    is_active: user.is_active,
    status: user.status || (Number(user.is_active) ? "ACTIVE" : "DEACTIVATED"),
    is_locked: Boolean(user.locked_until && new Date(user.locked_until).getTime() > Date.now()),
    created_at: user.created_at ?? null,
    updated_at: user.updated_at ?? null,
    roles: roles.map((r) => ({ id: r.id, name: r.name, description: r.description ?? null })),
  };
}

async function createUser({ username, email, phone, full_name, password, is_active = 1, role_id }) {
  const active = is_active ? 1 : 0;
  const roleId = toInt(role_id);
  const hashedPassword = await hashPasswordIfNeeded(password);
  const includePhone = await hasPhoneColumn();
  const insertSql = includePhone
    ? `
    INSERT INTO users (username,email,phone,password_hash,full_name,is_active,created_at,updated_at)
    OUTPUT INSERTED.id
    VALUES (@param0,@param1,@param2,@param3,@param4,@param5,GETDATE(),NULL)
    `
    : `
    INSERT INTO users (username,email,password_hash,full_name,is_active,created_at,updated_at)
    OUTPUT INSERTED.id
    VALUES (@param0,@param1,@param2,@param3,@param4,GETDATE(),NULL)
    `;
  const insertParams = includePhone
    ? [username, email, phone, hashedPassword, full_name, active]
    : [username, email, hashedPassword, full_name, active];
  const result = await insertData(
    insertSql,
    insertParams
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

async function updateUser(id, { username, email, phone, full_name, password, is_active, role_id }) {
  const includePhone = await hasPhoneColumn();
  const sets = [];
  const params = [];
  const pushSet = (sqlFrag, value) => {
    sets.push(sqlFrag.replace("?", `@param${params.length}`));
    params.push(value);
  };

  if (username !== undefined) pushSet("username = ?", username);
  if (email !== undefined) pushSet("email = ?", email);
  if (includePhone && phone !== undefined) pushSet("phone = ?", phone);
  if (full_name !== undefined) pushSet("full_name = ?", full_name);
  let passwordChanged = false;
  if (password !== undefined && password !== "") {
    pushSet("password_hash = ?", await hashPasswordIfNeeded(password));
    passwordChanged = true;
  }
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

  // A password reset should force re-authentication everywhere the old one
  // was in use — otherwise a leaked/shared credential's existing session
  // outlives the reset that was meant to shut it down.
  if (passwordChanged) await bumpTokenVersion(id);

  const roleId = toInt(role_id);
  if (roleId) await setUserPrimaryRole(id, roleId);

  return await getUserById(id);
}

async function deactivateUser(id) {
  await updateData(
    `
    UPDATE users
    SET is_active = 0, status = 'DEACTIVATED', updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id]
  );
  await bumpTokenVersion(id);
  return await getUserById(id);
}

async function reactivateUser(id) {
  await updateData(
    `
    UPDATE users
    SET is_active = 1, status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id]
  );
  return await getUserById(id);
}

/** Distinct from deactivation: an admin-imposed, easily-reversed hold — e.g.
 * pending an investigation — rather than a long-term account closure. Blocks
 * login the same way (is_active = 0) but is labeled and audited separately. */
async function suspendUser(id) {
  await updateData(
    `
    UPDATE users
    SET is_active = 0, status = 'SUSPENDED', updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id]
  );
  await bumpTokenVersion(id);
  return await getUserById(id);
}

async function unsuspendUser(id) {
  return reactivateUser(id);
}

async function getTotpRecord(userId) {
  if (!(await hasTotpColumns())) return null;
  const rows = await selectData(
    `
    SELECT TOP (1) u.id, u.username, u.totp_secret, u.totp_enabled
    FROM users u
    WHERE u.id = @param0
    `,
    [userId]
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    totp_secret: row.totp_secret ?? null,
    totp_enabled: Number(row.totp_enabled) ? 1 : 0,
  };
}

async function setTotpSecret(userId, encryptedSecret) {
  await updateData(
    `
    UPDATE users
    SET totp_secret = @param1, totp_enabled = 0, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [userId, encryptedSecret]
  );
  return getTotpRecord(userId);
}

async function enableTotp(userId) {
  await updateData(
    `
    UPDATE users
    SET totp_enabled = 1, updated_at = GETDATE()
    WHERE id = @param0 AND totp_secret IS NOT NULL
    `,
    [userId]
  );
  return getTotpRecord(userId);
}

async function disableTotp(userId) {
  await updateData(
    `
    UPDATE users
    SET totp_secret = NULL, totp_enabled = 0, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [userId]
  );
  return getTotpRecord(userId);
}

/** Login-time lockout check + password fields, in one row read so Auth.js
 * doesn't need a second query. */
async function getLoginLockState(userId) {
  const rows = await selectData(
    `SELECT TOP (1) failed_login_attempts, locked_until, token_version FROM users WHERE id = @param0`,
    [userId]
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    failedAttempts: Number(row.failed_login_attempts || 0),
    lockedUntil: row.locked_until || null,
    tokenVersion: Number(row.token_version || 0),
  };
}

async function registerFailedLogin(userId, maxAttempts, lockoutMinutes) {
  await updateData(
    `
    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1,
        locked_until = CASE
          WHEN failed_login_attempts + 1 >= @param1 THEN DATEADD(MINUTE, @param2, SYSUTCDATETIME())
          ELSE locked_until
        END,
        updated_at = GETDATE()
    WHERE id = @param0
    `,
    [userId, maxAttempts, lockoutMinutes]
  );
}

async function resetFailedLogins(userId) {
  await updateData(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = GETDATE() WHERE id = @param0`,
    [userId]
  );
}

async function bumpTokenVersion(userId) {
  await updateData(`UPDATE users SET token_version = token_version + 1 WHERE id = @param0`, [userId]);
}

/** Session invalidation: forces every JWT issued for this user to fail its
 * next per-request check (m_auth.js), without waiting for the 24h expiry. */
async function revokeSessions(userId) {
  await bumpTokenVersion(userId);
  return getUserById(userId);
}

/** Cheap per-request check backing session invalidation — see m_auth.js. */
async function getSessionCheck(userId) {
  const rows = await selectData(
    `SELECT TOP (1) is_active, token_version FROM users WHERE id = @param0`,
    [userId]
  );
  const row = rows?.[0];
  if (!row) return null;
  return { isActive: Number(row.is_active) === 1, tokenVersion: Number(row.token_version || 0) };
}

module.exports = {
  ensureSchema,
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  suspendUser,
  unsuspendUser,
  getTotpRecord,
  setTotpSecret,
  enableTotp,
  disableTotp,
  getLoginLockState,
  registerFailedLogin,
  resetFailedLogins,
  bumpTokenVersion,
  revokeSessions,
  getSessionCheck,
};

