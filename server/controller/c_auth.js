const Auth = require("../models/Auth");
const AuditLog = require("../models/AuditLog");
const ActivityLog = require("../models/ActivityLog");
const UserSession = require("../models/UserSession");
const { sendMail } = require("../lib/mailer");
const { endSessionStreams } = require("../lib/notificationStream");
const { escapeHtml } = require("../lib/html");
const { getters: site } = require("../lib/siteSettings");

// How far back the audit log looks when counting repeat failed sign-ins.
const RECENT_FAILURE_WINDOW_MINUTES = 15;

// No maxAge: a browser-session cookie, dropped when the browser quits. The
// idle limit (Portal Settings) is enforced by the JWT's own expiry (Auth.js), not
// the cookie's lifetime. Secure (HTTPS-only) in production, unless
// COOKIE_SECURE=false — a temporary escape hatch for a plain-HTTP rollout
// (e.g. staff training before the certificate is in place).
function cookieSecure() {
  const override = String(process.env.COOKIE_SECURE || "").trim().toLowerCase();
  if (override === "false") return false;
  if (override === "true") return true;
  return process.env.NODE_ENV === "production";
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
  };
}

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
        // Includes this attempt: earlier failures for the same name in the
        // window, plus one. Spots guessing across accounts that don't exist
        // (no lockout counter there) as well as against real ones.
        const recentFailures = (await AuditLog.countRecentLoginFailures(username, RECENT_FAILURE_WINDOW_MINUTES)) + 1;
        await AuditLog.record({
          actorId: result.userId,
          actorUsername: username,
          action: "LOGIN_FAILED",
          entityType: "user",
          entityId: result.userId,
          details: {
            reason: result.reason || "unknown",
            message: result.message,
            locked: Boolean(result.locked),
            attempt: result.attempt,
            maxAttempts: result.maxAttempts,
            recentFailures,
            windowMinutes: RECENT_FAILURE_WINDOW_MINUTES,
          },
          req,
        });
      }
      // 503 for maintenance mode: the sign-in itself was fine, the portal is closed.
      return res.status(result.maintenance ? 503 : 401).json({
        success: false,
        message: result.message,
        maintenance: Boolean(result.maintenance),
        mfaRequired: Boolean(result.mfaRequired),
        enrollmentRequired: Boolean(result.enrollmentRequired),
        mustChangePassword: Boolean(result.mustChangePassword),
        ...(result.enrollment ? { enrollment: result.enrollment } : {}),
      });
    }

    res.cookie("jwt", result.token, sessionCookieOptions());

    if (result.session) {
      await UserSession.start({
        id: result.session.id,
        userId: result.user?.id,
        username: result.user?.username,
        tokenVersion: result.session.tokenVersion,
        expiresAt: result.session.expiresAt,
        ipAddress: AuditLog.normalizeIp(req.ip),
        userAgent: req.get("user-agent"),
      });
      // One session per account: this sign-in signs out any other open one,
      // and its open pages are told right away over the notification stream.
      const replaced = await UserSession.endOtherSessions(result.user?.id, result.session.id);
      if (replaced.length) {
        endSessionStreams(result.user?.id, replaced);
        await AuditLog.record({
          actorId: result.user?.id,
          actorUsername: result.user?.username,
          action: "SESSION_REPLACED",
          entityType: "user",
          entityId: result.user?.id,
          sessionId: result.session.id,
          details: { replaced_sessions: replaced.length },
          req,
        });
      }
    }
    // Security trail (append-only, admin-facing).
    await AuditLog.record({
      actorId: result.user?.id,
      actorUsername: result.user?.username,
      action: "LOGIN_SUCCESS",
      entityType: "user",
      entityId: result.user?.id,
      sessionId: result.session?.id,
      req,
    });
    // Cookie / activity-logging consent from the login page notice — the
    // client sends it until one successful login has recorded it.
    const consent = req.body?.consent;
    if (consent && consent.accepted_at) {
      await AuditLog.record({
        actorId: result.user?.id,
        actorUsername: result.user?.username,
        action: "COOKIE_CONSENT_ACCEPTED",
        entityType: "user",
        entityId: result.user?.id,
        details: { version: Number(consent.version) || null, accepted_at: String(consent.accepted_at).slice(0, 40) },
        sessionId: result.session?.id,
        req,
      });
    }
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
    const ended = await UserSession.end(req.user.sid, "logout");
    // Tokens issued before session tracking have no sid — their own
    // issued-at time still gives the session length.
    const durationSeconds =
      ended?.durationSeconds ?? (req.user.iat ? Math.max(0, Math.round(Date.now() / 1000 - req.user.iat)) : null);
    await AuditLog.record({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: "LOGOUT",
      entityType: "user",
      entityId: req.user.id,
      details: durationSeconds != null ? { duration_seconds: durationSeconds } : undefined,
      req,
    });
  }
  res.clearCookie("jwt");
  return res.json({ success: true, message: "Logged out successfully" });
};

/** Extends an active session by another idle-timeout window. Called by the
 * frontend only while the user is actually interacting with the page; the
 * token_version/is_active check in m_auth.js has already run, so a revoked
 * session can't be refreshed. */
exports.refresh = async (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Session expired", reason: req.sessionEndedReason });
  // ?tab= is sent by a page that just loaded: if that tab reported closing a
  // moment ago, it was a reload — keep the session (UserSession.js).
  UserSession.cancelTabClose(req.user.sid, typeof req.query.tab === "string" ? req.query.tab : null);
  const { token, expiresAt } = Auth.issueSessionToken(req.user, req.tokenVersion, req.user.sid);
  res.cookie("jwt", token, sessionCookieOptions());
  await UserSession.extend(req.user.sid, expiresAt);
  return res.json({ success: true, expiresAt });
};

/** Sent (keepalive fetch) by the frontend when any tab of the app goes away;
 * closing one tab signs out all of them. Only schedules the sign-out — see
 * UserSession.scheduleTabClose for why it waits. */
exports.tabClosed = (req, res) => {
  if (req.user) {
    UserSession.scheduleTabClose({
      id: req.user.sid,
      tabId: typeof req.query.tab === "string" ? req.query.tab : null,
      userId: req.user.id,
      username: req.user.username,
      ipAddress: AuditLog.normalizeIp(req.ip),
      userAgent: req.get("user-agent"),
    });
  }
  return res.status(204).end();
};

exports.checkAuth = async (req, res) => {
  if (req.user) return res.json({ success: true, authenticated: true, user: req.user });
  return res.json({ success: true, authenticated: false, reason: req.sessionEndedReason });
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
        subject: `Reset your ${site.locatorPortalLabel()} password`,
        text:
          `Hello ${name},\n\n` +
          `We received a request to reset your password. This link expires in ${Auth.RESET_TOKEN_TTL_MINUTES} minutes:\n\n` +
          `${resetUrl}\n\n` +
          `If you didn't request this, you can safely ignore this email — your password won't change.\n`,
        html:
          `<p>Hello ${escapeHtml(name)},</p>` +
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
        req,
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
      req,
    });

    return res.json({ success: true, message: "Password updated. You can now sign in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
