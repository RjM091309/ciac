const Role = require("../models/Role");
const AuditLog = require("../models/AuditLog");

// Fixed roles — locked against rename/retire from the UI. Two different
// reasons land a name on this list:
//  - ADMIN, PROPONENT: matched literally (lowercase) throughout the app's
//    login/permission/routing logic (e.g. "role === 'admin'" for the
//    Control Panel bypass, "role === 'proponent'" for self-service portal
//    access and MFA exemption) — renaming or deactivating either one
//    doesn't just change a label, it silently breaks that logic for every
//    user on the role.
//  - ACCOUNT OFFICER, ASSESSMENT OFFICER: no code keys off these literal
//    strings (they're driven entirely by Control Panel's per-role_id
//    permissions, same as any custom role) — locked instead because the
//    client treats these as fixed positions in their organization, not
//    something an admin should accidentally rename or retire from the UI.
//    A genuinely new custom role (anything not in this list) stays freely
//    renameable/retireable.
const SYSTEM_ROLE_NAMES = ["ADMIN", "PROPONENT", "ACCOUNT OFFICER", "ASSESSMENT OFFICER"];

// Same set, PLUS "LOCATOR" — the cosmetic display name roleDisplayName()
// (src/lib/roleDisplay.ts) substitutes for "PROPONENT" everywhere a human
// reads a role name in this app, including right on this very edit form. An
// admin renaming some other role would only ever see/type "Locator", never
// the real stored name "PROPONENT" — checking SYSTEM_ROLE_NAMES alone here
// would let that through and recreate the exact two-roles-mean-"Locator"
// bug already fixed once this session (server/models/Role.js's seed
// silently mints a fresh 'proponent' row the next time it doesn't find an
// exact match, so the app ends up with two competing "Locator" roles again).
const RESERVED_TARGET_ROLE_NAMES = [...SYSTEM_ROLE_NAMES, "LOCATOR"];

function isSystemRoleName(name) {
  return SYSTEM_ROLE_NAMES.includes(String(name || "").trim().toUpperCase());
}

function isReservedTargetRoleName(name) {
  return RESERVED_TARGET_ROLE_NAMES.includes(String(name || "").trim().toUpperCase());
}

/** roles.name has a UNIQUE index (case-insensitive collation), so renaming
 * any role to a name already in use — a built-in one or just a duplicate of
 * another custom role — throws a raw SQL Server error (number 2627) that
 * would otherwise surface as an unhandled 500. Callers check this first so
 * the common case gets a clear message instead, but it's also a backstop:
 * without it, a rename that slips past the explicit isSystemRoleName check
 * (or just collides with another custom role) still crashes cleanly caught
 * rather than as a raw 500. */
function isUniqueNameViolation(error) {
  return Number(error?.number) === 2627 || Number(error?.originalError?.info?.number) === 2627;
}

exports.list = async (req, res) => {
  try {
    const rows = await Role.listRoles();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List roles error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!String(name || "").trim()) {
      return res.status(400).json({ success: false, message: "Role name is required" });
    }
    if (isReservedTargetRoleName(name)) {
      return res.status(400).json({
        success: false,
        message: `"${String(name).trim()}" is reserved — choose a different name.`,
      });
    }
    let row;
    try {
      row = await Role.createRole({ name, description });
    } catch (error) {
      if (isUniqueNameViolation(error)) {
        return res.status(409).json({ success: false, message: `A role named "${String(name).trim()}" already exists.` });
      }
      throw error;
    }
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ROLE_CREATED",
      entityType: "role",
      entityId: row?.id,
      details: { name: row?.name },
      ipAddress: req.ip,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create role error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { name, description } = req.body || {};
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Role name is required" });
    }

    const current = await Role.getRoleById(id);
    if (!current) return res.status(404).json({ success: false, message: "Role not found" });
    if (
      name !== undefined &&
      isSystemRoleName(current.name) &&
      String(name).trim().toUpperCase() !== String(current.name).trim().toUpperCase()
    ) {
      return res.status(400).json({
        success: false,
        message: `"${current.name}" is a built-in role name the system relies on and can't be renamed. Only its description can be changed.`,
      });
    }
    // The other direction: renaming a DIFFERENT role (e.g. Account Officer)
    // *into* "Admin", "Proponent", or "Locator" — current.name isn't locked
    // here, so the check above doesn't fire, but it's exactly as unsafe: the
    // app would then have two roles both matching `role === "proponent"`
    // (or displaying as "Locator"), and whichever the DB's UNIQUE constraint
    // let through wins.
    if (name !== undefined && isReservedTargetRoleName(name) && !isSystemRoleName(current.name)) {
      return res.status(400).json({
        success: false,
        message: `"${String(name).trim()}" is reserved — choose a different name.`,
      });
    }

    let row;
    try {
      row = await Role.updateRole(id, { name, description });
    } catch (error) {
      if (isUniqueNameViolation(error)) {
        return res.status(409).json({ success: false, message: `A role named "${String(name).trim()}" already exists.` });
      }
      throw error;
    }
    if (!row) return res.status(404).json({ success: false, message: "Role not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ROLE_UPDATED",
      entityType: "role",
      entityId: id,
      details: { name: row?.name, previousName: current?.name !== row?.name ? current?.name : undefined },
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update role error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const current = await Role.getRoleById(id);
    if (!current) return res.status(404).json({ success: false, message: "Role not found" });
    if (isSystemRoleName(current.name)) {
      return res.status(400).json({ success: false, message: `"${current.name}" is a built-in role and can't be retired.` });
    }
    if (await Role.isRoleInUse(id)) {
      return res.status(409).json({ success: false, message: "This role is still assigned to one or more users." });
    }
    const row = await Role.deactivateRole(id);
    if (!row) return res.status(404).json({ success: false, message: "Role not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ROLE_DEACTIVATED",
      entityType: "role",
      entityId: id,
      details: { name: current?.name },
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate role error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Role.reactivateRole(id);
    if (!row) return res.status(404).json({ success: false, message: "Role not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ROLE_REACTIVATED",
      entityType: "role",
      entityId: id,
      details: { name: row?.name },
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate role error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
