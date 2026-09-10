// The PROPONENT role's stored name can't change (server/controller/c_roles.js
// blocks it — login, self-service portal routing, and every requireRole()
// check match on it literally). "Locator" is the term the client wants
// shown everywhere a human reads it, so every admin-facing surface that
// displays a role name renders through this instead of the raw value.
export function roleDisplayName(name: string): string {
  return String(name || '').trim().toUpperCase() === 'PROPONENT' ? 'LOCATOR' : name;
}
