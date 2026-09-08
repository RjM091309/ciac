# CIAC System - developed by 3CORE

## Two-factor login (Google Authenticator / TOTP)

Non-admin users sign in with username + password **and** a 6-digit code from an
authenticator app (Google Authenticator, Authy, 1Password, etc.). 2FA is
mandatory for them — they enroll themselves on their next login. Users with the
`admin` role are exempt and sign in with a password only (if an admin sets up an
authenticator anyway, its code is still enforced).

### Setup

No frontend config is required. Optional backend env values (see
`server/.env.example`):

- `TOTP_ISSUER` — name shown in the user's authenticator app (default `3CORE Portal`).
- `TOTP_ENC_KEY` — 32+ char random string used to encrypt stored TOTP secrets at
  rest. If omitted, a key derived from `JWT_SECRET` is used.

### Enrollment flow (self-service, on first login — non-admins only)

1. User enters username + password.
2. Server validates the password, then returns a QR code + setup key
   (`enrollmentRequired: true`).
3. The login screen shows the QR. On mobile the user taps **Add to
   Authenticator** (`otpauth://` deep link) or copies the setup key; on desktop
   they scan the QR with their phone.
4. User enters the current 6-digit code → server verifies, marks the
   authenticator active, and issues the session.
5. Every later login just asks for the code.

Admins have no enrollment step. In **Settings → Users → edit user** they see the
2FA status and a **Reset authenticator** button — used when a user loses their
device; it clears the authenticator so the user re-enrolls on their next login.

### Notes

- Single endpoint: `POST /api/auth/login` with `{ username, password }`, plus a
  `token` field once a code is required. Responses:
  - `enrollmentRequired: true` + `enrollment: { otpauthUrl, secret, qrDataUrl }`
    — user has no authenticator yet.
  - `mfaRequired: true` — authenticator active, code missing/incorrect.
  - `success: true` — sets the JWT cookie.
- The pending secret is reused across login attempts until activated, so a
  half-scanned QR is never invalidated by re-submitting.
- Secrets are stored AES-256-GCM encrypted in `users.totp_secret`
  (`users.totp_enabled` gates enforcement). Both columns are auto-created on
  server start.
- Admin reset: `POST /api/users/:id/totp/reset`.
