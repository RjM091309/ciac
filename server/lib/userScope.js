// Which accounts a non-admin user manager may see and manage on User
// Management / Locator Accounts: only staff in their own role(s) — a Level 1
// BDO sees BDO accounts, a Level 1 Account Officer sees Account Officers —
// plus locator accounts when they hold Locator Accounts. Admins see everyone.
const { selectData } = require("../config/database");
const Role = require("../models/Role");

/** null = no limit (admin); otherwise the role ids this viewer may manage. */
async function scopeFor(user) {
  const role = String(user?.role || "").trim().toLowerCase();
  if (role === "admin") return null;
  // Lazy: m_auth requires this module.
  const { checkMenuAllowed } = require("../middleware/m_auth");
  const { blockedByLevel } = require("./departments");
  const roleIds = new Set();
  // Own staff role(s): User Management, which Level 2 BDO / AO never get.
  if ((await checkMenuAllowed(role, "settings:users", "view")) && !(await blockedByLevel(user, "settings:users"))) {
    const rows = await selectData(`SELECT role_id FROM dbo.user_roles WHERE user_id = @param0`, [Number(user?.id) || 0]);
    rows.forEach((r) => roleIds.add(Number(r.role_id)));
  }
  const locatorRoleId = Number(await Role.getActiveRoleIdByName("proponent")) || null;
  if (locatorRoleId) {
    roleIds.delete(locatorRoleId);
    if (await checkMenuAllowed(role, "settings:locator-users", "view")) roleIds.add(locatorRoleId);
  }
  // Never an admin account, even for a viewer that also holds the admin role
  // as a second role.
  const adminRoleId = Number(await Role.getActiveRoleIdByName("admin")) || null;
  if (adminRoleId) roleIds.delete(adminRoleId);
  return roleIds;
}

/** An account is in scope when every role it holds is one the viewer manages. */
function inScope(scope, roleIds) {
  if (!scope) return true;
  const ids = (roleIds || []).map(Number).filter(Boolean);
  return ids.length > 0 && ids.every((id) => scope.has(id));
}

async function userInScope(scope, userId) {
  if (!scope) return true;
  const rows = await selectData(`SELECT role_id FROM dbo.user_roles WHERE user_id = @param0`, [Number(userId) || 0]);
  return inScope(
    scope,
    rows.map((r) => r.role_id)
  );
}

module.exports = { scopeFor, inScope, userInScope };
