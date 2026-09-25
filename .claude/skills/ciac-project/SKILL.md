---
name: ciac-project
description: Overview, run/dev, build, and deploy instructions for the CIAC system (3CORE) — a React/Vite frontend + Express/MSSQL backend — plus the Locator → Assessment Officer → Account Officer application workflow (statuses, draft/submit/activation rules, who does what). Use when running, building, deploying, or navigating this repo, or when working on application filing/assessment/approval logic.
---

# CIAC System (3CORE)

Full-stack app: React 19 + Vite frontend (`/`) and an Express backend (`server/`), split as two npm workspaces (root `package.json` declares `workspaces: ["server"]`). Used to manage lease applications, contracts, requirements/compliance, and inspections for locators (proponents).

## Stack

- Frontend: React 19, TypeScript, Vite 6, Tailwind CSS 4, MUI 7 (+ `x-date-pickers-pro`), `recharts`, `sonner`, `lucide-react`.
- Backend: Express 4 (CommonJS), MSSQL (`mssql` / `msnodesqlv8`), `better-sqlite3` is also a root dependency (see `bizreg.db` at repo root — check `server/config/database.js` to confirm which DB is actually live), JWT auth via cookies (`jsonwebtoken`, `cookie-parser`), TOTP 2FA (`otplib` + `qrcode`), `nodemailer` for email, `node-cache`.

## Repo layout

```
src/                  Frontend (Vite root)
  components/         applications/, proponent/, dashboard/, auth/, FileMaintenance/, settings/, ui/
  layout/             AppLayout, AppView routing
  config/landingConfig.ts   per-view dashboard copy/stats registry
  context/, hooks/, state/  GlobalDateContext, etc.
server/               Backend (separate npm workspace, CommonJS)
  app.js              Express bootstrap, CORS allowlist, static files, DB init
  routes/r_*.js        one router per resource, mounted in routes/routes.js under /api/*
  controller/c_*.js    matches each router
  models/              Role, User, Proponent, Contract, ApplicationWorkflow, Requirement(Category),
                        ComplianceType, InspectionType, Notification, ControlPanelPermission, Auth
  middleware/m_auth.js  attachUserFromJwt, isAuthenticated
  config/               database.js, mailer.js, cache.js
  lib/                  notificationStream.js, totp.js (Google Authenticator secrets/verify)
ecosystem.config.cjs   PM2 config (two apps: ciac-dev, ciac-backend-dev)
```

### API surface (mounted in `server/routes/routes.js`)

`/api/auth`, `/api/users`, `/api/roles`, `/api/proponents`, `/api/applications`, `/api/contracts`, `/api/notifications`, `/api/requirements`, `/api/requirement-categories`, `/api/inspection-types`, `/api/compliance-types`, `/api/control-panel`.

Auth: JWT stored in an httpOnly cookie; `attachUserFromJwt` middleware runs globally, `isAuthenticated` guards protected routes. Login is `POST /api/auth/login` (username + password, plus a `token` field once a code is needed). TOTP 2FA is mandatory for non-admin roles: after the password checks out the response is `enrollmentRequired` (returns a QR to self-enroll) or `mfaRequired` (authenticator active) until a valid code is sent. Users with the `admin` role skip enrollment (password only), though an authenticator they opted into is still enforced. Admins can `POST /api/users/:id/totp/reset` a lost authenticator (see root `README.md`).

## Ports & proxy

- Frontend dev server: `2500` (`vite.config.ts`, `host: 0.0.0.0`, `strictPort: true`).
- Backend: `process.env.PORT || 3100`.
- Vite proxies `/api` → `env.VITE_BACKEND_URL` (defaults to `http://127.0.0.1:2501` in `vite.config.ts`, but `.env.example` sets `VITE_BACKEND_URL=http://localhost:3100` — confirm the actual backend port matches whichever `.env` value is loaded before assuming which one is live).
- Backend CORS allowlist defaults to `http://localhost:2500` and `http://localhost:5173`, plus `FRONTEND_URL` / `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS` from env.

## Running it

Root scripts (`package.json`):

```bash
npm run dev        # vite dev --port 2500 (frontend only)
npm run dev:all     # runs frontend + `npm --prefix server run dev` concurrently
npm run build       # vite build
npm run start       # vite preview --port 2500
npm run lint        # tsc --noEmit
```

Backend only: `npm --prefix server run dev` (plain `node app.js`) or `npm --prefix server run start` (`NODE_ENV=production node app.js`).

Via PM2 (`ecosystem.config.cjs`, both apps have `watch: true`):

```bash
pm2 start ecosystem.config.cjs        # starts ciac-dev (frontend) + ciac-backend-dev
pm2 restart ciac-dev ciac-backend-dev
pm2 logs ciac-backend-dev
```

## Environment variables

Frontend (`.env`, Vite-exposed vars need `VITE_` prefix):
- `VITE_BACKEND_URL` — backend origin for the `/api` proxy.
- `GEMINI_API_KEY` — injected into `process.env` at build time via `vite.config.ts` `define`.

Backend (`server/.env`):
- `PORT`, `NODE_ENV`
- `JWT_SECRET`
- `FRONTEND_URL` (also accepts `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS`, comma-separated)
- `DB_SERVER`, `DB_NAME`, `DB_TRUSTED_CONNECTION`, `DB_USER`, `DB_PASSWORD`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
- `TOTP_ISSUER` (authenticator app label, default `3CORE Portal`), `TOTP_ENC_KEY` (optional; encrypts stored TOTP secrets, falls back to `JWT_SECRET`)

## Build & deploy

```bash
npm run build     # emits static frontend to dist/
```

`dist/` is served as the built frontend; the Express server (`server/app.js`) serves its own static assets from `server/public` and JSON/API routes — the two are deployed/run as separate processes (see `ecosystem.config.cjs`), with the frontend's dev proxy (or a reverse proxy in production) routing `/api` to the backend port.

Auth/session guard on startup: `server/app.js` calls `initializeDatabase()` then `Role.ensureSchema()` / `User.ensureSchema()` before listening — if the DB is unreachable, the server still starts (login page still loads) but DB-backed routes will fail. `User.ensureSchema()` also auto-adds the `users.totp_secret` / `users.totp_enabled` columns for 2FA.

## Application workflow (Locator → Assessment Officer → Account Officer)

**Quick summary (high-level mental model — see Stages 1-4 below for the exact code-level mechanics):**
1. A staff user with **Locator Accounts** access (`settings:locator-users`, `LocatorUsersManagement.tsx` → `POST /api/users`) creates the Locator's login account up front — it starts `PENDING`/inactive with a placeholder password. Filing the Locator's first real application does **not** create the account; it *activates* an already-existing PENDING one — `activateLocatorIfPending()` in `c_applications.js` no-ops if there's no linked user yet or it isn't PENDING. So a locator needs a Locator Account created *before* anyone can file for them.
2. **Locator** submits their requirements — uploads documents against the requirement checklist in their own portal (`ProponentApplications.tsx`, `POST /api/proponents/me/applications/:id/documents`, then `POST /api/applications/:id/submit` for DRAFT→SUBMITTED or RETURNED→RESUBMITTED — Stage 2).
3. **Assessment Officer** evaluates and approves the Locator's requirements (Compliance tab + Recommendation submit — Stage 3).
4. **Account Officer** handles the master list of registered business locators and renewals (Approval/Issuance module — Stage 4, plus the Locators/Proponent List page).

None of "Locator Accounts," "Applications," or "Assessment Officer" access is a hardcoded role check — they're generic Control Panel menu permissions (`settings:locator-users`, `applications:new`/`applications:renewals`/`assessment:queue`/`approval:queue`) that an admin assigns to whatever role they name; see the permission note right below.

Staff files applications on the locator's behalf now (not locator self-service filing). Roles are **not hardcoded** — access is driven by Control Panel per-role menu permissions (`assessment:queue`, `approval:queue`, `applications:new`, `applications:renewals`), checked live per request (`requireMenuAccess`/`requireApplicationsAccess` in `server/middleware/m_auth.js`). "Assessment Officer"/"Account Officer" are just conventional role names an admin assigns those permissions to — nothing in code checks the literal role string except `admin` and `proponent`.

**Statuses** (`APPLICATION_STATUSES`, `server/models/ApplicationWorkflow.js`): `DRAFT, SUBMITTED, UNDER_REVIEW (dead — nothing sets it), RESUBMITTED, RETURNED, REJECTED, FOR_APPROVAL, DISAPPROVED, APPROVED`.

**Stage 1 — Filing** (`src/components/applications/ApplicationsWorkflow.tsx`, "Applications" page): staff picks a Locator + Application Type, either "Save as draft" or submits immediately.
- **DRAFT means hold/not-yet-started** — no notification, no email, no locator account activation while draft. A DRAFT row shows a "Draft →" button (not Submit) that reopens the same panel pre-filled ("Continue Draft") to fix the Locator (DRAFT-only) or Application Type (`TYPE_EDITABLE_STATUSES = DRAFT/SUBMITTED/UNDER_REVIEW/RESUBMITTED/RETURNED`, refused once documents exist and the type actually changes) before really submitting.
- **The mandatory-document check only applies to RETURNED → RESUBMITTED, never to the first DRAFT → SUBMITTED.** This is deliberate, not a bug: a freshly-filed locator has no portal access yet (their account is still PENDING, no login emailed) until this exact submit succeeds — requiring documents before that first submit would be circular (can't upload without logging in, can't log in without this submit, can't submit without documents). The locator uploads their own documents in their own portal *after* this handoff. Resubmitting after a RETURNED does require all mandatory docs, since the locator already has access by then.
- **Locator account activation is tied to a real submit, not to filing/drafting.** `activateLocatorIfPending()` (`server/controller/c_applications.js`) resets a PENDING locator's password and emails it, but only fires from `exports.create` (non-draft) and `exports.submit` — never while saving/updating a draft. It no-ops safely if the account is already ACTIVE (checked before any password reset), so re-submitting other applications for the same locator never re-issues credentials.
- One proponent (business) can have any number of applications, including multiple simultaneous DRAFTs — no uniqueness constraint on `applications.proponent_id`, each application has its own row/`application_no`/requirement checklist. This already works correctly.
- "One login, multiple *businesses*" (a second `proponents` row for an already-active `user_id`) is a **separate, unsupported** scenario — no reachable UI creates a second business for an existing account, and the self-service portal (`requireProponentSelf`) only ever resolves one proponent per user (`TOP(1)`, no `ORDER BY`) — a second one would be silently invisible to the locator. Don't confuse this with the (fully working) multi-application case above.

**Stage 2 — Locator uploads** (`src/components/proponent/ProponentApplications.tsx`, locator's own portal): locator logs in (once activated), uploads documents against the requirement checklist, submits/resubmits themselves via the same DRAFT→SUBMITTED / RETURNED→RESUBMITTED transitions. Re-uploading against a REJECTED requirement auto-flips it back to PENDING server-side.

**Stage 3 — Assessment** (`src/components/assessment/AssessmentEvaluation.tsx`, `/assessment`): Compliance tab verifies/rejects each requirement (Verify disabled once REJECTED until a reupload flips it back to PENDING); a per-requirement comment/reply thread (`application_requirement_comments`, cascades on delete) lets the Assessment Officer and Locator discuss a specific requirement; ad-hoc one-off requirements can be attached to a single application (`is_ad_hoc=1` catalog rows, excluded from the shared Requirements screen and preserved across a type-change checklist rebuild). Findings (structured deficiencies) are staff/Account-Officer-only, never shown to the Locator. Recommendation submit (ENDORSE/RETURN/DISAPPROVE) moves the application to FOR_APPROVAL/RETURNED/DISAPPROVED and locks the whole Overview/Findings/Recommendation UI until an admin Reopens. FOR_APPROVAL auto-starts the Approval routing ladder — no manual "Start" step.

**Stage 4 — Approval** (`src/components/approval/ApprovalIssuance.tsx`, `/approval`, Account Officer territory): out of scope for the Applications/Assessment pages — clicking a row in "Applications" never routes here; it always opens `/assessment?tab=Compliance`. Contract/permit issuance happens only in this module (a duplicate contract-creation UI in the old Applications page was removed as a workflow-bypass risk). A raw `PATCH /api/applications/:id/status` escape hatch exists but is now `requireRole("admin")`-gated — it skips the mandatory-document check and doesn't auto-start Approval routing, so it's not a substitute for the real Compliance→Recommendation flow.

## Notes / gotchas

- `.env.example` (tracked in git) has a `GEMINI_API_KEY` value that looks like a live key format (`AIzaSy...`), not an obvious placeholder — verify whether it's a real, still-valid key and rotate/remove it if so.
- Root `package.json` lists `better-sqlite3` as a dependency and there's a `bizreg.db` at repo root, while the backend's primary DB config points at MSSQL (`mssql`/`msnodesqlv8` in `server/package.json`) — check `server/config/database.js` before assuming which datastore a given feature reads from.
