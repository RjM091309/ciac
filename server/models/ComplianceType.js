const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Once per process: the DDL below is idempotent but not free, and
// ensureSchema() is awaited at the top of most queries in this file.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = createSchema().catch((error) => {
      schemaReady = null; // retry on the next call if the DDL failed
      throw error;
    });
  }
  return schemaReady;
}

async function createSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.compliance_types', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.compliance_types (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code NVARCHAR(50) NOT NULL,
        name NVARCHAR(255) NOT NULL,
        description NVARCHAR(1000) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_compliance_types_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_compliance_types_is_active DEFAULT (1)
      );

      CREATE INDEX IX_compliance_types_code ON dbo.compliance_types(code);
      CREATE INDEX IX_compliance_types_name ON dbo.compliance_types(name);
    END
  `);
}

function mapRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    is_active: row.is_active,
  };
}

async function listActiveCodes() {
  await ensureSchema();
  const rows = await selectData(`SELECT code FROM dbo.compliance_types WHERE is_active = 1`);
  return rows.map((r) => String(r.code || "").trim().toUpperCase());
}

async function listComplianceTypes() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT
      ct.id,
      ct.code,
      ct.name,
      ct.description,
      ct.created_by,
      ct.updated_by,
      ct.created_at,
      ct.updated_at,
      ct.is_active
    FROM dbo.compliance_types ct
    ORDER BY ct.id DESC
  `);
  return rows.map(mapRow);
}

// Used to give the permit certificate a proper "CERTIFICATE OF <NAME>"-style
// title driven by the File Maintenance-configurable type name, instead of a
// hardcoded label (see lib/permitCertificate.js) — same pattern as
// ApplicationType.getByCode for contract certificates.
async function getByCode(code) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT id, code, name, description, is_active FROM dbo.compliance_types WHERE UPPER(code) = UPPER(@param0)`,
    [String(code || "").trim()]
  );
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function getComplianceTypeById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      ct.id, ct.code, ct.name, ct.description,
      ct.created_by, ct.updated_by, ct.created_at, ct.updated_at, ct.is_active
    FROM dbo.compliance_types ct
    WHERE ct.id = @param0
    `,
    [id]
  );
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function createComplianceType({ code, name, description, created_by, is_active = 1 }) {
  await ensureSchema();
  const createdBy = toInt(created_by);
  const active = is_active ? 1 : 0;
  const result = await insertData(
    `
    INSERT INTO dbo.compliance_types
      (code, name, description, created_by, updated_by, created_at, updated_at, is_active)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, NULL, GETDATE(), NULL, @param4)
    `,
    [code, name, description ?? null, createdBy, active]
  );
  const id = result?.recordset?.[0]?.id;
  return getComplianceTypeById(id);
}

async function updateComplianceType(id, { code, name, description, is_active, updated_by }) {
  await ensureSchema();
  const sets = [];
  const params = [];
  const pushSet = (sqlFrag, value) => {
    sets.push(sqlFrag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (code !== undefined) pushSet("code = ?", code);
  if (name !== undefined) pushSet("name = ?", name);
  if (description !== undefined) pushSet("description = ?", description ?? null);
  if (is_active !== undefined) pushSet("is_active = ?", is_active ? 1 : 0);
  const updatedBy = toInt(updated_by);
  if (updatedBy !== null) pushSet("updated_by = ?", updatedBy);
  if (sets.length) {
    const query = `
      UPDATE dbo.compliance_types
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }
  return getComplianceTypeById(id);
}

async function deactivateComplianceType(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.compliance_types
    SET is_active = 0, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getComplianceTypeById(id);
}

async function reactivateComplianceType(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.compliance_types
    SET is_active = 1, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getComplianceTypeById(id);
}

module.exports = {
  ensureSchema,
  listActiveCodes,
  getByCode,
  listComplianceTypes,
  getComplianceTypeById,
  createComplianceType,
  updateComplianceType,
  deactivateComplianceType,
  reactivateComplianceType,
};
