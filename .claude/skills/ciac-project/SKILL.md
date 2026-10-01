---
name: ciac-project
description: Overview, run/dev, build, and deploy instructions for the CIAC system (3CORE) — a React/Vite frontend + Express/MSSQL backend — plus the Locator → Assessment (Level 2 Officer → Level 1 Manager) → Account Officer approval workflow, permits/expiration/renewal (statuses, draft/submit/activation rules, who does what). Use when running, building, deploying, or navigating this repo, or when working on application filing/assessment/approval/permit logic.
---

# CIAC System (3CORE)

Full-stack app: React 19 + Vite frontend (`/`) and an Express backend (`server/`), split as two npm workspaces (root `package.json` declares `workspaces: ["server"]`). Used to manage locator (proponent) applications, assessment, approval/issuance, contracts, permits (expiry + renewal), and compliance inspections.

## Stack

- Frontend: React 19, TypeScript, Vite 6, Tailwind CSS 4, MUI 7 (+ `x-date-pickers` with the date-fns adapter; the commercial `-pro` package was removed), `recharts`, `sonner`, `lucide-react`, `exceljs`/`jspdf` for exports.
- Backend: Express 4 (CommonJS), MSSQL via `mssql` (or `mssql/msnodesqlv8` when `DB_TRUSTED_CONNECTION` is on — see `server/config/database.js`), JWT in an httpOnly cookie, TOTP 2FA (`otplib` + `qrcode`), `nodemailer`, `multer` uploads, `helmet`, `express-rate-limit`, `playwright` (only for rendering certificate PDFs in `server/lib/certificateRenderer.js`).
- MSSQL is the only datastore. Backend-only packages (`express`, `dotenv`, …) belong in `server/package.json`, not the root.

## Repo layout

```
src/                    Frontend (Vite root)
  App.tsx               Custom router (VIEW_TO_PATH), lazy-loaded pages, auth state
  layout/AppLayout.tsx  Staff shell (AppSidebar/AppHeader); AppView type
  components/
    applications/       ApplicationsWorkflow (filing), Requirements (+ Requirement Categories drawer)
    assessment/         AssessmentEvaluation (/assessment)
    approval/           ApprovalIssuance (/approval)
    compliance/         PermitsManagement (permits, expiry, renewal), ComplianceInspections
    proponent/          Locator portal pages + ProponentsManagement (staff locator list)
    dashboard/          RoleDashboard, OfficerDashboard, ProponentDashboard, PreviewDashboard, AttentionCard
    reports/            ReportsAnalytics
    FileMaintenance/    lookup tables (Application Types, Account Officers, Building, Land Use, Type of Contract, Departments)
    settings/           UsersManagement, LocatorUsersManagement, RolesPanel, ControlPanelManagement, AuditLog, PortalSettings
  config/landingConfig.ts  per-view dashboard copy/stats registry
  context/ControlPanelAccessContext.tsx  per-role menu permissions on the client
  lib/                  notificationClient (SSE), idleSession, passwordPolicy, etc.
server/                 Backend (separate npm workspace, CommonJS)
  app.js                bootstrap: helmet, CORS allowlist, CSRF origin guard, JWT attach, routes, ensureSchema steps
  routes/r_*.js         one router per resource, mounted in routes/routes.js under /api/*
  controller/c_*.js     matches each router
  models/               raw-SQL models; most own an idempotent ensureSchema(), memoized once per process (`schemaReady` promise)
  middleware/           m_auth.js (guards), m_csrf.js (Origin check), m_upload.js (multer, 15 MB, mimetype allowlist, extension taken from the mimetype)
  lib/                  totp, mailer, notificationStream (SSE), fileStorage (+ contentDisposition), certificate renderers, auditDiff,
                        httpError (publicErrorMessage), uploadCheck (magic-byte check after multer)
  config/cache.js       node-cache `remember()` — role ids + Control Panel permissions (30s TTL, invalidated on save)
  sql/, scripts/        one-off SQL files and migration/backfill/import scripts (run manually)
  uploads/              uploaded documents (gitignored, runtime data)
ecosystem.config.cjs    PM2 config (ciac-dev = Vite, ciac-backend-dev = Express)
docs/                   SYSTEM-GUIDE.md, PROCESS-MODULES.md (last updated 2026-09-09 — may lag the code)
```

### API surface (mounted in `server/routes/routes.js`)

- Auth & users: `/api/auth`, `/api/users`, `/api/roles`, `/api/control-panel`
- Workflow: `/api/applications`, `/api/assessments`, `/api/approvals`, `/api/documents`
- Locators: `/api/proponents` (staff CRUD + `/me/*` locator self-service portal)
- Permits & compliance: `/api/permits` (+ `/types`), `/api/inspections` (+ `/locators/*` compliance checklist), `/api/compliance-requirements`
- Lookups (File Maintenance): `/api/requirements`, `/api/requirement-categories`, `/api/application-types`, `/api/account-officers`, `/api/departments`, `/api/type-of-contract`, `/api/building`, `/api/land-use`
- Misc: `/api/dashboard`, `/api/reports`, `/api/search`, `/api/notifications` (includes an SSE `/stream`), `/api/quick-tasks`, `/api/audit-logs` (admin only), `/api/site-settings` (Portal Settings: `/public`, `/assets/:slot`, `/manifest.webmanifest` open; `/runtime` signed-in; everything else admin only)
- Contracts are saved through `/api/approvals/:applicationId/contract` (the old `/api/contracts` route was removed; `models/Contract.js` stays).

### Auth & access control

- Login `POST /api/auth/login` (username + password, plus `token` once a code is needed). The JWT sits in an httpOnly cookie with no maxAge (browser-session), `sameSite: lax`, `secure` only when `NODE_ENV=production`. Idle timeout comes from Portal Settings (5–30 min, default 15; `sessionIdleTimeoutSeconds()` in `server/models/Auth.js`, `idleTimeoutMs()` in `src/lib/idleSession.ts`), refreshed via `POST /api/auth/refresh`; `UserSession` tracks sessions and a sweeper closes expired ones.
- TOTP 2FA is required for every account, admin included: responses are `enrollmentRequired` (QR to self-enroll) or `mfaRequired` until a valid code is sent. Any user may turn it off in My Profile, which sets `users.totp_opt_out` and stops the forced enrollment until they turn it back on; an admin reset (`POST /api/users/:id/totp/reset`) clears the opt-out, so the user re-enrolls at the next sign-in.
- One session per account: a successful login ends the user's other open sessions (`user_sessions.end_reason = 'replaced'`, `UserSession.endOtherSessions`), pushes `session-ended` over the SSE stream to those pages, and `/api/auth/check` / `refresh` return `reason: "replaced"` so the page shows why it was signed out. Audit action `SESSION_REPLACED`.
- Plain-HTTP rollouts: `COOKIE_SECURE=false` in `server/.env` drops the Secure flag while `NODE_ENV=production` (remove once HTTPS is live).
- Lockout: a wrong password or a wrong authenticator code counts toward the Portal Settings lockout limit (default 5 attempts, then locked for 15 minutes). Admins are included. The counter clears only after a full sign-in, so a correct password alone doesn't reset it. Logout is `POST /api/auth/logout` only. Checks of the password or code during a session (Change Password, My Profile email change, and 2FA setup, move and disable) use the same counter through `server/lib/reauth.js`. At the limit, the account is locked and its sessions are ended. They also have the same per-IP cap as login (20 per 15 min).
- Rate limits on login/forgot/reset. CSRF: `m_csrf.js` rejects mutating `/api` requests whose `Origin` isn't in the CORS allowlist.
- Admin protection: only an admin may grant the admin role or change an account that holds it (edit, password reset, TOTP reset, suspend, revoke) — enforced in `requireUserMenuAccess` and in `c_account_officers.js`. Non-admins can't change their own role. Changing a user's role bumps `token_version`, which signs them out, because the role is stored in the JWT. There is no built-in fallback login: if the DB is down, nobody can sign in.
- Roles are **not hardcoded** except `admin` (bypasses every menu check) and `proponent` (the Locator portal). Everything else is Control Panel per-role permissions, checked live per request by `requireMenuAccess(menuKey, action)`, `requireAnyMenuAccess`, `requireApplicationsAccess`, `requireUserMenuAccess` (`server/middleware/m_auth.js`). No saved permission row → denied.
- Menu keys: `applications:renewals`, `applications:requirements`, `assessment:queue`, `approval:queue`, `compliance:permits`, `compliance:inspections`, and `settings:*` (`users`, `locator-users`, `proponents`, `control-panel`, `audit-log`, `account-officers`, `application-types`, `building`, `land-use`, `type-of-contract`). Check `server/models/ControlPanelPermission.js` / `src/components/AppSidebar.tsx` for the current full list.
- The Locator (`proponent`) role can never hold a staff menu: `ControlPanelPermission.js` drops any non-portal key for it on read and write, `requireMenuAccess`/`checkMenuAllowed` reject it, and Control Panel doesn't list it (nor admin).
- Staff dashboard widgets (Account Officer / Assessment Officer / Viewer / custom roles): `server/lib/dashboardWidgets.js` is the single catalog: widget keys, the menus that make a role eligible, and visibility (default on; a stat card also needs its `dashboard:stats` parent). `c_dashboard.js` `buildStaffDashboard` only computes and sends eligible and enabled widgets, and Control Panel only shows toggles for eligible ones. A new widget needs an entry there, a data branch in `buildStaffDashboard`, and rendering in `OfficerDashboard.tsx`. Shared widget cards live in `src/components/dashboard/widgets.tsx`, and reflowing rows use `.balanced-row` + `src/lib/balancedColumns.ts`.
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

Backend (`server/.env`): `PORT`, `NODE_ENV`, `JWT_SECRET`, `FRONTEND_URL` (/`FRONTEND_ORIGIN(S)`), `TRUST_PROXY`, `DB_SERVER`, `DB_NAME`, `DB_TRUSTED_CONNECTION`, `DB_USER`, `DB_PASSWORD`, `TOTP_ENC_KEY` (optional, falls back to `JWT_SECRET`), `APP_ENC_KEY`. **Not** `.env` any more: `SMTP_*`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`, `TOTP_ISSUER` — they live only in Portal Settings; an existing server's values are imported once on first start (see below) and a startup warning lists any still left in `.env`.

## Environments & deploy

- The VPS at 45.32.119.62 (`ciac-dev` + `ciac-backend-dev`, Vite dev server, `NODE_ENV=development`, plain HTTP) is a **dev/staging box**, not the client's production. MSSQL runs in Docker (`mssql` container, DB `bridge`), with :1433 restricted to one IP through the `DOCKER-USER` iptables chain.
- Client production is a Windows Server with nginx; the full steps are in `docs/DEPLOY-WINDOWS.md`. The backend runs as an NSSM Windows service, not PM2. A production build calls `/api` on its own origin: `VITE_BACKEND_URL` is only the dev proxy target, and `VITE_API_ORIGIN` is an optional override. A fresh DB has no admin, so create the first one with `node server/scripts/create-admin.js <username> <email>`.
- Production (client server) checklist: `npm run build` and serve `dist/` from nginx over HTTPS; proxy `/api` to a localhost-bound backend; run the backend with `NODE_ENV=production` (needed for `secure` cookies); no PM2 `watch`; schedule backups of the database and `server/uploads/`.
- Schema: there is no migration runner. `server/app.js` runs each model's idempotent `ensureSchema()` in order on startup (roles → users → type of contract → contracts → account officers → proponent sub-tables → building → land use); other models create their tables lazily on first use. Unused tables from the old schema are dropped on startup by `server/config/legacyTables.js` (`UNUSED_TABLES`, listed in FK order). This happens only if they exist, so every database cleans itself after a pull. Add a table to that list only once nothing in `server/` or `src/` uses it. Anything that isn't additive (data moves, renames) lives in `server/scripts/*.js` or `server/sql/*.sql` and must be run by hand, e.g. `server/scripts/migrate-approval-single-level.js`.
- If the DB is unreachable the server still listens (login page loads), but DB-backed routes fail.

## Application workflow

**High-level:** Locator Account → Filing → Locator uploads → Assessment (Level 2 Officer review → Level 1 Manager recommendation) → Approval & Issuance (Account Officer) → Contract/Permits → Expiry monitoring → Renewal.

**Application statuses** (`APPLICATION_STATUSES`, `server/models/ApplicationWorkflow.js`): `DRAFT, SUBMITTED, RESUBMITTED, RETURNED, REJECTED, FOR_APPROVAL, DISAPPROVED, APPROVED`. (`UNDER_REVIEW` was removed 2026-09-25 — nothing ever set it.)

**Stage 0 — Locator Account.** Staff with `settings:locator-users` (`LocatorUsersManagement.tsx` → `POST /api/users`, or `POST /api/users/locator-with-application`) create the Locator's login. It starts `PENDING`/inactive with a placeholder password. Filing later *activates* an existing PENDING account; it never creates one.

**Stage 1 — Filing** (`ApplicationsWorkflow.tsx`). Staff pick a Locator and Application Type (plus `is_renewal`), then "Save as draft" or submit.
- DRAFT = on hold: no notification, no email, no activation. A DRAFT row reopens pre-filled ("Continue Draft"). The Locator can only be changed while DRAFT. The type can be changed while in `TYPE_EDITABLE_STATUSES` (DRAFT/SUBMITTED/RESUBMITTED/RETURNED), but not once documents exist and the type actually changes.
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
- Issuing a contract auto-creates or syncs a permit of reserved type `CONTRACT`. Other permit types are the active `PERMITS` Compliance Requirements (`GET /api/permits/types`).
- Effective status is derived: `REVOKED` if revoked, otherwise from `expiry_date`: `EXPIRED` (past), `EXPIRING` (within `EXPIRING_WINDOW_DAYS` = 365), else `VALID`. The UI adds "this month / next 90 days / overdue" filters, and dashboards show them through `AttentionCard`.
- Renewal: a renewal application (`is_renewal=1`, optional `renewed_from_permit_id`) links back to the expiring permit. The permit row shows "Renewal filed: <application_no>", linking to `/applications/renewals?applicationId=…`.

**Compliance & Inspections** (`ComplianceInspections.tsx`, `/api/inspections`, `compliance:inspections`). The page is modelled on the legacy BRIDGE compliance screen.
- Compliance Requirements (`dbo.compliance_requirements`, `/api/compliance-requirements`) are one list in three categories: `COMPLIANCE`, `PERMITS` and `PERFORMANCE`. It replaces the old Inspection Types and Compliance Types. It is managed from its own tab under the same `compliance:inspections` permission. A requirement's code is fixed once created.
- Each locator has a checklist in `dbo.locator_compliance_items`, one row per requirement. Unsaved items count as Pending. The locator is "Completed" only once every active requirement is Complied. Checklist edits are audit-logged, and the drawer's Activity tab reads them back.
- An inspection covers a requirement (`inspection_type_code`), and older inspections keep their legacy type label. Inspections also record findings, corrective actions and documents.
- Requirement Categories are managed from the Requirements page under `applications:requirements`.

## Portal Settings (System Settings → Portal Settings, `settings:portal`)

- **Admin only, always.** `requireRole("admin")` in `server/routes/r_site_settings.js`; it's flagged `adminOnly` in `src/config/landingConfig.ts`, so Control Panel never offers it to a role, and AppSidebar shows it only with `fullAccess`.
- **One catalog:** `server/lib/siteSettings.js` lists every key (section, type, limits, default, and `importFrom` for the one-time `.env` import). A new setting needs an entry there, then it shows up in the admin API automatically; add a control/help text in `PortalSettings.tsx`, a label in `AuditLog.tsx` `FIELD_LABELS`, and (if the browser needs it) `publicSettings()` + `src/lib/siteSettings.ts`. Unknown keys are rejected. Stored in `dbo.site_settings` (key/value, `models/SiteSetting.js`); value order is saved → built-in default — nothing falls back to `.env`. `importEnvOnce()` (run by `init()`) copies the old `SMTP_*` / `LOGIN_*` / `TOTP_ISSUER` values in once per database: validated like a UI save, never over a saved value, written together with the `system.env_imported_at` marker in one transaction, audited as `SITE_SETTINGS_IMPORTED` (password masked); the marker means it never runs again. Values are read synchronously from an in-memory snapshot (reloaded after every save and every 60 s), because lockout, password length and token expiry are on hot paths.
- **Sections:** Branding (names, org/contact, privacy/terms links, logos with optional dark versions + "invert in dark mode", login background, favicon), Email (SMTP, from/reply-to, **Send test email** to the admin's own address), Integrations (Google Maps key), Security (lockout 3–10 attempts, 15–1440 min; idle 5–30 min; min password 12–64), Announcements (banner with optional schedule; maintenance mode).
- **Security rules:** Email/Integrations/Security saves, and turning maintenance mode on, need the admin's password (`lib/reauth.js`, shared sign-in lockout). Secrets (`smtp_pass`, `google_maps_api_key`) are AES-GCM encrypted (`lib/crypto.js`), never returned, masked in audit diffs. Changing the SMTP host/username requires re-entering the SMTP password (so a hijacked session can't redirect the stored one), and the test email uses the stored password only against the saved server. Text fields reject control characters (header injection); links must be `https://`. Images: PNG/JPG/WebP (+ ICO for the favicon), type from the file's bytes, no SVG, random names under `STORAGE_ROOT/branding` (`lib/brandingStorage.js`), served with `CSP: default-src 'none'; sandbox`. Saves check the section's version and return 409 if someone else saved first. Deliberately not configurable here: DB, secrets, `FRONTEND_URL`, CORS.
- **Maintenance mode:** non-admin sign-ins get 503 (checked after password + code, so it doesn't reveal admin usernames); turning it on ends every non-admin session (`UserSession.endNonAdminSessions`, `end_reason='maintenance'`) and `m_auth.js` drops non-admin tokens while it's on (`reason: "maintenance"`).
- **Everything that displays these follows them:** the browser loads `/api/site-settings/public` before the first screen (`App.tsx`), and a save broadcasts `site-settings` on the SSE stream (`publishToAll`), which makes `AppHeader` re-fetch. Names/logos in the header, login page, footer, tab title, favicon and manifest; the "15m" idle stat and sign-out notices; password hints (`passwordPolicy.ts`); all emails (subjects/text use `getters.portalLabel()` / `contactPhrase()`, and `lib/mailer.js` appends a signature with the support contact); certificate footers; the TOTP issuer (new enrollments only). The PDF user guides are static and need a manual edit.
- **Audit:** `SITE_SETTINGS_UPDATED` (details.changes via `diffChanges`), `SITE_ASSET_UPLOADED` / `_REMOVED`, `SITE_EMAIL_TEST_SENT`, `MAINTENANCE_MODE_ENABLED` / `_DISABLED`, category `system`, entity `site_settings`.

## Notes / gotchas

- `msnodesqlv8` runs on libuv's threadpool, so `server/app.js` sets `UV_THREADPOOL_SIZE=16` before any require. Keep that line first, or parallel page loads hit "Query timeout expired".
- `vite.config.ts` `optimizeDeps.include` lists the MUI date-picker modules on purpose, to avoid stale-chunk errors after lazy routes load. Don't remove them.
- PM2 `ignore_watch` must keep excluding `server/uploads` (backend) and `server`/`src` (frontend). Otherwise uploads restart processes and reload the browser.
- Error responses: controllers send `publicErrorMessage(error)` (`server/lib/httpError.js`), never raw `error.message`. Plain `new Error("…")` messages and errors with a 4xx `.status` reach the client; DB, system and runtime errors become a generic message (the real one is only in the server log). So throw user-facing validation errors as plain `Error`.
- Storage: both upload paths write under `STORAGE_ROOT` (`STORAGE_DIR` or `server/uploads`) and save `storage_path` relative to it. Older staff uploads have absolute paths; `resolveStoredPath` handles both. A rejected upload deletes its file. Inspection "documents" are text references only; there's no file upload there.
- Uploads: both upload paths (`m_upload.js` for staff, `fileStorage.handleUpload` for the portal) run `verifyUploadedFile` from `lib/uploadCheck.js`. A new allowed mimetype needs a signature in `SIGNATURES` there, or every upload of it is rejected.
- Permission caching: anything that writes `role_*_permissions` or `roles` outside `ControlPanelPermission.set*` / `Role.*` must clear `config/cache.js`, or the change can take up to 30s to apply.
