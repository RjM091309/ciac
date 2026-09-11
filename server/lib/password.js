// Minimum bar for account passwords (TOR: "password policies and account
// security"). Kept intentionally simple — length plus a mix of character
// classes — rather than an arbitrary regex ruleset that mostly frustrates
// users without stopping real attacks.
const MIN_LENGTH = 8;

function validatePasswordStrength(password) {
  const value = String(password ?? "");
  if (value.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(value)) {
    return "Password must include at least one letter.";
  }
  if (!/[0-9]/.test(value)) {
    return "Password must include at least one number.";
  }
  return null;
}

const crypto = require("crypto");

// Excludes visually-ambiguous characters (0/O, 1/l/I) since this is meant to
// be read off an email and retyped once. crypto.randomBytes, not Math.random
// — it's mailed to the user, so it needs to be unguessable, not just unique.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Admin "reset password" temp password — always satisfies
 * validatePasswordStrength (12 chars drawn from letters+digits). */
function generateTempPassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  }
  return out;
}

module.exports = { validatePasswordStrength, MIN_LENGTH, generateTempPassword };
