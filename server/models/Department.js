const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Legacy BRIDGE dbDepartment master list. Kept in sync with
// server/sql/001_departments_and_account_officers.sql.
const DEFAULT_DEPARTMENTS = [
  ["MD", "MARKETING DEPARTMENT"],
  ["MISD", "MANAGEMENT INFORMATION SYSTEM DEPARTMENT"],
  ["PD", "PROPERTY DEPARTMENT"],
  ["NBVU", "NEW BUSINESS VENTURE UNIT"],
  ["OP", "OFFICE OF THE PRESIDENT AND CEO"],
  ["RMD", "RECORDS MANAGEMENT DEPARTMENT"],
  ["AD", "ADMINISTRATIVE DEPARTMENT"],
  ["BAC", "BIDS AND AWARDS COMMITTEE SECRETARIAT OFFICE"],
  ["BD", "BOARD OF DIRECTORS"],
  ["CCO", "CORPORATE COMMUNICATION OFFICE"],
  ["HRD", "HUMAN RESOURCES DEPARTMENT"],
  ["IAD", "INTERNAL AUDIT DEPARTMENT"],
  ["LSG", "LEGAL SERVICES DEPARTMENT"],
  ["SCMD", "STRATEGY AND CORPORATE MANAGEMENT DEPARTMENT"],
  ["SD", "SECURITY DEPARTMENT"],
  ["TD", "TREASURY DEPARTMENT"],
  ["ED", "ENGINEERING DEPARTMENT"],
  ["FD", "FINANCE DEPARTMENT"],
];

let defaultsSeeded = false;

/** Inserts any default department whose code is missing. Matched by code only, and
 * departments are only ever deactivated (never deleted), so this can't resurrect or
 * overwrite anything an admin changed. */
async function seedDefaultDepartments() {
  if (defaultsSeeded) return;
  defaultsSeeded = true;
  try {
    const params = DEFAULT_DEPARTMENTS.flat();
    const values = DEFAULT_DEPARTMENTS.map((_, i) => `(@param${i * 2}, @param${i * 2 + 1})`).join(", ");
    await updateData(
      `
      INSERT INTO dbo.department (code, name)
      SELECT v.code, v.name
      FROM (VALUES ${values}) AS v(code, name)
      WHERE NOT EXISTS (SELECT 1 FROM dbo.department d WHERE d.code = v.code)
      `,
      params
    );
  } catch (error) {
    defaultsSeeded = false;
    console.error("Default departments seed failed:", error);
  }
}

let ensurePromise = null;

/** Creates the table and seeds the defaults. Memoised per process: every model call
 * awaits this, and re-checking the schema on each request is wasted work. A failure
 * clears the memo so the next call retries. */
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
    IF OBJECT_ID('dbo.department', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.department (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code NVARCHAR(50) NOT NULL,
        name NVARCHAR(255) NOT NULL,
        created_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_department_created_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_department_is_active DEFAULT (1)
      );

      CREATE UNIQUE INDEX UX_department_code ON dbo.department(code);
    END
  `);
  await seedDefaultDepartments();
}

function mapRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    is_active: row.is_active,
  };
}

async function listDepartments() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT d.id, d.code, d.name, d.created_by, d.updated_by, d.created_at, d.updated_at, d.is_active
    FROM dbo.department d
    ORDER BY d.name ASC
  `);
  return rows.map(mapRow);
}

async function getDepartmentById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1) d.id, d.code, d.name, d.created_by, d.updated_by, d.created_at, d.updated_at, d.is_active
    FROM dbo.department d
    WHERE d.id = @param0
    `,
    [id]
  );
  const row = rows?.[0];
  return row ? mapRow(row) : null;
}

async function createDepartment({ code, name, created_by, is_active = 1 }) {
  await ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.department (code, name, created_by, updated_by, created_at, updated_at, is_active)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, NULL, GETDATE(), NULL, @param3)
    `,
    [code, name, toInt(created_by), is_active ? 1 : 0]
  );
  return getDepartmentById(result?.recordset?.[0]?.id);
}

async function updateDepartment(id, { code, name, is_active, updated_by }) {
  await ensureSchema();
  const sets = [];
  const params = [];
  const pushSet = (sqlFrag, value) => {
    sets.push(sqlFrag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (code !== undefined) pushSet("code = ?", code);
  if (name !== undefined) pushSet("name = ?", name);
  if (is_active !== undefined) pushSet("is_active = ?", is_active ? 1 : 0);
  const updatedBy = toInt(updated_by);
  if (updatedBy !== null) pushSet("updated_by = ?", updatedBy);
  if (sets.length) {
    const query = `
      UPDATE dbo.department
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }
  return getDepartmentById(id);
}

async function setDepartmentActive(id, active, updated_by) {
  await ensureSchema();
  await updateData(
    `
    UPDATE dbo.department
    SET is_active = @param1, updated_by = @param2, updated_at = GETDATE()
    WHERE id = @param0
    `,
    [id, active ? 1 : 0, toInt(updated_by)]
  );
  return getDepartmentById(id);
}

const deactivateDepartment = (id, updated_by) => setDepartmentActive(id, false, updated_by);
const reactivateDepartment = (id, updated_by) => setDepartmentActive(id, true, updated_by);

module.exports = {
  ensureSchema,
  listDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deactivateDepartment,
  reactivateDepartment,
};
