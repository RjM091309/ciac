const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBit(v) {
  return Number(v) ? 1 : 0;
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.requirements', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.requirements (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code NVARCHAR(50) NOT NULL,
        name NVARCHAR(200) NOT NULL,
        description NVARCHAR(500) NULL,
        category_id INT NULL,
        for_new BIT NOT NULL CONSTRAINT DF_requirements_for_new DEFAULT (1),
        for_renewal BIT NOT NULL CONSTRAINT DF_requirements_for_renewal DEFAULT (1),
        is_mandatory BIT NOT NULL CONSTRAINT DF_requirements_is_mandatory DEFAULT (1),
        is_active BIT NOT NULL CONSTRAINT DF_requirements_is_active DEFAULT (1),
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_requirements_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );

      CREATE INDEX IX_requirements_code ON dbo.requirements(code);
      CREATE INDEX IX_requirements_name ON dbo.requirements(name);
      CREATE INDEX IX_requirements_category_id ON dbo.requirements(category_id);
    END
  `);
}

function mapRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    category_id: row.category_id ?? null,
    category_name: row.category_name ?? null,
    for_new: row.for_new,
    for_renewal: row.for_renewal,
    is_mandatory: row.is_mandatory,
    is_active: row.is_active,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function listRequirements() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT
      r.id,
      r.code,
      r.name,
      r.description,
      r.category_id,
      rc.name AS category_name,
      r.for_new,
      r.for_renewal,
      r.is_mandatory,
      r.is_active,
      r.created_by,
      r.updated_by,
      r.created_at,
      r.updated_at
    FROM dbo.requirements r
    LEFT JOIN dbo.requirement_categories rc ON rc.id = r.category_id
    ORDER BY r.id DESC
  `);
  return rows.map(mapRow);
}

async function getRequirementById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      r.id,
      r.code,
      r.name,
      r.description,
      r.category_id,
      rc.name AS category_name,
      r.for_new,
      r.for_renewal,
      r.is_mandatory,
      r.is_active,
      r.created_by,
      r.updated_by,
      r.created_at,
      r.updated_at
    FROM dbo.requirements r
    LEFT JOIN dbo.requirement_categories rc ON rc.id = r.category_id
    WHERE r.id = @param0
    `,
    [id]
  );
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function createRequirement({
  code,
  name,
  description,
  category_id,
  for_new,
  for_renewal,
  is_mandatory,
  is_active = 1,
  created_by,
}) {
  await ensureSchema();
  const createdBy = toInt(created_by);
  const categoryId = toInt(category_id);
  const result = await insertData(
    `
    INSERT INTO dbo.requirements
      (code, name, description, category_id, for_new, for_renewal, is_mandatory, is_active, created_by, updated_by, created_at, updated_at)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, @param8, NULL, GETDATE(), NULL)
    `,
    [code, name, description ?? null, categoryId, toBit(for_new), toBit(for_renewal), toBit(is_mandatory), toBit(is_active), createdBy]
  );
  const id = result?.recordset?.[0]?.id;
  return getRequirementById(id);
}

async function updateRequirement(
  id,
  { code, name, description, category_id, for_new, for_renewal, is_mandatory, is_active, updated_by }
) {
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
  if (category_id !== undefined) pushSet("category_id = ?", toInt(category_id));
  if (for_new !== undefined) pushSet("for_new = ?", toBit(for_new));
  if (for_renewal !== undefined) pushSet("for_renewal = ?", toBit(for_renewal));
  if (is_mandatory !== undefined) pushSet("is_mandatory = ?", toBit(is_mandatory));
  if (is_active !== undefined) pushSet("is_active = ?", toBit(is_active));

  const updatedBy = toInt(updated_by);
  if (updatedBy !== null) pushSet("updated_by = ?", updatedBy);

  if (sets.length) {
    const query = `
      UPDATE dbo.requirements
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }

  return getRequirementById(id);
}

async function deactivateRequirement(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.requirements
    SET is_active = 0, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getRequirementById(id);
}

async function reactivateRequirement(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.requirements
    SET is_active = 1, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getRequirementById(id);
}

module.exports = {
  ensureSchema,
  listRequirements,
  getRequirementById,
  createRequirement,
  updateRequirement,
  deactivateRequirement,
  reactivateRequirement,
};
