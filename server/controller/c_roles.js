const Role = require("../models/Role");
const AuditLog = require("../models/AuditLog");

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
