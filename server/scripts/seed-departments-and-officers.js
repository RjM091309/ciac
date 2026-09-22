/**
 * One-time, idempotent: brings the legacy BRIDGE department / account-officer
 * master data (dbo.dbDepartment, dbo.dbAccountOfficer) into this app.
 *
 *   1. dbo.department  <- every non-deleted legacy department (matched by code).
 *   2. For each "(Legacy Import)" officer user created by the locator migration
 *      (see migrate-legacy-locators.js / backfill-legacy-profile-fields.js) whose
 *      name matches an active legacy officer: grant the ACCOUNT OFFICER role and
 *      set users.department_id from the legacy officer's department name.
 *      Officers with no legacy match (e.g. TRISHA CAMELLO) are only reported.
 *
 * Dry-run by default — prints what it WOULD do. Pass --apply to write.
 * Legacy database name defaults to "actual" (bridge_import on the VPS):
 *   LEGACY_DB=bridge_import node server/scripts/seed-departments-and-officers.js --apply
 */
const { selectData, updateData } = require("../config/database");
const Department = require("../models/Department");
const Role = require("../models/Role");
const User = require("../models/User");

const APPLY = process.argv.includes("--apply");
const LEGACY_DB = process.env.LEGACY_DB || "actual";
if (!/^\w+$/.test(LEGACY_DB)) throw new Error("LEGACY_DB must be a plain database name");

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

async function run() {
  await Role.ensureSchema();
  await User.ensureSchema(); // also creates dbo.department + users.department_id

  const legacyDepts = await selectData(
    `SELECT DeptCode, Description FROM ${LEGACY_DB}.dbo.dbDepartment WHERE Deleted = 0 OR Deleted IS NULL ORDER BY RefNo`
  );
  const existing = new Set((await Department.listDepartments()).map((d) => d.code.toUpperCase()));

  console.log(`\n[departments] ${legacyDepts.length} in legacy, ${existing.size} already here`);
  for (const d of legacyDepts) {
    const code = norm(d.DeptCode);
    if (!code || existing.has(code)) continue;
    console.log(`  + ${code}  ${norm(d.Description)}`);
    if (APPLY) await Department.createDepartment({ code, name: norm(d.Description) });
  }

  const roleId = await Role.getActiveRoleIdByName("ACCOUNT OFFICER");
  if (!roleId) throw new Error("ACCOUNT OFFICER role not found");

  const deptRows = await Department.listDepartments();
  const deptIdByName = new Map(deptRows.map((d) => [norm(d.name), d.id]));

  const legacyOfficers = await selectData(
    `SELECT Description, Department FROM ${LEGACY_DB}.dbo.dbAccountOfficer WHERE (Deleted = 0 OR Deleted IS NULL) AND Active = 1`
  );
  const legacyByName = new Map(legacyOfficers.map((o) => [norm(o.Description), norm(o.Department)]));

  const users = await selectData(
    `SELECT u.id, u.full_name, u.department_id,
            (SELECT COUNT(*) FROM dbo.user_roles ur WHERE ur.user_id = u.id AND ur.role_id = @param0) AS has_role
     FROM dbo.users u WHERE u.full_name LIKE '% (Legacy Import)'`,
    [roleId]
  );

  console.log(`\n[officers] ${users.length} "(Legacy Import)" users checked`);
  for (const u of users) {
    const name = norm(String(u.full_name).replace(/\(Legacy Import\)\s*$/i, ""));
    if (!legacyByName.has(name)) {
      console.log(`  ? ${name} (user ${u.id}): no active legacy officer with this name — skipped`);
      continue;
    }
    const deptName = legacyByName.get(name);
    const deptId = deptIdByName.get(deptName) ?? null;
    console.log(`  ~ ${name} (user ${u.id}): role ${u.has_role ? "already set" : "+ACCOUNT OFFICER"}, department -> ${deptName || "(none)"}${deptId || !deptName ? "" : "  [department not found yet]"}`);
    if (!APPLY) continue;
    if (!u.has_role) await User.setUserPrimaryRole(u.id, roleId);
    if (deptId) await updateData(`UPDATE dbo.users SET department_id = @param1 WHERE id = @param0`, [u.id, deptId]);
  }

  console.log(APPLY ? "\nApplied." : "\nDry run only — re-run with --apply to write.");
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
