const Auth = require("../models/Auth");
const AuditLog = require("../models/AuditLog");
const ActivityLog = require("../models/ActivityLog");

exports.login = async (req, res) => {
  try {
    const { username, password, token } = req.body || {};

    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required" });
    }

    if (!password) {
      return res.status(400).json({ success: false, message: "Password is required" });
    }

    const result = await Auth.login(username, password, token);

    if (!result.success) {
      // Don't log the routine "here's your QR code" / "enter your 6-digit
      // code" first prompts as failures — only genuine wrong-password,
      // wrong-code, or locked-account attempts.
      const isInitialPrompt = (result.mfaRequired || result.enrollmentRequired) && !token;
      if (!isInitialPrompt) {
        await AuditLog.record({
          actorUsername: username,
          action: "LOGIN_FAILED",
          entityType: "user",
          details: { message: result.message, locked: Boolean(result.locked) },
          ipAddress: req.ip,
        });
      }
      return res.status(401).json({
        success: false,
        message: result.message,
        mfaRequired: Boolean(result.mfaRequired),
        enrollmentRequired: Boolean(result.enrollmentRequired),
        ...(result.enrollment ? { enrollment: result.enrollment } : {}),
      });
    }

    res.cookie("jwt", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    // Security trail (append-only, admin-facing).
    await AuditLog.record({
      actorId: result.user?.id,
      actorUsername: result.user?.username,
      action: "LOGIN_SUCCESS",
      entityType: "user",
      entityId: result.user?.id,
      ipAddress: req.ip,
    });
    // Proponent-facing activity timeline ("Signed in" entries).
    ActivityLog.record({
      actorUserId: result.user?.id ?? null,
      entityType: "AUTH",
      action: "LOGIN",
      meta: { role: result.user?.role ?? null },
      ip: req.ip,
    });

    return res.json({ success: true, message: result.message, user: result.user });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.logout = async (req, res) => {
  if (req.user) {
    await AuditLog.record({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: "LOGOUT",
      entityType: "user",
      entityId: req.user.id,
      ipAddress: req.ip,
    });
  }
  res.clearCookie("jwt");
  return res.json({ success: true, message: "Logged out successfully" });
};

exports.checkAuth = async (req, res) => {
  if (req.user) return res.json({ success: true, authenticated: true, user: req.user });
  return res.json({ success: true, authenticated: false });
};
