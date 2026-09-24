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
async function createSchema() {
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
    IF COL_LENGTH('dbo.audit_logs', 'user_agent') IS NULL
      ALTER TABLE dbo.audit_logs ADD user_agent NVARCHAR(512) NULL;
  `);
  // The sign-in session (UserSession.js) the action happened in.
  await updateSchema(`
    IF COL_LENGTH('dbo.audit_logs', 'session_id') IS NULL
      ALTER TABLE dbo.audit_logs ADD session_id NVARCHAR(36) NULL;
  `);
  await updateSchema(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_logs_session_id' AND object_id = OBJECT_ID('dbo.audit_logs'))
      CREATE INDEX IX_audit_logs_session_id ON dbo.audit_logs(session_id) WHERE session_id IS NOT NULL;
  `);
  await updateSchema(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_logs_entity' AND object_id = OBJECT_ID('dbo.audit_logs'))
      CREATE INDEX IX_audit_logs_entity ON dbo.audit_logs(entity_type, entity_id);
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

// The schema checks only need to run once per process, not on every write.
// Cleared on failure so the next call retries (e.g. the DB was still down).
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = createSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/** "::ffff:45.32.119.62" is just how Node reports an IPv4 client on a
 * dual-stack socket — store the plain IPv4 form. */
function normalizeIp(ip) {
  if (!ip) return null;
  const s = String(ip).trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  return (mapped ? mapped[1] : s).slice(0, 45) || null;
}

function toIntOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fire-and-forget by design: a logging failure must never block the action
 * being logged (a failed audit write shouldn't stop someone from logging in
 * or an admin from saving a record). Callers `await` this only to keep
 * ordering predictable in tests; errors are swallowed here, not rethrown.
 *
 * Pass `req` and the client IP, browser user agent and sign-in session are
 * taken from it; `ipAddress` / `userAgent` / `sessionId` override those when
 * there's no request (or, at sign-in, before req.user exists). */
async function record({
  actorId,
  actorUsername,
  action,
  entityType,
  entityId,
  details,
  req,
  ipAddress,
  userAgent,
  sessionId,
}) {
  try {
    const ip = normalizeIp(ipAddress ?? req?.ip ?? req?.socket?.remoteAddress);
    const ua = userAgent ?? req?.get?.("user-agent") ?? null;
    const sid = sessionId ?? req?.user?.sid ?? null;
    await ensureSchema();
    await insertData(
      `
      INSERT INTO dbo.audit_logs
        (user_id, actor_username, action, entity_type, entity_id, metadata_json, ip_address, user_agent, session_id, created_at)
      VALUES
        (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, @param8, SYSUTCDATETIME())
      `,
      [
        toIntOrNull(actorId),
        actorUsername ?? null,
        String(action || "").slice(0, 100),
        entityType ?? null,
        toIntOrNull(entityId),
        details ? JSON.stringify(details) : null,
        ip,
        ua ? String(ua).slice(0, 512) : null,
        sid ? String(sid).slice(0, 36) : null,
      ]
    );
  } catch (error) {
    console.error("Audit log write failed:", error);
  }
}

/** Logs someone opening a stored file. `?view=1` requests open it inline in
 * the browser (DOCUMENT_VIEWED / CERTIFICATE_VIEWED); anything else is a
 * download (…_DOWNLOADED). A browser's PDF viewer can fetch one file as
 * several byte-range requests, so only the first request (no Range header, or
 * one starting at byte 0) is logged — one view, one entry. Not awaited by
 * callers: the file shouldn't wait on the log write. */
function recordFileAccess(req, { kind, entityType, entityId, details }) {
  const range = req.get?.("range");
  if (range && !/^bytes=0-/i.test(String(range).trim())) return Promise.resolve();
  const viewed = req.query?.view === "1";
  return record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action: `${kind}_${viewed ? "VIEWED" : "DOWNLOADED"}`,
    entityType,
    entityId,
    details,
    req,
  });
}

/** Failed sign-ins for this username/email in the last `minutes` — counted
 * from the audit trail itself, so it covers names that don't match any
 * account too (the per-account lockout counter only exists for real users). */
async function countRecentLoginFailures(username, minutes = 15) {
  if (!username) return 0;
  try {
    await ensureSchema();
    const rows = await selectData(
      `
      SELECT COUNT(1) AS total
      FROM dbo.audit_logs
      WHERE action = 'LOGIN_FAILED'
        AND actor_username = @param0
        AND created_at >= DATEADD(MINUTE, -@param1, SYSUTCDATETIME())
      `,
      [String(username), Number(minutes)]
    );
    return Number(rows?.[0]?.total || 0);
  } catch (error) {
    console.error("Audit log failure count failed:", error);
    return 0;
  }
}

// Broad groups for the Audit Log's Category filter. First match wins, so
// every action lands in exactly one group; anything not matched earlier
// (applications, assessment, approval, permits, inspections…) is workflow.
const CATEGORY_RULES = [
  ["auth", /^(LOGIN_|LOGOUT$|SESSION_|PASSWORD_RESET_|USER_PASSWORD_SELF_CHANGE$)/],
  ["access", /^(DOCUMENT_VIEWED|DOCUMENT_DOWNLOADED|CERTIFICATE_VIEWED|CERTIFICATE_DOWNLOADED|REPORT_EXPORTED|AUDIT_LOG_EXPORTED)$/],
  ["accounts", /^(USER_|ROLE_|PERMISSIONS_)/],
  ["locators", /^PROPONENT_/],
  [
    "maintenance",
    /^(REQUIREMENT_(CREATED|UPDATED|DEACTIVATED|REACTIVATED)$|REQUIREMENT_CATEGORY_|COMPLIANCE_TYPE_|INSPECTION_TYPE_|APPLICATION_TYPE_|DEPARTMENT_|BUILDING_|LAND_USE_|TYPE_OF_CONTRACT_)/,
  ],
];
const CATEGORIES = [...CATEGORY_RULES.map(([name]) => name), "workflow"];

function categoryOf(action) {
  for (const [name, pattern] of CATEGORY_RULES) {
    if (pattern.test(action)) return name;
  }
  return "workflow";
}

const ROLE_ENTITY_TYPES = ["role", "role_sidebar_menu", "role_menu_crud", "role_dashboard_widgets"];

/** Makes user input literal inside LIKE: %, _ and [ are wildcards there. */
function escapeLike(value) {
  return String(value).replace(/[[%_]/g, (ch) => `[${ch}]`);
}

/** WHERE clause shared by the page listing and the CSV export. */
async function buildWhere({ q, qActions, user, action, category, entityType, entityId, session, from, to } = {}) {
  const where = [];
  const params = [];
  // Every "?" in a fragment refers to the same value.
  const push = (frag, value) => {
    where.push(frag.replace(/\?/g, `@param${params.length}`));
    params.push(value);
  };

  // Page-wide search: who, what, where from, and anything recorded in the
  // details (names, file names, application/permit numbers, remarks…).
  // Action and record-type codes also match with spaces for underscores, so
  // "login failed" finds LOGIN_FAILED. `qActions` are the action codes whose
  // on-screen label matched on the page ("Locator updated" →
  // PROPONENT_UPDATED), since those labels only exist in the frontend.
  if (q) {
    const term = escapeLike(q);
    const matches = [
      "actor_username LIKE '%' + ? + '%'",
      "action LIKE '%' + ? + '%'",
      "REPLACE(action, '_', ' ') LIKE '%' + ? + '%'",
      "entity_type LIKE '%' + ? + '%'",
      "REPLACE(entity_type, '_', ' ') LIKE '%' + ? + '%'",
      "ip_address LIKE '%' + ? + '%'",
      "user_agent LIKE '%' + ? + '%'",
      "metadata_json LIKE '%' + ? + '%'",
      "session_id LIKE ? + '%'",
    ];
    const labelActions = String(qActions || "")
      .split(",")
      .map((a) => a.trim())
      .filter((a) => /^[A-Z_]{1,100}$/.test(a))
      .slice(0, 50);
    const actionIn = labelActions.map((a) => `'${a}'`).join(", ");
    push(`(${matches.join(" OR ")}${actionIn ? ` OR action IN (${actionIn})` : ""})`, term);
  }
  // Exact username — the "All activity by this user" drill-down.
  if (user) push("actor_username = ?", user);
  if (action) push("action = ?", action);
  if (category && CATEGORIES.includes(category)) {
    const actions = (await listDistinctActions()).filter((a) => categoryOf(a) === category);
    if (actions.length === 0) {
      where.push("1 = 0");
    } else {
      const placeholders = actions.map((a) => {
        params.push(a);
        return `@param${params.length - 1}`;
      });
      where.push(`action IN (${placeholders.join(", ")})`);
    }
  }
  if (entityType) {
    if (entityType === "role") {
      where.push(`entity_type IN (${ROLE_ENTITY_TYPES.map((t) => `'${t}'`).join(", ")})`);
    } else {
      push("entity_type = ?", entityType);
    }
    const id = toIntOrNull(entityId);
    if (id != null) push("entity_id = ?", id);
  }
  if (session) push("session_id = ?", session);
  if (from) push("created_at >= ?", from);
  if (to) push("created_at <= ?", to);

  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

function mapRow(r) {
  return {
    id: r.id,
    actor_id: r.actor_id,
    actor_username: r.actor_username,
    action: r.action,
    category: categoryOf(r.action),
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    details: r.metadata_json ? JSON.parse(r.metadata_json) : null,
    ip_address: normalizeIp(r.ip_address),
    user_agent: r.user_agent ?? null,
    session_id: r.session_id ?? null,
    created_at: r.created_at,
  };
}

const SELECT_COLUMNS = `id, user_id AS actor_id, actor_username, action, entity_type, entity_id, metadata_json, ip_address, user_agent, session_id, created_at`;

async function list(filters = {}) {
  await ensureSchema();
  const { limit = 50, offset = 0 } = filters;
  const { whereSql, params } = await buildWhere(filters);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const rows = await selectData(
    `
    SELECT ${SELECT_COLUMNS}
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

  const mapped = rows.map(mapRow);
  await backfillEntityNames(mapped);

  return {
    rows: mapped,
    total: Number(countRows?.[0]?.total || 0),
  };
}

const EXPORT_MAX_ROWS = 5000;

/** Every row matching the filters (newest first, capped at EXPORT_MAX_ROWS)
 * for the CSV download. `total` is the full match count, so the caller can
 * tell when the cap cut the export short. */
async function listForExport(filters = {}) {
  await ensureSchema();
  const { whereSql, params } = await buildWhere(filters);
  const rows = await selectData(
    `
    SELECT TOP (${EXPORT_MAX_ROWS}) ${SELECT_COLUMNS}
    FROM dbo.audit_logs
    ${whereSql}
    ORDER BY id DESC
    `,
    params
  );
  const countRows = await selectData(`SELECT COUNT(1) AS total FROM dbo.audit_logs ${whereSql}`, params);
  const mapped = rows.map(mapRow);
  await backfillEntityNames(mapped);
  return { rows: mapped, total: Number(countRows?.[0]?.total || 0), limit: EXPORT_MAX_ROWS };
}

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

module.exports = {
  ensureSchema,
  normalizeIp,
  record,
  recordFileAccess,
  countRecentLoginFailures,
  list,
  listForExport,
  listDistinctActions,
  categoryOf,
  CATEGORIES,
};
