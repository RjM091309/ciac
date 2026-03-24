const { selectData, updateData } = require("../config/database");

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(value) {
  const raw = String(value ?? "").trim();
  const asNum = Number(raw);
  if (asNum === 2) return 2; // read
  if (asNum === 1) return 1; // unread

  const upper = raw.toUpperCase();
  if (upper === "READ" || upper === "SEEN" || upper === "READ_BY_USER") return 2;
  if (upper === "PENDING" || upper === "UNREAD" || upper === "SENT") return 1;
  return 1;
}

async function listForUser(userId, limit = 50) {
  const uid = toInt(userId);
  const cappedLimit = Math.min(200, Math.max(1, toInt(limit) || 50));
  if (!uid) return [];

  const rows = await selectData(
    `
    SELECT TOP (@param1)
      n.id,
      n.user_id,
      n.channel,
      n.subject,
      n.body,
      n.status,
      n.error_message,
      n.created_by,
      n.updated_by,
      n.created_at,
      n.updated_at
    FROM dbo.notifications n
    WHERE n.user_id = @param0
    ORDER BY n.created_at DESC, n.id DESC
    `,
    [uid, cappedLimit]
  );

  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    channel: row.channel ?? null,
    subject: row.subject ?? null,
    body: row.body ?? null,
    status: normalizeStatus(row.status),
    error_message: row.error_message ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  }));
}

async function markAsRead(id, userId) {
  const notificationId = toInt(id);
  const uid = toInt(userId);
  if (!notificationId || !uid) return false;

  await updateData(
    `
    UPDATE dbo.notifications
    SET
      status = 2,
      updated_by = @param2,
      updated_at = SYSUTCDATETIME()
    WHERE id = @param0
      AND user_id = @param1
    `,
    [notificationId, uid, uid]
  );

  const rows = await selectData(
    `
    SELECT TOP (1) id
    FROM dbo.notifications
    WHERE id = @param0
      AND user_id = @param1
      AND (
        TRY_CONVERT(INT, status) = 2
        OR UPPER(LTRIM(RTRIM(CONVERT(NVARCHAR(20), ISNULL(status, ''))))) = 'READ'
      )
    `,
    [notificationId, uid]
  );
  return Boolean(rows?.[0]);
}

async function markAllAsRead(userId) {
  const uid = toInt(userId);
  if (!uid) return;

  await updateData(
    `
    UPDATE dbo.notifications
    SET
      status = 2,
      updated_by = @param1,
      updated_at = SYSUTCDATETIME()
    WHERE user_id = @param0
      AND (
        TRY_CONVERT(INT, status) IS NULL
        OR TRY_CONVERT(INT, status) <> 2
      )
    `,
    [uid, uid]
  );
}

module.exports = {
  listForUser,
  markAsRead,
  markAllAsRead,
};
