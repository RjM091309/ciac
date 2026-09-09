const AuditLog = require("../models/AuditLog");

exports.list = async (req, res) => {
  try {
    const { actor, action, from, to, page, pageSize } = req.query || {};
    const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const pageNum = Math.max(Number(page) || 1, 1);
    const { rows, total } = await AuditLog.list({
      actor: actor ? String(actor) : undefined,
      action: action ? String(action) : undefined,
      from: from ? String(from) : undefined,
      to: to ? String(to) : undefined,
      limit: size,
      offset: (pageNum - 1) * size,
    });
    return res.json({ success: true, data: rows, total, page: pageNum, pageSize: size });
  } catch (error) {
    console.error("List audit logs error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.listActions = async (req, res) => {
  try {
    const actions = await AuditLog.listDistinctActions();
    return res.json({ success: true, data: actions });
  } catch (error) {
    console.error("List audit log actions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
