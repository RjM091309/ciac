const ControlPanelPermission = require("../models/ControlPanelPermission");
const Role = require("../models/Role");
const AuditLog = require("../models/AuditLog");
const { publishToUsers } = require("../lib/notificationStream");
const { publicErrorMessage } = require("../lib/httpError");

function parseRoleId(v) {
  const id = Number(v);
  return Number.isFinite(id) ? id : null;
}

// Pushes a live "permissions" SSE event (same stream AppHeader.tsx already
// keeps open for notifications, see server/lib/notificationStream.js) to
// everyone currently holding this role, so ControlPanelAccessContext can
// silently re-fetch instead of the change only taking effect on their next
// manual page refresh.
async function notifyRolePermissionsChanged(roleId) {
  try {
    const userIds = await Role.listUserIdsByRole(roleId);
    publishToUsers(userIds, { roleId }, "permissions");
  } catch (error) {
    console.error("Notify role permissions changed error:", error);
  }
}

exports.getSidebarPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });

    const rows = await ControlPanelPermission.getSidebarPermissions(roleId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get sidebar permissions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.setSidebarPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });
    if (!(await Role.roleExists(roleId))) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    await ControlPanelPermission.setSidebarPermissions(roleId, permissions);
    const roleForLog = await Role.getRoleById(roleId);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PERMISSIONS_CHANGED",
      entityType: "role_sidebar_menu",
      entityId: roleId,
      details: { name: roleForLog?.name, menuCount: permissions.length },
      req,
    });
    await notifyRolePermissionsChanged(roleId);
    return res.json({ success: true });
  } catch (error) {
    console.error("Set sidebar permissions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.setMenuCrudPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });
    if (!(await Role.roleExists(roleId))) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    await ControlPanelPermission.setMenuCrudPermissions(roleId, permissions);
    const roleForLog = await Role.getRoleById(roleId);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PERMISSIONS_CHANGED",
      entityType: "role_menu_crud",
      entityId: roleId,
      details: { name: roleForLog?.name, menuCount: permissions.length },
      req,
    });
    await notifyRolePermissionsChanged(roleId);
    return res.json({ success: true });
  } catch (error) {
    console.error("Set menu CRUD permissions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// 'admin' is exempt from Control Panel restrictions (it's excluded from the
// manageable role list in the UI), so it never has rows of its own here.
// Flag full access explicitly instead of relying on "no rows = unrestricted".
function isExemptRole(roleName) {
  return String(roleName || "").trim().toLowerCase() === "admin";
}

exports.getMySidebarPermissions = async (req, res) => {
  try {
    const roleName = req.user?.role;
    if (isExemptRole(roleName)) {
      return res.json({ success: true, fullAccess: true, data: [] });
    }
    const roleId = await Role.getActiveRoleIdByName(roleName);
    if (!roleId) return res.json({ success: true, fullAccess: false, data: [] });
    const rows = await ControlPanelPermission.getSidebarPermissions(roleId);
    return res.json({ success: true, fullAccess: false, data: rows });
  } catch (error) {
    console.error("Get my sidebar permissions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getMyMenuCrudPermissions = async (req, res) => {
  try {
    const roleName = req.user?.role;
    if (isExemptRole(roleName)) {
      return res.json({ success: true, fullAccess: true, data: [] });
    }
    const roleId = await Role.getActiveRoleIdByName(roleName);
    if (!roleId) return res.json({ success: true, fullAccess: false, data: [] });
    const rows = await ControlPanelPermission.getMenuCrudPermissions(roleId);
    return res.json({ success: true, fullAccess: false, data: rows });
  } catch (error) {
    console.error("Get my menu CRUD permissions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getDashboardWidgetPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });
    const rows = await ControlPanelPermission.getDashboardWidgetPermissions(roleId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get dashboard widget permissions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.setDashboardWidgetPermissions = async (req, res) => {
  try {
    const roleId = parseRoleId(req.params.roleId);
    if (!roleId) return res.status(400).json({ success: false, message: "Invalid role id" });
    if (!(await Role.roleExists(roleId))) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    await ControlPanelPermission.setDashboardWidgetPermissions(roleId, permissions);
    const roleForLog = await Role.getRoleById(roleId);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PERMISSIONS_CHANGED",
      entityType: "role_dashboard_widgets",
      entityId: roleId,
      details: { name: roleForLog?.name, widgetCount: permissions.length },
      req,
    });
    await notifyRolePermissionsChanged(roleId);
    return res.json({ success: true });
  } catch (error) {
    console.error("Set dashboard widget permissions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getMyDashboardWidgetPermissions = async (req, res) => {
  try {
    const roleName = req.user?.role;
    if (isExemptRole(roleName)) {
      return res.json({ success: true, fullAccess: true, data: [] });
    }
    const roleId = await Role.getActiveRoleIdByName(roleName);
    if (!roleId) return res.json({ success: true, fullAccess: false, data: [] });
    const rows = await ControlPanelPermission.getDashboardWidgetPermissions(roleId);
    return res.json({ success: true, fullAccess: false, data: rows });
  } catch (error) {
    console.error("Get my dashboard widget permissions error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};
