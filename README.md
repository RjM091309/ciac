# CIAC System - developed by 3CORE

## Docs

- **[System Guide](docs/SYSTEM-GUIDE.md)** — all 11 BRIDGE modules, who owns what
  (RJ / AXL / RAYNAN / ROMAR), workflows, build status, screens, API, and conventions.
  Start here.
- [Process Track deep-dive](docs/PROCESS-MODULES.md) — Assessment & Evaluation +
  Compliance & Inspection (Modules 4 & 10) in full detail.

## Process Track — RAYNAN (DEV 3)

`raynandizon21` owns the **Process** track: everything that happens to an
application *after* the locator submits it and *before* it reaches Approval.
Org-chart nodes: **Assessment · Evaluation · Assignment · Compliance · Inspection**.

| Module | Menu key | API | Frontend | Model |
|--------|----------|-----|----------|-------|
| 4 — Assessment & Evaluation | `assessment:queue` | `/api/assessments` | `src/components/assessment/AssessmentEvaluation.tsx` | `server/models/AssessmentEvaluation.js` |
| 10 — Compliance & Inspection | `compliance:inspections` | `/api/inspections` | `src/components/compliance/ComplianceInspections.tsx` | `server/models/ComplianceInspection.js` |

Both are permission-gated by `requireMenuAccess(<menu key>)`; `admin` gets access
via `fullAccess`, other roles need it switched on in **Settings → Control Panel**.

### Assessment & Evaluation workflow (Module 4) — "Evaluation Queue"

The full, current rules (statuses, Level 1 / Level 2, terms & contract, approval)
are in [`.claude/skills/ciac-project/SKILL.md`](.claude/skills/ciac-project/SKILL.md)
and on **System Settings → Workflow Topology**. In short:

1. **Assignment** — BDO Level 1 assigns a Level 2 (`PATCH /api/assessments/:id/assign`);
   stage `UNASSIGNED → ASSIGNED`, and the Level 2 opening it moves it to `IN_REVIEW`.
2. **Encode the proponent** — drawer tabs **Proponent Information**,
   **Performance Commitment** and **Stockholders / GIS**
   (`/api/assessments/:id/profile | /commitment | /stockholders`). They write the
   proponent's own records, so the same details show on Registered Locator once
   approved. Only the assigned Level 2 edits, while the review is open.
3. **Review** — the **Compliance** tab verifies / rejects each uploaded
   requirement (remarks + a comment thread with the locator).
4. **Terms & Contract** — Level 2 sends the terms; once the locator agrees, records
   the contract, prints the package and uploads the signed copy.
5. **Submit → For Approval** — Level 2 submits the review (`FOR_RECOMMENDATION`);
   Level 1 returns it or clicks **For Approval** and approves in the Approval panel.

Drawer tab order: `Overview | Proponent Information | Performance Commitment |
Stockholders / GIS | Compliance | Terms | Contract | Recommendation | Activity Log`.

### Registered Locator — Locator Information

After approval the locator is edited by its Account Officer on Registered Locator
(`src/components/proponent/ProponentsManagement.tsx`, `/api/proponents`):

- **Lease Agreements** (`server/models/ProponentLease.js`, `dbo.proponent_leases`) —
  one row per lease (first contract + one per approved renewal), the current one
  editable: **Ref. Code** (typed in, never reused), SEC Reg. No. (read-only), Date
  Signed, Start / End, Lease Term. A renewal starts a new lease with a copy of the
  property schedule and needs its own Ref. Code.
- **Profile** — Business Activities, Property Schedule (of the current lease;
  earlier leases viewable), Advance Lease Payment / Security Deposit / Performance
  Security (with Total Amount), Performance Commitment.
- **Stockholders** — the stockholders and the SEC Registration Information card
  (SEC Reg. No. — unique per company — capital, purposes, SEC contact person, GIS).
- **Sub-Lease** — a sub-lessee is a locator of its own, linked to the locator it
  sub-leases from (`proponents.sublessor_id`). The main locator's Sub-Lessees card
  lists them, adds a new one (Add Sub-Lessee) or links / unlinks an existing locator
  (`PUT /api/proponents/:id/sublessor`).
- Deletes are soft (`is_active = 0`); new tables and columns are created on backend
  start, so a `git pull` + restart is all another machine needs.

### Compliance & Inspection workflow (Module 10)

Schedules and tracks inspections against locators and rolls the results up into a
per-locator compliance standing.

1. **Schedule** — `POST /api/inspections` creates an inspection (locator required,
   optional contract / application link, type, target date); status `SCHEDULED`.
2. **Assignment** — `PATCH /api/inspections/:id/assign` sets the inspector
   (officer / admin).
3. **Conduct** — `PATCH /:id/status` moves `SCHEDULED → IN_PROGRESS → COMPLETED`
   (or `CANCELLED`). During the inspection the inspector logs findings
   (`/:id/findings`, each with a recommendation and `OPEN / RESOLVED / WAIVED`
   status) and raises corrective actions (`/:id/actions` — responsible party +
   due date; status `PENDING / IN_PROGRESS / DONE`, auto-flagged `OVERDUE` past
   the due date).
4. **Report & result** — supporting report documents are attached by path/URL
   (`/:id/documents`, metadata only — this system has no binary upload) and
   `PATCH /:id/result` records `PASSED / PASSED_WITH_FINDINGS / FAILED`.
5. **Monitor** — `GET /api/inspections/summary` returns stat counts plus a
   `by_proponent` compliance-standing rollup shown on the "Compliance Monitor"
   in-page tab. Notifications (`eventType: "compliance"`) fire only when the
   inspection is linked to an `application_id`.

`server/models/ComplianceInspection.js` self-migrates its 5 tables
(`inspections`, `inspection_findings`, `inspection_corrective_actions`,
`inspection_documents`, `inspection_activity`) once per process.

### Not in this track

The `compliance:bir` (BIR & Tax Records) and `compliance:expiry` (Expiry Calendar)
sidebar screens are still static placeholders and belong to Records Management
(Module 6, ROMAR / DEV 4), not the Process track.

## Two-factor login (Google Authenticator / TOTP)

Non-admin users sign in with username + password **and** a 6-digit code from an
authenticator app (Google Authenticator, Authy, 1Password, etc.). 2FA is
mandatory for them — they enroll themselves on their next login. Users with the
`admin` role are exempt and sign in with a password only (if an admin sets up an
authenticator anyway, its code is still enforced).

### Setup

No frontend config is required. Optional backend env values (see
`server/.env.example`):

- The name shown in the user's authenticator app is set in **Portal Settings → Branding → Authenticator app name** (empty = `CIAC Portal`; accounts enrolled before the rename still show `3CORE Portal`). `TOTP_ISSUER` in `.env` is no longer read — an existing value is imported once.
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
