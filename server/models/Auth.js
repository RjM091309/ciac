const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { selectData } = require("../config/database");
const User = require("./User");
const { decryptSecret, encryptSecret, newSecret, buildEnrollment, verifyToken } = require("../lib/totp");
const { validatePasswordStrength } = require("../lib/password");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

function getDemoAdminCreds() {
  return {
    username: process.env.CIAC_ADMIN_USERNAME || "admin",
    password: process.env.CIAC_ADMIN_PASSWORD || "admin123",
    passwordHash: process.env.CIAC_ADMIN_PASSWORD_HASH || "",
  };
}

function normalizeString(v) {
  return String(v ?? "").trim();
}

// TOR: "account lockout after configurable failed login attempts".
function getLockoutConfig() {
  const maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS);
  const lockoutMinutes = Number(process.env.LOGIN_LOCKOUT_MINUTES);
  return {
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5,
    lockoutMinutes: Number.isFinite(lockoutMinutes) && lockoutMinutes > 0 ? lockoutMinutes : 15,
  };
}

function pickPasswordField(row) {
  if (!row || typeof row !== "object") return null;
  const keys = Object.keys(row);
  const candidates = ["password", "passwd", "pass", "user_password", "password_hash", "hash"];
  const found = candidates.find((c) => keys.some((k) => k.toLowerCase() === c));
  if (!found) return null;
  const actualKey = keys.find((k) => k.toLowerCase() === found);
  return actualKey || null;
}

async function loginViaDatabase(username, password, totpCode, newPassword) {
  const userKey = normalizeString(username);
  const pass = String(password ?? "");

  // Prefer active accounts first. A user can have multiple roles assigned in
  // user_roles; without an explicit tie-break, SQL Server can return them in
  // any order, making the "effective" role in the JWT non-deterministic across
  // logins. Prefer 'admin' when present, then fall back to a stable order.
  const activeRows = await selectData(
    `
      SELECT TOP (1)
        u.*,
        r.name as role_name
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE (u.username = @param0 OR u.email = @param0)
        AND u.is_active = 1
      ORDER BY CASE WHEN LOWER(r.name) = 'admin' THEN 0 ELSE 1 END, r.id ASC
    `,
    [userKey]
  );

  let row = activeRows?.[0];

  // If not active, check if the account exists but is pending / rejected /
  // suspended / deactivated, and return the matching message.
  if (!row) {
    const inactiveRows = await selectData(
      `
        SELECT TOP (1) u.id, u.is_active, u.status
        FROM users u
        WHERE (u.username = @param0 OR u.email = @param0)
          AND u.is_active = 0
      `,
      [userKey]
    );
    const inactive = inactiveRows?.[0];
    if (inactive) {
      const status = String(inactive.status || "ACTIVE").trim().toUpperCase();
      if (status === "PENDING") {
        return {
          success: false,
          message: "Your account is still awaiting approval by CIAC. You'll be able to sign in once it's activated.",
        };
      }
      if (status === "REJECTED") {
        return {
          success: false,
          message: "Your registration was not approved. Please contact CIAC for details.",
        };
      }
      if (status === "SUSPENDED") {
        return { success: false, message: "Your account has been suspended. Contact the administrator." };
      }
      return { success: false, message: "Your account has been deactivated. Contact the administrator." };
    }
    return { success: false, message: "User not found" };
  }

  const id = row.id ?? row.user_id ?? 0;

  // Locked out from repeated failed attempts — reject before touching the
  // password at all, so a locked account never leaks whether the *current*
  // guess would have been right.
  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    const minutesLeft = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
    return {
      success: false,
      locked: true,
      message: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
    };
  }

  const passField = pickPasswordField(row);
  if (!passField) {
    return { success: false, message: "Password field not found in users. Configure your schema or update Auth model." };
  }
  const stored = String(row[passField] ?? "");
  if (!stored.startsWith("$2")) {
    return {
      success: false,
      message: "Account password is using an unsupported format. Ask admin to reset your password.",
    };
  }
  const matches = await bcrypt.compare(pass, stored);
  if (!matches) {
    const { maxAttempts, lockoutMinutes } = getLockoutConfig();
    await User.registerFailedLogin(id, maxAttempts, lockoutMinutes);
    const attemptsSoFar = Number(row.failed_login_attempts || 0) + 1;
    if (attemptsSoFar >= maxAttempts) {
      return {
        success: false,
        locked: true,
        message: `Too many failed attempts. Your account is locked for ${lockoutMinutes} minutes.`,
      };
    }
    return { success: false, message: "Username and Password incorrect!" };
  }

  // Password confirmed — the attack this throttles (guessing the password)
  // is over regardless of whether TOTP succeeds next.
  await User.resetFailedLogins(id);
  const effectiveRole = row.role_name || row.role || "user";
  const isAdmin = String(effectiveRole).toLowerCase() === "admin";

  // An admin-triggered reset (User.adminResetPassword) sets this so the
  // emailed temp password can't just be reused indefinitely — the user must
  // set their own password, right after proving they know the temp one,
  // before a session is issued. Checked ahead of TOTP: no point asking for a
  // 6-digit code tied to a password that's about to be replaced anyway.
  if (Number(row.must_change_password) === 1) {
    if (!newPassword) {
      return {
        success: false,
        mustChangePassword: true,
        message: "Your password was reset by an administrator. Set a new password to continue.",
      };
    }
    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      return { success: false, mustChangePassword: true, message: passwordError };
    }
    await User.setPasswordAndClearMustChange(id, newPassword);
  }

  // --- Two-factor (Google Authenticator / TOTP) ---
  // Non-admin users must have an authenticator; they self-enroll on login (the QR
  // is only issued once the password checks out). Admins are exempt from forced
  // enrollment, but an authenticator they chose to set up is still enforced.
  if ("totp_secret" in row) {
    const code = String(totpCode ?? "").replace(/\D/g, "");
    const enabled = Number(row.totp_enabled) === 1 && !!row.totp_secret;
    const label = row.email || row.username || `user-${id}`;

    if (enabled) {
      let secret;
      try {
        secret = decryptSecret(row.totp_secret);
      } catch {
        return { success: false, message: "Authenticator is misconfigured. Contact the administrator." };
      }
      if (!code) {
        return { success: false, mfaRequired: true, message: "Enter the 6-digit code from your authenticator app." };
      }
      if (!(await verifyToken(code, secret))) {
        return { success: false, mfaRequired: true, message: "Invalid authenticator code. Try again." };
      }
    } else if (!isAdmin) {
      // First-time enrollment. Reuse any pending secret so a re-submit doesn't
      // invalidate a QR the user already scanned; mint one otherwise.
      let secret = null;
      if (row.totp_secret) {
        try {
          secret = decryptSecret(row.totp_secret);
        } catch {
          secret = null;
        }
      }
      if (!secret) {
        secret = newSecret();
        await User.setTotpSecret(id, encryptSecret(secret));
      }
      if (!code) {
        return {
          success: false,
          enrollmentRequired: true,
          enrollment: await buildEnrollment(secret, label),
          message: "Scan the QR code and enter the 6-digit code to finish setup.",
        };
      }
      if (!(await verifyToken(code, secret))) {
        return {
          success: false,
          enrollmentRequired: true,
          enrollment: await buildEnrollment(secret, label),
          message: "That code didn't match. Enter the current 6-digit code.",
        };
      }
      await User.enableTotp(id);
    }
  }

  const user = { id, username: row.username || row.email || userKey, role: effectiveRole };
  const tokenVersion = Number(row.token_version || 0);
  const token = jwt.sign({ ...user, tv: tokenVersion }, getJwtSecret(), { expiresIn: "24h" });
  return { success: true, message: "Login successful", user, token };
}

async function login(username, password, totpCode, newPassword) {
  // Prefer DB if configured; fallback to demo creds
  try {
    return await loginViaDatabase(username, password, totpCode, newPassword);
  } catch (err) {
    // Only fallback if DB isn't configured; otherwise surface the real issue.
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : "";
    if (msg && !msg.toLowerCase().includes("database is not configured") && !msg.toLowerCase().includes("db env not set")) {
      return { success: false, message: msg || "Login failed" };
    }

    const { username: adminUser, password: adminPass, passwordHash: adminPassHash } = getDemoAdminCreds();
    if (normalizeString(username) !== normalizeString(adminUser)) {
      return { success: false, message: "Username and Password incorrect!" };
    }
    const stored = String(adminPassHash || "");
    const hashForCompare = stored.startsWith("$2") ? stored : await bcrypt.hash(String(adminPass), 10);
    const matches = await bcrypt.compare(String(password), hashForCompare);
    if (!matches) return { success: false, message: "Username and Password incorrect!" };

    const user = { id: 1, username: adminUser, role: "admin" };
    const token = jwt.sign(user, getJwtSecret(), { expiresIn: "24h" });
    return { success: true, message: "Login successful", user, token };
  }
}

module.exports = {
  login,
};

