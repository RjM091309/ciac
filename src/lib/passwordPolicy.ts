// Mirrors server/lib/password.js — kept in sync by hand since frontend and
// backend don't share a module boundary here. Gives inline feedback before
// the request round-trip; the backend is still the actual enforcement point.
const MIN_LENGTH = 8;

export function validatePassword(password: string): string | null {
  if (password.length < MIN_LENGTH) return `At least ${MIN_LENGTH} characters.`;
  if (!/[a-zA-Z]/.test(password)) return 'Include at least one letter.';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';
  return null;
}
