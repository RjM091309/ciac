const Proponent = require("../models/Proponent");

exports.list = async (req, res) => {
  try {
    const rows = await Proponent.listProponents();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List proponents error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.getProponentById(id);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { user_id, business_name, registration_no, tin, address, contact_no, is_active } = req.body || {};
    if (!business_name) return res.status(400).json({ success: false, message: "business_name is required" });

    const row = await Proponent.createProponent({
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      created_by: req.user?.id ?? null,
      is_active,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const { user_id, business_name, registration_no, tin, address, contact_no, is_active } = req.body || {};
    const row = await Proponent.updateProponent(id, {
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.deactivateProponent(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.reactivateProponent(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate proponent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

