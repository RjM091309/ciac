/**
 * Account Officers (File Maintenance). Not a separate table: an account officer
 * is a dbo.users row holding the ACCOUNT OFFICER role, so proponents.account_officer_id,
 * notifications and the audit trail keep pointing at one identity. This model is
 * the officer-shaped view over that — plus the officer's department
 * (dbo.users.department_id -> dbo.department).
 */
const { selectData, updateData } = require("../config/database");
const User = require("./User");
const Role = require("./Role");

const ROLE_NAME = "ACCOUNT OFFICER";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const SELECT_OFFICERS = `
  SELECT
    u.id,
    u.username,
    u.full_name,
    u.email,
    u.phone,
    u.is_active,
    u.created_at,
    u.updated_at,
    u.department_id,
    d.code AS department_code,
    d.name AS department_name,
    (SELECT COUNT(*) FROM dbo.proponents p WHERE p.account_officer_id = u.id) AS locator_count
  FROM dbo.users u
  INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
  INNER JOIN dbo.roles r ON r.id = ur.role_id AND UPPER(r.name) = '${ROLE_NAME}'
  LEFT JOIN dbo.department d ON d.id = u.department_id
`;

function mapRow(row) {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    is_active: row.is_active,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    department_id: row.department_id ?? null,
    department_code: row.department_code ?? null,
    department_name: row.department_name ?? null,
    locator_count: Number(row.locator_count) || 0,
  };
}

async function listAccountOfficers() {
  const rows = await selectData(`${SELECT_OFFICERS} ORDER BY u.full_name ASC, u.id ASC`);
  return rows.map(mapRow);
}

async function getAccountOfficerById(id) {
  const rows = await selectData(`${SELECT_OFFICERS} WHERE u.id = @param0`, [id]);
  return rows?.[0] ? mapRow(rows[0]) : null;
}

async function setDepartment(userId, departmentId) {
  await updateData(`UPDATE dbo.users SET department_id = @param1, updated_at = GETDATE() WHERE id = @param0`, [
    userId,
    toInt(departmentId),
  ]);
}

async function createAccountOfficer({ username, email, phone, full_name, password, department_id }) {
  const roleId = await Role.getActiveRoleIdByName(ROLE_NAME);
  if (!roleId) throw new Error(`The ${ROLE_NAME} role does not exist or is inactive.`);
  const user = await User.createUser({ username, email, phone, full_name, password, role_id: roleId });
  if (user?.id && toInt(department_id)) await setDepartment(user.id, department_id);
  return getAccountOfficerById(user?.id);
}

/** Only touches users that are actually account officers, so this endpoint can't
 * be used to edit an arbitrary account through the File Maintenance permission. */
async function updateAccountOfficer(id, { username, email, phone, full_name, department_id }) {
  const existing = await getAccountOfficerById(id);
  if (!existing) return null;
  await User.updateUser(id, { username, email, phone, full_name });
  if (department_id !== undefined) await setDepartment(id, department_id);
  return getAccountOfficerById(id);
}

async function deactivateAccountOfficer(id) {
  if (!(await getAccountOfficerById(id))) return null;
  await User.deactivateUser(id);
  return getAccountOfficerById(id);
}

async function reactivateAccountOfficer(id) {
  if (!(await getAccountOfficerById(id))) return null;
  await User.reactivateUser(id);
  return getAccountOfficerById(id);
}

// The legacy BRIDGE account officers that were migrated as "(Legacy Import)" users
// (see scripts/migrate-legacy-locators.js) -> their department code. Kept in sync
// with server/sql/001_departments_and_account_officers.sql.
const LEGACY_OFFICER_DEPARTMENTS = [
  ["TJ GALVEZ (Legacy Import)", "MD"],
  ["JANE PINEDA (Legacy Import)", "MD"],
  ["MIRIAM PAMINDANAN (Legacy Import)", "MD"],
  ["LYN SANCHEZ (Legacy Import)", "MD"],
];

/** Boot-time, idempotent: gives the migrated legacy officers the ACCOUNT OFFICER role
 * and their department. Only touches a user that still has no role / no department,
 * so it never overrides something an admin set, and it does nothing on a database
 * where those users don't exist. */
async function applyLegacyOfficerDefaults() {
  const roleId = await Role.getActiveRoleIdByName(ROLE_NAME);
  if (!roleId) return;
  for (const [fullName, deptCode] of LEGACY_OFFICER_DEPARTMENTS) {
    await updateData(
      `
      INSERT INTO dbo.user_roles (user_id, role_id)
      SELECT u.id, @param1 FROM dbo.users u
      WHERE u.full_name = @param0
        AND NOT EXISTS (SELECT 1 FROM dbo.user_roles ur WHERE ur.user_id = u.id);

      UPDATE u SET u.department_id = d.id
      FROM dbo.users u
      INNER JOIN dbo.department d ON d.code = @param2
      WHERE u.full_name = @param0 AND u.department_id IS NULL;
      `,
      [fullName, roleId, deptCode]
    );
  }
}

module.exports = {
  applyLegacyOfficerDefaults,
  listAccountOfficers,
  getAccountOfficerById,
  createAccountOfficer,
  updateAccountOfficer,
  deactivateAccountOfficer,
  reactivateAccountOfficer,
};
