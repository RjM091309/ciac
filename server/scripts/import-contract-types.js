/**
 * Adds "Type of Contract" values as rows in dbo.application_types (the same
 * shared catalog table Business Type/Industry already use — see
 * import-industry-as-application-types.js for why one catalog table, many
 * reference columns, is the established pattern here), then sets each
 * migrated legacy locator's current contract (dbo.contracts.contract_type_code)
 * to match what bridge_import.dbo.dbLocator.TypeContract actually recorded.
 *
 * Idempotent: skips codes that already exist, skips contracts whose
 * contract_type_code is already set.
 * Usage: node server/scripts/import-contract-types.js
 */
const { selectData, updateData } = require("../config/database");
const ApplicationType = require("../models/ApplicationType");
const Contract = require("../models/Contract");

function toCode(label) {
  return (
    "TOC_" +
    String(label)
      .trim()
      .toUpperCase()
      .replace(/&/g, "AND")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  );
}

function toTitleCase(label) {
  return String(label)
    .trim()
    .toUpperCase();
}

async function run() {
  await ApplicationType.ensureSchema();
  await Contract.ensureSchema();

  const legacyRows = await selectData(`
    SELECT RefNo, TypeContract
    FROM bridge_import.dbo.dbLocator
    WHERE (Deleted = 0 OR Deleted IS NULL) AND TypeContract IS NOT NULL AND LTRIM(RTRIM(TypeContract)) <> ''
  `);

  const labelByNormalized = new Map();
  for (const row of legacyRows) {
    const normalized = String(row.TypeContract).trim().toUpperCase();
    if (!labelByNormalized.has(normalized)) labelByNormalized.set(normalized, toTitleCase(row.TypeContract));
  }

  console.log(`Found ${labelByNormalized.size} distinct contract-type labels across ${legacyRows.length} locators.`);

  const codeByNormalized = new Map();
  for (const [normalized, label] of labelByNormalized) {
    const code = toCode(normalized);
    const existing = await ApplicationType.getByCode(code);
    if (!existing) {
      await ApplicationType.createApplicationType({
        code,
        name: label,
        description: "Imported from the legacy BRIDGE system's Type of Contract classification.",
      });
      console.log(`Created application type ${code} ("${label}").`);
    }
    codeByNormalized.set(normalized, code);
  }

  let updated = 0;
  for (const row of legacyRows) {
    const refNo = String(row.RefNo || "").trim();
    if (!refNo) continue;
    const code = codeByNormalized.get(String(row.TypeContract).trim().toUpperCase());
    if (!code) continue;

    const proponentRows = await selectData(`SELECT id FROM dbo.proponents WHERE ref_no = @param0`, [refNo]);
    const proponentId = proponentRows?.[0]?.id;
    if (!proponentId) continue;

    const applied = await Contract.setContractTypeForProponent(proponentId, code, null);
    if (applied) updated++;
  }

  console.log(`Set contract_type_code on ${updated} migrated locators' contracts.`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Contract type import failed:", error);
    process.exit(1);
  });
