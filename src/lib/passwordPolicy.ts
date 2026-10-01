import { getSiteSettings } from './siteSettings';

// Mirrors server/lib/password.js — kept in sync by hand since frontend and
// backend don't share a module boundary here. Gives inline feedback before
// the request round-trip; the backend is still the actual enforcement point.
// The minimum length is set in Portal Settings (Security tab); components
// showing these call useSiteSettings() so they re-render when it changes.

export function minPasswordLength(): number {
  return getSiteSettings().security.password_min_length;
}

export function passwordHint(): string {
  return `At least ${minPasswordLength()} characters, with uppercase, lowercase, a number and a special character.`;
}

export function passwordChecks(password: string) {
  return {
    length: password.length >= minPasswordLength(),
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export function validatePassword(password: string): string | null {
  const c = passwordChecks(password);
  if (!c.length) return `At least ${minPasswordLength()} characters.`;
  if (!c.upper) return 'Include at least one uppercase letter.';
  if (!c.lower) return 'Include at least one lowercase letter.';
  if (!c.number) return 'Include at least one number.';
  if (!c.special) return 'Include at least one special character.';
  return null;
}
