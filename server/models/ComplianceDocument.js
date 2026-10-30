const { selectData, insertData, updateData, updateSchema } = require("../config/database");
const ComplianceRequirement = require("./ComplianceRequirement");
const ControlPanelPermission = require("./ControlPanelPermission");
const Notification = require("./Notification");

// Files a locator uploads against a compliance requirement (Insurance, AFS,
// GIS, permits…) from the portal's Compliance page. Every upload is kept —
// a renewal adds a new row instead of replacing the old one — so expired
// and superseded documents stay on file as history.
//
// Review happens on the locator's checklist row (locator_compliance_items):
// the Compliance Officer marks it Complied / Not complied, which also stamps
// the latest submitted file ACCEPTED / REJECTED (see applyReview).

const REVIEW_MENU_KEY = "compliance:inspections";

let schemaReady = null;

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function clientError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function readDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw clientError(`${label} must be a valid date.`);
  }
  return s;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF OBJECT_ID('dbo.locator_compliance_documents', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.locator_compliance_documents (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          proponent_id INT NOT NULL,
          item_code NVARCHAR(40) NOT NULL,
          file_name NVARCHAR(260) NOT NULL,
          original_file_name NVARCHAR(260) NULL,
          storage_path NVARCHAR(1000) NOT NULL,
          content_type NVARCHAR(255) NULL,
          file_size_bytes BIGINT NULL,
          validity_from DATE NULL,
          validity_to DATE NULL,
          -- SUBMITTED (awaiting review) / ACCEPTED / REJECTED
          status NVARCHAR(20) NOT NULL CONSTRAINT DF_locator_compliance_documents_status DEFAULT ('SUBMITTED'),
          review_remarks NVARCHAR(2000) NULL,
          uploaded_by INT NULL,
          uploaded_at DATETIME2(3) NOT NULL CONSTRAINT DF_locator_compliance_documents_uploaded_at DEFAULT (SYSUTCDATETIME()),
          reviewed_by INT NULL,
          reviewed_at DATETIME2(3) NULL,
          CONSTRAINT FK_locator_compliance_documents_proponent FOREIGN KEY (proponent_id)
            REFERENCES dbo.proponents(id) ON DELETE CASCADE
        );
        CREATE INDEX IX_locator_compliance_documents_item
          ON dbo.locator_compliance_documents(proponent_id, item_code, id);
      END
    `).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const SELECT = `
  SELECT
    d.id, d.proponent_id, d.item_code, d.file_name, d.original_file_name, d.storage_path,
    d.content_type, d.file_size_bytes, d.validity_from, d.validity_to, d.status,
    d.review_remarks, d.uploaded_by, d.uploaded_at, d.reviewed_by, d.reviewed_at,
    uu.full_name AS uploaded_by_name, ru.full_name AS reviewed_by_name,
    -- 1 = the locator uploaded it from the portal; 0 = staff uploaded it for them.
    CASE WHEN p.user_id IS NOT NULL AND d.uploaded_by = p.user_id THEN 1 ELSE 0 END AS uploaded_by_locator
  FROM dbo.locator_compliance_documents d
  LEFT JOIN dbo.proponents p ON p.id = d.proponent_id
  LEFT JOIN dbo.users uu ON uu.id = d.uploaded_by
  LEFT JOIN dbo.users ru ON ru.id = d.reviewed_by
`;

/** Every document a locator uploaded, newest first (optionally one item). */
async function listForProponent(proponentId, itemCode = null) {
  await ensureSchema();
  const params = [toInt(proponentId)];
  let where = "d.proponent_id = @param0";
  if (itemCode) {
    where += " AND d.item_code = @param1";
    params.push(String(itemCode));
  }
  return selectData(`${SELECT} WHERE ${where} ORDER BY d.id DESC`, params);
}

async function getById(id) {
  await ensureSchema();
  const rows = await selectData(`${SELECT} WHERE d.id = @param0`, [toInt(id)]);
  return rows?.[0] || null;
}

/** Records an upload and puts the checklist item back to SUBMITTED for the
 * Compliance Officer to review. Earlier files for the item are kept.
 * `markComplied` (staff uploading for the locator, already reviewed): the
 * file goes straight to ACCEPTED and the item to COMPLIED. */
async function createUpload({ proponentId, itemCode, file, storagePath, validityFrom, validityTo, userId, markComplied = false, remarks = null }) {
  await ensureSchema();
  const pid = toInt(proponentId);
  const item = await ComplianceRequirement.getActiveRequirementByCode(itemCode);
  if (!item) throw clientError("Unknown or inactive compliance requirement.");
  const from = readDate(validityFrom, "Valid from");
  const to = readDate(validityTo, "Valid until");
  if (from && to && from > to) throw clientError("Valid until must be on or after Valid from.");

  const result = await insertData(
    `
    INSERT INTO dbo.locator_compliance_documents
      (proponent_id, item_code, file_name, original_file_name, storage_path, content_type, file_size_bytes,
       validity_from, validity_to, status, uploaded_by)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, @param8, 'SUBMITTED', @param9)
    `,
    [
      pid,
      item.code,
      file.filename,
      file.originalname ?? null,
      storagePath,
      file.mimetype ?? null,
      file.size ?? null,
      from,
      to,
      toInt(userId),
    ]
  );
  const id = result?.recordset?.[0]?.id;

  // Checklist row: SUBMITTED, today's submit date, and the new validity
  // (kept from before when the locator didn't enter one). Everything the
  // officer wrote (particular, commitment, actual, remarks) is left alone.
  await updateData(
    `
    MERGE dbo.locator_compliance_items AS t
    USING (SELECT @param0 AS proponent_id, @param1 AS item_code) AS s
      ON t.proponent_id = s.proponent_id AND t.item_code = s.item_code
    WHEN MATCHED THEN UPDATE SET
      status = 'SUBMITTED',
      date_submitted = CAST(SYSUTCDATETIME() AS DATE),
      validity_from = COALESCE(@param2, t.validity_from),
      validity_to = COALESCE(@param3, t.validity_to),
      updated_by = @param4, updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT
      (proponent_id, item_code, validity_from, validity_to, status, date_submitted, updated_by, updated_at)
      VALUES (@param0, @param1, @param2, @param3, 'SUBMITTED', CAST(SYSUTCDATETIME() AS DATE), @param4, SYSUTCDATETIME());
    `,
    [pid, item.code, from, to, toInt(userId)]
  );

  if (markComplied) {
    await updateData(
      `UPDATE dbo.locator_compliance_items
       SET status = 'COMPLIED', remarks = COALESCE(@param2, remarks), updated_by = @param3, updated_at = SYSUTCDATETIME()
       WHERE proponent_id = @param0 AND item_code = @param1`,
      [pid, item.code, remarks ? String(remarks).slice(0, 2000) : null, toInt(userId)]
    );
    await applyReview(pid, item.code, "COMPLIED", remarks, userId);
  }

  return { document: await getById(id), item };
}

/** Called after the Compliance Officer saves a checklist item: Complied /
 * Not complied stamps the latest still-SUBMITTED file ACCEPTED / REJECTED. */
async function applyReview(proponentId, itemCode, status, remarks, actorId) {
  await ensureSchema();
  const docStatus = status === "COMPLIED" ? "ACCEPTED" : status === "NOT_COMPLIED" ? "REJECTED" : null;
  if (!docStatus) return;
  await updateData(
    `
    UPDATE dbo.locator_compliance_documents
    SET status = @param2, review_remarks = @param3, reviewed_by = @param4, reviewed_at = SYSUTCDATETIME()
    WHERE id = (
      SELECT TOP (1) id FROM dbo.locator_compliance_documents
      WHERE proponent_id = @param0 AND item_code = @param1 AND status = 'SUBMITTED'
      ORDER BY id DESC
    )
    `,
    [toInt(proponentId), String(itemCode), docStatus, remarks ? String(remarks).slice(0, 2000) : null, toInt(actorId)]
  );
}

/** Active users who review compliance: roles with the Compliance &
 * Inspection menu (the Compliance Officer), plus admins. */
async function listComplianceStaffIds() {
  const roleIds = await ControlPanelPermission.listRoleIdsWithMenu(REVIEW_MENU_KEY);
  const adminRows = await selectData(
    `SELECT id FROM dbo.roles WHERE LOWER(LTRIM(RTRIM(name))) = 'admin' AND is_active = 1`
  );
  const ids = [...new Set([...roleIds, ...adminRows.map((r) => Number(r.id))])];
  if (!ids.length) return [];
  const users = await selectData(
    `
    SELECT DISTINCT u.id
    FROM dbo.users u
    INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
    WHERE u.is_active = 1 AND ur.role_id IN (${ids.map((_, i) => `@param${i}`).join(", ")})
    `,
    ids
  );
  return users.map((u) => Number(u.id));
}

/** In-app notice to every compliance reviewer that a locator uploaded a document. */
async function notifyReviewers({ proponentName, itemName, actorId }) {
  try {
    for (const userId of await listComplianceStaffIds()) {
      await Notification.createNotification({
        userId,
        subject: `Compliance document submitted: ${itemName}`,
        body: `${proponentName || "A locator"} uploaded ${itemName} for review.`,
        createdBy: toInt(actorId),
        eventType: "compliance",
      });
    }
  } catch (error) {
    console.error("Compliance upload notification error:", error);
  }
}

/** The locator's latest GIS upload (Compliance page), summarised for the
 * read-only "GIS document" field on the Stockholders tabs; null if none. */
async function latestGisSummary(proponentId) {
  const [latest] = await listForProponent(proponentId, "GIS");
  if (!latest) return null;
  return {
    original_file_name: latest.original_file_name || latest.file_name || null,
    status: latest.status || null,
    validity_to: latest.validity_to || null,
    uploaded_at: latest.uploaded_at || null,
  };
}

module.exports = {
  ensureSchema,
  listForProponent,
  latestGisSummary,
  getById,
  createUpload,
  applyReview,
  notifyReviewers,
  listComplianceStaffIds,
};
