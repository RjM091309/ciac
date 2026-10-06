/**
 * One-time migration: the ASSESSMENT OFFICER role becomes BDO. It's one role;
 * Level 1 / Level 2 is each user's level (users.assessment_level, set in User
 * Management): 1 = Level 1 (assigns evaluators, final recommendation),
 * anything else = Level 2 (creates locator accounts/applications, evaluates
 * what's assigned to them).
 *
 * Also folds in the short-lived separate BDO1/BDO2 roles (with a
 * roles.assessment_level column) if a database has them: their users move to
 * BDO (BDO1 holders get level 1), and those roles and the column are removed.
 *
 * Users whose role changes are signed out (token_version bump), since the
 * role name is in the JWT. Admins are left signed in.
 *
 * Idempotent: safe to re-run.
 *
 * Usage: node server/scripts/migrate-assessment-officer-to-bdo.js
 */
const { initializeDatabase, updateSchema, updateData, selectData } = require("../config/database");

const DESCRIPTION = "Locator applications and evaluation (Level 1 assigns, Level 2 evaluates)";

async function roleIdByName(name) {
  const rows = await selectData(`SELECT TOP (1) id FROM dbo.roles WHERE LOWER(name) = LOWER(@param0)`, [name]);
  return rows?.[0]?.id ?? null;
}

async function run() {
  await initializeDatabase();
  const touched = new Set();

  // 1. The BDO role: rename ASSESSMENT OFFICER (or the old BDO2 role) so its
  //    users and Control Panel permissions carry over.
  let bdo = await roleIdByName("BDO");
  for (const oldName of ["ASSESSMENT OFFICER", "BDO2"]) {
    if (bdo) break;
    const id = await roleIdByName(oldName);
    if (id) {
      console.log(`Renaming ${oldName} (id ${id}) to BDO...`);
      await updateData(`UPDATE dbo.roles SET name = 'BDO', description = @param1, is_active = 1 WHERE id = @param0`, [
        id,
        DESCRIPTION,
      ]);
      bdo = id;
      (await selectData(`SELECT user_id FROM dbo.user_roles WHERE role_id = @param0`, [id])).forEach((r) => touched.add(r.user_id));
    }
  }
  if (!bdo) {
    console.log("Creating BDO...");
    await updateData(`INSERT INTO dbo.roles (name, description, is_active) VALUES ('BDO', @param0, 1)`, [DESCRIPTION]);
    bdo = await roleIdByName("BDO");
  }

  // 2. Fold any leftover separate BDO1 / BDO2 / ASSESSMENT OFFICER roles into BDO.
  for (const [oldName, level] of [
    ["BDO1", 1],
    ["BDO2", null],
    ["ASSESSMENT OFFICER", null],
  ]) {
    const id = await roleIdByName(oldName);
    if (!id || id === bdo) continue;
    const users = await selectData(`SELECT user_id FROM dbo.user_roles WHERE role_id = @param0`, [id]);
    for (const { user_id } of users) {
      console.log(`Moving user ${user_id} from ${oldName} to BDO${level ? " (Level 1)" : ""}...`);
      await updateData(
        `IF NOT EXISTS (SELECT 1 FROM dbo.user_roles WHERE user_id = @param0 AND role_id = @param1)
           INSERT INTO dbo.user_roles (user_id, role_id) VALUES (@param0, @param1)`,
        [user_id, bdo]
      );
      if (level) await updateData(`UPDATE dbo.users SET assessment_level = @param1 WHERE id = @param0`, [user_id, level]);
      touched.add(user_id);
    }
    console.log(`Removing role ${oldName} (id ${id})...`);
    await updateData(`DELETE FROM dbo.user_roles WHERE role_id = @param0`, [id]);
    for (const table of ["role_sidebar_menu_permissions", "role_menu_crud_permissions", "role_dashboard_widget_permissions"]) {
      await updateData(`DELETE FROM dbo.${table} WHERE role_id = @param0`, [id]);
    }
    try {
      await updateData(`DELETE FROM dbo.roles WHERE id = @param0`, [id]);
    } catch {
      // Still referenced somewhere — retire it instead.
      await updateData(`UPDATE dbo.roles SET is_active = 0, name = CONCAT(name, ' (retired)') WHERE id = @param0`, [id]);
    }
  }

  // 3. The level lives on the user, not the role.
  await updateSchema(`
    IF COL_LENGTH('dbo.roles', 'assessment_level') IS NOT NULL
      ALTER TABLE dbo.roles DROP COLUMN assessment_level;
  `);

  // 4. Sign out non-admin users whose role name changed.
  const ids = [...touched].map(Number).filter(Number.isFinite);
  if (ids.length) {
    const result = await updateData(
      `UPDATE dbo.users SET token_version = ISNULL(token_version, 0) + 1
       WHERE id IN (${ids.join(", ")})
         AND id NOT IN (SELECT ur.user_id FROM dbo.user_roles ur INNER JOIN dbo.roles r ON r.id = ur.role_id WHERE LOWER(r.name) = 'admin')`
    );
    console.log(`Signed out ${result?.rowsAffected?.[0] ?? 0} account(s).`);
  }
  console.log(`Done. BDO = role ${bdo}. Set each user's Level 1 / Level 2 in User Management. Restart the backend.`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
