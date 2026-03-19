const Requirement = require("../models/Requirement");

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
    const { code, name, description, category_id, for_new, for_renewal, is_mandatory, is_active } = req.body || {};
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
      created_by: req.user?.id ?? null,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create requirement error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { code, name, description, category_id, for_new, for_renewal, is_mandatory, is_active } = req.body || {};

    const row = await Requirement.updateRequirement(id, {
      code: code !== undefined ? String(code).trim() : undefined,
      name: name !== undefined ? String(name).trim() : undefined,
      description,
      category_id,
      for_new,
      for_renewal,
      is_mandatory,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update requirement error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Requirement.deactivateRequirement(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Requirement not found" });
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
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate requirement error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
