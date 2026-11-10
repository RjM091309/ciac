const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


let ensurePromise = null;

/** Type of Property (File Maintenance) — the Property Schedule's "Type of
 * Property" options. Creates the table. Memoised per process; a failure clears
 * the memo so the next call retries. Seeded once, only when the table is first
 * created, with the two types that were fixed in the code (OPEN SPACE,
 * STRUCTURE); after that the list is maintained on the page. */
function ensureSchema() {
  if (!ensurePromise) {
    ensurePromise = createSchema().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

async function createSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.property_type', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.property_type (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name NVARCHAR(255) NOT NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_property_type_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_property_type_is_active DEFAULT (1)
      );

      CREATE UNIQUE INDEX UX_property_type_name ON dbo.property_type(name);

      INSERT INTO dbo.property_type (name, created_at, is_active) VALUES (N'OPEN SPACE', SYSUTCDATETIME(), 1), (N'STRUCTURE', SYSUTCDATETIME(), 1);
    END
  `);
}

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    is_active: row.is_active,
  };
}

const COLUMNS = "x.id, x.name, x.created_by, x.updated_by, x.created_at, x.updated_at, x.is_active";

async function listPropertyTypes() {
  await ensureSchema();
  const rows = await selectData(`SELECT ${COLUMNS} FROM dbo.property_type x ORDER BY x.name ASC`);
  return rows.map(mapRow);
}

async function getPropertyTypeById(id) {
  await ensureSchema();
  const rows = await selectData(`SELECT TOP (1) ${COLUMNS} FROM dbo.property_type x WHERE x.id = @param0`, [id]);
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function createPropertyType({ name, created_by, is_active = 1 }) {
  await ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.property_type (name, created_by, updated_by, created_at, updated_at, is_active)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, NULL, GETDATE(), NULL, @param2)
    `,
    [name, toInt(created_by), is_active ? 1 : 0]
  );
  return getPropertyTypeById(result?.recordset?.[0]?.id);
}

async function updatePropertyType(id, { name, is_active, updated_by }) {
  await ensureSchema();
  const sets = [];
  const params = [];
  const pushSet = (sqlFrag, value) => {
    sets.push(sqlFrag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (name !== undefined) pushSet("name = ?", name);
  if (is_active !== undefined) pushSet("is_active = ?", is_active ? 1 : 0);
  const updatedBy = toInt(updated_by);
  if (updatedBy !== null) pushSet("updated_by = ?", updatedBy);
  if (sets.length) {
    const query = `
      UPDATE dbo.property_type
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }
  return getPropertyTypeById(id);
}

async function setPropertyTypeActive(id, active, updated_by) {
  await ensureSchema();
  await updateData(
    `
    UPDATE dbo.property_type
    SET is_active = @param1, updated_by = @param2, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, active ? 1 : 0, toInt(updated_by)]
  );
  return getPropertyTypeById(id);
}

const deactivatePropertyType = (id, updated_by) => setPropertyTypeActive(id, false, updated_by);
const reactivatePropertyType = (id, updated_by) => setPropertyTypeActive(id, true, updated_by);

module.exports = {
  ensureSchema,
  listPropertyTypes,
  getPropertyTypeById,
  createPropertyType,
  updatePropertyType,
  deactivatePropertyType,
  reactivatePropertyType,
};
