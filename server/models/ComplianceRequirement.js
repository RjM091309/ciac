const { selectData, insertData, updateData, updateSchema } = require("../config/database");

// Tags a validation/business-rule rejection with an HTTP status so the
// controller reports it as a client error (400/409) instead of a 500 — same
// pattern as businessError() in AssessmentEvaluation.js.
function clientError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The three tabs of the legacy BRIDGE locator compliance screen. */
const CATEGORIES = ["COMPLIANCE", "PERMITS", "PERFORMANCE"];

/** The legacy BRIDGE compliance screen's rows, seeded into a fresh table.
 * Codes are what dbo.locator_compliance_items.item_code refers to. */
const SEED_REQUIREMENTS = [
  ["INSURANCE", "COMPLIANCE", "Insurance Premium Coverage"],
  ["MONTHLY_GROSS_REVENUE", "COMPLIANCE", "Monthly Gross Revenues Report"],
  ["QUARTERLY_FS", "COMPLIANCE", "Quarterly Financial Statement"],
  ["AFS", "COMPLIANCE", "Audited Financial Statement (AFS)"],
  ["GIS", "COMPLIANCE", "GIS"],
  ["TAX_CLEARANCE", "COMPLIANCE", "Tax Clearance"],
  ["GAD", "COMPLIANCE", "Gender and Development Activities and Programs"],
  ["ATO", "PERMITS", "Authority to Operate"],
  ["FSIC", "PERMITS", "Fire Safety Inspection Certificate"],
  ["SANITARY_PERMIT", "PERMITS", "Sanitary Permit"],
  ["ECC", "PERMITS", "Certificate of Environmental Compliance"],
  ["ANNUAL_INSPECTION", "PERMITS", "Annual Inspection Report or Certificate of Occupancy/Use"],
  ["INVESTMENT_COMMITMENT", "PERFORMANCE", "Investment Commitment"],
  ["EMPLOYMENT_COMMITMENT", "PERFORMANCE", "Employment Commitment"],
];

// Once per process, and shared by concurrent first callers: two requests
// racing through a boolean flag on a fresh install would both see an empty
// table and both seed it, the second failing on the unique code index.
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
    IF OBJECT_ID('dbo.compliance_requirements', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.compliance_requirements (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code NVARCHAR(40) NOT NULL,
        name NVARCHAR(255) NOT NULL,
        category NVARCHAR(20) NOT NULL,
        sort_order INT NOT NULL CONSTRAINT DF_compliance_requirements_sort DEFAULT (0),
        description NVARCHAR(1000) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_compliance_requirements_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_compliance_requirements_is_active DEFAULT (1)
      );
      CREATE UNIQUE INDEX UX_compliance_requirements_code ON dbo.compliance_requirements(code);
    END
  `);
  const existing = await selectData(`SELECT COUNT(1) AS n FROM dbo.compliance_requirements`);
  if (Number(existing?.[0]?.n || 0) === 0) {
    for (let i = 0; i < SEED_REQUIREMENTS.length; i += 1) {
      const [code, category, name] = SEED_REQUIREMENTS[i];
      await insertData(
        `INSERT INTO dbo.compliance_requirements (code, name, category, sort_order, is_active, created_at)
         VALUES (@param0, @param1, @param2, @param3, 1, SYSUTCDATETIME())`,
        [code, name, category, (i + 1) * 10]
      );
    }
  }
  // Permits used to take their types from dbo.compliance_types; the one
  // type in use there with no legacy checklist equivalent is kept here.
  await updateSchema(`
    IF NOT EXISTS (SELECT 1 FROM dbo.compliance_requirements WHERE code = 'MAYORS_PERMIT')
      INSERT INTO dbo.compliance_requirements (code, name, category, sort_order, description, is_active, created_at)
      VALUES ('MAYORS_PERMIT', 'Mayor''s / Business Permit', 'PERMITS', 125,
              'Valid Mayor''s Permit and Business Permit for the current year', 1, SYSUTCDATETIME());
  `);
}

function mapRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    sort_order: Number(row.sort_order || 0),
    description: row.description ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    is_active: row.is_active,
  };
}

const ORDER_BY = `
  ORDER BY CASE category WHEN 'COMPLIANCE' THEN 0 WHEN 'PERMITS' THEN 1 ELSE 2 END, sort_order, id
`;

async function listRequirements({ activeOnly = false } = {}) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT * FROM dbo.compliance_requirements ${activeOnly ? "WHERE is_active = 1" : ""} ${ORDER_BY}`
  );
  return rows.map(mapRow);
}

async function getRequirementById(id) {
  await ensureSchema();
  const rows = await selectData(`SELECT TOP (1) * FROM dbo.compliance_requirements WHERE id = @param0`, [toInt(id)]);
  return rows?.[0] ? mapRow(rows[0]) : null;
}

/** Any requirement by code, active or not (for labelling older records). */
async function getRequirementByCode(code) {
  await ensureSchema();
  const rows = await selectData(`SELECT TOP (1) * FROM dbo.compliance_requirements WHERE code = @param0`, [
    String(code || ""),
  ]);
  return rows?.[0] ? mapRow(rows[0]) : null;
}

async function getActiveRequirementByCode(code) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT TOP (1) * FROM dbo.compliance_requirements WHERE code = @param0 AND is_active = 1`,
    [String(code || "")]
  );
  return rows?.[0] ? mapRow(rows[0]) : null;
}

function normalizeCategory(v) {
  const c = String(v ?? "").trim().toUpperCase();
  if (!CATEGORIES.includes(c)) throw clientError("category must be COMPLIANCE, PERMITS or PERFORMANCE");
  return c;
}

async function createRequirement({ code, name, category, sort_order, description, created_by }) {
  await ensureSchema();
  const cleanCode = String(code).trim().toUpperCase().replace(/\s+/g, "_").slice(0, 40);
  const dup = await selectData(`SELECT TOP (1) id FROM dbo.compliance_requirements WHERE code = @param0`, [cleanCode]);
  if (dup?.length) throw clientError(`Code ${cleanCode} is already used`, 409);
  const result = await insertData(
    `
    INSERT INTO dbo.compliance_requirements
      (code, name, category, sort_order, description, created_by, created_at, is_active)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, @param4, @param5, SYSUTCDATETIME(), 1)
    `,
    [
      cleanCode,
      String(name).trim().slice(0, 255),
      normalizeCategory(category),
      toInt(sort_order) ?? 0,
      description ? String(description).trim().slice(0, 1000) : null,
      toInt(created_by),
    ]
  );
  return getRequirementById(result?.recordset?.[0]?.id);
}

/** Code is fixed once created — saved locator checklist values point at it. */
async function updateRequirement(id, { name, category, sort_order, description, updated_by }) {
  await ensureSchema();
  const sets = [];
  const params = [];
  const push = (frag, value) => {
    sets.push(frag.replace("?", `@param${params.length}`));
    params.push(value);
  };
  if (name !== undefined) push("name = ?", String(name).trim().slice(0, 255));
  if (category !== undefined) push("category = ?", normalizeCategory(category));
  if (sort_order !== undefined) push("sort_order = ?", toInt(sort_order) ?? 0);
  if (description !== undefined) push("description = ?", description ? String(description).trim().slice(0, 1000) : null);
  push("updated_by = ?", toInt(updated_by));
  params.push(toInt(id));
  await updateData(
    `UPDATE dbo.compliance_requirements SET ${sets.join(", ")}, updated_at = SYSUTCDATETIME() WHERE id = @param${params.length - 1}`,
    params
  );
  return getRequirementById(id);
}

async function setActive(id, active, updated_by) {
  await ensureSchema();
  await updateData(
    `UPDATE dbo.compliance_requirements SET is_active = @param1, updated_by = @param2, updated_at = SYSUTCDATETIME() WHERE id = @param0`,
    [toInt(id), active ? 1 : 0, toInt(updated_by)]
  );
  return getRequirementById(id);
}

module.exports = {
  CATEGORIES,
  ensureSchema,
  listRequirements,
  getRequirementById,
  getActiveRequirementByCode,
  getRequirementByCode,
  createRequirement,
  updateRequirement,
  setActive,
};
