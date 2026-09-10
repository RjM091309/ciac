const Role = require("../models/Role");
const AuditLog = require("../models/AuditLog");

// These three exact names are matched literally, in lowercase, throughout
// the app's login/permission/routing logic (e.g. "role === 'proponent'")
// — renaming or deactivating one of them doesn't just change a label, it
// silently breaks self-service portal access, MFA exemption, and every
// requireRole() check for every user on that role.
const SYSTEM_ROLE_NAMES = ["ADMIN", "OFFICER", "PROPONENT"];

function isSystemRoleName(name) {
  return SYSTEM_ROLE_NAMES.includes(String(name || "").trim().toUpperCase());
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
    const row = await Role.createRole({ name, description });
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

    const row = await Role.updateRole(id, { name, description });
    if (!row) return res.status(404).json({ success: false, message: "Role not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ROLE_UPDATED",
      entityType: "role",
      entityId: id,
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
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate role error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
