const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.requirement_categories', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.requirement_categories (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name NVARCHAR(255) NOT NULL,
        description NVARCHAR(1000) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_requirement_categories_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_requirement_categories_is_active DEFAULT (1)
      );

      CREATE INDEX IX_requirement_categories_name ON dbo.requirement_categories(name);
    END
  `);
}

function mapRow(rc) {
  return {
    id: rc.id,
    name: rc.name,
    description: rc.description ?? null,
    created_by: rc.created_by ?? null,
    updated_by: rc.updated_by ?? null,
    created_at: rc.created_at ?? null,
    updated_at: rc.updated_at ?? null,
    is_active: rc.is_active,
  };
}

async function listRequirementCategories() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT
      rc.id,
      rc.name,
      rc.description,
      rc.created_by,
      rc.updated_by,
      rc.created_at,
      rc.updated_at,
      rc.is_active
    FROM dbo.requirement_categories rc
    ORDER BY rc.id DESC
  `);
  return rows.map(mapRow);
}

async function getRequirementCategoryById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      rc.id,
      rc.name,
      rc.description,
      rc.created_by,
      rc.updated_by,
      rc.created_at,
      rc.updated_at,
      rc.is_active
    FROM dbo.requirement_categories rc
    WHERE rc.id = @param0
    `,
    [id]
  );

  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function createRequirementCategory({ name, description, created_by, is_active = 1 }) {
  await ensureSchema();
  const createdBy = toInt(created_by);
  const active = is_active ? 1 : 0;
  const result = await insertData(
    `
    INSERT INTO dbo.requirement_categories
      (name, description, created_by, updated_by, created_at, updated_at, is_active)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, NULL, GETDATE(), NULL, @param3)
    `,
    [name, description ?? null, createdBy, active]
  );

  const id = result?.recordset?.[0]?.id;
  return getRequirementCategoryById(id);
}

async function updateRequirementCategory(id, { name, description, is_active, updated_by }) {
  await ensureSchema();
  const sets = [];
  const params = [];

  const pushSet = (sqlFrag, value) => {
    sets.push(sqlFrag.replace("?", `@param${params.length}`));
    params.push(value);
  };

  if (name !== undefined) pushSet("name = ?", name);
  if (description !== undefined) pushSet("description = ?", description ?? null);
  if (is_active !== undefined) pushSet("is_active = ?", is_active ? 1 : 0);

  const updatedBy = toInt(updated_by);
  if (updatedBy !== null) pushSet("updated_by = ?", updatedBy);

  if (sets.length) {
    const query = `
      UPDATE dbo.requirement_categories
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }

  return getRequirementCategoryById(id);
}

async function deactivateRequirementCategory(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.requirement_categories
    SET is_active = 0,
        updated_by = @param1,
        updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getRequirementCategoryById(id);
}

async function reactivateRequirementCategory(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.requirement_categories
    SET is_active = 1,
        updated_by = @param1,
        updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getRequirementCategoryById(id);
}

module.exports = {
  ensureSchema,
  listRequirementCategories,
  getRequirementCategoryById,
  createRequirementCategory,
  updateRequirementCategory,
  deactivateRequirementCategory,
  reactivateRequirementCategory,
};
