const { selectData, insertData, updateSchema } = require("../config/database");

// TOR items 10-12: a single append-only trail for security-relevant events
// across the app (logins, account changes, permission changes), distinct
// from application_status_history (which only covers application workflow)
// and Notification (user-facing inbox, not a compliance record).
//
// dbo.audit_logs already existed in this database (user_id, action,
// entity_type, entity_id, metadata_json, ip_address, created_at) — unused by
// any code in this repo, but clearly provisioned for exactly this purpose,
// so this model writes into it rather than creating a second, parallel
// table. actor_username is the one column it was missing (useful for a
// failed-login attempt against a username that never resolves to a user_id).
async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.audit_logs', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.audit_logs (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NULL,
        action NVARCHAR(100) NOT NULL,
        entity_type NVARCHAR(50) NULL,
        entity_id INT NULL,
        metadata_json NVARCHAR(MAX) NULL,
        ip_address NVARCHAR(45) NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_audit_logs_created_at DEFAULT (SYSUTCDATETIME())
      );
    END
  `);
  await updateSchema(`
    IF COL_LENGTH('dbo.audit_logs', 'actor_username') IS NULL
      ALTER TABLE dbo.audit_logs ADD actor_username NVARCHAR(100) NULL;
  `);
  await updateSchema(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_logs_created_at' AND object_id = OBJECT_ID('dbo.audit_logs'))
      CREATE INDEX IX_audit_logs_created_at ON dbo.audit_logs(created_at DESC);
  `);
  await updateSchema(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_logs_action' AND object_id = OBJECT_ID('dbo.audit_logs'))
      CREATE INDEX IX_audit_logs_action ON dbo.audit_logs(action);
  `);
}

function toIntOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fire-and-forget by design: a logging failure must never block the action
 * being logged (a failed audit write shouldn't stop someone from logging in
 * or an admin from saving a record). Callers `await` this only to keep
 * ordering predictable in tests; errors are swallowed here, not rethrown. */
async function record({ actorId, actorUsername, action, entityType, entityId, details, ipAddress }) {
  try {
    await ensureSchema();
    await insertData(
      `
      INSERT INTO dbo.audit_logs
        (user_id, actor_username, action, entity_type, entity_id, metadata_json, ip_address, created_at)
      VALUES
        (@param0, @param1, @param2, @param3, @param4, @param5, @param6, SYSUTCDATETIME())
      `,
      [
        toIntOrNull(actorId),
        actorUsername ?? null,
        String(action || "").slice(0, 100),
        entityType ?? null,
        toIntOrNull(entityId),
        details ? JSON.stringify(details) : null,
        ipAddress ?? null,
      ]
    );
  } catch (error) {
    console.error("Audit log write failed:", error);
  }
}

async function list({ actor, action, from, to, limit = 50, offset = 0 } = {}) {
  await ensureSchema();
  const where = [];
  const params = [];
  const push = (frag, value) => {
    where.push(frag.replace("?", `@param${params.length}`));
    params.push(value);
  };

  if (actor) push("(actor_username LIKE '%' + ? + '%')", actor);
  if (action) push("action = ?", action);
  if (from) push("created_at >= ?", from);
  if (to) push("created_at <= ?", to);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const rows = await selectData(
    `
    SELECT id, user_id AS actor_id, actor_username, action, entity_type, entity_id, metadata_json, ip_address, created_at
    FROM dbo.audit_logs
    ${whereSql}
    ORDER BY id DESC
    OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY
    `,
    params
  );

  const countRows = await selectData(
    `SELECT COUNT(1) AS total FROM dbo.audit_logs ${whereSql}`,
    params
  );

  const mapped = rows.map((r) => ({
    id: r.id,
    actor_id: r.actor_id,
    actor_username: r.actor_username,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    details: r.metadata_json ? JSON.parse(r.metadata_json) : null,
    ip_address: r.ip_address,
    created_at: r.created_at,
  }));

  await backfillEntityNames(mapped);

  return {
    rows: mapped,
    total: Number(countRows?.[0]?.total || 0),
  };
}

const ROLE_ENTITY_TYPES = ["role", "role_sidebar_menu", "role_menu_crud", "role_dashboard_widgets"];

/** Rows written before their call site started passing a real name in
 * `details` (or any future call site that forgets to) fall back to showing
 * "user #12" / "role #3" in the Details column — this resolves the actual
 * current username/role name straight from entity_id at read time instead,
 * so the Details column never has to show a raw database id even for old
 * rows already sitting in audit_logs. Mutates `rows` in place. */
async function backfillEntityNames(rows) {
  const userIds = new Set();
  const roleIds = new Set();
  for (const r of rows) {
    if (r.entity_id == null || !Number.isFinite(Number(r.entity_id))) continue;
    if (r.entity_type === "user" && !r.details?.username) userIds.add(Number(r.entity_id));
    if (ROLE_ENTITY_TYPES.includes(r.entity_type) && !r.details?.name) roleIds.add(Number(r.entity_id));
  }
  if (!userIds.size && !roleIds.size) return;

  const [userRows, roleRows] = await Promise.all([
    userIds.size ? selectData(`SELECT id, username FROM users WHERE id IN (${[...userIds].join(",")})`) : [],
    roleIds.size ? selectData(`SELECT id, name FROM roles WHERE id IN (${[...roleIds].join(",")})`) : [],
  ]);
  const usernameById = new Map(userRows.map((u) => [u.id, u.username]));
  const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]));

  for (const r of rows) {
    if (r.entity_id == null) continue;
    const id = Number(r.entity_id);
    if (r.entity_type === "user" && !r.details?.username && usernameById.has(id)) {
      r.details = { ...(r.details || {}), username: usernameById.get(id) };
    }
    if (ROLE_ENTITY_TYPES.includes(r.entity_type) && !r.details?.name && roleNameById.has(id)) {
      r.details = { ...(r.details || {}), name: roleNameById.get(id) };
    }
  }
}

async function listDistinctActions() {
  await ensureSchema();
  const rows = await selectData(`SELECT DISTINCT action FROM dbo.audit_logs ORDER BY action ASC`);
  return rows.map((r) => r.action);
}

module.exports = { ensureSchema, record, list, listDistinctActions };
