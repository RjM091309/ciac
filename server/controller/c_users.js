const User = require("../models/User");

exports.list = async (req, res) => {
  try {
    const rows = await User.listUsers();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.getUserById(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { username, email, phone, full_name, password, is_active, role_id } = req.body || {};
    if (!username) return res.status(400).json({ success: false, message: "username is required" });
    if (!String(email || "").trim()) return res.status(400).json({ success: false, message: "email is required" });
    if (!password) return res.status(400).json({ success: false, message: "password is required" });

    const row = await User.createUser({ username, email, phone, full_name, password, is_active, role_id });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const { username, email, phone, full_name, password, is_active, role_id } = req.body || {};
    if (email !== undefined && !String(email || "").trim()) {
      return res.status(400).json({ success: false, message: "email is required" });
    }
    const row = await User.updateUser(id, { username, email, phone, full_name, password, is_active, role_id });
    if (!row) return res.status(404).json({ success: false, message: "User not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.deactivateUser(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.reactivateUser(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

