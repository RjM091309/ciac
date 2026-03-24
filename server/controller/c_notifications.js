const Notification = require("../models/Notification");

exports.listMine = async (req, res) => {
  try {
    const userId = req.user?.id;
    const limit = Number(req.query.limit || 50);
    const rows = await Notification.listForUser(userId, limit);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List notifications error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.markRead = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification id" });
    }
    const ok = await Notification.markAsRead(id, req.user?.id);
    if (!ok) return res.status(404).json({ success: false, message: "Notification not found" });
    return res.json({ success: true });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await Notification.markAllAsRead(req.user?.id);
    return res.json({ success: true });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
