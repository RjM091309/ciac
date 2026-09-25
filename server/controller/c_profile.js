const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { sendMail } = require("../lib/mailer");
const { diffChanges } = require("../lib/auditDiff");
const { decryptSecret, encryptSecret, newSecret, buildEnrollment, verifyToken } = require("../lib/totp");
const { saveAvatar, resolveAvatar, avatarContentType, deleteAvatar } = require("../lib/avatarStorage");
const { publicErrorMessage } = require("../lib/httpError");
const { guardedCheck, checkPassword } = require("../lib/reauth");

// My Profile — the signed-in user's own account (staff only on the frontend;
// Locators keep "Settings" → My Business Profile). Every route here acts on
// req.user.id only, so none of them take a user id from the client.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// PH mobile only: the panel shows a fixed +63 and takes the 10 digits after it.
const PHONE_RE = /^\+639\d{9}$/;

function isAdminRole(role) {
  return String(role || "").toLowerCase() === "admin";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function fail(res, status, message, field) {
  return res.status(status).json({ success: false, message, ...(field ? { field } : {}) });
}

function serverError(res, label, error) {
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: publicErrorMessage(error) });
}

function toProfileResponse(profile, extra = {}) {
  return {
    id: profile.id,
    username: profile.username,
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    role: profile.roles[0] || null,
    totp_enabled: profile.totp_enabled,
    // The stored file name is unique per upload, so it doubles as a cache-buster.
    avatar_version: profile.avatar_path || null,
    created_at: profile.created_at,
    ...extra,
  };
}

exports.get = async (req, res) => {
  try {
    const profile = await User.getOwnProfile(req.user.id);
    if (!profile) return fail(res, 404, "Account not found");
    const previousLogin = await AuditLog.previousLoginFor(req.user.id, req.user.sid).catch(() => null);
    return res.json({
      success: true,
      data: toProfileResponse(profile, { is_admin: isAdminRole(req.user.role), previous_login: previousLogin }),
    });
  } catch (error) {
    return serverError(res, "Get profile", error);
  }
};

function sendEmailChangeNotices({ name, username, oldEmail, newEmail }) {
  const when = new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" });
  const safeName = escapeHtml(name);
  const mails = [
    sendMail({
      to: newEmail,
      subject: "Your CIAC Portal email address was updated",
      text:
        `Hello ${name},\n\n` +
        `This address is now the email on the CIAC Portal account "${username}" (changed ${when}). ` +
        `Password-reset links and account notices will be sent here from now on.\n\n` +
        `If you didn't make this change, contact CIAC right away.\n`,
      html:
        `<p>Hello ${safeName},</p>` +
        `<p>This address is now the email on the CIAC Portal account <b>${escapeHtml(username)}</b> (changed ${when}). ` +
        `Password-reset links and account notices will be sent here from now on.</p>` +
        `<p>If you didn't make this change, contact CIAC right away.</p>`,
    }),
  ];
  if (oldEmail) {
    mails.push(
      sendMail({
        to: oldEmail,
        subject: "The email on your CIAC Portal account was changed",
        text:
          `Hello ${name},\n\n` +
          `The email on the CIAC Portal account "${username}" was changed from this address to ${newEmail} (${when}). ` +
          `You won't receive account emails here anymore.\n\n` +
          `If you didn't make this change, contact CIAC right away — someone else may have access to your account.\n`,
        html:
          `<p>Hello ${safeName},</p>` +
          `<p>The email on the CIAC Portal account <b>${escapeHtml(username)}</b> was changed from this address to ` +
          `<b>${escapeHtml(newEmail)}</b> (${when}). You won't receive account emails here anymore.</p>` +
          `<p>If you didn't make this change, contact CIAC right away — someone else may have access to your account.</p>`,
      })
    );
  }
  return Promise.all(mails);
}

exports.update = async (req, res) => {
  try {
    const userId = req.user.id;
    const before = await User.getOwnProfile(userId);
    if (!before) return fail(res, 404, "Account not found");

    const fullName = String(req.body?.full_name ?? "").trim();
    const email = String(req.body?.email ?? "").trim();
    // Stored without spaces so "+63 912…" and "+63912…" can't both pass the unique index.
    const phoneRaw = String(req.body?.phone ?? "").replace(/\s/g, "");
    const phone = phoneRaw || null;

    if (!fullName) return fail(res, 400, "Full name is required.", "full_name");
    if (fullName.length > 255) return fail(res, 400, "Full name is too long.", "full_name");
    if (!email) return fail(res, 400, "Email is required.", "email");
    if (!EMAIL_RE.test(email) || email.length > 255) return fail(res, 400, "Enter a valid email address.", "email");
    if (phone && !PHONE_RE.test(phone)) return fail(res, 400, "Enter a 10-digit mobile number starting with 9.", "phone");

    const emailChanged = email.toLowerCase() !== String(before.email || "").toLowerCase();
    if (emailChanged) {
      // The email receives password-reset links, so changing it is as good as
      // taking the account — make whoever is at the keyboard prove it's them.
      const currentPassword = String(req.body?.currentPassword ?? "");
      if (!currentPassword) return fail(res, 400, "Enter your current password to change your email.", "currentPassword");
      const check = await checkPassword(req, currentPassword);
      if (!check.ok) return fail(res, check.status, check.message, "currentPassword");
      if (!(await User.isFieldAvailable("email", email, userId))) return fail(res, 409, "That email is already in use.", "email");
    }
    if (phone && phone !== before.phone && !(await User.isFieldAvailable("phone", phone, userId))) {
      return fail(res, 409, "That phone number is already in use.", "phone");
    }

    try {
      await User.updateUser(userId, { full_name: fullName, email, phone });
    } catch (error) {
      if (error?.number === 2627 || error?.number === 2601) {
        const msg = String(error.message || "");
        if (msg.includes("UX_users_email")) return fail(res, 409, "That email is already in use.", "email");
        if (msg.includes("UX_users_phone")) return fail(res, 409, "That phone number is already in use.", "phone");
      }
      throw error;
    }

    const after = await User.getOwnProfile(userId);
    const fields = ["full_name", "email", "phone"];
    const changes = diffChanges(before, after, fields);
    if (changes.length) {
      await AuditLog.record({
        actorId: userId,
        actorUsername: req.user.username,
        action: "USER_PROFILE_UPDATED",
        entityType: "user",
        entityId: userId,
        details: { username: after.username, changes },
        req,
      });
    }
    if (emailChanged) {
      await AuditLog.record({
        actorId: userId,
        actorUsername: req.user.username,
        action: "USER_PROFILE_EMAIL_CHANGED",
        entityType: "user",
        entityId: userId,
        details: { username: after.username, from: before.email, to: after.email },
        req,
      });
      // Not awaited: the save is done, a slow SMTP server shouldn't hold the response.
      sendEmailChangeNotices({
        name: after.full_name || after.username,
        username: after.username,
        oldEmail: before.email,
        newEmail: after.email,
      }).catch((error) => console.error("Email change notice failed:", error));
    }

    return res.json({ success: true, data: toProfileResponse(after, { is_admin: isAdminRole(req.user.role) }) });
  } catch (error) {
    return serverError(res, "Update profile", error);
  }
};

// --- Photo ---

exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file?.buffer) return fail(res, 400, "Choose a photo to upload.");
    const before = await User.getOwnProfile(req.user.id);
    if (!before) return fail(res, 404, "Account not found");
    let fileName;
    try {
      fileName = saveAvatar(req.user.id, req.file.buffer);
    } catch (error) {
      if (error.status === 400) return fail(res, 400, error.message);
      throw error;
    }
    await User.setAvatarPath(req.user.id, fileName);
    if (before.avatar_path) deleteAvatar(before.avatar_path);
    await AuditLog.record({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: "USER_AVATAR_UPDATED",
      entityType: "user",
      entityId: req.user.id,
      details: { username: before.username },
      req,
    });
    return res.json({ success: true, data: { avatar_version: fileName } });
  } catch (error) {
    return serverError(res, "Upload avatar", error);
  }
};

exports.removeAvatar = async (req, res) => {
  try {
    const before = await User.getOwnProfile(req.user.id);
    if (!before) return fail(res, 404, "Account not found");
    if (before.avatar_path) {
      await User.setAvatarPath(req.user.id, null);
      deleteAvatar(before.avatar_path);
      await AuditLog.record({
        actorId: req.user.id,
        actorUsername: req.user.username,
        action: "USER_AVATAR_REMOVED",
        entityType: "user",
        entityId: req.user.id,
        details: { username: before.username },
        req,
      });
    }
    return res.json({ success: true, data: { avatar_version: null } });
  } catch (error) {
    return serverError(res, "Remove avatar", error);
  }
};

exports.getAvatar = async (req, res) => {
  try {
    const profile = await User.getOwnProfile(req.user.id);
    const abs = resolveAvatar(profile?.avatar_path);
    if (!abs) return res.status(404).end();
    // The URL carries ?v=<file name>, which changes on every upload, so the
    // browser can keep this one around.
    res.set("Cache-Control", "private, max-age=86400");
    res.type(avatarContentType(profile.avatar_path));
    return res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch (error) {
    return serverError(res, "Get avatar", error);
  }
};

// --- Two-factor (authenticator app) ---
// Same policy as login (Auth.js): non-admins must keep 2FA on, so they can
// only move it to a new phone; admins may also turn it on or off.

function codeOf(req) {
  return String(req.body?.code ?? "").replace(/\D/g, "");
}

async function verifyCurrentCode(record, code) {
  if (!code) return false;
  let secret;
  try {
    secret = decryptSecret(record.totp_secret);
  } catch {
    return false;
  }
  return verifyToken(code, secret);
}

exports.startTotpSetup = async (req, res) => {
  try {
    const record = await User.getTotpRecord(req.user.id);
    if (!record) return fail(res, 404, "Account not found");
    const enabled = record.totp_enabled === 1 && !!record.totp_secret;
    // Moving to a new phone: prove the current one first, so a session left
    // open on a shared computer can't be used to swap in someone else's phone.
    if (enabled) {
      const code = codeOf(req);
      if (!code) return fail(res, 400, "Enter the current 6-digit code from your authenticator app.", "code");
      const check = await guardedCheck(req, () => verifyCurrentCode(record, code), "That code didn't match. Enter the current 6-digit code.");
      if (!check.ok) return fail(res, check.status, check.message, "code");
    }
    // Turning it on for the first time: same risk the other way — whoever
    // enrolls the authenticator decides who can sign in from then on, so an
    // unattended session mustn't be enough. Ask for the password instead.
    if (!enabled) {
      const currentPassword = String(req.body?.currentPassword ?? "");
      if (!currentPassword) {
        return fail(res, 400, "Enter your current password to set up two-factor authentication.", "currentPassword");
      }
      const check = await checkPassword(req, currentPassword);
      if (!check.ok) return fail(res, check.status, check.message, "currentPassword");
    }
    const profile = await User.getOwnProfile(req.user.id);
    const secret = newSecret();
    await User.setTotpPendingSecret(req.user.id, encryptSecret(secret));
    const enrollment = await buildEnrollment(secret, profile?.email || profile?.username || `user-${req.user.id}`);
    return res.json({ success: true, data: { enrollment, replacing: enabled } });
  } catch (error) {
    return serverError(res, "Start 2FA setup", error);
  }
};

exports.confirmTotpSetup = async (req, res) => {
  try {
    const record = await User.getTotpRecord(req.user.id);
    if (!record) return fail(res, 404, "Account not found");
    const pending = await User.getTotpPendingSecret(req.user.id);
    if (!pending) return fail(res, 400, "Setup expired. Start again.");
    let secret;
    try {
      secret = decryptSecret(pending);
    } catch {
      return fail(res, 400, "Setup expired. Start again.");
    }
    if (!(await verifyToken(codeOf(req), secret))) {
      return fail(res, 400, "That code didn't match. Enter the current 6-digit code from the new app entry.", "code");
    }
    const wasEnabled = record.totp_enabled === 1 && !!record.totp_secret;
    await User.activatePendingTotp(req.user.id);
    await AuditLog.record({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: wasEnabled ? "USER_TOTP_SELF_REPLACED" : "USER_TOTP_SELF_ENABLED",
      entityType: "user",
      entityId: req.user.id,
      details: { username: record.username },
      req,
    });
    return res.json({ success: true, data: { totp_enabled: 1 } });
  } catch (error) {
    return serverError(res, "Confirm 2FA setup", error);
  }
};

exports.cancelTotpSetup = async (req, res) => {
  try {
    await User.setTotpPendingSecret(req.user.id, null);
    return res.json({ success: true });
  } catch (error) {
    return serverError(res, "Cancel 2FA setup", error);
  }
};

exports.disableTotp = async (req, res) => {
  try {
    if (!isAdminRole(req.user.role)) {
      return fail(res, 403, "Two-factor authentication is required for your role and can't be turned off.");
    }
    const record = await User.getTotpRecord(req.user.id);
    if (!record) return fail(res, 404, "Account not found");
    if (!(record.totp_enabled === 1 && record.totp_secret)) return res.json({ success: true, data: { totp_enabled: 0 } });
    const code = codeOf(req);
    if (!code) return fail(res, 400, "Enter the current 6-digit code from your authenticator app.", "code");
    const check = await guardedCheck(req, () => verifyCurrentCode(record, code), "That code didn't match. Enter the current 6-digit code.");
    if (!check.ok) return fail(res, check.status, check.message, "code");
    await User.disableTotp(req.user.id);
    await AuditLog.record({
      actorId: req.user.id,
      actorUsername: req.user.username,
      action: "USER_TOTP_SELF_DISABLED",
      entityType: "user",
      entityId: req.user.id,
      details: { username: record.username },
      req,
    });
    return res.json({ success: true, data: { totp_enabled: 0 } });
  } catch (error) {
    return serverError(res, "Disable 2FA", error);
  }
};
