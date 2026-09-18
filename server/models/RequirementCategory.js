const { selectData, insertData, updateData, updateSchema, runInTransaction } = require("../config/database");

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

    -- No rows for a category here = it applies to every application type
    -- (same "unrestricted default" convention as requirement_application_types).
    -- Any row(s) present restrict it to just those types, so newly-created
    -- categories sort immediately under the type they were created for
    -- instead of waiting for a requirement to link them.
    IF OBJECT_ID('dbo.requirement_category_application_types', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.requirement_category_application_types (
        category_id INT NOT NULL,
        application_type NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_req_cat_app_types PRIMARY KEY (category_id, application_type),
        CONSTRAINT FK_req_cat_app_types_category FOREIGN KEY (category_id) REFERENCES dbo.requirement_categories(id)
      );
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
    // Populated by the caller from a second query — empty array means
    // "applies to every application type".
    application_types: [],
  };
}

/** Attaches each row's linked application_types in one extra query instead
 * of N+1 — mutates and returns the same array for convenience. */
async function attachApplicationTypes(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `@param${i}`).join(", ");
  const linkRows = await selectData(
    `SELECT category_id, application_type FROM dbo.requirement_category_application_types WHERE category_id IN (${placeholders})`,
    ids
  );
  const byCategory = new Map();
  linkRows.forEach((r) => {
    const list = byCategory.get(r.category_id) || [];
    list.push(r.application_type);
    byCategory.set(r.category_id, list);
  });
  rows.forEach((r) => {
    r.application_types = byCategory.get(r.id) || [];
  });
  return rows;
}

async function setApplicationTypes(categoryId, applicationTypes) {
  const types = Array.isArray(applicationTypes)
    ? [...new Set(applicationTypes.map((t) => String(t).trim().toUpperCase()).filter(Boolean))]
    : [];
  await runInTransaction(async (tx) => {
    await tx.query(`DELETE FROM dbo.requirement_category_application_types WHERE category_id = @param0`, [categoryId]);
    for (const type of types) {
      await tx.query(
        `INSERT INTO dbo.requirement_category_application_types (category_id, application_type) VALUES (@param0, @param1)`,
        [categoryId, type]
      );
    }
  });
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
  return attachApplicationTypes(rows.map(mapRow));
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
  if (!row) return null;
  const [mapped] = await attachApplicationTypes([mapRow(row)]);
  return mapped;
}

async function createRequirementCategory({ name, description, created_by, is_active = 1, application_types }) {
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
  if (application_types !== undefined) await setApplicationTypes(id, application_types);
  return getRequirementCategoryById(id);
}

async function updateRequirementCategory(id, { name, description, is_active, application_types, updated_by }) {
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

  if (application_types !== undefined) await setApplicationTypes(id, application_types);

  return getRequirementCategoryById(id);
}

async function deactivateRequirementCategory(id, updated_by) {
  await ensureSchema();

  const current = await getRequirementCategoryById(id);
  if (!current) return null;

  // Block deactivation while active Requirements still point at this
  // category — same guard as deactivateApplicationType one level up, so the
  // catalog can't silently orphan the requirements underneath it.
  const dependentRows = await selectData(
    `SELECT COUNT(1) AS n FROM dbo.requirements WHERE category_id = @param0 AND is_active = 1`,
    [id]
  );
  const dependentCount = Number(dependentRows?.[0]?.n || 0);
  if (dependentCount > 0) {
    throw new Error(
      `Cannot deactivate "${current.name}" — ${dependentCount} active requirement${
        dependentCount === 1 ? " is" : "s are"
      } still assigned to it. Reassign or deactivate ${dependentCount === 1 ? "it" : "them"} first.`
    );
  }

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
