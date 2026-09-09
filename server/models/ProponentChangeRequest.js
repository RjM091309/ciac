const { selectData, insertData, updateData, updateSchema } = require("../config/database");

// Fields a proponent may request changes to (all live on dbo.proponents).
const EDITABLE_FIELDS = ["business_name", "registration_no", "tin", "address", "contact_no"];

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeParse(json) {
  if (json == null) return {};
  if (typeof json === "object") return json;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.proponent_profile_change_requests', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.proponent_profile_change_requests (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        requested_by INT NULL,
        payload NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_ppcr_status DEFAULT ('PENDING'),
        review_remarks NVARCHAR(500) NULL,
        reviewed_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_ppcr_created_at DEFAULT (SYSUTCDATETIME()),
        reviewed_at DATETIME2(3) NULL,
        CONSTRAINT FK_ppcr_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id)
      );
      CREATE INDEX IX_ppcr_proponent_id ON dbo.proponent_profile_change_requests(proponent_id);
      CREATE INDEX IX_ppcr_status ON dbo.proponent_profile_change_requests(status);
    END
  `);
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    proponent_id: r.proponent_id,
    requested_by: r.requested_by ?? null,
    payload: safeParse(r.payload),
    status: String(r.status || "PENDING").toUpperCase(),
    review_remarks: r.review_remarks ?? null,
    reviewed_by: r.reviewed_by ?? null,
    created_at: r.created_at ?? null,
    reviewed_at: r.reviewed_at ?? null,
    business_name: r.business_name ?? null,
    // current values (for the admin diff view)
    current: {
      business_name: r.cur_business_name ?? null,
      registration_no: r.cur_registration_no ?? null,
      tin: r.cur_tin ?? null,
      address: r.cur_address ?? null,
      contact_no: r.cur_contact_no ?? null,
    },
    requested_by_username: r.requested_by_username ?? null,
  };
}

async function getPendingForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1) *
    FROM dbo.proponent_profile_change_requests
    WHERE proponent_id = @param0 AND status = 'PENDING'
    ORDER BY id DESC
    `,
    [toInt(proponentId)]
  );
  return mapRow(rows?.[0]);
}

async function listForProponent(proponentId, limit = 20) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (${Math.max(1, Math.min(100, toInt(limit) || 20))}) *
    FROM dbo.proponent_profile_change_requests
    WHERE proponent_id = @param0
    ORDER BY id DESC
    `,
    [toInt(proponentId)]
  );
  return rows.map(mapRow);
}

async function getById(id) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT TOP (1) * FROM dbo.proponent_profile_change_requests WHERE id = @param0`,
    [toInt(id)]
  );
  return mapRow(rows?.[0]);
}

async function listByStatus(status = "PENDING") {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      cr.*,
      p.business_name AS business_name,
      p.business_name AS cur_business_name,
      p.registration_no AS cur_registration_no,
      p.tin AS cur_tin,
      p.address AS cur_address,
      p.contact_no AS cur_contact_no,
      u.username AS requested_by_username
    FROM dbo.proponent_profile_change_requests cr
    LEFT JOIN dbo.proponents p ON p.id = cr.proponent_id
    LEFT JOIN dbo.users u ON u.id = cr.requested_by
    WHERE cr.status = @param0
    ORDER BY cr.id DESC
    `,
    [String(status || "PENDING").toUpperCase()]
  );
  return rows.map(mapRow);
}

async function create({ proponent_id, requested_by, payload }) {
  await ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.proponent_profile_change_requests (proponent_id, requested_by, payload, status, created_at)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, 'PENDING', SYSUTCDATETIME())
    `,
    [toInt(proponent_id), toInt(requested_by), JSON.stringify(payload || {})]
  );
  return getById(result?.recordset?.[0]?.id);
}

async function markReviewed(id, status, reviewed_by, remarks = null) {
  await ensureSchema();
  await updateData(
    `
    UPDATE dbo.proponent_profile_change_requests
    SET status = @param1,
        reviewed_by = @param2,
        review_remarks = @param3,
        reviewed_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [toInt(id), String(status).toUpperCase(), toInt(reviewed_by), remarks ? String(remarks).slice(0, 500) : null]
  );
  return getById(id);
}

module.exports = {
  EDITABLE_FIELDS,
  ensureSchema,
  getPendingForProponent,
  listForProponent,
  getById,
  listByStatus,
  create,
  markReviewed,
};
