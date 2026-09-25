const { selectData, insertData, updateData, updateSchema } = require("../config/database");
// Cross-model require to ensure the category->type link table exists before
// the deactivate guard below queries it (see deactivateApplicationType).
const RequirementCategory = require("./RequirementCategory");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Seeded once when the table is first created so existing applications
// (already stored with these exact codes) keep resolving to a real type
// instead of the dropdown starting empty and blocking every new filing
// until an admin manually recreates them in File Maintenance.
const DEFAULT_TYPES = [
  { code: "DIRECT_LEASE", name: "Direct Lease", description: null },
  { code: "WAREHOUSE_LEASE", name: "Warehouse Lease", description: null },
  { code: "SUBLEASE", name: "Sublease", description: null },
];

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
    IF OBJECT_ID('dbo.application_types', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_types (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code NVARCHAR(50) NOT NULL,
        name NVARCHAR(255) NOT NULL,
        description NVARCHAR(1000) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_application_types_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_application_types_is_active DEFAULT (1)
      );

      CREATE UNIQUE INDEX UX_application_types_code ON dbo.application_types(code);
    END
  `);

  const existing = await selectData(`SELECT COUNT(1) AS total FROM dbo.application_types`);
  if (Number(existing?.[0]?.total || 0) === 0) {
    for (const t of DEFAULT_TYPES) {
      await insertData(
        `
        INSERT INTO dbo.application_types (code, name, description, created_at, is_active)
        VALUES (@param0, @param1, @param2, SYSUTCDATETIME(), 1)
        `,
        [t.code, t.name, t.description]
      );
    }
  }
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

async function listApplicationTypes() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT id, code, name, description, created_by, updated_by, created_at, updated_at, is_active
    FROM dbo.application_types
    ORDER BY id DESC
  `);
  return rows.map(mapRow);
}

// Codes usable when filing an application — active only, uppercased for a
// case-insensitive match against the stored application_type value.
async function listActiveCodes() {
  await ensureSchema();
  const rows = await selectData(`SELECT code FROM dbo.application_types WHERE is_active = 1`);
  return rows.map((r) => String(r.code || "").trim().toUpperCase());
}

async function getApplicationTypeById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT id, code, name, description, created_by, updated_by, created_at, updated_at, is_active
    FROM dbo.application_types
    WHERE id = @param0
    `,
    [id]
  );
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

// Used to give the contract certificate a proper "CERTIFICATE OF DIRECT
// LEASE CONTRACT"-style title driven by the File Maintenance-configurable
// type name, instead of a hardcoded label (see c_permits/contractCertificate).
async function getByCode(code) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT id, code, name, description, is_active FROM dbo.application_types WHERE UPPER(code) = UPPER(@param0)`,
    [String(code || "").trim()]
  );
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function createApplicationType({ code, name, description, created_by, is_active = 1 }) {
  await ensureSchema();
  const createdBy = toInt(created_by);
  const active = is_active ? 1 : 0;
  const result = await insertData(
    `
    INSERT INTO dbo.application_types
      (code, name, description, created_by, updated_by, created_at, updated_at, is_active)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, NULL, GETDATE(), NULL, @param4)
    `,
    [code, name, description ?? null, createdBy, active]
  );
  const id = result?.recordset?.[0]?.id;
  return getApplicationTypeById(id);
}

async function updateApplicationType(id, { code, name, description, is_active, updated_by }) {
  await ensureSchema();

  // `code` is stored as a plain string everywhere it's referenced — filed
  // applications (applications.application_type), the requirement/category
  // wiring tables — none of which are real FKs to application_types.id and
  // none of which get cascade-renamed. Changing it here would silently
  // orphan all of that existing data, so it's locked after creation; only
  // the display name/description can change.
  if (code !== undefined) {
    const current = await getApplicationTypeById(id);
    if (current && String(code).trim().toUpperCase() !== String(current.code || "").trim().toUpperCase()) {
      throw new Error(
        `The code "${current.code}" can't be changed after creation — it's referenced by filed applications and by requirement/category wiring. Create a new type instead if you need a different code.`
      );
    }
  }

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
      UPDATE dbo.application_types
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }
  return getApplicationTypeById(id);
}

// Deactivating a type always succeeds now — instead of blocking it while
// categories are still wired to it (through their requirements' types), it
// cascades down: if this was the LAST active type a category served, the
// category itself gets cascade-deactivated too (which itself cascades further to its
// requirements — see RequirementCategory.deactivateRequirementCategory). A
// category still tagged to another active type is left alone.
async function deactivateApplicationType(id, updated_by) {
  await ensureSchema();
  await RequirementCategory.ensureSchema();

  const current = await getApplicationTypeById(id);
  if (!current) return null;

  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.application_types
    SET is_active = 0, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );

  // A category's types are the types its requirements are tagged to. It's
  // orphaned when it has a requirement for this type and no active
  // requirement that still serves some other active type — an untagged
  // (applies-to-every-type) requirement counts as serving one.
  const orphanedCategories = await selectData(
    `
    SELECT rc.id
    FROM dbo.requirement_categories rc
    WHERE rc.is_active = 1
      AND EXISTS (
        SELECT 1
        FROM dbo.requirements r
        INNER JOIN dbo.requirement_application_types rat ON rat.requirement_id = r.id
        WHERE r.category_id = rc.id AND rat.application_type = @param0
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.requirements r2
        WHERE r2.category_id = rc.id
          AND r2.is_active = 1
          AND (
            NOT EXISTS (SELECT 1 FROM dbo.requirement_application_types rat2 WHERE rat2.requirement_id = r2.id)
            OR EXISTS (
              SELECT 1
              FROM dbo.requirement_application_types rat3
              INNER JOIN dbo.application_types at3 ON at3.code = rat3.application_type
              WHERE rat3.requirement_id = r2.id AND rat3.application_type <> @param0 AND at3.is_active = 1
            )
          )
      )
    `,
    [current.code]
  );
  for (const row of orphanedCategories) {
    await RequirementCategory.deactivateRequirementCategory(row.id, updated_by, true);
  }

  return getApplicationTypeById(id);
}

// Reactivating cascades back down to exactly the categories this type
// previously cascade-disabled (deactivated_via_cascade=1) — one deactivated
// independently is left alone, same rule as the level below it.
async function reactivateApplicationType(id, updated_by) {
  await ensureSchema();
  await RequirementCategory.ensureSchema();

  const current = await getApplicationTypeById(id);
  if (!current) return null;

  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.application_types
    SET is_active = 1, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );

  const cascadedCategories = await selectData(
    `
    SELECT rc.id
    FROM dbo.requirement_categories rc
    WHERE rc.is_active = 0 AND rc.deactivated_via_cascade = 1
      AND EXISTS (
        SELECT 1
        FROM dbo.requirements r
        INNER JOIN dbo.requirement_application_types rat ON rat.requirement_id = r.id
        WHERE r.category_id = rc.id AND rat.application_type = @param0
      )
    `,
    [current.code]
  );
  for (const row of cascadedCategories) {
    await RequirementCategory.reactivateRequirementCategory(row.id, updated_by);
  }

  return getApplicationTypeById(id);
}

module.exports = {
  ensureSchema,
  listApplicationTypes,
  listActiveCodes,
  getApplicationTypeById,
  getByCode,
  createApplicationType,
  updateApplicationType,
  deactivateApplicationType,
  reactivateApplicationType,
};
