const bcrypt = require("bcryptjs");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Proponent = require("../models/Proponent");
const Role = require("../models/Role");
const Notification = require("../models/Notification");
const ActivityLog = require("../models/ActivityLog");
const Workflow = require("../models/ApplicationWorkflow");
const ApplicationType = require("../models/ApplicationType");
const { updateData } = require("../config/database");
const { validatePasswordStrength, generateTempPassword } = require("../lib/password");
const { sendMail } = require("../lib/mailer");
const { diffChanges } = require("../lib/auditDiff");

/** Translates a raw MSSQL unique-constraint violation (error 2627/2601) on
 * dbo.users into a friendly message plus which field it belongs to, so the
 * frontend can show it inline under that field instead of a toast leaking
 * the raw SQL error ("Violation of UNIQUE KEY constraint 'UX_users_username'
 * ..."). Returns null for anything else — the caller falls through to its
 * normal 500 handling. */
function friendlyDuplicateUserError(error) {
  if (error?.number !== 2627 && error?.number !== 2601) return null;
  const msg = String(error?.message || "");
  if (msg.includes("UX_users_username")) return { field: "username", message: "That username is already taken." };
  if (msg.includes("UX_users_email")) return { field: "email", message: "That email is already in use." };
  if (msg.includes("UX_users_phone")) return { field: "phone", message: "That phone number is already in use." };
  return { field: null, message: "That value is already in use." };
}

/** The fields an admin can edit on a user, in the shape the audit diff
 * compares — role by name rather than id, plus the linked locator profile
 * fields this same form writes. */
async function userAuditSnapshot(id) {
  const [user, proponent] = await Promise.all([
    User.getUserById(id),
    Proponent.getProponentByUserId(id).catch(() => null),
  ]);
  if (!user) return null;
  return {
    username: user.username,
    email: user.email,
    phone: user.phone,
    full_name: user.full_name,
    is_active: Boolean(user.is_active),
    role: (user.roles || []).map((r) => r.name).join(", ") || null,
    assessment_level: user.assessment_level === 1 ? "Level 1" : "Level 2",
    business_name: proponent?.business_name ?? null,
    address: proponent?.address ?? null,
    lease_address: proponent?.lease_address ?? null,
    contact_no: proponent?.contact_no ?? null,
  };
}

/** Shared by account creation (no admin-chosen password) and admin-triggered
 * reset — same email either way, since both hand the owner a one-time temp
 * password they're required to replace on first login. Includes the
 * username (the password alone isn't enough to sign in) and a direct link
 * to the portal. */
function sendTempPasswordEmail({ to, name, username, tempPassword, isNewAccount }) {
  const intro = isNewAccount
    ? "An account was created for you on the 3CORE Locator Portal."
    : "An administrator reset your password.";
  const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
  return sendMail({
    to,
    subject: isNewAccount ? "Your 3CORE Locator Portal account" : "Your 3CORE Locator Portal password was reset",
    text:
      `Hello ${name},\n\n${intro}\n\n` +
      `Username: ${username}\n` +
      `Temporary password: ${tempPassword}\n\n` +
      `Sign in here: ${loginUrl}\n\n` +
      `You'll be asked to set a new password right away. If you didn't expect this, contact 3CORE.\n`,
    html:
      `<p>Hello ${name},</p>` +
      `<p>${intro}</p>` +
      `<p>Username: <b>${username}</b><br/>` +
      `Temporary password: <span style="font-size:18px;font-weight:bold;letter-spacing:1px;">${tempPassword}</span></p>` +
      `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to the portal</a></p>` +
      `<p>You'll be asked to set a new password right away. If you didn't expect this, contact 3CORE.</p>`,
  });
}

// Reused by c_applications.js when a deferred locator account (created with
// a business profile but no immediate email, see exports.create below) gets
// activated on its first real application submission.
exports.sendTempPasswordEmail = sendTempPasswordEmail;

exports.list = async (req, res) => {
  try {
    const rows = await User.listUsers();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Live check while a create/edit form is still being filled in — lets the
// UI say "already taken" immediately instead of only finding out from a raw
// DB constraint error after Save. field/value come from the query string;
// excludeUserId lets an edit form check without colliding with its own row.
exports.checkAvailability = async (req, res) => {
  try {
    const field = String(req.query?.field || "");
    const value = String(req.query?.value || "");
    if (!["username", "email", "phone"].includes(field)) {
      return res.status(400).json({ success: false, message: "Unsupported field" });
    }
    const excludeUserId = req.query?.excludeUserId ? Number(req.query.excludeUserId) : undefined;
    const available = await User.isFieldAvailable(field, value, excludeUserId);
    return res.json({ success: true, available });
  } catch (error) {
    console.error("Check availability error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await User.getUserById(id);
    if (!row) return res.status(404).json({ success: false, message: "User not found" });

    // Locator Accounts' edit form doubles as the business profile editor, so
    // it needs the linked proponent's fields alongside the plain user row.
    const proponent = await Proponent.getProponentByUserId(id);
    return res.json({
      success: true,
      data: {
        ...row,
        business_name: proponent?.business_name ?? null,
        address: proponent?.address ?? null,
        lease_address: proponent?.lease_address ?? null,
        contact_no: proponent?.contact_no ?? null,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const {
      username,
      email,
      phone,
      full_name,
      password,
      is_active,
      role_id,
      assessment_level,
      business_name,
      address,
      lease_address,
      contact_no,
    } = req.body || {};
    if (!username) return res.status(400).json({ success: false, message: "username is required" });
    if (!String(email || "").trim()) return res.status(400).json({ success: false, message: "email is required" });

    // Locator Accounts' create form can optionally arrive with a business
    // profile already filled in. When it does, activation and the
    // credentials email are DEFERRED to the locator's first real
    // application submission (see c_applications.js's exports.create)
    // instead of firing immediately — no point emailing login access to
    // someone with nothing to act on yet. Without a business profile
    // (business_name left blank), account creation stays immediate/active,
    // same as before.
    const hasBusinessProfile = String(business_name || "").trim().length > 0;
    const locatorRoleId = hasBusinessProfile ? await Role.getActiveRoleIdByName("proponent") : null;
    const isDeferredLocator = Boolean(hasBusinessProfile && locatorRoleId && Number(role_id) === Number(locatorRoleId));

    // No password supplied (e.g. Locator Accounts' create form, which never
    // shows a password field) — generate one. For a deferred locator this is
    // just a placeholder that's immediately unreachable (account starts
    // PENDING/inactive) and gets overwritten by a fresh one at activation.
    const autoGenerate = !password;
    let effectivePassword = password;
    if (autoGenerate) {
      effectivePassword = generateTempPassword();
    } else {
      const passwordError = validatePasswordStrength(password);
      if (passwordError) return res.status(400).json({ success: false, message: passwordError });
    }

    const row = await User.createUser({
      username,
      email,
      phone,
      full_name,
      password: effectivePassword,
      is_active: isDeferredLocator ? 0 : is_active,
      role_id,
      status: isDeferredLocator ? "PENDING" : "ACTIVE",
      assessment_level,
    });

    // Create the linked proponent record now so it's pickable from the New
    // Application locator dropdown right away. Best-effort: a failure here
    // shouldn't fail account creation — for a non-deferred locator, they'd
    // just see the "one more step" business-profile wizard
    // (LocatorProfileSetup.tsx / POST /api/proponents/me/setup) on first
    // login instead.
    if (row && hasBusinessProfile) {
      try {
        await Proponent.createProponent({
          user_id: row.id,
          business_name: String(business_name).trim(),
          address: address ? String(address).trim() : null,
          lease_address: lease_address ? String(lease_address).trim() : null,
          contact_no: contact_no ? String(contact_no).trim() : null,
          created_by: req.user?.id ?? null,
        });
      } catch (error) {
        console.error("Create linked proponent profile error:", error);
      }
    }

    let mailResult = { sent: false };
    if (autoGenerate && row && !isDeferredLocator) {
      await User.setMustChangePassword(row.id, true);
      mailResult = await sendTempPasswordEmail({
        to: row.email,
        name: row.full_name || row.username,
        username: row.username,
        tempPassword: effectivePassword,
        isNewAccount: true,
      });
    }

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_CREATED",
      entityType: "user",
      entityId: row?.id,
      details: {
        username: row?.username,
        role_id,
        autoGeneratedPassword: autoGenerate,
        emailSent: mailResult.sent,
        deferredActivation: isDeferredLocator || undefined,
      },
      req,
    });
    return res.status(201).json({
      success: true,
      data: row,
      deferredActivation: isDeferredLocator || undefined,
      emailSent: isDeferredLocator ? undefined : autoGenerate ? mailResult.sent : undefined,
      message: isDeferredLocator
        ? "Locator account created — pending activation. Their login and temporary password will be emailed automatically once their first application is submitted."
        : autoGenerate
          ? mailResult.sent
            ? `A temporary password was emailed to ${row.email}.`
            : `Account created, but the email could not be sent (SMTP isn't configured on this server) — check the server console for the temporary password.`
          : undefined,
    });
  } catch (error) {
    console.error("Create user error:", error);
    const duplicate = friendlyDuplicateUserError(error);
    if (duplicate) {
      return res.status(409).json({ success: false, message: duplicate.message, field: duplicate.field });
    }
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** Locator Accounts + New Application, merged into one step — the business
 * confirmed a locator account is always exactly one application (1:1), so
 * creating an account with nothing to act on yet is no longer a real state
 * worth supporting. This always creates the user, their business profile,
 * and their application together; a failure partway through rolls back
 * whatever was already created (raw DELETEs, not the model layer's own
 * soft-deactivate helpers — this undoes a creation from the same request,
 * not a real delete of existing data) so a half-created account can never be
 * left behind, since one existing without the other would break the 1:1
 * invariant this endpoint exists to guarantee. */
exports.createLocatorWithApplication = async (req, res) => {
  let createdUserId = null;
  let createdProponentId = null;
  try {
    const {
      username,
      email,
      phone,
      full_name,
      business_name,
      address,
      lease_address,
      contact_no,
      application_type,
      is_renewal,
      save_as_draft,
    } = req.body || {};

    if (!username) return res.status(400).json({ success: false, message: "username is required" });
    if (!String(email || "").trim()) return res.status(400).json({ success: false, message: "email is required" });
    if (!String(business_name || "").trim()) {
      return res.status(400).json({ success: false, message: "business_name is required" });
    }
    if (!String(contact_no || "").trim()) {
      return res.status(400).json({ success: false, message: "contact_no is required" });
    }
    if (!String(address || "").trim()) {
      return res.status(400).json({ success: false, message: "address is required" });
    }

    const normalizedType = String(application_type || "").trim().toUpperCase();
    if (!normalizedType) {
      return res.status(400).json({ success: false, message: "application_type is required" });
    }
    if (!(await Workflow.isValidApplicationType(normalizedType))) {
      const activeCodes = await ApplicationType.listActiveCodes();
      return res.status(400).json({
        success: false,
        message: `Invalid application type. Expected one of: ${activeCodes.join(", ")}.`,
      });
    }

    const locatorRoleId = await Role.getActiveRoleIdByName("proponent");
    if (!locatorRoleId) {
      return res.status(500).json({ success: false, message: "The Locator role isn't configured — set it up in Control Panel first." });
    }

    // Same deferred-activation semantics as the two separate flows this
    // replaces: a draft isn't a real commitment yet, so no login access/email
    // until it's actually submitted (existing submit-a-draft path already
    // calls activateLocatorIfPending for that case).
    const isDraft = Boolean(save_as_draft);
    const tempPassword = generateTempPassword();

    const user = await User.createUser({
      username,
      email,
      phone,
      full_name,
      password: tempPassword,
      is_active: isDraft ? 0 : 1,
      role_id: locatorRoleId,
      status: isDraft ? "PENDING" : "ACTIVE",
    });
    createdUserId = user?.id;

    let proponent;
    try {
      proponent = await Proponent.createProponent({
        user_id: user.id,
        business_name: String(business_name).trim(),
        address: String(address).trim(),
        lease_address: lease_address ? String(lease_address).trim() : null,
        contact_no: String(contact_no).trim(),
        created_by: req.user?.id ?? null,
      });
      createdProponentId = proponent?.id;
    } catch (error) {
      console.error("Create locator with application: proponent step failed:", error);
      throw Object.assign(new Error("Failed to create the locator's business profile."), { status: 500 });
    }

    let application;
    try {
      application = await Workflow.createApplication({
        proponent_id: proponent.id,
        application_type: normalizedType,
        is_renewal: Number(is_renewal) ? 1 : 0,
        status: isDraft ? "DRAFT" : "SUBMITTED",
        created_by: req.user?.id ?? null,
      });
    } catch (error) {
      console.error("Create locator with application: application step failed:", error);
      throw Object.assign(new Error("Failed to create the application."), { status: 500 });
    }

    let mailResult = { sent: false };
    if (!isDraft) {
      await User.setMustChangePassword(user.id, true);
      mailResult = await sendTempPasswordEmail({
        to: user.email,
        name: user.full_name || user.username,
        username: user.username,
        tempPassword,
        isNewAccount: true,
      });
    }

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "LOCATOR_AND_APPLICATION_CREATED",
      entityType: "user",
      entityId: user.id,
      details: {
        username: user.username,
        business_name: proponent?.business_name,
        application_no: application?.application_no,
        application_type: normalizedType,
        save_as_draft: isDraft,
        emailSent: mailResult.sent,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      data: { user, proponent, application },
      emailSent: isDraft ? undefined : mailResult.sent,
      message: isDraft
        ? "Saved as draft — the locator's login and temporary password will be emailed automatically once the application is submitted."
        : mailResult.sent
          ? `Application filed. A temporary password was emailed to ${user.email}.`
          : `Application filed, but the credentials email could not be sent (SMTP isn't configured on this server) — check the server console for the temporary password.`,
    });
  } catch (error) {
    console.error("Create locator with application error:", error);
    // Undo whatever this request already created, in reverse order, so a
    // partial failure never leaves an account without its application.
    if (createdProponentId) {
      await updateData(`DELETE FROM dbo.proponents WHERE id = @param0`, [createdProponentId]).catch(() => {});
    }
    if (createdUserId) {
      await updateData(`DELETE FROM dbo.user_roles WHERE user_id = @param0`, [createdUserId]).catch(() => {});
      await updateData(`DELETE FROM dbo.users WHERE id = @param0`, [createdUserId]).catch(() => {});
    }
    const duplicate = friendlyDuplicateUserError(error);
    if (duplicate) {
      return res.status(409).json({ success: false, message: duplicate.message, field: duplicate.field });
    }
    return res.status(error.status || 500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const {
      username,
      email,
      phone,
      full_name,
      password,
      is_active,
      role_id,
      assessment_level,
      business_name,
      address,
      lease_address,
      contact_no,
    } = req.body || {};
    if (email !== undefined && !String(email || "").trim()) {
      return res.status(400).json({ success: false, message: "email is required" });
    }
    if (password) {
      const passwordError = validatePasswordStrength(password);
      if (passwordError) return res.status(400).json({ success: false, message: passwordError });
    }
    const before = await userAuditSnapshot(id);
    const row = await User.updateUser(id, {
      username,
      email,
      phone,
      full_name,
      password,
      is_active,
      role_id,
      assessment_level,
    });
    if (!row) return res.status(404).json({ success: false, message: "User not found" });

    // Mirrors exports.create's best-effort linked-proponent write: this is
    // the admin-direct edit path (gated by the same settings:locator-users
    // permission as the rest of this route), separate from the proponent's
    // own self-service change-request flow in c_proponents.js.
    if (business_name !== undefined || address !== undefined || lease_address !== undefined || contact_no !== undefined) {
      try {
        const existing = await Proponent.getProponentByUserId(id);
        if (existing) {
          await Proponent.updateProponent(existing.id, {
            business_name: business_name !== undefined ? String(business_name).trim() : undefined,
            address: address !== undefined ? (address ? String(address).trim() : null) : undefined,
            lease_address: lease_address !== undefined ? (lease_address ? String(lease_address).trim() : null) : undefined,
            contact_no: contact_no !== undefined ? (contact_no ? String(contact_no).trim() : null) : undefined,
            updated_by: req.user?.id ?? null,
          });
        } else if (String(business_name || "").trim()) {
          await Proponent.createProponent({
            user_id: id,
            business_name: String(business_name).trim(),
            address: address ? String(address).trim() : null,
            lease_address: lease_address ? String(lease_address).trim() : null,
            contact_no: contact_no ? String(contact_no).trim() : null,
            created_by: req.user?.id ?? null,
          });
        }
      } catch (error) {
        console.error("Update linked proponent profile error:", error);
      }
    }

    const changes = diffChanges(before, await userAuditSnapshot(id));
    if (password) changes.push({ field: "password", masked: true });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: password ? "USER_PASSWORD_RESET" : "USER_UPDATED",
      entityType: "user",
      entityId: id,
      details: { username: row?.username, changes },
      req,
    });

    // Proponent-facing "Password changed" activity entry.
    if (password !== undefined && String(password).trim() !== "") {
      const prop = await Proponent.getProponentByUserId(id);
      ActivityLog.record({
        actorUserId: req.user?.id ?? null,
        proponentId: prop?.id ?? null,
        entityType: "USER",
        entityId: id,
        action: "PASSWORD_CHANGED",
        ip: req.ip,
      });
    }

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update user error:", error);
    const duplicate = friendlyDuplicateUserError(error);
    if (duplicate) {
      return res.status(409).json({ success: false, message: duplicate.message, field: duplicate.field });
    }
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
      details: { username: row?.username },
      req,
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
      details: { username: row?.username },
      req,
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
      details: { username: row?.username },
      req,
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
      details: { username: row?.username },
      req,
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
      details: { username: row?.username },
      req,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Revoke sessions error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** Admin "reset password": generates a temp password, emails it to the
 * user, and flags the account so Auth.js forces them onto a new password
 * before their next login completes. Also revokes any session still open
 * on the old password (User.adminResetPassword bumps token_version). */
exports.resetPassword = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const user = await User.getUserById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!user.email) {
      return res.status(400).json({ success: false, message: "This account has no email on file to send the new password to." });
    }

    const tempPassword = generateTempPassword();
    await User.adminResetPassword(id, tempPassword);

    const mailResult = await sendTempPasswordEmail({
      to: user.email,
      name: user.full_name || user.username,
      username: user.username,
      tempPassword,
      isNewAccount: false,
    });

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_PASSWORD_RESET",
      entityType: "user",
      entityId: id,
      details: { username: user?.username, emailSent: mailResult.sent },
      req,
    });
    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      proponentId: (await Proponent.getProponentByUserId(id))?.id ?? null,
      entityType: "USER",
      entityId: id,
      action: "PASSWORD_CHANGED",
      ip: req.ip,
    });

    return res.json({
      success: true,
      emailSent: mailResult.sent,
      message: mailResult.sent
        ? `A new temporary password was emailed to ${user.email}.`
        : `Password reset, but the email could not be sent (SMTP isn't configured on this server) — check the server console for the temporary password.`,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// --- Self-service registration review ---

exports.approve = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const user = await User.getUserById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.status === "ACTIVE") {
      return res.status(400).json({ success: false, message: "This account is already active." });
    }

    const updated = await User.setUserStatus(id, "ACTIVE");
    await Proponent.setActiveByUserId(id, 1, req.user?.id ?? null);

    const approvedProponent = await Proponent.getProponentByUserId(id);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_APPROVED",
      entityType: "user",
      entityId: id,
      details: { username: user?.username, business_name: approvedProponent?.business_name },
      req,
    });
    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      proponentId: approvedProponent?.id ?? null,
      entityType: "USER",
      entityId: id,
      action: "ACCOUNT_APPROVED",
      ip: req.ip,
    });

    try {
      await Notification.createNotification({
        userId: id,
        subject: "Your CIAC account has been approved",
        body: "Your registration was approved. You can now sign in to the proponent portal.",
        createdBy: req.user?.id ?? null,
        eventType: "application_status",
      });
    } catch (notifyError) {
      console.error("Approve notification error:", notifyError);
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Approve user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.reject = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const note = String(req.body?.note ?? "").trim().slice(0, 500) || null;

    const user = await User.getUserById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const updated = await User.setUserStatus(id, "REJECTED", note);
    await Proponent.setActiveByUserId(id, 0, req.user?.id ?? null);

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "USER_REJECTED",
      entityType: "user",
      entityId: id,
      details: { username: user?.username, note: note || undefined },
      req,
    });
    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      entityType: "USER",
      entityId: id,
      action: "ACCOUNT_REJECTED",
      meta: note ? { note } : null,
      ip: req.ip,
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Reject user error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// --- Self-service password change (topbar "Change Password") ---

exports.changeMyPassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Access token required" });

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required." });
    }

    const storedHash = await User.getPasswordHashById(userId);
    if (!storedHash || !storedHash.startsWith("$2")) {
      return res.status(400).json({ success: false, message: "Account password is using an unsupported format. Ask admin to reset your password." });
    }
    const matches = await bcrypt.compare(String(currentPassword), storedHash);
    if (!matches) {
      return res.status(400).json({ success: false, message: "Current password is incorrect." });
    }

    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) return res.status(400).json({ success: false, message: strengthError });

    if (String(newPassword) === String(currentPassword)) {
      return res.status(400).json({ success: false, message: "New password must be different from your current password." });
    }

    await User.changeOwnPassword(userId, newPassword);
    await AuditLog.record({
      actorId: userId,
      actorUsername: req.user?.username,
      action: "USER_PASSWORD_SELF_CHANGE",
      entityType: "user",
      entityId: userId,
      req,
    });

    return res.json({ success: true, message: "Password updated." });
  } catch (error) {
    console.error("Change own password error:", error);
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
      details: { username: record?.username },
      req,
    });
    return res.json({ success: true, data: { enabled: false } });
  } catch (error) {
    console.error("Reset TOTP error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
