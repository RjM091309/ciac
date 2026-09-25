const { updateSchema } = require("./database");

// Indexes on the columns the app filters and joins on most. The models only
// create their indexes inside their "IF OBJECT_ID(...) IS NULL" table-creation
// block, so a table that already existed before that code (the dev server's,
// a restored dump) never got them. Each index here is checked by name on its
// own, so this also backfills those databases. Names match the ones the
// models use, so a fresh install that already created them is left alone.
const INDEXES = [
  // Read on every page load and by the notification stream, per user, newest first.
  ["IX_notifications_user_id", "notifications", "user_id, created_at DESC"],
  ["IX_applications_proponent_id", "applications", "proponent_id"],
  ["IX_applications_status", "applications", "status"],
  ["IX_applications_current_officer_id", "applications", "current_officer_id"],
  ["IX_app_req_requirement_id", "application_requirements", "requirement_id"],
  ["IX_app_status_history_app_id", "application_status_history", "application_id"],
  ["IX_documents_application_id", "documents", "application_id"],
  ["IX_documents_requirement_id", "documents", "requirement_id"],
  ["IX_proponents_user_id", "proponents", "user_id"],
  ["IX_user_roles_role_id", "user_roles", "role_id"],
  // Last-login lookup per user (AuditLog.js).
  ["IX_audit_logs_user_id", "audit_logs", "user_id"],
  // A record's own history, e.g. a locator's Activity tab in Compliance
  // (ComplianceInspection.listLocatorActivity).
  ["IX_audit_logs_entity", "audit_logs", "entity_type, entity_id"],
  // Requirements per category: the Requirement Categories list and the
  // application-type deactivate/reactivate cascade (ApplicationType.js).
  ["IX_requirements_category_id", "requirements", "category_id"],
];

// Indexes another index already covers (same leading key), dropped when that
// covering index is present. They only cost extra work on every write.
const REDUNDANT = [
  // [redundant index, table, covering index]
  ["IX_proponent_financial_terms_proponent", "proponent_financial_terms", "UX_proponent_financial_terms_proponent_type"],
  ["IX_proponent_investment_proponent", "proponent_investment", "UX_proponent_investment_proponent_metric"],
];

async function ensureIndexes() {
  for (const [name, table, columns] of INDEXES) {
    // Skip (rather than fail) when the table or a key column is missing.
    const columnChecks = columns
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .map((column) => `AND COL_LENGTH('dbo.${table}', '${column}') IS NOT NULL`)
      .join(" ");
    const result = await updateSchema(`
      IF OBJECT_ID('dbo.${table}', 'U') IS NOT NULL ${columnChecks}
        AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${name}' AND object_id = OBJECT_ID('dbo.${table}'))
      BEGIN
        -- EXEC defers compiling it: SQL Server validates the whole batch up
        -- front, so a direct CREATE INDEX on a missing column would fail even
        -- with the checks above false.
        EXEC('CREATE INDEX ${name} ON dbo.${table}(${columns})');
        SELECT 1 AS created;
      END
    `);
    if (result?.recordset?.[0]?.created) console.log(`Created index ${name} on dbo.${table}`);
  }
}

async function dropRedundantIndexes() {
  for (const [name, table, coveredBy] of REDUNDANT) {
    const result = await updateSchema(`
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${name}' AND object_id = OBJECT_ID('dbo.${table}'))
        AND EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${coveredBy}' AND object_id = OBJECT_ID('dbo.${table}'))
      BEGIN
        DROP INDEX ${name} ON dbo.${table};
        SELECT 1 AS dropped;
      END
    `);
    if (result?.recordset?.[0]?.dropped) console.log(`Dropped redundant index ${name} on dbo.${table}`);
  }

  // Tables created by the original schema carry an auto-named unique
  // constraint on applications.application_no (UQ__applicat__…, a different
  // name in every database) alongside the model's UX_applications_application_no.
  // Drop the auto-named one once UX_ exists; uniqueness stays enforced by UX_.
  const result = await updateSchema(`
    DECLARE @name SYSNAME = (
      SELECT TOP (1) kc.name
      FROM sys.key_constraints kc
      JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE kc.parent_object_id = OBJECT_ID('dbo.applications') AND kc.type = 'UQ' AND c.name = 'application_no'
        AND (SELECT COUNT(1) FROM sys.index_columns x WHERE x.object_id = ic.object_id AND x.index_id = ic.index_id) = 1
    );
    IF @name IS NOT NULL
      AND EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_applications_application_no' AND object_id = OBJECT_ID('dbo.applications'))
    BEGIN
      EXEC('ALTER TABLE dbo.applications DROP CONSTRAINT [' + @name + ']');
      SELECT @name AS dropped;
    END
  `);
  const dropped = result?.recordset?.[0]?.dropped;
  if (dropped) console.log(`Dropped duplicate unique constraint ${dropped} on dbo.applications(application_no)`);
}

module.exports = { ensureIndexes, dropRedundantIndexes, INDEXES, REDUNDANT };
