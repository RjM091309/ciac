const { updateSchema } = require("./database");

// Tables from the original schema that no code reads or writes any more.
// Dropped on startup (when present) so every database — each teammate's, the
// dev server's, a restored dump — ends up the same without a manual step.
// Order matters: a table must go before the one its foreign key points at.
// Only add a table here once nothing in server/ or src/ touches it.
const UNUSED_TABLES = [
  "application_inspections", // FK -> inspection_types (which stays: inspections still label with it)
  "compliance_checks", // FK -> compliance_types
  "proponent_compliance_checklist", // FK -> compliance_types; replaced by locator_compliance_items
  "inspection_compliance_links", // never used by the current app
  "compliance_types", // replaced by compliance_requirements
  "role_crud_permissions", // replaced by role_menu_crud_permissions
  "role_sidebar_permissions", // replaced by role_sidebar_menu_permissions
  "assessment_findings", // Findings tab removed; per-document remarks replaced it
  "requirement_category_application_types", // category types now derived from requirement_application_types
];

async function dropUnusedLegacyTables() {
  for (const table of UNUSED_TABLES) {
    const result = await updateSchema(`
      IF OBJECT_ID('dbo.${table}', 'U') IS NOT NULL
      BEGIN
        DROP TABLE dbo.${table};
        SELECT 1 AS dropped;
      END
    `);
    if (result?.recordset?.[0]?.dropped) console.log(`Dropped unused legacy table dbo.${table}`);
  }
}

module.exports = { dropUnusedLegacyTables, UNUSED_TABLES };
