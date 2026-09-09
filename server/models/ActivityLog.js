const { selectData, insertData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.activity_log', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.activity_log (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        actor_user_id INT NULL,
        proponent_id INT NULL,
        entity_type NVARCHAR(30) NOT NULL,
        entity_id INT NULL,
        action NVARCHAR(60) NOT NULL,
        meta NVARCHAR(MAX) NULL,
        ip NVARCHAR(64) NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_activity_log_created_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_activity_log_proponent_id ON dbo.activity_log(proponent_id);
      CREATE INDEX IX_activity_log_actor_user_id ON dbo.activity_log(actor_user_id);
      CREATE INDEX IX_activity_log_created_at ON dbo.activity_log(created_at);
    END
  `);
}

let schemaReady = null;
async function ready() {
  if (!schemaReady) schemaReady = ensureSchema().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

/**
 * Fire-and-forget audit entry. Never throws — a logging failure must not break
 * the action it records.
 */
async function record({ actorUserId, proponentId, entityType, entityId, action, meta, ip }) {
  try {
    await ready();
    await insertData(
      `
      INSERT INTO dbo.activity_log (actor_user_id, proponent_id, entity_type, entity_id, action, meta, ip, created_at)
      VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, SYSUTCDATETIME())
      `,
      [
        toInt(actorUserId),
        toInt(proponentId),
        String(entityType || "SYSTEM").toUpperCase().slice(0, 30),
        toInt(entityId),
        String(action || "UNKNOWN").toUpperCase().slice(0, 60),
        meta == null ? null : JSON.stringify(meta),
        ip ? String(ip).slice(0, 64) : null,
      ]
    );
  } catch (error) {
    console.error("ActivityLog.record failed:", error?.message || error);
  }
}

/** Convenience wrapper for controllers holding an Express req. */
function recordFromReq(req, { proponentId, entityType, entityId, action, meta }) {
  return record({
    actorUserId: req?.user?.id ?? null,
    proponentId: proponentId ?? req?.proponent?.id ?? null,
    entityType,
    entityId,
    action,
    meta,
    ip: req?.ip || req?.connection?.remoteAddress || null,
  });
}

async function listForProponent(proponentId, userId, { limit = 30, cursor } = {}) {
  await ready();
  const capped = Math.min(100, Math.max(1, toInt(limit) || 30));
  const beforeId = toInt(cursor);
  const params = [toInt(proponentId), toInt(userId)];
  if (beforeId) params.push(beforeId);
  const rows = await selectData(
    `
    SELECT TOP (${capped})
      a.id, a.actor_user_id, a.proponent_id, a.entity_type, a.entity_id,
      a.action, a.meta, a.created_at,
      u.username AS actor_username
    FROM dbo.activity_log a
    LEFT JOIN dbo.users u ON u.id = a.actor_user_id
    WHERE (
        (@param0 IS NOT NULL AND a.proponent_id = @param0)
        OR (@param1 IS NOT NULL AND a.actor_user_id = @param1)
      )
      ${beforeId ? "AND a.id < @param2" : ""}
    ORDER BY a.id DESC
    `,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    actor_user_id: r.actor_user_id ?? null,
    actor_username: r.actor_username ?? null,
    entity_type: r.entity_type,
    entity_id: r.entity_id ?? null,
    action: r.action,
    meta: (() => {
      try {
        return r.meta ? JSON.parse(r.meta) : null;
      } catch {
        return null;
      }
    })(),
    created_at: r.created_at ?? null,
  }));
}

module.exports = {
  ensureSchema,
  record,
  recordFromReq,
  listForProponent,
};
