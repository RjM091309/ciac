const RequirementCategory = require("../models/RequirementCategory");
const AuditLog = require("../models/AuditLog");
const { publicErrorMessage } = require("../lib/httpError");

function audit(req, action, entityId, details) {
  return AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action,
    entityType: "requirement_category",
    entityId,
    details,
    req,
  });
}

exports.list = async (req, res) => {
  try {
    const rows = await RequirementCategory.listRequirementCategories();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List requirement categories error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await RequirementCategory.getRequirementCategoryById(id);
    if (!row) return res.status(404).json({ success: false, message: "Requirement category not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get requirement category error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, is_active } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }

    const row = await RequirementCategory.createRequirementCategory({
      name: String(name).trim(),
      description: description ?? null,
      created_by: req.user?.id ?? null,
      is_active,
    });

    await audit(req, "REQUIREMENT_CATEGORY_CREATED", row?.id, { name: row?.name });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create requirement category error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const { name, description, is_active } = req.body || {};
    const row = await RequirementCategory.updateRequirementCategory(id, {
      name: name !== undefined ? String(name).trim() : undefined,
      description,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Requirement category not found" });

    await audit(req, "REQUIREMENT_CATEGORY_UPDATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update requirement category error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await RequirementCategory.deactivateRequirementCategory(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Requirement category not found" });

    await audit(req, "REQUIREMENT_CATEGORY_DEACTIVATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate requirement category error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await RequirementCategory.reactivateRequirementCategory(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Requirement category not found" });

    await audit(req, "REQUIREMENT_CATEGORY_REACTIVATED", id, { name: row?.name });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate requirement category error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};
