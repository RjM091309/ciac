const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { validatePasswordStrength } = require("../lib/password");

exports.list = async (req, res) => {
  try {
    const rows = await User.listUsers();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.getUserById(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { username, email, phone, full_name, password, is_active, role_id } = req.body || {};
    if (!username) return res.status(400).json({ success: false, message: "username is required" });
    if (!String(email || "").trim()) return res.status(400).json({ success: false, message: "email is required" });
    if (!password) return res.status(400).json({ success: false, message: "password is required" });
    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ success: false, message: passwordError });

    const row = await User.createUser({ username, email, phone, full_name, password, is_active, role_id });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_CREATED",
      entityType: "user",
      entityId: row?.id,
      details: { username: row?.username, role_id },
      ipAddress: req.ip,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const { username, email, phone, full_name, password, is_active, role_id } = req.body || {};
    if (email !== undefined && !String(email || "").trim()) {
      return res.status(400).json({ success: false, message: "email is required" });
    }
    if (password) {
      const passwordError = validatePasswordStrength(password);
      if (passwordError) return res.status(400).json({ success: false, message: passwordError });
    }
    const row = await User.updateUser(id, { username, email, phone, full_name, password, is_active, role_id });
    if (!row) return res.status(404).json({ success: false, message: "User not found" });

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: password ? "USER_PASSWORD_RESET" : "USER_UPDATED",
      entityType: "user",
      entityId: id,
      details: { fields: Object.keys(req.body || {}) },
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.deactivateUser(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_DEACTIVATED",
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.reactivateUser(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_REACTIVATED",
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** Distinct from deactivate: an easily-reversed hold, not a long-term closure. */
exports.suspend = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.suspendUser(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_SUSPENDED",
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Suspend user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.unsuspend = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.unsuspendUser(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_UNSUSPENDED",
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Unsuspend user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** Forces the user to log in again everywhere, without waiting for their
 * current JWT's 24h expiry — e.g. after a suspected compromise. */
exports.revokeSessions = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.revokeSessions(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_SESSIONS_REVOKED",
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Revoke sessions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// --- Two-factor (Google Authenticator / TOTP) ---
// Users self-enroll on their next login; admins can only reset a lost
// authenticator, which clears it and forces re-enrollment.

exports.resetTotp = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const record = await User.getTotpRecord(id);
    if (!record) return res.status(404).json({ success: false, message: "User not found" });

    await User.disableTotp(id);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_TOTP_RESET",
      entityType: "user",
      entityId: id,
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: { enabled: false } });
  } catch (error) {
    console.error("Reset TOTP error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
