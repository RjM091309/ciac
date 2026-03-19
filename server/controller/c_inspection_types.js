const InspectionType = require("../models/InspectionType");

exports.list = async (req, res) => {
  try {
    const rows = await InspectionType.listInspectionTypes();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List inspection types error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await InspectionType.getInspectionTypeById(id);
    if (!row) return res.status(404).json({ success: false, message: "Inspection type not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get inspection type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { code, name, description, is_active } = req.body || {};
    if (!code || !String(code).trim()) return res.status(400).json({ success: false, message: "code is required" });
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required" });
    const row = await InspectionType.createInspectionType({
      code: String(code).trim(),
      name: String(name).trim(),
      description: description ?? null,
      created_by: req.user?.id ?? null,
      is_active,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create inspection type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { code, name, description, is_active } = req.body || {};
    const row = await InspectionType.updateInspectionType(id, {
      code: code !== undefined ? String(code).trim() : undefined,
      name: name !== undefined ? String(name).trim() : undefined,
      description,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Inspection type not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update inspection type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await InspectionType.deactivateInspectionType(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Inspection type not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate inspection type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await InspectionType.reactivateInspectionType(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Inspection type not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate inspection type error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
