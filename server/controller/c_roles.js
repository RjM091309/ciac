const Role = require("../models/Role");

exports.list = async (req, res) => {
  try {
    const rows = await Role.listRoles();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List roles error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

