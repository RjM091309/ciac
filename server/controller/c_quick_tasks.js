const QuickTask = require("../models/QuickTask");

exports.list = async (req, res) => {
  try {
    const rows = await QuickTask.listForUser(req.user.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List quick tasks error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ success: false, message: "title is required" });
    const row = await QuickTask.create(req.user.id, title);
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create quick task error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.setDone = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await QuickTask.setDone(id, req.user.id, Boolean(req.body?.is_done));
    if (!row) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update quick task error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    await QuickTask.remove(id, req.user.id);
    return res.json({ success: true });
  } catch (error) {
    console.error("Delete quick task error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
