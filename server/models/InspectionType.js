const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.inspection_types', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.inspection_types (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code NVARCHAR(50) NOT NULL,
        name NVARCHAR(255) NOT NULL,
        description NVARCHAR(1000) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_inspection_types_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_inspection_types_is_active DEFAULT (1)
      );

      CREATE INDEX IX_inspection_types_code ON dbo.inspection_types(code);
      CREATE INDEX IX_inspection_types_name ON dbo.inspection_types(name);
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

async function listInspectionTypes() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT
      it.id,
      it.code,
      it.name,
      it.description,
      it.created_by,
      it.updated_by,
      it.created_at,
      it.updated_at,
      it.is_active
    FROM dbo.inspection_types it
    ORDER BY it.id DESC
  `);
  return rows.map(mapRow);
}

async function getInspectionTypeById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      it.id, it.code, it.name, it.description,
      it.created_by, it.updated_by, it.created_at, it.updated_at, it.is_active
    FROM dbo.inspection_types it
    WHERE it.id = @param0
    `,
    [id]
  );
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function createInspectionType({ code, name, description, created_by, is_active = 1 }) {
  await ensureSchema();
  const createdBy = toInt(created_by);
  const active = is_active ? 1 : 0;
  const result = await insertData(
    `
    INSERT INTO dbo.inspection_types
      (code, name, description, created_by, updated_by, created_at, updated_at, is_active)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, NULL, GETDATE(), NULL, @param4)
    `,
    [code, name, description ?? null, createdBy, active]
  );
  const id = result?.recordset?.[0]?.id;
  return getInspectionTypeById(id);
}

async function updateInspectionType(id, { code, name, description, is_active, updated_by }) {
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
      UPDATE dbo.inspection_types
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }
  return getInspectionTypeById(id);
}

async function deactivateInspectionType(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.inspection_types
    SET is_active = 0, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getInspectionTypeById(id);
}

async function reactivateInspectionType(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.inspection_types
    SET is_active = 1, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getInspectionTypeById(id);
}

module.exports = {
  ensureSchema,
  listInspectionTypes,
  getInspectionTypeById,
  createInspectionType,
  updateInspectionType,
  deactivateInspectionType,
  reactivateInspectionType,
};
