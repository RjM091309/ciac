/**
 * Per explicit direction: Industry and Application Type are treated as the
 * same concept under different terms, sharing one catalog/one column. This
 * adds every distinct Industry value found on the migrated legacy locators
 * (bridge_import.dbo.dbLocator) as new rows in dbo.application_types, then
 * repoints each migrated locator's synthetic application
 * (application_no = 'LEGACY-<RefNo>', see migrate-legacy-locators.js) at its
 * real Industry code instead of the TypeContract-derived lease-type code —
 * so the Locators List's "Industry" column (sourced from application_type,
 * see listProponentsForLocatorList in models/Proponent.js) shows the actual
 * historical industry.
 *
 * Idempotent: re-running skips codes/updates that already match.
 * Usage: node server/scripts/import-industry-as-application-types.js
 */
const { selectData, updateData } = require("../config/database");
const ApplicationType = require("../models/ApplicationType");

function toCode(label) {
  return (
    "IND_" +
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
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function run() {
  await ApplicationType.ensureSchema();

  const legacyRows = await selectData(`
    SELECT RefNo, Industry
    FROM bridge_import.dbo.dbLocator
    WHERE (Deleted = 0 OR Deleted IS NULL) AND Industry IS NOT NULL AND LTRIM(RTRIM(Industry)) <> ''
  `);

  // Distinct, case-insensitively deduped industry labels -> canonical label.
  const industryByNormalized = new Map();
  for (const row of legacyRows) {
    const normalized = String(row.Industry).trim().toUpperCase();
    if (!industryByNormalized.has(normalized)) {
      industryByNormalized.set(normalized, toTitleCase(row.Industry));
    }
  }

  console.log(`Found ${industryByNormalized.size} distinct industry labels across ${legacyRows.length} locators.`);

  const codeByNormalized = new Map();
  for (const [normalized, label] of industryByNormalized) {
    const code = toCode(normalized);
    const existing = await ApplicationType.getByCode(code);
    if (!existing) {
      await ApplicationType.createApplicationType({
        code,
        name: label,
        description: "Imported from the legacy BRIDGE system's Industry classification.",
      });
      console.log(`Created application type ${code} ("${label}").`);
    }
    codeByNormalized.set(normalized, code);
  }

  let updated = 0;
  for (const row of legacyRows) {
    const refNo = String(row.RefNo || "").trim();
    if (!refNo) continue;
    const code = codeByNormalized.get(String(row.Industry).trim().toUpperCase());
    if (!code) continue;

    const result = await updateData(
      `
      UPDATE a
      SET a.application_type = @param1
      FROM dbo.applications a
      WHERE a.application_no = @param0 AND a.application_type <> @param1
      `,
      [`LEGACY-${refNo}`, code]
    );
    if (result?.rowsAffected?.[0]) updated++;
  }

  console.log(`Repointed ${updated} migrated applications to their real Industry type.`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Industry import failed:", error);
    process.exit(1);
  });
