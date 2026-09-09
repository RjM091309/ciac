const Permit = require("../models/Permit");

exports.list = async (req, res) => {
  try {
    const rows = await Permit.listAll();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List permits error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Permit.getById(id);
    if (!row) return res.status(404).json({ success: false, message: "Permit not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get permit error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { proponent_id, permit_type, permit_no } = req.body || {};
    if (!Number.isFinite(Number(proponent_id))) {
      return res.status(400).json({ success: false, message: "proponent_id is required" });
    }
    if (!permit_type) return res.status(400).json({ success: false, message: "permit_type is required" });
    if (!permit_no || !String(permit_no).trim()) {
      return res.status(400).json({ success: false, message: "permit_no is required" });
    }
    const row = await Permit.create({ ...req.body, created_by: req.user?.id ?? null });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create permit error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Permit.update(id, { ...req.body, updated_by: req.user?.id ?? null });
    if (!row) return res.status(404).json({ success: false, message: "Permit not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update permit error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Permit.deactivate(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Permit not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate permit error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
