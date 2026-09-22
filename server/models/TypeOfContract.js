const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


// Legacy BRIDGE dbTOC master list (only its Description is kept — the legacy RefNo was just a running number). Kept in sync with
// server/sql/002_type_of_contract.sql.
const DEFAULT_NAMES = [
  "LEASE AGREEMENT",
  "SHORT-TERM LEASE AGREEMENT",
  "SUPPLEMENTAL LEASE AGREEMENT",
  "APPROVAL OF SUBLEASE AGREEMENT",
  "CONFIRMATION OF SUBLEASE AGREEMENT",
  "MEMORANDUM OF AGREEMENT",
];

let defaultsSeeded = false;

/** Inserts any default whose name is missing. Matched by name only, and rows are only
 * ever deactivated (never deleted), so this can't resurrect or overwrite anything an
 * admin changed. */
async function seedDefaults() {
  if (defaultsSeeded) return;
  defaultsSeeded = true;
  try {
    const values = DEFAULT_NAMES.map((_, i) => `(@param${i})`).join(", ");
    await updateData(
      `
      INSERT INTO dbo.type_of_contract (name)
      SELECT v.name
      FROM (VALUES ${values}) AS v(name)
      WHERE NOT EXISTS (SELECT 1 FROM dbo.type_of_contract x WHERE x.name = v.name)
      `,
      DEFAULT_NAMES
    );
  } catch (error) {
    defaultsSeeded = false;
    console.error("Default type of contract seed failed:", error);
  }
}


let ensurePromise = null;

/** Creates the table and seeds the defaults. Memoised per process: every model call awaits
 * this, and re-checking the schema on each request is wasted work. A failure clears the
 * memo so the next call retries. */
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
    IF OBJECT_ID('dbo.type_of_contract', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.type_of_contract (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name NVARCHAR(255) NOT NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_type_of_contract_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_type_of_contract_is_active DEFAULT (1)
      );

      CREATE UNIQUE INDEX UX_type_of_contract_name ON dbo.type_of_contract(name);
    END
  `);
  await seedDefaults();
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

async function listTypeOfContracts() {
  await ensureSchema();
  const rows = await selectData(`SELECT ${COLUMNS} FROM dbo.type_of_contract x ORDER BY x.name ASC`);
  return rows.map(mapRow);
}

async function getTypeOfContractById(id) {
  await ensureSchema();
  const rows = await selectData(`SELECT TOP (1) ${COLUMNS} FROM dbo.type_of_contract x WHERE x.id = @param0`, [id]);
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function createTypeOfContract({ name, created_by, is_active = 1 }) {
  await ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.type_of_contract (name, created_by, updated_by, created_at, updated_at, is_active)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, NULL, GETDATE(), NULL, @param2)
    `,
    [name, toInt(created_by), is_active ? 1 : 0]
  );
  return getTypeOfContractById(result?.recordset?.[0]?.id);
}

async function updateTypeOfContract(id, { name, is_active, updated_by }) {
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
      UPDATE dbo.type_of_contract
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }
  return getTypeOfContractById(id);
}

async function setTypeOfContractActive(id, active, updated_by) {
  await ensureSchema();
  await updateData(
    `
    UPDATE dbo.type_of_contract
    SET is_active = @param1, updated_by = @param2, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, active ? 1 : 0, toInt(updated_by)]
  );
  return getTypeOfContractById(id);
}

const deactivateTypeOfContract = (id, updated_by) => setTypeOfContractActive(id, false, updated_by);
const reactivateTypeOfContract = (id, updated_by) => setTypeOfContractActive(id, true, updated_by);

module.exports = {
  ensureSchema,
  listTypeOfContracts,
  getTypeOfContractById,
  createTypeOfContract,
  updateTypeOfContract,
  deactivateTypeOfContract,
  reactivateTypeOfContract,
};
