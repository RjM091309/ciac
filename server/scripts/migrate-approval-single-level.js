/**
 * One-time migration: collapses the Approval & Issuance module's old
 * configurable multi-level routing (dbo.approval_levels, up to 3 levels —
 * "Account Officer Review" -> "Division Chief Endorsement" -> "Approving
 * Authority") down to a single hardcoded approval step, matching the code
 * change in server/models/ApprovalIssuance.js (startApproval no longer loops
 * over levels; actOnStep no longer advances to a "next level").
 *
 * Run this ONCE against every database this app talks to after pulling that
 * change — including each teammate's own local dev DB and any shared/
 * staging/production server — otherwise the app will throw on the very next
 * approval started: the old dbo.approval_steps.level_no/level_name columns
 * are NOT NULL with no default, and the new code's INSERT no longer supplies
 * them.
 *
 * Idempotent and safe to re-run: every step is guarded by an existence check
 * (OBJECT_ID/COL_LENGTH), so running it twice, or against a DB that was
 * never on the old multi-level schema in the first place (a fresh install,
 * or one already migrated), is a no-op.
 *
 * Safety verified before this was first run (2026-09-24, on this session's
 * DB): dbo.approval_levels had 3 rows (1 active, 2 already disabled),
 * dbo.approval_level_assignees and dbo.approval_step_assignees were both
 * empty, and every existing dbo.approval_steps row was already level_no = 1
 * with level_id NULL — so there was no in-flight application sitting at
 * level 2/3 and nothing gets orphaned by this. If a database has since
 * accumulated real level-2/3 activity, STOP and review before running this.
 *
 * Usage: node server/scripts/migrate-approval-single-level.js
 */
const { initializeDatabase, updateSchema, updateData, selectData } = require("../config/database");

async function columnExists(table, column) {
  const rows = await selectData(
    `SELECT COL_LENGTH('dbo.${table}', '${column}') AS len`
  );
  return rows?.[0]?.len !== null;
}

async function tableExists(table) {
  const rows = await selectData(`SELECT OBJECT_ID('dbo.${table}', 'U') AS id`);
  return rows?.[0]?.id !== null;
}

async function run() {
  await initializeDatabase();

  console.log("Dropping FK_approval_steps_level (if present)...");
  await updateSchema(`
    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_approval_steps_level')
      ALTER TABLE dbo.approval_steps DROP CONSTRAINT FK_approval_steps_level;
  `);

  // Checked per column: some DBs were only partially on the old schema (e.g.
  // level_no/level_name present but level_id never added), so gating all of
  // these on level_id alone left NOT NULL level_no behind and broke INSERTs.
  for (const column of ["level_id", "level_no", "level_name", "role_id", "role_name"]) {
    if (await columnExists("approval_steps", column)) {
      console.log(`Dropping dbo.approval_steps.${column}...`);
      await updateData(`ALTER TABLE dbo.approval_steps DROP COLUMN ${column}`);
    } else {
      console.log(`dbo.approval_steps already has no ${column} column — skipping.`);
    }
  }

  if (await columnExists("application_approvals", "current_level_no")) {
    console.log("Dropping dbo.application_approvals.current_level_no...");
    await updateData(`ALTER TABLE dbo.application_approvals DROP COLUMN current_level_no`);
  } else {
    console.log("dbo.application_approvals already has no current_level_no column — skipping.");
  }

  if (await tableExists("approval_level_assignees")) {
    console.log("Dropping dbo.approval_level_assignees...");
    await updateData(`DROP TABLE dbo.approval_level_assignees`);
  } else {
    console.log("dbo.approval_level_assignees already gone — skipping.");
  }

  if (await tableExists("approval_step_assignees")) {
    console.log("Dropping dbo.approval_step_assignees...");
    await updateData(`DROP TABLE dbo.approval_step_assignees`);
  } else {
    console.log("dbo.approval_step_assignees already gone — skipping.");
  }

  if (await tableExists("approval_levels")) {
    console.log("Dropping dbo.approval_levels...");
    await updateData(`DROP TABLE dbo.approval_levels`);
  } else {
    console.log("dbo.approval_levels already gone — skipping.");
  }

  console.log("\nDone — dbo.approval_steps and dbo.application_approvals now match the single-level schema.");
  process.exit(0);
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
