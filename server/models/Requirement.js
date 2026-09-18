const { selectData, insertData, updateData, updateSchema, runInTransaction } = require("../config/database");

function toInt(v) {
  // Number(null) is 0, not NaN — without this guard, an explicitly-passed
  // null/undefined optional FK (e.g. category_id) silently became 0 instead
  // of staying NULL and violated the foreign key.
  if (v === null || v === undefined || v === "") return null;
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

    -- A one-off requirement an Assessment Officer attaches to a single
    -- application (see ApplicationWorkflow.addCustomRequirementToApplication)
    -- is still stored as a catalog row (for_new/for_renewal both 0, so the
    -- bulk auto-seed never reuses it elsewhere) — this flag just keeps it out
    -- of the shared Requirements file-maintenance screen.
    IF COL_LENGTH('dbo.requirements', 'is_ad_hoc') IS NULL
      ALTER TABLE dbo.requirements ADD is_ad_hoc BIT NOT NULL CONSTRAINT DF_requirements_is_ad_hoc DEFAULT (0);

    -- No rows for a requirement here = it applies to every application type
    -- (matches the historical behavior, before types could be restricted).
    -- Any row(s) present restrict it to just those types.
    IF OBJECT_ID('dbo.requirement_application_types', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.requirement_application_types (
        requirement_id INT NOT NULL,
        application_type NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_requirement_application_types PRIMARY KEY (requirement_id, application_type),
        CONSTRAINT FK_req_app_types_requirement FOREIGN KEY (requirement_id) REFERENCES dbo.requirements(id)
      );
    END

    -- Set when this row was deactivated automatically because its category
    -- (or, one level further up, its category's application type) was
    -- deactivated — as opposed to someone deactivating it directly. Lets a
    -- parent's reactivate cascade back down to exactly the rows it disabled,
    -- without resurrecting something that was independently deactivated on
    -- its own for an unrelated reason.
    IF COL_LENGTH('dbo.requirements', 'deactivated_via_cascade') IS NULL
      ALTER TABLE dbo.requirements ADD deactivated_via_cascade BIT NOT NULL CONSTRAINT DF_requirements_deactivated_via_cascade DEFAULT (0);
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
    deactivated_via_cascade: row.deactivated_via_cascade ?? 0,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    // Populated by the caller (listRequirements/getRequirementById) from a
    // second query — empty array means "applies to every application type".
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
    `SELECT requirement_id, application_type FROM dbo.requirement_application_types WHERE requirement_id IN (${placeholders})`,
    ids
  );
  const byRequirement = new Map();
  linkRows.forEach((r) => {
    const list = byRequirement.get(r.requirement_id) || [];
    list.push(r.application_type);
    byRequirement.set(r.requirement_id, list);
  });
  rows.forEach((r) => {
    r.application_types = byRequirement.get(r.id) || [];
  });
  return rows;
}

async function setApplicationTypes(requirementId, applicationTypes) {
  const types = Array.isArray(applicationTypes)
    ? [...new Set(applicationTypes.map((t) => String(t).trim().toUpperCase()).filter(Boolean))]
    : [];
  await runInTransaction(async (tx) => {
    await tx.query(`DELETE FROM dbo.requirement_application_types WHERE requirement_id = @param0`, [requirementId]);
    for (const type of types) {
      await tx.query(
        `INSERT INTO dbo.requirement_application_types (requirement_id, application_type) VALUES (@param0, @param1)`,
        [requirementId, type]
      );
    }
  });
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
      r.deactivated_via_cascade,
      r.created_by,
      r.updated_by,
      r.created_at,
      r.updated_at
    FROM dbo.requirements r
    LEFT JOIN dbo.requirement_categories rc ON rc.id = r.category_id
    WHERE r.is_ad_hoc = 0
    ORDER BY r.id DESC
  `);
  const mapped = rows.map(mapRow);
  return attachApplicationTypes(mapped);
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
      r.deactivated_via_cascade,
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
  if (!row) return null;
  const [mapped] = await attachApplicationTypes([mapRow(row)]);
  return mapped;
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
  application_types,
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
  if (application_types !== undefined) await setApplicationTypes(id, application_types);
  return getRequirementById(id);
}

async function updateRequirement(
  id,
  { code, name, description, category_id, for_new, for_renewal, is_mandatory, is_active, application_types, updated_by }
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

  if (application_types !== undefined) await setApplicationTypes(id, application_types);

  return getRequirementById(id);
}

async function deactivateRequirement(id, updated_by, viaCascade = false) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.requirements
    SET is_active = 0, deactivated_via_cascade = @param2, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy, viaCascade ? 1 : 0]
  );
  return getRequirementById(id);
}

async function reactivateRequirement(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.requirements
    SET is_active = 1, deactivated_via_cascade = 0, updated_by = @param1, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return getRequirementById(id);
}

async function markAdHoc(id) {
  await ensureSchema();
  await updateData(`UPDATE dbo.requirements SET is_ad_hoc = 1 WHERE id = @param0`, [id]);
}

module.exports = {
  ensureSchema,
  listRequirements,
  getRequirementById,
  createRequirement,
  updateRequirement,
  deactivateRequirement,
  reactivateRequirement,
  markAdHoc,
};
