const Requirement = require("../models/Requirement");
const AuditLog = require("../models/AuditLog");

function isForeignKeyViolation(error) {
  return error?.number === 547 || /FOREIGN KEY constraint/i.test(String(error?.message || ""));
}

function audit(req, action, entityId, details) {
  return AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action,
    entityType: "requirement",
    entityId,
    details,
    req,
  });
}

exports.list = async (req, res) => {
  try {
    const rows = await Requirement.listRequirements();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List requirements error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Requirement.getRequirementById(id);
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get requirement error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { code, name, description, category_id, for_new, for_renewal, is_mandatory, is_active, application_types } = req.body || {};
    if (!code || !String(code).trim()) return res.status(400).json({ success: false, message: "code is required" });
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required" });

    const row = await Requirement.createRequirement({
      code: String(code).trim(),
      name: String(name).trim(),
      description: description ?? null,
      category_id,
      for_new,
      for_renewal,
      is_mandatory,
      is_active,
      application_types,
      created_by: req.user?.id ?? null,
    });
    await audit(req, "REQUIREMENT_CREATED", row?.id, { code: row?.code, name: row?.name });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create requirement error:", error);
    if (isForeignKeyViolation(error)) {
      return res.status(400).json({
        success: false,
        message: "Selected category no longer exists. Please refresh and choose another category.",
      });
    }
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { code, name, description, category_id, for_new, for_renewal, is_mandatory, is_active, application_types } = req.body || {};

    const row = await Requirement.updateRequirement(id, {
      code: code !== undefined ? String(code).trim() : undefined,
      name: name !== undefined ? String(name).trim() : undefined,
      description,
      category_id,
      for_new,
      for_renewal,
      is_mandatory,
      is_active,
      application_types,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
    await audit(req, "REQUIREMENT_UPDATED", id, { code: row?.code, name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update requirement error:", error);
    if (isForeignKeyViolation(error)) {
      return res.status(400).json({
        success: false,
        message: "Selected category no longer exists. Please refresh and choose another category.",
      });
    }
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Requirement.deactivateRequirement(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
    await audit(req, "REQUIREMENT_DEACTIVATED", id, { code: row?.code, name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate requirement error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Requirement.reactivateRequirement(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
    await audit(req, "REQUIREMENT_REACTIVATED", id, { code: row?.code, name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate requirement error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
