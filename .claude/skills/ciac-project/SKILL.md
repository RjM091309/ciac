---
name: ciac-project
description: Overview, run/dev, build, and deploy instructions for the CIAC system (3CORE) — a React/Vite frontend + Express/MSSQL backend — plus the Locator → Assessment (Level 2 Officer → Level 1 Manager) → Account Officer approval workflow, permits/expiration/renewal (statuses, draft/submit/activation rules, who does what). Use when running, building, deploying, or navigating this repo, or when working on application filing/assessment/approval/permit logic.
---

# CIAC System (3CORE)

Full-stack app: React 19 + Vite frontend (`/`) and an Express backend (`server/`), split as two npm workspaces (root `package.json` declares `workspaces: ["server"]`). Used to manage locator (proponent) applications, assessment, approval/issuance, contracts, permits (expiry + renewal), and compliance inspections.

## Stack

- Frontend: React 19, TypeScript, Vite 6, Tailwind CSS 4, MUI 7 (+ `x-date-pickers-pro`), `recharts`, `sonner`, `lucide-react`, `exceljs`/`jspdf` for exports.
- Backend: Express 4 (CommonJS), MSSQL via `mssql` (or `mssql/msnodesqlv8` when `DB_TRUSTED_CONNECTION` is on — see `server/config/database.js`), JWT in an httpOnly cookie, TOTP 2FA (`otplib` + `qrcode`), `nodemailer`, `multer` uploads, `helmet`, `express-rate-limit`, `playwright` (only for rendering certificate PDFs in `server/lib/certificateRenderer.js`).
- Unused leftovers from the original template: root `better-sqlite3` dependency + `bizreg.db`, and `@google/genai` / `GEMINI_API_KEY` — nothing in `src/` or `server/` reads them. MSSQL is the only live datastore.

## Repo layout

```
src/                    Frontend (Vite root)
  App.tsx               Custom router (VIEW_TO_PATH), lazy-loaded pages, auth state
  layout/AppLayout.tsx  Staff shell (AppSidebar/AppHeader); AppView type
  components/
    applications/       ApplicationsWorkflow (filing), Requirements, RequirementCategories
    assessment/         AssessmentEvaluation (/assessment)
    approval/           ApprovalIssuance (/approval)
    compliance/         PermitsManagement (permits, expiry, renewal), ComplianceInspections
    proponent/          Locator portal pages + ProponentsManagement (staff locator list)
    dashboard/          RoleDashboard, OfficerDashboard, ProponentDashboard, PreviewDashboard, AttentionCard
    reports/            ReportsAnalytics
    FileMaintenance/    lookup tables (Application/Compliance/Inspection types, Account Officers, Building, Land Use, Type of Contract, Departments)
    settings/           UsersManagement, LocatorUsersManagement, RolesPanel, ControlPanelManagement, AuditLog
  config/landingConfig.ts  per-view dashboard copy/stats registry
  context/ControlPanelAccessContext.tsx  per-role menu permissions on the client
  lib/                  notificationClient (SSE), idleSession, passwordPolicy, etc.
server/                 Backend (separate npm workspace, CommonJS)
  app.js                bootstrap: helmet, CORS allowlist, CSRF origin guard, JWT attach, routes, ensureSchema steps
  routes/r_*.js         one router per resource, mounted in routes/routes.js under /api/*
  controller/c_*.js     matches each router
  models/               raw-SQL models; most own an idempotent ensureSchema()
  middleware/           m_auth.js (guards), m_csrf.js (Origin check), m_upload.js (multer, 15 MB, mimetype allowlist)
  lib/                  totp, mailer, notificationStream (SSE), fileStorage, certificate renderers, auditDiff
  sql/, scripts/        one-off SQL files and migration/backfill/import scripts (run manually)
  uploads/              uploaded documents (gitignored, runtime data)
ecosystem.config.cjs    PM2 config (ciac-dev = Vite, ciac-backend-dev = Express)
docs/                   SYSTEM-GUIDE.md, PROCESS-MODULES.md (last updated 2026-09-09 — may lag the code)
```

### API surface (mounted in `server/routes/routes.js`)

- Auth & users: `/api/auth`, `/api/users`, `/api/roles`, `/api/control-panel`
- Workflow: `/api/applications`, `/api/assessments`, `/api/approvals`, `/api/documents`
- Locators: `/api/proponents` (staff CRUD + `/me/*` locator self-service portal)
- Permits & compliance: `/api/permits`, `/api/inspections`
- Lookups (File Maintenance): `/api/requirements`, `/api/requirement-categories`, `/api/application-types`, `/api/compliance-types`, `/api/inspection-types`, `/api/account-officers`, `/api/departments`, `/api/type-of-contract`, `/api/building`, `/api/land-use`
- Misc: `/api/dashboard`, `/api/reports`, `/api/search`, `/api/notifications` (includes an SSE `/stream`), `/api/quick-tasks`, `/api/audit-logs` (admin only)
- Legacy: `/api/contracts` is admin-only and no longer called by the frontend — contracts are saved through `/api/approvals/:applicationId/contract`.

### Auth & access control

- Login `POST /api/auth/login` (username + password, plus `token` once a code is needed). The JWT sits in an httpOnly cookie with no maxAge (browser-session), `sameSite: lax`, `secure` only when `NODE_ENV=production`. Idle timeout is 15 min (`SESSION_IDLE_TIMEOUT_SECONDS` in `server/models/Auth.js`), refreshed via `POST /api/auth/refresh`; `UserSession` tracks sessions and a sweeper closes expired ones.
- TOTP 2FA is mandatory for non-admin roles: responses are `enrollmentRequired` (QR to self-enroll) or `mfaRequired` until a valid code is sent. Admins skip enrollment, though an authenticator they opted into is still enforced. Admins/user managers can `POST /api/users/:id/totp/reset`.
- Rate limits on login/forgot/reset. CSRF: `m_csrf.js` rejects mutating `/api` requests whose `Origin` isn't in the CORS allowlist.
- Roles are **not hardcoded** except `admin` (bypasses every menu check) and `proponent` (the Locator portal). Everything else is Control Panel per-role permissions, checked live per request by `requireMenuAccess(menuKey, action)`, `requireAnyMenuAccess`, `requireApplicationsAccess`, `requireUserMenuAccess` (`server/middleware/m_auth.js`). No saved permission row → denied.
- Menu keys: `applications:renewals`, `applications:requirements`, `assessment:queue`, `approval:queue`, `compliance:permits`, `compliance:inspections`, and `settings:*` (`users`, `locator-users`, `proponents`, `control-panel`, `audit-log`, `account-officers`, `application-types`, `compliance-types`, `inspection-types`, `requirement-categories`, `building`, `land-use`, `type-of-contract`). Check `server/models/ControlPanelPermission.js` / `src/components/AppSidebar.tsx` for the current full list.
- Assessment level is a **user** attribute, not a role: `users.assessment_level` = 1 → Level 1 Manager, otherwise Level 2 Officer (`getUserLevel`/`isManager` in `server/models/AssessmentEvaluation.js`; admin counts as Manager).

## Ports & proxy

- Frontend dev server: `2500` (`vite.config.ts`, `host: 0.0.0.0`, `strictPort: true`).
- Backend: `process.env.PORT || 3100`. The current dev box sets `PORT=2501` in `server/.env`.
- Vite proxies `/api` → `VITE_BACKEND_URL` (fallback `http://127.0.0.1:2501`), with `xfwd: true` so the audit log gets the real client IP. The backend's `trust proxy` defaults to `loopback`; set `TRUST_PROXY` if the proxy runs on another host.
- Backend CORS allowlist: `http://localhost:2500`, `http://localhost:5173`, plus `FRONTEND_URL` / `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS`.

## Running it

```bash
npm run dev        # vite dev --port 2500 (frontend only)
npm run dev:all    # frontend + backend concurrently
npm run build      # vite build → dist/
npm run start      # vite preview --port 2500
npm run lint       # tsc --noEmit (passes clean as of 2026-09-25)
```

Backend only: `npm --prefix server run dev` (`node app.js`) or `npm --prefix server run start` (`NODE_ENV=production`).

PM2 (`ecosystem.config.cjs`, both `watch: true`; `ciac-dev` ignores `server`/`src`, backend ignores `uploads`):

```bash
pm2 restart ciac-dev ciac-backend-dev
pm2 logs ciac-backend-dev
```

There are no automated tests in the repo.

## Environment variables

Frontend (`.env`): `VITE_BACKEND_URL`, `VITE_GOOGLE_MAPS_API_KEY` (address autocomplete).

Backend (`server/.env`): `PORT`, `NODE_ENV`, `JWT_SECRET`, `FRONTEND_URL` (/`FRONTEND_ORIGIN(S)`), `TRUST_PROXY`, `DB_SERVER`, `DB_NAME`, `DB_TRUSTED_CONNECTION`, `DB_USER`, `DB_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `TOTP_ISSUER` (default `3CORE Portal`), `TOTP_ENC_KEY` (optional, falls back to `JWT_SECRET`).

## Environments & deploy

- The VPS at 45.32.119.62 (`ciac-dev` + `ciac-backend-dev`, Vite dev server, `NODE_ENV=development`, plain HTTP) is a **dev/staging box**, not the client's production. MSSQL runs in Docker (`mssql` container, DB `bridge`), with :1433 restricted to one IP through the `DOCKER-USER` iptables chain.
- Production (client server) checklist: `npm run build` and serve `dist/` from nginx over HTTPS; proxy `/api` to a localhost-bound backend; run the backend with `NODE_ENV=production` (needed for `secure` cookies); no PM2 `watch`; schedule backups of the database and `server/uploads/`.
- Schema: there is no migration runner. `server/app.js` runs each model's idempotent `ensureSchema()` in order on startup (roles → users → type of contract → contracts → account officers → proponent sub-tables → building → land use); other models create their tables lazily on first use. Anything that isn't additive (data moves, renames) lives in `server/scripts/*.js` or `server/sql/*.sql` and must be run by hand, e.g. `server/scripts/migrate-approval-single-level.js`.
- If the DB is unreachable the server still listens (login page loads), but DB-backed routes fail.

## Application workflow

**High-level:** Locator Account → Filing → Locator uploads → Assessment (Level 2 Officer review → Level 1 Manager recommendation) → Approval & Issuance (Account Officer) → Contract/Permits → Expiry monitoring → Renewal.

**Application statuses** (`APPLICATION_STATUSES`, `server/models/ApplicationWorkflow.js`): `DRAFT, SUBMITTED, UNDER_REVIEW (dead — nothing sets it), RESUBMITTED, RETURNED, REJECTED, FOR_APPROVAL, DISAPPROVED, APPROVED`.

**Stage 0 — Locator Account.** Staff with `settings:locator-users` (`LocatorUsersManagement.tsx` → `POST /api/users`, or `POST /api/users/locator-with-application`) create the Locator's login. It starts `PENDING`/inactive with a placeholder password. Filing later *activates* an existing PENDING account; it never creates one.

**Stage 1 — Filing** (`ApplicationsWorkflow.tsx`). Staff pick a Locator and Application Type (plus `is_renewal`), then "Save as draft" or submit.
- DRAFT = on hold: no notification, no email, no activation. A DRAFT row reopens pre-filled ("Continue Draft"). The Locator can only be changed while DRAFT. The type can be changed while in `TYPE_EDITABLE_STATUSES` (DRAFT/SUBMITTED/UNDER_REVIEW/RESUBMITTED/RETURNED), but not once documents exist and the type actually changes.
- The mandatory-document check applies only to RETURNED → RESUBMITTED, never the first DRAFT → SUBMITTED. This is deliberate: the locator has no portal access until that first submit activates them.
- `activateLocatorIfPending()` (`c_applications.js`) resets the password and emails it, but fires only on a non-draft create or on submit. It no-ops if the account is already ACTIVE.
- One proponent can have many applications, including multiple DRAFTs. "One login, multiple businesses" is unsupported: `requireProponentSelf` resolves a single proponent with `TOP(1)` and no `ORDER BY`.
- Application numbers come from `generateApplicationNo`: `APP-<year>-…` for new filings, `REN-<year>-…` for renewals (per-year counters in `application_no_counters`). The requirement checklist is seeded from catalog requirements flagged `for_new` (new filing) or `for_renewal` (renewal), not both.

**Stage 2 — Locator uploads** (`ProponentApplications.tsx`, `/api/proponents/me/applications/*`). The locator uploads against the checklist and submits/resubmits (DRAFT→SUBMITTED, RETURNED→RESUBMITTED). Re-uploading against a REJECTED requirement flips it back to PENDING. They can reply on a requirement's comment thread and acknowledge requirements. Profile edits go through change requests that staff approve or reject (`/api/proponents/change-requests`).

**Stage 3 — Assessment** (`AssessmentEvaluation.tsx`, `/assessment`, `assessment:queue`). This is a two-tier review with its own `stage`: `UNASSIGNED → ASSIGNED → IN_REVIEW → FOR_RECOMMENDATION → COMPLETED` (or `RETURNED`).
- Manager assigns an evaluator (`PATCH /:id/assign`). Level 2 Officers only see and act on their own assignments (`ensureCanAct`).
- Compliance tab: verify or reject each requirement. Verify stays disabled on a REJECTED requirement until a reupload resets it. Each document has evaluator **Remarks** (`PATCH /requirements/:id/remarks`, no status change or notification, locked once COMPLETED/RETURNED) and a comment thread shared with the Locator. Ad-hoc one-off requirements (`POST /:id/requirements/custom`, `is_ad_hoc=1`) survive a type-change rebuild. Assessment charges can be added.
- The old **Findings tab and "Return to Locator" were removed** (commit e533090). Per-document remarks replace them.
- Officer submits their review (`POST /:id/officer-review`, recommendation `ENDORSE`/`DISAPPROVE`) → stage FOR_RECOMMENDATION.
- Level 1 Manager then either sends it back (`POST /:id/return-to-officer` → IN_REVIEW) or gives the final recommendation (`POST /:id/recommendation`):
  - `ENDORSE` requires `approver_id` (an Account Officer) → application FOR_APPROVAL, and Approval starts automatically, assigned to that officer.
  - `DISAPPROVE` → application DISAPPROVED.
- Once decided, it's locked until an admin reopens it (`PATCH /:id/reopen`). Reopening is refused once Approval reached APPROVED/DISAPPROVED.

**Stage 4 — Approval & Issuance** (`ApprovalIssuance.tsx`, `/approval`, `approval:queue`). This is a **single-level** approval (Levels 2/3 removed in 20afca8; old data migrated by `server/scripts/migrate-approval-single-level.js`).
- One pending step, assigned to the endorsed Account Officer; only they (or admin) may act. Account Officers see only their own queue.
- Actions `APPROVE` / `DISAPPROVE` / `RETURN` are final. The compare-and-swap on `decision = 'PENDING'` prevents double decisions.
  - APPROVE requires every mandatory requirement to be verified unless `override_unverified` is passed.
  - RETURN sets the application to RETURNED and auto-reopens the assessment so the officer can redo it.
- Issuances (`APPROVAL_ORDER`, `NOTICE_OF_AWARD`, `CONTRACT`, `PERMIT`, `OTHER`), charges, and the Contract tab (`PUT /:id/contract`) live here. The next contract number comes from `GET /:id/contract/next-number`, and the certificate PDF is rendered on save.
- Clicking a row on the Applications page always opens `/assessment?tab=Compliance`, never Approval.
- `PATCH /api/applications/:id/status` is an admin-only escape hatch. It skips the document check and Approval routing, so it's not a substitute for the real flow.

**Stage 5 — Permits, expiry & renewal** (`PermitsManagement.tsx`, `compliance:permits`, `server/models/Permit.js`).
- Issuing a contract auto-creates or syncs a permit of reserved type `CONTRACT`. Other permit types come from Compliance Types (File Maintenance).
- Effective status is derived: `REVOKED` if revoked, otherwise from `expiry_date`: `EXPIRED` (past), `EXPIRING` (within `EXPIRING_WINDOW_DAYS` = 365), else `VALID`. The UI adds "this month / next 90 days / overdue" filters, and dashboards show them through `AttentionCard`.
- Renewal: a renewal application (`is_renewal=1`, optional `renewed_from_permit_id`) links back to the expiring permit. The permit row shows "Renewal filed: <application_no>", linking to `/applications/renewals?applicationId=…`.

**Compliance & Inspections** (`ComplianceInspections.tsx`, `/api/inspections`, `compliance:inspections`): schedule and assign inspections, set status and result, record findings, corrective actions, and documents, with a per-locator inspection drawer.

## Notes / gotchas

- `msnodesqlv8` runs on libuv's threadpool, so `server/app.js` sets `UV_THREADPOOL_SIZE=16` before any require. Keep that line first, or parallel page loads hit "Query timeout expired".
- `vite.config.ts` `optimizeDeps.include` lists the MUI date-picker modules on purpose, to avoid stale-chunk errors after lazy routes load. Don't remove them.
- PM2 `ignore_watch` must keep excluding `server/uploads` (backend) and `server`/`src` (frontend). Otherwise uploads restart processes and reload the browser.
- Cleanup candidates: the `UNDER_REVIEW` status, `/api/contracts`, `better-sqlite3` + `bizreg.db`, and `@google/genai`.
