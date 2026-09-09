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

module.exports = { validatePasswordStrength, MIN_LENGTH };
