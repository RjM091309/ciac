const crypto = require("crypto");
const { selectData, insertData, updateSchema } = require("../config/database");
const AuditLog = require("./AuditLog");

// One row per sign-in, so the audit log can say how long a session lasted
// and how it ended — including the two endings nobody clicks: the JWT
// running out (24h), and an admin/system action invalidating it (password
// reset, deactivation, "sign out of all devices" — all of which bump
// users.token_version). Neither of those produces a request the server
// could log at the moment it happens, so sweep() below finds them after
// the fact. Tracking only: whether a request is allowed is still decided by
// the JWT and token_version check in m_auth.js, not by this table.

async function createSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.user_sessions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.user_sessions (
        id NVARCHAR(36) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        username NVARCHAR(100) NULL,
        token_version INT NOT NULL CONSTRAINT DF_user_sessions_token_version DEFAULT (0),
        ip_address NVARCHAR(45) NULL,
        user_agent NVARCHAR(512) NULL,
        started_at DATETIME2(3) NOT NULL CONSTRAINT DF_user_sessions_started_at DEFAULT (SYSUTCDATETIME()),
        last_seen_at DATETIME2(3) NULL,
        expires_at DATETIME2(3) NOT NULL,
        ended_at DATETIME2(3) NULL,
        end_reason NVARCHAR(20) NULL
      );
    END
  `);
  await updateSchema(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_user_sessions_open' AND object_id = OBJECT_ID('dbo.user_sessions'))
      CREATE INDEX IX_user_sessions_open ON dbo.user_sessions(ended_at, expires_at);
  `);
}

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

function newSessionId() {
  return crypto.randomUUID();
}

function secondsBetween(from, to) {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
}

/** Best-effort like AuditLog.record: a tracking failure must never block a
 * sign-in. */
async function start({ id, userId, username, tokenVersion, expiresAt, ipAddress, userAgent }) {
  try {
    await ensureSchema();
    await insertData(
      `
      INSERT INTO dbo.user_sessions
        (id, user_id, username, token_version, ip_address, user_agent, started_at, last_seen_at, expires_at)
      VALUES
        (@param0, @param1, @param2, @param3, @param4, @param5, SYSUTCDATETIME(), SYSUTCDATETIME(), @param6)
      `,
      [
        id,
        userId,
        username ?? null,
        Number(tokenVersion) || 0,
        ipAddress ?? null,
        userAgent ? String(userAgent).slice(0, 512) : null,
        expiresAt,
      ]
    );
  } catch (error) {
    console.error("Session start write failed:", error);
  }
}

// last_seen_at is written at most once per TOUCH_INTERVAL_MS per session —
// often enough to say roughly when someone was last active, without a DB
// write on every API call.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastTouched = new Map();

function touch(id) {
  if (!id) return;
  const now = Date.now();
  const last = lastTouched.get(id);
  if (last && now - last < TOUCH_INTERVAL_MS) return;
  lastTouched.set(id, now);
  if (lastTouched.size > 5000) {
    for (const [key, at] of lastTouched) {
      if (now - at > TOUCH_INTERVAL_MS) lastTouched.delete(key);
    }
  }
  ensureSchema()
    .then(() =>
      insertData(
        `UPDATE dbo.user_sessions SET last_seen_at = SYSUTCDATETIME() WHERE id = @param0 AND ended_at IS NULL`,
        [id]
      )
    )
    .catch((error) => console.error("Session touch failed:", error.message));
}

/** Closes one session (sign-out). Returns { durationSeconds } or null when
 * the session isn't tracked / already closed. */
async function end(id, reason) {
  if (!id) return null;
  try {
    await ensureSchema();
    const rows = await selectData(
      `
      UPDATE dbo.user_sessions
      SET ended_at = SYSUTCDATETIME(), end_reason = @param1
      OUTPUT inserted.started_at, inserted.ended_at
      WHERE id = @param0 AND ended_at IS NULL
      `,
      [id, reason]
    );
    lastTouched.delete(id);
    const row = rows?.[0];
    return row ? { durationSeconds: secondsBetween(row.started_at, row.ended_at) } : null;
  } catch (error) {
    console.error("Session end write failed:", error);
    return null;
  }
}

/**
 * Closes sessions that ended without a sign-out and writes one audit entry
 * for each:
 *  - SESSION_EXPIRED: the 24h JWT ran out. ended_at is the real expiry time.
 *  - SESSION_REVOKED: the account's token_version moved on (password reset,
 *    deactivation, suspension, "sign out of all devices") or the account is
 *    gone/inactive. ended_at is when this sweep noticed, so it can trail the
 *    real moment by up to one sweep interval.
 */
async function sweep() {
  await ensureSchema();

  const expired = await selectData(
    `
    UPDATE dbo.user_sessions
    SET ended_at = expires_at, end_reason = 'expired'
    OUTPUT inserted.*
    WHERE ended_at IS NULL AND expires_at <= SYSUTCDATETIME()
    `
  );
  const revoked = await selectData(
    `
    UPDATE s
    SET ended_at = SYSUTCDATETIME(), end_reason = 'revoked'
    OUTPUT inserted.*, CAST(CASE WHEN u.id IS NULL OR u.is_active = 0 THEN 1 ELSE 0 END AS BIT) AS account_inactive
    FROM dbo.user_sessions s
    LEFT JOIN dbo.users u ON u.id = s.user_id
    WHERE s.ended_at IS NULL
      AND (u.id IS NULL OR u.is_active = 0 OR u.token_version <> s.token_version)
    `
  );

  for (const row of [...(expired || []), ...(revoked || [])]) {
    lastTouched.delete(row.id);
    await AuditLog.record({
      actorId: row.user_id,
      actorUsername: row.username,
      action: row.end_reason === "expired" ? "SESSION_EXPIRED" : "SESSION_REVOKED",
      entityType: "user",
      entityId: row.user_id,
      sessionId: row.id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      details: {
        username: row.username,
        started_at: row.started_at,
        ended_at: row.ended_at,
        duration_seconds: secondsBetween(row.started_at, row.ended_at),
        last_seen_at: row.last_seen_at,
        active_seconds: secondsBetween(row.started_at, row.last_seen_at),
        account_inactive: row.account_inactive ? true : undefined,
      },
    });
  }
  return (expired?.length || 0) + (revoked?.length || 0);
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let sweepTimer = null;

function startSweeper() {
  if (sweepTimer) return;
  const run = () =>
    sweep().catch((error) => console.error("Session sweep failed:", error.message));
  run();
  sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

module.exports = { ensureSchema, newSessionId, start, touch, end, sweep, startSweeper };
