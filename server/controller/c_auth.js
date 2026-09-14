const Auth = require("../models/Auth");
const AuditLog = require("../models/AuditLog");
const ActivityLog = require("../models/ActivityLog");
const { sendMail } = require("../lib/mailer");

exports.login = async (req, res) => {
  try {
    const { username, password, token, newPassword } = req.body || {};

    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required" });
    }

    if (!password) {
      return res.status(400).json({ success: false, message: "Password is required" });
    }

    const result = await Auth.login(username, password, token, newPassword);

    if (!result.success) {
      // Don't log the routine "here's your QR code" / "enter your 6-digit
      // code" / "set a new password" first prompts as failures — only
      // genuine wrong-password, wrong-code, or locked-account attempts.
      const isInitialPrompt = (result.mfaRequired || result.enrollmentRequired || result.mustChangePassword) && !token && !newPassword;
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
        mustChangePassword: Boolean(result.mustChangePassword),
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

// --- Self-service "forgot password" (emailed reset link) ---

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const result = await Auth.requestPasswordReset(email);
    if (result.matched) {
      const resetUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/reset-password?token=${result.token}`;
      const name = result.user.full_name || result.user.username;
      const mailResult = await sendMail({
        to: result.user.email,
        subject: "Reset your 3CORE Locator Portal password",
        text:
          `Hello ${name},\n\n` +
          `We received a request to reset your password. This link expires in ${Auth.RESET_TOKEN_TTL_MINUTES} minutes:\n\n` +
          `${resetUrl}\n\n` +
          `If you didn't request this, you can safely ignore this email — your password won't change.\n`,
        html:
          `<p>Hello ${name},</p>` +
          `<p>We received a request to reset your password. This link expires in ${Auth.RESET_TOKEN_TTL_MINUTES} minutes.</p>` +
          `<p><a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Reset your password</a></p>` +
          `<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
      });
      await AuditLog.record({
        actorId: result.user.id,
        actorUsername: result.user.username,
        action: "PASSWORD_RESET_REQUESTED",
        entityType: "user",
        entityId: result.user.id,
        details: { emailSent: mailResult.sent },
        ipAddress: req.ip,
      });
    }

    // Same response whether or not the email matched an account — a
    // "forgot password" form that answers differently either way is how it
    // leaks which emails are registered.
    return res.json({
      success: true,
      message: "If an account with that email exists, we've sent a password reset link.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: "Token and new password are required." });
    }

    const result = await Auth.resetPasswordWithToken(token, newPassword);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    await AuditLog.record({
      actorId: result.user.id,
      actorUsername: result.user.username,
      action: "PASSWORD_RESET_VIA_EMAIL",
      entityType: "user",
      entityId: result.user.id,
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: "Password updated. You can now sign in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
