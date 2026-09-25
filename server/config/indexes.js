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

module.exports = { ensureIndexes, INDEXES };
