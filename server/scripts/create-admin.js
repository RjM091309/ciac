/**
 * Creates an administrator account — the first sign-in on a fresh database,
 * where nothing else creates one (Role.js seeds only the proponent and
 * Account Officer roles, and every other account is made by an admin from
 * inside the app).
 *
 * Makes sure the schema and the "admin" role exist, then creates the user
 * with a random temporary password, printed once below. The account must
 * set its own password at first sign-in (must_change_password), like any
 * admin-created account.
 *
 * Refuses if the username or email is already taken, so re-running it can't
 * overwrite an existing account.
 *
 * Usage (from the server folder, with server/.env pointing at the target DB):
 *   node scripts/create-admin.js <username> <email> ["Full Name"]
 */
const { initializeDatabase, updateSchema, selectData } = require("../config/database");
const Role = require("../models/Role");
const User = require("../models/User");
const { generateTempPassword } = require("../lib/password");

async function run() {
  const [username, email, fullName] = process.argv.slice(2).map((v) => String(v || "").trim());
  if (!username || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: node scripts/create-admin.js <username> <email> ["Full Name"]');
    process.exit(1);
  }

  const pool = await initializeDatabase();
  if (!pool) {
    console.error("Could not connect to the database — check the DB_* settings in server/.env.");
    process.exit(1);
  }
  await Role.ensureSchema();
  await User.ensureSchema();

  await updateSchema(`
    IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE LOWER(name) = 'admin')
      INSERT INTO dbo.roles (name, description, is_active)
      VALUES ('admin', 'System administrator (bypasses Control Panel permissions)', 1);
  `);
  const adminRoleId = (await selectData(`SELECT TOP (1) id FROM dbo.roles WHERE LOWER(name) = 'admin'`))[0]?.id;

  if (!(await User.isFieldAvailable("username", username))) {
    console.error(`Username "${username}" is already taken — nothing was changed.`);
    process.exit(1);
  }
  if (!(await User.isFieldAvailable("email", email))) {
    console.error(`Email "${email}" is already in use — nothing was changed.`);
    process.exit(1);
  }

  const tempPassword = generateTempPassword(16);
  const user = await User.createUser({
    username,
    email,
    full_name: fullName || username,
    password: tempPassword,
    role_id: adminRoleId,
  });
  await User.setMustChangePassword(user.id, true);

  console.log(`\nAdmin account created: ${user.username} (id ${user.id})`);
  console.log(`Temporary password:    ${tempPassword}`);
  console.log("Sign in with it once; you'll be asked to set your own password. It isn't shown again.\n");
  process.exit(0);
}

run().catch((error) => {
  console.error("Creating the admin failed:", error.message || error);
  process.exit(1);
});
