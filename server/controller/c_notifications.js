const Notification = require("../models/Notification");
const { subscribeUser, writeEvent } = require("../lib/notificationStream");

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

exports.stream = async (req, res) => {
  const userId = Number(req.user?.id || 0);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ success: false, message: "Access token required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  res.write("retry: 5000\n\n");

  const unsubscribe = subscribeUser(userId, res);
  writeEvent(res, "connected", { ok: true, user_id: userId });

  const heartbeat = setInterval(() => {
    writeEvent(res, "heartbeat", { ts: Date.now() });
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};
