const { getters } = require("./siteSettings");

// Minimum bar for account passwords (TOR: "password policies and account
// security"). Upper, lower, number and special, plus a minimum length an
// administrator sets in Portal Settings (Security tab, 12–64, default 12 —
// the bar VAPT scans check for, "Weak Password Requirements"). Only enforced
// when a password is set, so existing passwords keep working until their next
// change. src/lib/passwordPolicy.ts mirrors these rules for inline feedback.
function minLength() {
  return getters.passwordMinLength();
}

function validatePasswordStrength(password) {
  const value = String(password ?? "");
  const min = minLength();
  if (value.length < min) {
    return `Password must be at least ${min} characters.`;
  }
  if (!/[A-Z]/.test(value)) {
    return "Password must include at least one uppercase letter.";
  }
  if (!/[a-z]/.test(value)) {
    return "Password must include at least one lowercase letter.";
  }
  if (!/[0-9]/.test(value)) {
    return "Password must include at least one number.";
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return "Password must include at least one special character.";
  }
  return null;
}

const crypto = require("crypto");

// Excludes visually-ambiguous characters (0/O, 1/l/I) since this is meant to
// be read off an email and retyped once. crypto.randomBytes, not Math.random
// — it's mailed to the user, so it needs to be unguessable, not just unique.
const TEMP_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const TEMP_LOWER = "abcdefghijkmnpqrstuvwxyz";
const TEMP_DIGITS = "23456789";
const TEMP_SPECIAL = "!@#$%*?";
const TEMP_PASSWORD_ALPHABET = TEMP_UPPER + TEMP_LOWER + TEMP_DIGITS + TEMP_SPECIAL;

function randomChar(alphabet) {
  return alphabet[crypto.randomInt(alphabet.length)];
}

/** Admin "reset password" temp password — always satisfies
 * validatePasswordStrength: one of each character class, the rest drawn from
 * all of them, then shuffled so the classes aren't in a fixed position. */
function generateTempPassword(length = 12) {
  const size = Math.max(length, minLength());
  const chars = [randomChar(TEMP_UPPER), randomChar(TEMP_LOWER), randomChar(TEMP_DIGITS), randomChar(TEMP_SPECIAL)];
  while (chars.length < size) chars.push(randomChar(TEMP_PASSWORD_ALPHABET));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

module.exports = { validatePasswordStrength, minLength, generateTempPassword };
