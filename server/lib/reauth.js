const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { getLockoutConfig } = require("../models/Auth");

// Re-checks a signed-in user's password or authenticator code (Change
// Password, My Profile email change / 2FA). These share the sign-in lockout
// in Auth.js — same counter, same LOGIN_MAX_ATTEMPTS / LOGIN_LOCKOUT_MINUTES,
// admins included — so an open session can't be used to guess the
// password or code more times than the login page allows. Hitting the limit
// also ends the account's sessions: whoever is guessing gets signed out and,
// with the account locked, can't sign back in until the lockout passes.

function lockedMessage(lockedUntil) {
  const minutes = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60000));
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** Error message if the account is currently locked out, else null. */
async function lockoutMessage(req) {
  const state = await User.getLoginLockState(req.user.id);
  if (state?.lockedUntil && new Date(state.lockedUntil).getTime() > Date.now()) return lockedMessage(state.lockedUntil);
  return null;
}

/** Counts one wrong password/code. Returns the lockout message when this
 * attempt locked the account (its sessions are ended too), else null. */
async function registerFailure(req) {
  const { maxAttempts, lockoutMinutes } = getLockoutConfig();
  await User.registerFailedLogin(req.user.id, maxAttempts, lockoutMinutes);
  const state = await User.getLoginLockState(req.user.id);
  if (!state?.lockedUntil || new Date(state.lockedUntil).getTime() <= Date.now()) return null;
  await User.bumpTokenVersion(req.user.id);
  return `Too many failed attempts. Your account is locked for ${lockoutMinutes} minutes and you've been signed out.`;
}

/**
 * Runs `check` (resolves true when the password/code is right) under the
 * shared lockout. Resolves { ok: true }, or { ok: false, status, message,
 * locked } for the caller to send.
 */
async function guardedCheck(req, check, wrongMessage) {
  const locked = await lockoutMessage(req);
  if (locked) return { ok: false, status: 429, message: locked, locked: true };
  if (await check()) return { ok: true };
  const nowLocked = await registerFailure(req);
  if (nowLocked) return { ok: false, status: 429, message: nowLocked, locked: true };
  return { ok: false, status: 400, message: wrongMessage };
}

async function passwordMatches(userId, password) {
  const storedHash = await User.getPasswordHashById(userId);
  return Boolean(storedHash) && storedHash.startsWith("$2") && (await bcrypt.compare(String(password || ""), storedHash));
}

/** guardedCheck for the account's current password. */
function checkPassword(req, password, wrongMessage = "Current password is incorrect.") {
  return guardedCheck(req, () => passwordMatches(req.user.id, password), wrongMessage);
}

module.exports = { guardedCheck, checkPassword };
