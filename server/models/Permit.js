const { selectData, insertData, updateData, updateSchema } = require("../config/database");

const PERMIT_TYPES = ["ENVIRONMENTAL", "FIRE", "OCCUPANCY", "SANITARY", "AUTHORITY_TO_OPERATE"];
const EXPIRING_WINDOW_DAYS = 30;

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeType(v) {
  const raw = String(v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return PERMIT_TYPES.includes(raw) ? raw : "ENVIRONMENTAL";
}

/** Effective status: explicit REVOKED wins, otherwise derived from expiry_date. */
function effectiveStatus(row) {
  if (String(row.status || "").toUpperCase() === "REVOKED") return "REVOKED";
  if (!row.expiry_date) return "VALID";
  const expiry = new Date(row.expiry_date);
  if (Number.isNaN(expiry.getTime())) return "VALID";
  const now = new Date();
  const days = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 0) return "EXPIRED";
  if (days <= EXPIRING_WINDOW_DAYS) return "EXPIRING";
  return "VALID";
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.permits', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.permits (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        application_id INT NULL,
        permit_type NVARCHAR(50) NOT NULL,
        permit_no NVARCHAR(100) NOT NULL,
        issuing_authority NVARCHAR(200) NULL,
        issue_date DATE NULL,
        expiry_date DATE NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_permits_status DEFAULT ('VALID'),
        document_id INT NULL,
        remarks NVARCHAR(500) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_permits_is_active DEFAULT (1),
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_permits_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        CONSTRAINT FK_permits_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id)
      );
      CREATE INDEX IX_permits_proponent_id ON dbo.permits(proponent_id);
      CREATE INDEX IX_permits_application_id ON dbo.permits(application_id);
      CREATE INDEX IX_permits_expiry_date ON dbo.permits(expiry_date);
    END
  `);
}

const SELECT_COLS = `
  p.id, p.proponent_id, p.application_id, p.permit_type, p.permit_no,
  p.issuing_authority, p.issue_date, p.expiry_date, p.status, p.document_id,
  p.remarks, p.is_active, p.created_by, p.updated_by, p.created_at, p.updated_at
`;

function mapRow(r, extra = {}) {
  if (!r) return null;
  return {
    id: r.id,
    proponent_id: r.proponent_id,
    application_id: r.application_id ?? null,
    permit_type: r.permit_type,
    permit_no: r.permit_no,
    issuing_authority: r.issuing_authority ?? null,
    issue_date: r.issue_date ?? null,
    expiry_date: r.expiry_date ?? null,
    status: r.status,
    effective_status: effectiveStatus(r),
    document_id: r.document_id ?? null,
    remarks: r.remarks ?? null,
    is_active: r.is_active,
    created_by: r.created_by ?? null,
    updated_by: r.updated_by ?? null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    ...extra,
  };
}

async function listAll() {
  await ensureSchema();
  const rows = await selectData(
    `SELECT ${SELECT_COLS}, pr.business_name AS proponent_name
     FROM dbo.permits p
     LEFT JOIN dbo.proponents pr ON pr.id = p.proponent_id
     ORDER BY p.id DESC`
  );
  return rows.map((r) => mapRow(r, { proponent_name: r.proponent_name ?? null }));
}

async function listByProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT ${SELECT_COLS} FROM dbo.permits p
     WHERE p.proponent_id = @param0 AND p.is_active = 1
     ORDER BY p.expiry_date ASC, p.id DESC`,
    [toInt(proponentId)]
  );
  return rows.map((r) => mapRow(r));
}

async function listByApplication(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT ${SELECT_COLS} FROM dbo.permits p
     WHERE p.application_id = @param0 AND p.is_active = 1
     ORDER BY p.expiry_date ASC, p.id DESC`,
    [toInt(applicationId)]
  );
  return rows.map((r) => mapRow(r));
}

async function getById(id) {
  await ensureSchema();
  const rows = await selectData(`SELECT ${SELECT_COLS} FROM dbo.permits p WHERE p.id = @param0`, [toInt(id)]);
  return mapRow(rows?.[0]);
}

async function create(data) {
  await ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.permits
      (proponent_id, application_id, permit_type, permit_no, issuing_authority, issue_date, expiry_date, status, document_id, remarks, is_active, created_by, created_at)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, @param8, @param9, 1, @param10, SYSUTCDATETIME())
    `,
    [
      toInt(data.proponent_id),
      toInt(data.application_id),
      normalizeType(data.permit_type),
      String(data.permit_no || "").trim(),
      data.issuing_authority ? String(data.issuing_authority).trim() : null,
      data.issue_date || null,
      data.expiry_date || null,
      String(data.status || "VALID").trim().toUpperCase(),
      toInt(data.document_id),
      data.remarks ? String(data.remarks).slice(0, 500) : null,
      toInt(data.created_by),
    ]
  );
  return getById(result?.recordset?.[0]?.id);
}

async function update(id, data) {
  await ensureSchema();
  const sets = [];
  const params = [];
  const push = (frag, val) => {
    sets.push(frag.replace("?", `@param${params.length}`));
    params.push(val);
  };
  if (data.application_id !== undefined) push("application_id = ?", toInt(data.application_id));
  if (data.permit_type !== undefined) push("permit_type = ?", normalizeType(data.permit_type));
  if (data.permit_no !== undefined) push("permit_no = ?", String(data.permit_no || "").trim());
  if (data.issuing_authority !== undefined) push("issuing_authority = ?", data.issuing_authority ? String(data.issuing_authority).trim() : null);
  if (data.issue_date !== undefined) push("issue_date = ?", data.issue_date || null);
  if (data.expiry_date !== undefined) push("expiry_date = ?", data.expiry_date || null);
  if (data.status !== undefined) push("status = ?", String(data.status || "VALID").trim().toUpperCase());
  if (data.document_id !== undefined) push("document_id = ?", toInt(data.document_id));
  if (data.remarks !== undefined) push("remarks = ?", data.remarks ? String(data.remarks).slice(0, 500) : null);
  if (data.is_active !== undefined) push("is_active = ?", data.is_active ? 1 : 0);
  if (data.updated_by !== undefined) push("updated_by = ?", toInt(data.updated_by));

  if (sets.length) {
    params.push(toInt(id));
    await updateData(
      `UPDATE dbo.permits SET ${sets.join(", ")}, updated_at = SYSUTCDATETIME() WHERE id = @param${params.length - 1}`,
      params
    );
  }
  return getById(id);
}

async function deactivate(id, updatedBy) {
  await ensureSchema();
  await updateData(
    `UPDATE dbo.permits SET is_active = 0, updated_by = @param1, updated_at = SYSUTCDATETIME() WHERE id = @param0`,
    [toInt(id), toInt(updatedBy)]
  );
  return getById(id);
}

module.exports = {
  PERMIT_TYPES,
  ensureSchema,
  effectiveStatus,
  listAll,
  listByProponent,
  listByApplication,
  getById,
  create,
  update,
  deactivate,
};
