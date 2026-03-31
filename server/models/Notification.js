const { selectData, insertData, updateData, updateSchema } = require("../config/database");
const { publishToUser } = require("../lib/notificationStream");

function toInt(value) {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
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

function normalizeEventType(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (
    raw === "application_status" ||
    raw === "requirement" ||
    raw === "document" ||
    raw === "inspection" ||
    raw === "compliance" ||
    raw === "assessment" ||
    raw === "contract"
  ) {
    return raw;
  }
  return "application_status";
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.notifications', 'U') IS NOT NULL
    BEGIN
      IF COL_LENGTH('dbo.notifications', 'application_id') IS NULL
        ALTER TABLE dbo.notifications ADD application_id INT NULL;

      IF COL_LENGTH('dbo.notifications', 'event_type') IS NULL
        ALTER TABLE dbo.notifications ADD event_type NVARCHAR(50) NULL;
    END;
  `);
}

async function getApplicationContext(applicationId) {
  const appId = toInt(applicationId);
  if (!appId) return null;
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      a.id,
      a.proponent_id,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.status,
      a.current_officer_id,
      a.created_by,
      a.updated_by
    FROM dbo.applications a
    WHERE a.id = @param0
    `,
    [appId]
  );
  return rows?.[0] || null;
}

async function resolveApplicationRecipients(application, actorId) {
  const recipients = new Set();
  const createdBy = toInt(application?.created_by);
  const assignedOfficerId = toInt(application?.current_officer_id);
  const proponentId = toInt(application?.proponent_id);
  const normalizedActorId = toInt(actorId);

  if (createdBy) recipients.add(createdBy);
  if (assignedOfficerId) recipients.add(assignedOfficerId);

  if (proponentId) {
    const proponentRows = await selectData(
      `
      SELECT TOP (1) user_id
      FROM dbo.proponents
      WHERE id = @param0
      `,
      [proponentId]
    );
    const proponentUserId = toInt(proponentRows?.[0]?.user_id);
    if (proponentUserId) recipients.add(proponentUserId);
  }

  const adminAndOfficerRows = await selectData(
    `
    SELECT DISTINCT u.id
    FROM dbo.users u
    INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
    INNER JOIN dbo.roles r ON r.id = ur.role_id
    WHERE u.is_active = 1
      AND LOWER(LTRIM(RTRIM(r.name))) IN ('admin', 'administrator', 'officer', 'account officer')
    `
  );

  for (const row of adminAndOfficerRows) {
    const userId = toInt(row?.id);
    if (userId) recipients.add(userId);
  }

  if (normalizedActorId) recipients.add(normalizedActorId);
  return Array.from(recipients);
}

async function createNotification({
  userId,
  channel = "IN_APP",
  subject,
  body,
  status = 1,
  errorMessage = null,
  createdBy = null,
  updatedBy = null,
  applicationId = null,
  eventType = null,
}) {
  const recipientUserId = toInt(userId);
  if (!recipientUserId) return;
  await ensureSchema();
  await insertData(
    `
    INSERT INTO dbo.notifications
      (user_id, channel, subject, body, status, error_message, created_by, updated_by, created_at, updated_at, application_id, event_type)
    VALUES
      (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, SYSUTCDATETIME(), NULL, @param8, @param9)
    `,
    [
      recipientUserId,
      String(channel || "IN_APP").trim(),
      String(subject || "").trim(),
      body == null ? null : String(body),
      toInt(status) || 1,
      errorMessage ?? null,
      toInt(createdBy),
      toInt(updatedBy),
      toInt(applicationId),
      eventType ? normalizeEventType(eventType) : null,
    ]
  );

  publishToUser(recipientUserId, {
    type: "notification_created",
    application_id: toInt(applicationId),
    event_type: eventType ? normalizeEventType(eventType) : null,
  });
}

async function createApplicationScopedNotifications({
  applicationId,
  actorId,
  eventType,
  subject,
  body,
}) {
  const application = await getApplicationContext(applicationId);
  if (!application) return;
  const recipients = await resolveApplicationRecipients(application, actorId);
  for (const recipientUserId of recipients) {
    try {
      await createNotification({
        userId: recipientUserId,
        subject,
        body,
        status: 1,
        createdBy: actorId,
        applicationId: application.id,
        eventType,
      });
    } catch (error) {
      console.error("Create scoped notification error:", {
        applicationId: application.id,
        recipientUserId,
        eventType: eventType ? normalizeEventType(eventType) : null,
        message: error?.message || String(error),
      });
    }
  }
}

async function listForUser(userId, limit = 50) {
  const uid = toInt(userId);
  const cappedLimit = Math.min(200, Math.max(1, toInt(limit) || 50));
  if (!uid) return [];
  await ensureSchema();

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
      n.updated_at,
      n.application_id,
      n.event_type,
      a.application_no,
      a.is_renewal AS application_is_renewal
    FROM dbo.notifications n
    LEFT JOIN dbo.applications a ON a.id = n.application_id
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
    application_id: row.application_id ?? null,
    application_no: row.application_no ?? null,
    application_is_renewal: row.application_is_renewal ?? null,
    event_type: normalizeEventType(row.event_type),
  }));
}

async function markAsRead(id, userId) {
  const notificationId = toInt(id);
  const uid = toInt(userId);
  if (!notificationId || !uid) return false;
  await ensureSchema();

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
  const updated = Boolean(rows?.[0]);
  if (updated) {
    publishToUser(uid, {
      type: "notification_read",
      notification_id: notificationId,
    });
  }
  return updated;
}

async function markAllAsRead(userId) {
  const uid = toInt(userId);
  if (!uid) return;
  await ensureSchema();

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

  publishToUser(uid, {
    type: "notifications_read_all",
  });
}

module.exports = {
  ensureSchema,
  getApplicationContext,
  createNotification,
  createApplicationScopedNotifications,
  listForUser,
  markAsRead,
  markAllAsRead,
};
