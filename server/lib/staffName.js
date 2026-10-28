// Staff names. A staff account keeps First / Middle / Surname, and its
// full_name holds the label everyone else sees — in dropdowns, notifications,
// toasts and emails — e.g. "AO - Jane_IP": the role's short name, the first
// name, then the middle and surname initials. The formal name ("Jane I.
// Pineda") is built from the parts for User Management and My Profile.
// Locator (proponent) accounts keep their full_name as typed.
const { selectData, updateData, updateSchema } = require("../config/database");

/** "ACCOUNT OFFICER" → "AO", "BDO" → "BDO", "ADMIN" → "ADMIN". */
function roleAbbrev(roleName) {
  const words = String(roleName || "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]).join("");
  return words[0] || "";
}

const initial = (s) => String(s || "").trim().charAt(0).toUpperCase();
const clean = (s) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, 100);

/** Old single full_name → parts: first word, last word, the rest in between. */
function splitName(full) {
  const parts = clean(full).split(" ").filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || "", middle: "", last: "" };
  return { first: parts[0], middle: parts.slice(1, -1).join(" "), last: parts[parts.length - 1] };
}

/** "Jane I. Pineda" */
function formalName({ first, middle, last }) {
  return [clean(first), initial(middle) ? `${initial(middle)}.` : "", clean(last)].filter(Boolean).join(" ");
}

/** "AO - Jane_IP" */
function displayName({ first, middle, last }, roleName) {
  const initials = `${initial(middle)}${initial(last)}`;
  const name = initials ? `${clean(first)}_${initials}` : clean(first);
  const abbr = roleAbbrev(roleName);
  return abbr ? `${abbr} - ${name}` : name;
}

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF COL_LENGTH('dbo.users', 'first_name') IS NULL ALTER TABLE dbo.users ADD first_name NVARCHAR(100) NULL;
      IF COL_LENGTH('dbo.users', 'middle_name') IS NULL ALTER TABLE dbo.users ADD middle_name NVARCHAR(100) NULL;
      IF COL_LENGTH('dbo.users', 'last_name') IS NULL ALTER TABLE dbo.users ADD last_name NVARCHAR(100) NULL;
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/** The role its label starts with: admin first, else the first staff role. Null for a locator. */
async function primaryStaffRole(userId) {
  const roles = await selectData(
    `SELECT r.name FROM dbo.user_roles ur INNER JOIN dbo.roles r ON r.id = ur.role_id
     WHERE ur.user_id = @param0 ORDER BY CASE WHEN LOWER(r.name) = 'admin' THEN 0 ELSE 1 END, r.id`,
    [Number(userId) || 0]
  );
  const staff = roles.filter((r) => String(r.name || "").trim().toLowerCase() !== "proponent");
  return staff[0]?.name ?? null;
}

/**
 * Saves a staff account's name parts (when given) and rewrites its full_name
 * label from them and its current role. Without parts, uses the saved ones —
 * or splits the old full_name the first time. No-op for locators.
 * @param {{ first?: string, middle?: string, last?: string }} [parts]
 */
async function syncStaffName(userId, parts) {
  await ensureSchema();
  const id = Number(userId) || 0;
  const roleName = await primaryStaffRole(id);
  if (!roleName) return null;
  const row = (await selectData(`SELECT full_name, first_name, middle_name, last_name FROM dbo.users WHERE id = @param0`, [id]))?.[0];
  if (!row) return null;
  const name =
    parts && parts.first !== undefined
      ? { first: clean(parts.first), middle: clean(parts.middle), last: clean(parts.last) }
      : row.first_name
        ? { first: row.first_name, middle: row.middle_name || "", last: row.last_name || "" }
        : splitName(row.full_name);
  if (!name.first) return null;
  const label = displayName(name, roleName);
  await updateData(
    `UPDATE dbo.users SET first_name = @param1, middle_name = NULLIF(@param2, ''), last_name = NULLIF(@param3, ''), full_name = @param4 WHERE id = @param0`,
    [id, name.first, name.middle, name.last, label]
  );
  return label;
}

/** Every staff account still without name parts (once, at startup), or all
 * holders of a role (after it's renamed). */
async function syncAll({ roleId = null } = {}) {
  await ensureSchema();
  const rows = roleId
    ? await selectData(`SELECT user_id AS id FROM dbo.user_roles WHERE role_id = @param0`, [Number(roleId)])
    : await selectData(`SELECT id FROM dbo.users WHERE first_name IS NULL`);
  for (const r of rows) await syncStaffName(r.id).catch((error) => console.error("Staff name sync error:", error.message));
}

module.exports = { roleAbbrev, splitName, formalName, displayName, ensureSchema, primaryStaffRole, syncStaffName, syncAll };
