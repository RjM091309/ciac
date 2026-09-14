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

### Assessment & Evaluation workflow (Module 4)

Sits between Business Registration (Module 3) and Approval & Issuance (Module 5).
An Account Officer / evaluator processes each submitted application:

1. **Assignment** — `PATCH /api/assessments/:applicationId/assign` gives the
   application an evaluator; stage `UNASSIGNED → ASSIGNED`.
2. **Review** — evaluator moves through stages
   `ASSIGNED → IN_REVIEW → FOR_RECOMMENDATION` (`PATCH /:applicationId/stage`) and
   verifies each documentary requirement
   (`PATCH /api/assessments/requirements/:id/status`).
3. **Evaluation** — records findings / deficiencies / recommendations
   (`/:applicationId/findings`) and assesses fees, rentals, taxes and penalties as
   charge line items (`/:applicationId/charges`; `charges_total` is recomputed in
   a transaction on every write).
4. **Recommendation** — `POST /:applicationId/recommendation` with
   `ENDORSE` / `RETURN` / `DISAPPROVE`, which calls
   `ApplicationWorkflow.updateApplicationStatus` (→ `FOR_APPROVAL` / `RETURNED` /
   `DISAPPROVED`) and fires a notification (`eventType: "assessment"`). Stage
   becomes `COMPLETED` or `RETURNED`; `PATCH /:applicationId/reopen` re-opens a
   returned assessment.

Every action is written to an append-only `assessment_activity` log. Management
watches progress on the queue's monitoring stat bar.

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
