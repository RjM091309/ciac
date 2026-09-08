const jwt = require("jsonwebtoken");
const Role = require("../models/Role");
const ControlPanelPermission = require("../models/ControlPanelPermission");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

function attachUserFromJwt(req, res, next) {
  const token = req.cookies?.jwt;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
    };
    res.locals.user = req.user;
  } catch {
    res.clearCookie("jwt");
  }

  next();
}

function isAuthenticated(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  const frontend = process.env.FRONTEND_URL;
  if (frontend) return res.redirect(String(frontend).replace(/\/+$/, "") + "/");
  return res.redirect("/authentication/signin");
}

function authenticateToken(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Access token required" });
  }
  return next();
}

function requireRole(...allowedRoles) {
  const normalizedAllowed = allowedRoles.map((r) => String(r).toLowerCase());
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Access token required" });
    }
    const userRole = String(req.user.role || "").toLowerCase();
    if (!userRole || !normalizedAllowed.includes(userRole)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    return next();
  };
}

/**
 * Gates a route behind the Control Panel's per-role permissions for `menuKey`.
 * action 'view' checks Sidebar Menu visibility; 'add'/'edit'/'delete' check
 * Menu CRUD permissions. 'admin' always bypasses (it's exempt from Control
 * Panel restrictions, matching the UI which excludes it from the manageable
 * role list). Any role with no saved permission row is denied (fail-closed).
 */
function requireMenuAccess(menuKey, action = "view") {
  return async function menuAccessGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Access token required" });
    }
    const role = String(req.user.role || "").toLowerCase();
    if (role === "admin") return next();

    try {
      const roleId = await Role.getActiveRoleIdByName(req.user.role);
      if (!roleId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      const allowed =
        action === "view"
          ? await ControlPanelPermission.isSidebarVisible(roleId, menuKey)
          : await ControlPanelPermission.hasCrudPermission(roleId, menuKey, action);
      if (!allowed) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      return next();
    } catch (error) {
      console.error("Menu access check failed:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  };
}

module.exports = {
  attachUserFromJwt,
  isAuthenticated,
  authenticateToken,
  requireRole,
  requireMenuAccess,
};

