const jwt = require("jsonwebtoken");
const Role = require("../models/Role");
const ControlPanelPermission = require("../models/ControlPanelPermission");
const User = require("../models/User");
const Proponent = require("../models/Proponent");
const ApplicationWorkflow = require("../models/ApplicationWorkflow");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

/** Session invalidation for an otherwise-stateless JWT: a deactivation,
 * suspension, password reset, or explicit "revoke sessions" bumps
 * token_version in the DB (see User.js), which this rejects on the very
 * next request even though the JWT itself is still validly signed and
 * unexpired. Fails OPEN on a DB error — a per-request availability check
 * must not turn a database hiccup into a site-wide logout; the JWT's own
 * signature/expiry still gate access in that case. */
async function attachUserFromJwt(req, res, next) {
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

    try {
      const check = await User.getSessionCheck(decoded.id);
      if (check && (!check.isActive || check.tokenVersion !== Number(decoded.tv || 0))) {
        req.user = undefined;
        res.locals.user = undefined;
        res.clearCookie("jwt");
      }
    } catch {
      // DB unreachable — fall back to trusting the JWT alone this request.
    }
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

async function checkMenuAllowed(role, menuKey, action) {
  if (role === "admin") return true;
  const roleId = await Role.getActiveRoleIdByName(role);
  if (!roleId) return false;
  return action === "view"
    ? await ControlPanelPermission.isSidebarVisible(roleId, menuKey)
    : await ControlPanelPermission.hasCrudPermission(roleId, menuKey, action);
}

/**
 * Gates a route behind ANY ONE of several menu permissions — used where one
 * screen's data (e.g. GET /api/users, shared by both "User Management" and
 * "Locator Accounts") is reachable from either sidebar entry, so holding
 * just one of the two Control Panel permissions should be enough to load it.
 */
function requireAnyMenuAccess(menuKeys, action = "view") {
  return async function anyMenuAccessGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Access token required" });
    }
    const role = String(req.user.role || "").toLowerCase();
    try {
      for (const menuKey of menuKeys) {
        if (await checkMenuAllowed(role, menuKey, action)) return next();
      }
      return res.status(403).json({ success: false, message: "Forbidden" });
    } catch (error) {
      console.error("Any-menu access check failed:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  };
}

/**
 * Gates a /api/users route that acts on one specific account (:id) or
 * creates one (role_id in the body) behind whichever Control Panel
 * permission actually matches that account — settings:locator-users if the
 * target holds (or is being given) the Proponent role, settings:users
 * otherwise. Both "User Management" and "Locator Accounts" call the same
 * /api/users endpoints under the hood; gating all of it on settings:users
 * alone meant a role granted only settings:locator-users saw that sidebar
 * entry but got 403 on every action there, while a role granted only
 * settings:users could still manage Locator accounts it was never meant to
 * touch. Falls back to settings:users when the target can't be determined
 * (e.g. malformed body) — fail toward the stricter of the two.
 */
function requireUserMenuAccess(action = "view") {
  return async function userMenuAccessGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Access token required" });
    }
    const role = String(req.user.role || "").toLowerCase();
    if (role === "admin") return next();

    try {
      let isLocatorTarget = false;
      const targetId = Number(req.params.id);
      if (Number.isFinite(targetId) && targetId > 0) {
        isLocatorTarget = await Role.userHasRoleName(targetId, "proponent");
      } else if (req.body?.role_id) {
        const targetRole = await Role.getRoleById(Number(req.body.role_id));
        isLocatorTarget = String(targetRole?.name || "").trim().toLowerCase() === "proponent";
      }
      const menuKey = isLocatorTarget ? "settings:locator-users" : "settings:users";
      const allowed = await checkMenuAllowed(role, menuKey, action);
      if (!allowed) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      return next();
    } catch (error) {
      console.error("User menu access check failed:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  };
}

/**
 * Role-only half of requireProponentSelf's check, exported separately for the
 * one self-service route that must work BEFORE a proponent profile exists —
 * first-login business profile setup. Everything else should use
 * requireProponentSelf instead, which also attaches req.proponent.
 */
async function requireProponentRole(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Access token required" });
  }
  const isProponent =
    String(req.user.role || "").toLowerCase() === "proponent" || (await Role.userHasRoleName(req.user.id, "proponent"));
  if (!isProponent) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  return next();
}

/**
 * Guards a proponent self-service route. Requires an authenticated user who
 * holds the 'proponent' role AND has a linked (active) proponent profile. On
 * success attaches `req.proponent`. Checks the JWT's primary role first
 * (covers every real single-role Locator account without an extra query);
 * a multi-role account whose primary/effective role is something else —
 * currently just admin, which also holds Locator so it can preview the
 * portal with its own real, editable data instead of a read-only mock —
 * falls through to a user_roles lookup before being rejected. Officers are
 * still NOT allowed through: these routes are strictly "my own record"
 * endpoints, and Officer never holds the Locator role.
 */
async function requireProponentSelf(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Access token required" });
  }
  const isProponent =
    String(req.user.role || "").toLowerCase() === "proponent" || (await Role.userHasRoleName(req.user.id, "proponent"));
  if (!isProponent) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  try {
    const proponent = await Proponent.getProponentByUserId(req.user.id);
    if (!proponent) {
      return res.status(404).json({
        success: false,
        code: "NO_PROPONENT_PROFILE",
        message: "No proponent profile is linked to this account yet.",
      });
    }
    req.proponent = proponent;
    return next();
  } catch (error) {
    console.error("requireProponentSelf failed:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Runs after requireProponentSelf. Loads the application named by `:id` and
 * 403s unless it belongs to the caller's proponent. Attaches `req.application`.
 */
async function requireOwnApplication(req, res, next) {
  if (!req.proponent) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ success: false, message: "Invalid application id" });
  }
  try {
    const application = await ApplicationWorkflow.getApplicationById(id);
    if (!application || Number(application.proponent_id) !== Number(req.proponent.id)) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }
    req.application = application;
    return next();
  } catch (error) {
    console.error("requireOwnApplication failed:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = {
  attachUserFromJwt,
  isAuthenticated,
  authenticateToken,
  requireRole,
  requireMenuAccess,
  requireAnyMenuAccess,
  requireUserMenuAccess,
  requireProponentRole,
  requireProponentSelf,
  requireOwnApplication,
};

