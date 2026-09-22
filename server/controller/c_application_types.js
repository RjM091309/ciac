const ApplicationType = require("../models/ApplicationType");
const AuditLog = require("../models/AuditLog");

function audit(req, action, entityId, details) {
  return AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action,
    entityType: "application_type",
    entityId,
    details,
    ipAddress: req.ip,
  });
}

exports.list = async (req, res) => {
  try {
    const rows = await ApplicationType.listApplicationTypes();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List application types error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await ApplicationType.getApplicationTypeById(id);
    if (!row) return res.status(404).json({ success: false, message: "Application type not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get application type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { code, name, description, is_active } = req.body || {};
    if (!code || !String(code).trim()) return res.status(400).json({ success: false, message: "code is required" });
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required" });
    const row = await ApplicationType.createApplicationType({
      code: String(code).trim().toUpperCase().replace(/[\s-]+/g, "_"),
      name: String(name).trim(),
      description: description ?? null,
      created_by: req.user?.id ?? null,
      is_active,
    });
    await audit(req, "APPLICATION_TYPE_CREATED", row?.id, { code: row?.code, name: row?.name });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    if (error?.number === 2627 || error?.number === 2601) {
      return res.status(409).json({ success: false, message: "An application type with that code already exists." });
    }
    console.error("Create application type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { code, name, description, is_active } = req.body || {};
    const row = await ApplicationType.updateApplicationType(id, {
      code: code !== undefined ? String(code).trim().toUpperCase().replace(/[\s-]+/g, "_") : undefined,
      name: name !== undefined ? String(name).trim() : undefined,
      description,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Application type not found" });
    await audit(req, "APPLICATION_TYPE_UPDATED", id, { code: row?.code, name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    if (error?.number === 2627 || error?.number === 2601) {
      return res.status(409).json({ success: false, message: "An application type with that code already exists." });
    }
    console.error("Update application type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await ApplicationType.deactivateApplicationType(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Application type not found" });
    await audit(req, "APPLICATION_TYPE_DEACTIVATED", id, { code: row?.code, name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate application type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await ApplicationType.reactivateApplicationType(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Application type not found" });
    await audit(req, "APPLICATION_TYPE_REACTIVATED", id, { code: row?.code, name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate application type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
