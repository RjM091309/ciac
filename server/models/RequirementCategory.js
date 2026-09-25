const { selectData, insertData, updateData, updateSchema } = require("../config/database");
// Cross-model require so deactivating a category can cascade down to the
// requirements filed under it (see deactivateRequirementCategory below).
const Requirement = require("./Requirement");

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

    -- A category's application types are derived from the requirements
    -- filed under it (requirement_application_types); the old
    -- requirement_category_application_types table is dropped at startup
    -- by config/legacyTables.js.

    -- Set when this row was deactivated automatically because an application
    -- type it's wired to was deactivated (and this was its last active
    -- type) — as opposed to someone deactivating it directly. Lets that
    -- type's reactivate cascade back down to exactly the categories it
    -- disabled, without resurrecting one deactivated independently.
    IF COL_LENGTH('dbo.requirement_categories', 'deactivated_via_cascade') IS NULL
      ALTER TABLE dbo.requirement_categories ADD deactivated_via_cascade BIT NOT NULL CONSTRAINT DF_requirement_categories_deactivated_via_cascade DEFAULT (0);
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
    deactivated_via_cascade: rc.deactivated_via_cascade ?? 0,
    // Populated by the caller from a second query — the types its
    // requirements are tagged to (read-only, derived).
    application_types: [],
  };
}

/** Attaches each row's application_types — every type any requirement in the
 * category is tagged to — in one extra query instead of N+1. Mutates and
 * returns the same array for convenience. */
async function attachApplicationTypes(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `@param${i}`).join(", ");
  const linkRows = await selectData(
    `SELECT DISTINCT r.category_id, rat.application_type
     FROM dbo.requirements r
     INNER JOIN dbo.requirement_application_types rat ON rat.requirement_id = r.id
     WHERE r.category_id IN (${placeholders})`,
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
      rc.is_active,
      rc.deactivated_via_cascade
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
      rc.is_active,
      rc.deactivated_via_cascade
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

// Deactivating a category always succeeds now — instead of blocking it while
// requirements are still assigned, it cascades down and deactivates them too
// (flagged deactivated_via_cascade=1 so a later reactivate of THIS category
// knows to bring them back, without touching ones deactivated on their own).
async function deactivateRequirementCategory(id, updated_by, viaCascade = false) {
  await ensureSchema();

  const current = await getRequirementCategoryById(id);
  if (!current) return null;

  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.requirement_categories
    SET is_active = 0,
        deactivated_via_cascade = @param2,
        updated_by = @param1,
        updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy, viaCascade ? 1 : 0]
  );

  const dependentRows = await selectData(
    `SELECT id FROM dbo.requirements WHERE category_id = @param0 AND is_active = 1`,
    [id]
  );
  for (const row of dependentRows) {
    await Requirement.deactivateRequirement(row.id, updated_by, true);
  }

  return getRequirementCategoryById(id);
}

// Reactivating cascades back down to exactly the requirements this category
// previously cascade-disabled — one deactivated independently (the flag is
// 0) is left alone, since the person who turned it off did so on purpose.
async function reactivateRequirementCategory(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.requirement_categories
    SET is_active = 1,
        deactivated_via_cascade = 0,
        updated_by = @param1,
        updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );

  const cascadedRows = await selectData(
    `SELECT id FROM dbo.requirements WHERE category_id = @param0 AND is_active = 0 AND deactivated_via_cascade = 1`,
    [id]
  );
  for (const row of cascadedRows) {
    await Requirement.reactivateRequirement(row.id, updated_by);
  }

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
