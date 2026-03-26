const ControlPanelPermission = require("../models/ControlPanelPermission");
const { selectData } = require("../config/database");

function parseRoleId(v) {
  const id = Number(v);
  return Number.isFinite(id) ? id : null;
}

async function getRoleIdByName(roleName) {
  if (!roleName) return null;
  const rows = await selectData(
    `
    SELECT TOP (1) id
    FROM roles
    WHERE LOWER(name) = LOWER(@param0) AND is_active = 1
    `,
    [roleName]
  );
  const row = rows?.[0];
  const id = Number(row?.id);
  return Number.isFinite(id) ? id : null;
}

exports.getSidebarPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });

    const rows = await ControlPanelPermission.getSidebarPermissions(roleId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get sidebar permissions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.setSidebarPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });

    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    await ControlPanelPermission.setSidebarPermissions(roleId, permissions);
    return res.json({ success: true });
  } catch (error) {
    console.error("Set sidebar permissions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMenuCrudPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });

    const rows = await ControlPanelPermission.getMenuCrudPermissions(roleId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get menu CRUD permissions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.setMenuCrudPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });

    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    await ControlPanelPermission.setMenuCrudPermissions(roleId, permissions);
    return res.json({ success: true });
  } catch (error) {
    console.error("Set menu CRUD permissions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMySidebarPermissions = async (req, res) => {
  try {
    const roleName = req.user?.role;
    const roleId = await getRoleIdByName(roleName);
    if (!roleId) return res.json({ success: true, data: [] });
    const rows = await ControlPanelPermission.getSidebarPermissions(roleId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my sidebar permissions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getMyMenuCrudPermissions = async (req, res) => {
  try {
    const roleName = req.user?.role;
    const roleId = await getRoleIdByName(roleName);
    if (!roleId) return res.json({ success: true, data: [] });
    const rows = await ControlPanelPermission.getMenuCrudPermissions(roleId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my menu CRUD permissions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
