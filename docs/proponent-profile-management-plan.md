# Proponent Profile Management Module — Verification & Implementation Plan

Status: **Phases 0–7 code-complete.** Schema migrated to `bridge`. Phases 0–3 + 7 E2E-verified; 4–6 pending a full UI pass. Self-service registration was **removed** 2026-09-09 (admin creates accounts — see "Scope change" below). Phase 7 (proponent self-submission) was lost in a 2026-09-09 stash/pull/pop and **redone 2026-09-09** — see its section.
Date: 2026-09-09

---

## Scope change — 2026-09-09: self-registration removed

Per decision, **public self-service registration is dropped**. New proponent accounts are created by a CIAC admin only (User Management → create user with the `proponent` role + a linked business profile). Accounts are created `ACTIVE` — no PENDING queue involved in the normal path.

Removed:
- `src/components/auth/LoginPage.tsx` — the "Register your business" toggle, `RegisterFormView`/`RegisterField`, all `mode === 'register'` branches. Login page is sign-in / TOTP-enroll / MFA only.
- `server/routes/r_auth.js` — `POST /api/auth/register` route + the in-memory `rateLimit` helper (was only used by the register limiter).
- `server/controller/c_auth.js` — `exports.register` and its now-unused imports (`User`, `Role`, `Proponent`, `str`).

Kept (still used by the admin-managed path): `users.status` / `registration_note` columns, `User.setUserStatus` / `findByUsernameOrEmail`, the `PATCH /api/users/:id/approve|reject` endpoints, the `PENDING` login-gate message in `Auth.js`, `ActivityLog` `REGISTERED` action string. The A. Registration test steps below that start from the login page no longer apply.

---

## Merge repair — 2026-09-09

A `git stash` → `git pull` (→ `bd98f41`, which brought the teammate's Assessment & Evaluation work + more) → `git stash pop` left the tree with an unresolved conflict and several silently-mangled files. Resolved:

- **`server/models/ApplicationWorkflow.js`** — conflict (both sides added a function before `listApplicationStatusHistory`): kept `bd98f41`'s `getApplicationTurnaroundStats`, dropped the duplicate `getDocumentById`, and folded the `a.proponent_id` join our download endpoint needs into the surviving `getDocumentById`. `bd98f41`'s new application-lifecycle code (`APPLICATION_STATUSES`, `SUBMIT_TRANSITIONS`, `generateApplicationNo`, `submitApplication`, transaction-wrapped `createApplication` with `DRAFT`) is kept as-is.
- **`server/routes/routes.js`** — re-added the dropped `/api/documents` + `/api/permits` mounts.
- **`src/App.tsx`** — re-added the dropped lazy imports (`RoleDashboard`, `PreviewDashboard`, `Proponent*`, `PermitsManagement`) and the proponent content-render branch + the `RoleDashboard`/`PreviewDashboard` dashboard wiring.
- **`.gitignore`** — removed a duplicated `server/uploads/` block.
- `Auth.js`, `LoginPage.tsx`, `ApplicationsWorkflow.tsx` — checked, our changes survived intact.

Post-repair: `tsc --noEmit` clean, `vite build` OK, all backend modules load, all 11 `c_proponent_portal` handlers present. Conflict staged; `stash@{0}` left in place as a safety net (drop with `git stash drop stash@{0}` once satisfied).

---

## 0. End-to-end test checklist

Prereqs: dev backend restarted and connected (`✅ Connected to CIAC database successfully`); one admin account.

### A. Registration + approval (Phase 1)
1. Log out. On the login page click **"Register your business"**. Fill all 9 fields, pick a username + password (≥8 chars, matching confirm). Submit → expect the green "pending review" message and a return to sign-in.
2. Try to sign in with the new account → expect *"awaiting approval by CIAC"*.
3. Sign in as **admin** → **System Settings → User Management** → **Pending (1)** tab → **Approve**.
4. Sign in as the new proponent → password → Google Authenticator enrollment (scan QR / enter code) → lands on the proponent portal.
   - Negative: register a 2nd account, **Reject** it as admin, try to log in → *"was not approved"*.

### B. Portal shell + profile (Phases 0, 2)
5. Sidebar shows: Dashboard · My Applications · Contracts & Permits · My Business Profile · Activity History (no admin menus).
6. **My Business Profile** → shows the registered business info. Click **Request changes**, edit e.g. address + contact no, **Submit request** → amber "pending review" banner appears, the button disappears.
7. Try **Request changes** again → blocked ("pending change request").
8. As admin → **Proponent Management → Change Requests (1)** → see the Current→Requested diff → **Approve**.
9. Back as proponent → profile shows the new values; **Record → Recent change requests** shows an APPROVED row.

### C. Applications read views (Phase 3)
10. As admin → **Applications → Management → New Applications** → **+ New** → pick this proponent, give an application no. + type → save.
11. As proponent → **My Applications** → the application appears → click it → check all tabs: Overview, Requirements (checklist + progress), Documents, History (timeline), Contract & Permits.
12. Deep-link: as admin change the application's status; as proponent click the resulting bell notification → lands on that application's detail.
13. Security: as proponent, manually visit `/me/applications?applicationId=<some other proponent's id>` → *"Application not found"*.

### D. Document upload (Phase 5)
14. Proponent → application → **Documents** tab → optionally pick a requirement → **Upload document** → choose a PDF/JPG/PNG ≤10 MB → row appears; click **Download** → file downloads.
15. Negative: upload a `.txt` or a >10 MB file → clean error toast.
16. As admin → open the same application → preview that requirement's document → **Download** works.
17. Security: `GET /api/documents/<id>/download` for another proponent's document id (as this proponent) → 404.

### E. Permits (Phase 4)
18. As admin → **Compliance & Permits → CDC/CIAC Permits** → **+ New Permit** → pick the proponent, type (e.g. Fire Safety), permit no., issuing authority, issue + expiry dates → save.
19. Set one permit's expiry to ~2 weeks out → list shows **EXPIRING**; a past date → **EXPIRED**; set Status = Revoked → **REVOKED**.
20. As proponent → **Contracts & Permits** → the permit appears with the right status badge. If linked to an application, it also shows on that application's **Contract & Permits** tab.

### F. Activity history (Phase 6)
21. As proponent → **Activity History** → expect entries for: Signed in (each login), Submitted registration, Account approved, Profile change requested/approved, Document uploaded — newest first, with timestamps.
22. As admin, set a new password for the proponent (User Management → edit → Password) → proponent's Activity History gains a "Password changed" entry.

---

## 1. Scoping decisions (locked)

| Decision | Choice |
|---|---|
| Email / SMTP | **Admin-managed v1.** No email wiring. Register → `PENDING` → admin approves/activates. Password reset = admin sets new password. Email verification / self-service reset deferred to a later phase. |
| File uploads | **In scope.** Add real upload infra (multer + storage + authenticated, ownership-checked download). |
| Profile edits | **All edits go through an approval queue.** Proponent never writes `proponents` directly; every change is a `proponent_profile_change_requests` row an admin approves/rejects. |
| Permits | **In scope.** Add a real `permits` model + endpoints (currently permits are mock data only in `landingConfig`). |
| Application submission | **Proponent self-submission** (revised 2026-09-08 — was "admin encodes only"). Proponent creates a `DRAFT` (auto reference no., checklist auto-attached), uploads docs, submits (`DRAFT→SUBMITTED`, no requirement gate, New + Renewal). Admin can still encode too. **NOTE: the Phase 7 code for this was lost in the 2026-09-09 merge — the model layer exists (`bd98f41`), the controller/routes/UI need redoing (see Phase 7).** |

---

## 2. Verification — what already exists

### 2.1 Reusable as-is

| Capability | Location |
|---|---|
| Password login, bcrypt, JWT in httpOnly cookie | `server/controller/c_auth.js`, `server/models/Auth.js` |
| Mandatory TOTP 2FA for non-admin (proponent self-enrolls Google Authenticator on first login) | `server/models/Auth.js:95-145`, `server/lib/totp.js`, `src/components/auth/LoginPage.tsx` |
| `attachUserFromJwt` / `isAuthenticated` / `requireRole` / `requireMenuAccess` middleware | `server/middleware/m_auth.js` |
| `proponents` table + model (`listProponents`, `getProponentById`, `getProponentByUserId`, `createProponent`, `updateProponent`, `deactivate/reactivateProponent`) | `server/models/Proponent.js` |
| Admin proponent CRUD API + UI | `server/routes/r_proponents.js` (all `requireRole("admin")`), `src/components/proponent/ProponentsManagement.tsx` |
| Proponent dashboard (business name, apps list, status badges, requirement progress) + empty state when no profile linked | `src/components/dashboard/ProponentDashboard.tsx`, `server/controller/c_dashboard.js:81` (`GET /api/dashboard/me`) |
| Model fns: `listApplicationsForProponent`, `listApplicationRequirements`, `listDocumentsByApplication`, `listApplicationStatusHistory` | `server/models/ApplicationWorkflow.js` |
| `contracts` table + `Contract.getByApplicationId` / `getById` | `server/models/Contract.js` |
| Notifications — **proponent's user_id is already resolved as a recipient** of application-scoped events (status/requirement/document/contract) | `server/models/Notification.js:87-98`; `GET /api/notifications/me` works for any authed user; rendered in `src/components/AppHeader.tsx` |
| `users.is_active` + deactivate/reactivate; login rejects inactive accounts ("Your account was locked.") | `server/models/User.js`, `server/models/Auth.js:61-74` |
| Control Panel per-role gating (`role_sidebar_menu_permissions`, `role_menu_crud_permissions`), fail-closed | `server/models/ControlPanelPermission.js`, `src/context/ControlPanelAccessContext.tsx` |
| `roles` / `user_roles` tables; `App.tsx` `normalizeRole` already recognizes `'proponent'` | `server/models/Role.js`, `src/App.tsx:22` |

### 2.2 Scaffolded but unused

- `server/config/mailer.js` — nodemailer transporter, **not imported anywhere**. (Not needed for v1 given admin-managed decision.)

### 2.3 Missing entirely

| Spec requirement | Gap |
|---|---|
| Secure user registration | No self-registration route. Users created only by admin (`POST /api/users`). |
| Account activation & verification | No `PENDING`/verified state, no `email_verified`, no activation flow. Only the binary `is_active`. |
| Proponent creates/maintains own profile | No `/api/proponents/me` read or write. |
| Manage own business info & contact details | Same — dashboard shows a subset read-only, no edit path. |
| View business profile & registration info | Partial: dashboard shows `business_name` + `registration_no` only; no TIN/address/contact view, no dedicated page. |
| View submitted applications | ✅ dashboard list (read-only). |
| View application / transaction status | Partial: status badge in list; no proponent detail view (`/api/applications/:id/*` is `requireRole("admin")`). |
| View transaction history | `application_status_history` exists but admin-only endpoint; no proponent timeline. |
| View uploaded supporting documents | Admin-only endpoint. **Also: no real file storage** — `documents.storage_path` is a plain string; no multer/disk/blob. |
| View executed contracts & permits | Contracts admin-only. **Permits have no model at all** — mock rows in `src/App.tsx` `landingConfig` (`compliance:permits`). |
| Limited profile update subject to approval | No approval workflow, no `profile_change_requests` table. |
| Password reset & account recovery | "Forgot?" in `LoginPage.tsx` just shows "contact administrator". No token flow. |
| Profile activity history | No `activity_log` / audit table. Only `created_by` / `updated_by` / `updated_at` columns. |

### 2.4 Structural gap (important)

`src/App.tsx` + `src/components/AppSidebar.tsx` render **one hardcoded menu tree and one route set for every role**, filtered only by `canView()` (Control Panel). There are **no proponent-specific views** beyond `dashboard`. A proponent clicking any other menu loads an admin component that then 403s. This module needs a dedicated proponent view-set + navigation, not just permission toggles.

---

## 3. Implementation plan

Ordering principle: **never loosen an existing admin route.** All proponent access is new, separately-guarded, ownership-checked endpoints.

### Phase 0 — Foundations ✅ DONE (2026-09-08)

1. ~~**Seed the `proponent` role row**~~ — done in `Role.ensureSchema()` ([server/models/Role.js](../server/models/Role.js)), idempotent `IF NOT EXISTS ... INSERT`, runs on every boot via `app.js`.
2. ~~**`requireProponentSelf` guard**~~ — added to [server/middleware/m_auth.js](../server/middleware/m_auth.js): requires role `proponent` + a linked active proponent row, attaches `req.proponent`, returns `404 { code: 'NO_PROPONENT_PROFILE' }` if unlinked. `requireOwnApplicationOrAdmin` deferred to Phase 3 (no consumer yet).
3. ~~**Role-aware view-set**~~ — proponent views kept **separate from `AppView`** (avoids polluting the admin `Record<AppView,…>` maps and Control Panel's menu list). New: `type ProponentView = 'dashboard' | 'me:profile'` in [src/App.tsx](../src/App.tsx), `proponentView` state + path sync (`/me/profile`) + `handleProponentViewChange`. [src/layout/AppLayout.tsx](../src/layout/AppLayout.tsx) picks `ProponentSidebar` vs `AppSidebar` by `userRole` (props widened to `view: string`). New [src/components/proponent/ProponentSidebar.tsx](../src/components/proponent/ProponentSidebar.tsx) (fixed menu: Dashboard, My Business Profile).
4. **Gating decision:** `ProponentSidebar` is a fixed menu, **not** Control Panel-gated. `proponent` was NOT made a Control-Panel-exempt role (that would have leaked `requireMenuAccess` admin routes to it). Proponent screens are guarded by `requireProponentSelf` instead.

**Also shipped in Phase 0 (pre-existing breakage fixed):**
- `src/App.tsx` had 2 TS errors from a half-finished dashboard refactor (`<Dashboard />` with no `data`, missing `DashboardPreviewRole` import). Now wired: `dashboard` view renders `<RoleDashboard />` (real per-role data via `/api/dashboard/me`), admin preview renders `<PreviewDashboard role={…} />`. So the officer/proponent dashboards actually render now.
- New read-only [src/components/proponent/ProponentProfile.tsx](../src/components/proponent/ProponentProfile.tsx) → `GET /api/proponents/me`, handles the unlinked / error / loaded states.
- New backend: `GET /api/proponents/me` (`requireProponentSelf`) in [server/routes/r_proponents.js](../server/routes/r_proponents.js) + `c_proponents.getMine`.

Verification: `npx tsc --noEmit` clean (was 2 errors), `vite build` OK, backend modules load. **E2E-verified 2026-09-08** — proponent login shows the fixed portal sidebar (Dashboard, My Business Profile) + `ProponentDashboard` scoped to the linked proponent (tested with "ZXC Inc.", 10 applications).

### Phase 1 — Registration, activation, account recovery (admin-managed v1) ✅ DONE (2026-09-08)

**Decisions:** proponent picks own username + password at registration; full business info set collected up front.

**Schema (applied to `bridge` DB, verified):**
- `users.status NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE'` (`PENDING`/`ACTIVE`/`REJECTED`/`LOCKED`) + `users.registration_note NVARCHAR(500) NULL`, added in [server/models/User.js](../server/models/User.js) `ensureSchema` (guarded ALTER, `hasStatusColumn()` cache like phone/totp). Existing 10 users backfilled to `ACTIVE`. `proponent` role row already existed (`PROPONENT`, id 3) — seed was a no-op.

**Backend:**
- `POST /api/auth/register` (public, in-memory rate limit 10/hr/IP) → `c_auth.register`: validates 9 fields, dup-checks username/email (`User.findByUsernameOrEmail`), creates `PENDING` user (role proponent, `is_active=0`) + inactive linked `proponents` row. Returns 202. [server/routes/r_auth.js](../server/routes/r_auth.js), [server/controller/c_auth.js](../server/controller/c_auth.js).
- `Auth.login` ([server/models/Auth.js](../server/models/Auth.js)): inactive-account branch now reads `status` → `PENDING` = "awaiting approval", `REJECTED` = "not approved", else "locked".
- `User.setUserStatus(id, status, note)` keeps `is_active` in sync; `deactivateUser`/`reactivateUser` route through it (→ `LOCKED`/`ACTIVE`). `listUsers`/`getUserById` now return `status` + `registration_note`. `createUser` accepts `status`.
- `Proponent.setActiveByUserId(userId, active, by)` — flips the linked proponent row on approve/reject.
- `PATCH /api/users/:id/approve` / `:id/reject` (gated `settings:users` edit) → `c_users.approve`/`reject`: set status, sync proponent row, approve fires an in-app notification to the proponent.

**Frontend:**
- [LoginPage.tsx](../src/components/auth/LoginPage.tsx): "Register your business" toggle → `RegisterFormView` (business details / contact person / credentials, 3 grouped sections, confirm-password + client validation). Success → returns to sign-in with the "pending review" message.
- [UsersManagement.tsx](../src/components/settings/UsersManagement.tsx): "All users / Pending (N)" filter tabs, `StatusBadge` (Active/Pending/Rejected/Locked), Approve + Reject actions on `PENDING` rows (ConfirmModals), 4th stat card "Pending Approval".

**Password recovery:** still admin-managed — admin edits the user and sets a new password in the existing edit panel. No dedicated endpoint added.

Verification: `tsc --noEmit` clean, `vite build` OK, schema migration verified against DB. **E2E-verified 2026-09-08** — self-registration → PENDING → admin approve → proponent login all working.

**Schema**
- `users`: add `status NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE'` with values `PENDING` | `ACTIVE` | `REJECTED` | `LOCKED`. Keep `is_active` in sync (`PENDING`/`REJECTED`/`LOCKED` ⇒ `is_active = 0`). Migration sets existing rows to `ACTIVE`.
- Optional `users.registration_note NVARCHAR(500)` for admin context.

**Backend**
- `POST /api/auth/register` (public, rate-limited):
  - Body: `username`, `email`, `password`, `full_name`, `contact_no`, `business_name`, `registration_no`, `tin`, `address`.
  - Creates `users` row `status = 'PENDING'`, `is_active = 0`, role = `proponent` (via `user_roles`).
  - Creates linked `proponents` row `is_active = 0` (or a `pending` flag) with the submitted business info.
  - Returns 202 "Registration received, pending review." — no token, no email.
- `Auth.login`: when a matched account is `status = 'PENDING'` return a clear message ("Your account is awaiting approval."), `REJECTED` → ("Your registration was declined."). Keep existing inactive/locked handling.
- Admin approval endpoints (reuse `settings:users` menu gate):
  - `GET /api/users?status=PENDING` (extend `listUsers` filter) — pending registrations queue.
  - `PATCH /api/users/:id/approve` → `status = 'ACTIVE'`, `is_active = 1`, proponent row `is_active = 1`; fire a notification to the proponent user.
  - `PATCH /api/users/:id/reject` → `status = 'REJECTED'` + `registration_note`.
- Password recovery (admin-managed): already possible via `PUT /api/users/:id` (sets `password_hash`). Add a dedicated `PATCH /api/users/:id/set-password` for clarity + audit, and surface a "Reset password" action in `UsersManagement.tsx` that generates/sets a temporary password shown once to the admin.

**Frontend**
- `LoginPage.tsx`: add "Create an account" toggle → registration form (all fields above). Success → "pending review" panel.
- "Forgot?" copy stays "contact your administrator" for v1 (no token flow).
- `UsersManagement.tsx`: "Pending Registrations" tab/filter with Approve / Reject; "Reset password" row action.

**Note on 2FA:** unchanged. An approved proponent still self-enrolls Google Authenticator on first successful login (existing `Auth.js` enrollment path).

### Phase 2 — Proponent self-service profile + approval queue ✅ DONE (2026-09-08)

**Decision:** editable fields = the 5 business fields on `dbo.proponents` only (`business_name`, `registration_no`, `tin`, `address`, `contact_no`). Contact-person name/email (on `users`) not editable in this phase.

**Schema (created & verified on `bridge`):** `dbo.proponent_profile_change_requests` (id, proponent_id, requested_by, payload NVARCHAR(MAX) JSON, status PENDING/APPROVED/REJECTED, review_remarks, reviewed_by, created_at, reviewed_at) — [server/models/ProponentChangeRequest.js](../server/models/ProponentChangeRequest.js), lazily `ensureSchema`'d.

**Backend:**
- `PATCH /api/proponents/me` (`requireProponentSelf`) → `c_proponents.updateMine`: diffs body vs current, rejects if a request is already `PENDING` (409 `PENDING_REQUEST_EXISTS`) or nothing changed, else creates a `PENDING` change request. Never writes `proponents` directly.
- `GET /api/proponents/me` extended → also returns `pendingChangeRequest`, `changeRequestHistory` (last 10), `editableFields`.
- `GET /api/proponents/change-requests?status=PENDING` (admin, `settings:proponents` view) — joins current proponent values + requester username for the diff view.
- `PATCH /api/proponents/change-requests/:id/approve` → applies `payload` via `Proponent.updateProponent`, marks `APPROVED`, notifies the proponent. `/reject` → marks `REJECTED` (+ optional remarks), notifies.
- Routes declared before `/:id` in [server/routes/r_proponents.js](../server/routes/r_proponents.js).

**Frontend:**
- [ProponentProfile.tsx](../src/components/proponent/ProponentProfile.tsx): "Request changes" button → inline edit form (5 fields) → `PATCH /me`. Amber "Change request pending review" banner lists requested values and hides the button while pending. "Recent change requests" list (approved/rejected + remarks) under Record.
- New [ProponentChangeRequests.tsx](../src/components/proponent/ProponentChangeRequests.tsx): admin diff cards (Field / Current / Requested) with Approve / Reject.
- [ProponentsManagement.tsx](../src/components/proponent/ProponentsManagement.tsx): "Proponents / Change Requests (N)" tab switch; the requests tab renders the panel above.

Verification: `tsc --noEmit` clean, `vite build` OK, table DDL verified. **E2E-verified 2026-09-08.**

**Schema**
- Extend `proponents` with the business fields the spec implies but that don't exist yet (add only what's needed): `email`, `company_type`, `industry`, `date_established`, `website`. All nullable; migration-safe `ALTER` guards like the existing model.
- New table `proponent_profile_change_requests`:
  - `id`, `proponent_id`, `requested_by` (user_id), `payload` NVARCHAR(MAX) JSON (changed fields only), `status` `PENDING`|`APPROVED`|`REJECTED`, `reviewed_by`, `review_remarks`, `created_at`, `reviewed_at`.

**Backend**
- `GET /api/proponents/me` (`requireProponentSelf`) → full own record (all fields, even if pending) + the current `PENDING` change request if any.
- `PATCH /api/proponents/me` → **does not write `proponents`**; validates allowed fields, upserts a single `PENDING` `proponent_profile_change_requests` row (reject if one already pending). Notification to admins/officers.
- Admin review (gate: `settings:proponents`):
  - `GET /api/proponents/change-requests?status=PENDING`
  - `PATCH /api/proponents/change-requests/:id/approve` → apply `payload` to `proponents` via `updateProponent`, set `updated_by`, write `activity_log`, notify proponent.
  - `PATCH /api/proponents/change-requests/:id/reject` → `review_remarks`, notify proponent.

**Frontend**
- Proponent **My Business Profile** view (`me:profile`): read view of business + registration + contact info; "Request changes" form; banner showing pending request + its fields; history of past requests.
- Admin: **Profile Change Requests** — new tab in `ProponentsManagement.tsx` (diff view: current vs requested), Approve / Reject.

### Phase 3 — Proponent read access: applications, status, documents, contracts ✅ DONE (2026-09-08)

Permits deferred to Phase 4. No schema changes — all reads from existing tables.

**Backend (new; admin routes untouched):**
- `requireOwnApplication` middleware ([server/middleware/m_auth.js](../server/middleware/m_auth.js)) — runs after `requireProponentSelf`, loads `:id`, 404s unless `application.proponent_id === req.proponent.id`, attaches `req.application`.
- [server/controller/c_proponent_portal.js](../server/controller/c_proponent_portal.js) + routes in [server/routes/r_proponents.js](../server/routes/r_proponents.js):
  - `GET /api/proponents/me/applications` → `listApplicationsForProponent`
  - `GET /api/proponents/me/applications/:id` (+ requirements / documents / status-history / contract) — each ownership-checked
- Reuses `ApplicationWorkflow.*` and `Contract.getByApplicationId` as-is.

**Frontend:**
- New [ProponentApplications.tsx](../src/components/proponent/ProponentApplications.tsx): list view (clickable rows) + detail view (5 tabs: Overview / Requirements checklist / Documents / Status History timeline / Contract). One view key `me:applications`; detail is `?applicationId=` on the same route (deep-linkable).
- [ProponentSidebar.tsx](../src/components/proponent/ProponentSidebar.tsx): "My Applications" nav item.
- [src/App.tsx](../src/App.tsx): `ProponentView` += `me:applications`, route `/me/applications`, subheader entry.
- [src/lib/notificationClient.ts](../src/lib/notificationClient.ts): proponent notification deep-links now target `/me/applications` (was admin `/applications/new`).

**Documents:** shown as list; a URL `storage_path` renders an "Open" link, otherwise "On file at CIAC". Real upload/download is Phase 5.

Verification: `tsc --noEmit` clean, `vite build` OK. **E2E-verified 2026-09-08** — proponent opened an admin-created application (APP-NEW-…, SUBMITTED, 0/27 requirements) and all 5 detail tabs render.

**Backend (new, ownership-checked; admin routes untouched)**
- `GET /api/proponents/me/applications` → `listApplicationsForProponent(req.proponent.id)`.
- `GET /api/proponents/me/applications/:id` (+ `requireOwnApplicationOrAdmin`) → `getApplicationById`.
- `GET /api/proponents/me/applications/:id/requirements` → `listApplicationRequirements`.
- `GET /api/proponents/me/applications/:id/documents` → `listDocumentsByApplication`.
- `GET /api/proponents/me/applications/:id/status-history` → `listApplicationStatusHistory` (this is the "transaction history" per application).
- `GET /api/proponents/me/applications/:id/contract` → `Contract.getByApplicationId`.
- Permits (see Phase 4 for model): `GET /api/proponents/me/permits`, `GET /api/proponents/me/applications/:id/permits`.

**Frontend**
- **My Applications** list view (`me:applications`) — richer than the dashboard widget: filters, search, pagination (reuse `DataTableControls`).
- **Application Detail** (`me:application-detail?applicationId=`) — tabs:
  - Overview (status, type, dates, assigned officer name)
  - Requirements checklist (read-only, progress bar; reuse styling from `ProponentDashboard`)
  - Documents (list + download; upload in Phase 5)
  - Status / Transaction History timeline (from status-history)
  - Contract & Permits (executed docs)
- Wire notification deep-links: `AppHeader` already builds `targetPath?applicationId=...`; add proponent `targetPath` mapping so a proponent clicking a notification lands on `me:application-detail`.

### Phase 4 — Permits model ✅ DONE (2026-09-08)

**Schema (created & verified on `bridge`):** `dbo.permits` (proponent_id FK, application_id nullable, permit_type ENVIRONMENTAL/FIRE/OCCUPANCY/SANITARY/AUTHORITY_TO_OPERATE, permit_no, issuing_authority, issue_date, expiry_date, status, document_id, remarks, is_active, audit cols) — [server/models/Permit.js](../server/models/Permit.js). `effective_status` derived: REVOKED (explicit) → EXPIRED / EXPIRING (≤30d) / VALID from `expiry_date`.

**Backend:**
- Admin CRUD `/api/permits` ([server/routes/r_permits.js](../server/routes/r_permits.js), [server/controller/c_permits.js](../server/controller/c_permits.js)), gated `requireMenuAccess("compliance:permits", …)`.
- Proponent read: `GET /api/proponents/me/permits`, `GET /api/proponents/me/contracts` (new `Contract.listByProponentId`), `GET /api/proponents/me/applications/:id/permits`.

**Frontend:**
- New [PermitsManagement.tsx](../src/components/compliance/PermitsManagement.tsx) — admin CRUD table + SidePanel form (proponent/application dropdowns, type, dates, status). `src/App.tsx` `compliance:permits` view now renders this instead of the mock `SectionLanding`.
- New [ProponentContractsPermits.tsx](../src/components/proponent/ProponentContractsPermits.tsx) — proponent "Contracts & Permits" view (`me:contracts-permits`): executed contracts + permits with expiry-aware status badges.
- [ProponentApplications.tsx](../src/components/proponent/ProponentApplications.tsx): detail "Contract" tab → "Contract & Permits", now also lists permits linked to that application.
- [ProponentSidebar.tsx](../src/components/proponent/ProponentSidebar.tsx): "Contracts & Permits" nav item.

Verification: `tsc` clean, `vite build` OK, `permits` DDL verified. **Not yet E2E-tested** — needs dev backend restart + an admin to add a permit.

### Phase 6 — Profile activity history ✅ DONE (2026-09-08)

**Schema (created & verified on `bridge`):** `dbo.activity_log` (actor_user_id, proponent_id, entity_type, entity_id, action, meta JSON, ip, created_at) — [server/models/ActivityLog.js](../server/models/ActivityLog.js). `record()` is fire-and-forget (never throws). `listForProponent(proponentId, userId, …)` matches rows by proponent_id OR actor_user_id.

**Instrumented actions:** `LOGIN` (c_auth.login), `REGISTERED` (c_auth.register), `ACCOUNT_APPROVED` / `ACCOUNT_REJECTED` (c_users), `PASSWORD_CHANGED` (c_users.update when a password is set), `PROFILE_CHANGE_REQUESTED` / `_APPROVED` / `_REJECTED` (c_proponents), `DOCUMENT_UPLOADED` (c_proponent_portal). Write path verified end-to-end.

**Frontend:** `GET /api/proponents/me/activity` → new [ProponentActivity.tsx](../src/components/proponent/ProponentActivity.tsx) timeline view (`me:activity`), sidebar "Activity History" item.

Verification: `tsc` clean, `vite build` OK, `activity_log` write+read verified. **Not yet E2E-tested** — needs dev backend restart.

**Schema** — new `permits` table:
- `id`, `proponent_id` (or `application_id`, or both nullable), `permit_type` (`ENVIRONMENTAL`|`FIRE`|`OCCUPANCY`|`SANITARY`|`AUTHORITY_TO_OPERATE`), `permit_no`, `issuing_authority`, `issue_date`, `expiry_date`, `status` (`VALID`|`EXPIRING`|`EXPIRED`|`REVOKED` — can be derived from `expiry_date`), `document_id` (FK to `documents`), `created_by`, `updated_by`, timestamps.
- Reuse `compliance_types` / `inspection_types` if the taxonomy should be admin-managed rather than an enum — check `server/models/ComplianceType.js` before finalizing.

**Backend**
- `Permit` model + `server/controller/c_permits.js` + `server/routes/r_permits.js`.
- Admin CRUD (`requireRole("admin")` or a new `compliance:permits` menu gate).
- Proponent read: `GET /api/proponents/me/permits` (owned only).
- Mount in `server/routes/routes.js`.

**Frontend**
- Admin permits management UI under `compliance:permits` (replaces the mock `SectionLanding`).
- Proponent **Contracts & Permits** view (`me:contracts-permits`): executed contracts + valid/expired permits with download links and expiry highlighting.

### Phase 5 — File upload infrastructure ✅ DONE (2026-09-08)

**Decision:** local disk storage.

- `npm install multer` (2.3.0) in `server` workspace.
- [server/lib/fileStorage.js](../server/lib/fileStorage.js): multer disk storage → `server/uploads/<applicationId>/` (`STORAGE_DIR` env override), 10 MB / 1 file, PDF/JPG/PNG only. `handleUpload` maps multer errors to clean 400 JSON. `resolveStoredPath` blocks path traversal (verified). `storage_path` stored as `<appId>/<filename>` relative to the root.
- `POST /api/proponents/me/applications/:id/documents` (`requireProponentSelf` + `requireOwnApplication` + `handleUpload`) → `c_proponent_portal.uploadMyApplicationDocument`: optional `requirement_id` (validated against the app's checklist), writes a real `documents` row, cleans up the file on DB failure.
- `GET /api/documents/:id/download` ([server/routes/r_documents.js](../server/routes/r_documents.js), [server/controller/c_documents.js](../server/controller/c_documents.js)) — authenticated; admin/officer any doc, proponent only their own applications' docs; streams via `res.download`. Uploads dir is **not** served statically.
- `ApplicationWorkflow.getDocumentById` added (joins `proponent_id` for the ownership check).
- `.gitignore`: `server/uploads/`.

**Frontend:**
- [ProponentApplications.tsx](../src/components/proponent/ProponentApplications.tsx) Documents tab: upload control (hidden file input + optional requirement `<select>`), `FormData` POST, reloads the list; each doc row is a Download link → URL `storage_path` opens directly, otherwise `/api/documents/:id/download`.
- [ApplicationsWorkflow.tsx](../src/components/applications/ApplicationsWorkflow.tsx) (admin): document preview now has a working Download link (same endpoint; admins are privileged).

Verification: `tsc --noEmit` clean, `vite build` OK, storage helpers unit-checked (traversal blocked). **Not yet E2E-tested** — needs dev backend (`:2501`) restart.

**Backend**
- Add `multer` (disk storage → `server/uploads/<applicationId>/`, or a `STORAGE_DIR` env; keep an interface so blob/S3 can swap in later).
- `documents` table already has `file_name`, `original_file_name`, `storage_path`, `content_type`, `file_size_bytes` — populate them for real.
- `POST /api/proponents/me/applications/:id/documents` (`requireOwnApplicationOrAdmin`, `multer.single('file')`): size/type allowlist (PDF/JPG/PNG), writes file, inserts `documents` row via `createDocument` (which already fires notifications), optionally links to a `requirement_id`.
- `GET /api/documents/:id/download` — **authenticated + ownership-checked** (proponent may download only docs on their own applications; admins/officers any). Streams from `storage_path`. Never serve the uploads dir as static.
- Keep the existing admin `POST /api/applications/documents` for admin-side uploads (migrate it to multer too).
- `.gitignore` the uploads dir.

**Frontend**
- Upload control in the proponent Application Detail → Documents tab (drag-drop, per-requirement upload, progress).
- Replace any URL-string document handling in `src/components/applications/ApplicationsWorkflow.tsx` with the new download endpoint.

### Phase 7 — Proponent self-submission of applications ✅ DONE (redone 2026-09-09)

Full BRM filing flow now works end-to-end (create draft → edit → upload docs → submit / resubmit → delete draft), verified against `bridge`.

**Backend:**
- `ApplicationWorkflow.js`: added `APPLICATION_TYPES` (`DIRECT_LEASE`/`WAREHOUSE_LEASE`/`SUBLEASE`) + `isValidApplicationType`; `createApplication` now validates + upper-normalizes the type and **skips the staff "created" notification when status is DRAFT** (drafts are private until submitted); `listApplications()` gained `WHERE a.status <> 'DRAFT'` so staff lists never show a proponent's unsubmitted draft; **`submitApplication` now gates on supporting documents** — every `is_mandatory = 1` requirement must have ≥1 uploaded doc or it throws (BRM spec: "validation of mandatory fields and supporting documents"); new `updateDraftApplication(id, {application_type, is_renewal, changed_by})` (DRAFT-only; flipping is_renewal rebuilds the checklist and is refused once a doc is attached) and `deleteDraftApplication(id)` (DRAFT + 0 documents; wipes requirements/history/notifications then the row — no FKs on these tables).
- `c_applications.js`: `create` validates the type; new `updateDraft` (`PATCH /api/applications/:id`) and `remove` (`DELETE /api/applications/:id`), both `loadWithAccess`-gated, 409 on guard failure.
- `r_applications.js`: `PATCH /:id` + `DELETE /:id` added (`requireRole("admin","officer","proponent")`).

**Frontend:**
- `src/lib/applicationTypes.ts` (new) — shared `APPLICATION_TYPES` + labels, mirrors the server list.
- `ProponentApplications.tsx` rewritten: list has a **New Application** button → `ApplicationForm` SidePanel (type dropdown + New/Renewal) → `POST /api/applications {save_as_draft:true}` → opens the draft. Detail shows a **draft/returned action bar**: Edit / Delete (draft only) + Submit / Resubmit, with a live "N mandatory documents still needed" hint. Delete uses `ConfirmModal`.
- `statusBadge.ts`: `RESUBMITTED` → amber, `RETURNED` → orange, `DRAFT`/unknown → slate.
- `FileApplicationPanel.tsx` **deleted**; removed from `ProponentDashboard` (single filing entry point = My Applications). Dashboard gained a **Drafts** stat card.
- Admin `ApplicationsWorkflow.tsx` create form: type input → dropdown (server now rejects free text).

**Watch-outs / decisions still open:**
- The mandatory-document submit gate **overrides the earlier "no requirement gate" scoping decision** — flagged to the user. If CIAC's real process is "submit first, staff checks completeness", relax the check in `submitApplication` (the block is one `if (missing > 0) throw`).
- `listApplications()` excluding DRAFT also hides **admin-saved** drafts from the main admin list. Acceptable for now (admin "save as draft" is an edge case); revisit with a staff drafts filter if needed.
- Deleting a draft consumes its reference number (counter doesn't roll back) — ref numbers are unique, not gapless.

<details><summary>Original Phase 7 plan (kept for reference)</summary>

**Was:** ⚠️ REDO NEEDED (was done 2026-09-08, lost in 2026-09-09 merge)

Decisions: submit allowed even with incomplete requirements (no gate); New **and** Renewal.

`bd98f41` already provides the model layer — reuse it, don't rebuild it:
- `ApplicationWorkflow.generateApplicationNo(tx, isRenewal)` — BRM-09 counter-based `APP-2026-00001` / `REN-2026-00001`.
- `ApplicationWorkflow.createApplication({ proponent_id, application_type, is_renewal, status: 'DRAFT', created_by })` — mints the number itself, attaches the checklist, writes history. Do **not** pass `application_no`.
- `ApplicationWorkflow.submitApplication(id, { changed_by })` — `DRAFT→SUBMITTED` **or** `RETURNED→RESUBMITTED` (`SUBMIT_TRANSITIONS`); throws `Cannot submit an application while it is X` otherwise; fires the status-change notification.

**Still to build:**
- `ApplicationWorkflow.deleteDraftApplication(id)` — DELETE `application_requirements` + `application_status_history` + the row, only when `status='DRAFT'` and `documents` count is 0 (else 409).
- `c_proponent_portal`: `createMyApplication` (POST `/me/applications`; validate `application_type` ∈ DIRECT_LEASE/WAREHOUSE_LEASE/SUBLEASE; log `APPLICATION_DRAFTED`), `submitMyApplication` (PATCH `/me/applications/:id/submit`; `requireOwnApplication`; catch the submit throw → 409; log `APPLICATION_SUBMITTED`), `deleteMyDraftApplication` (DELETE `/me/applications/:id`).
- Routes in `server/routes/r_proponents.js` (before `/:id` admin routes): `POST /me/applications`, `PATCH /me/applications/:id/submit`, `DELETE /me/applications/:id`.
- `src/components/proponent/ProponentApplications.tsx`: "New Application" button + inline form (lease type + New/Renewal) → POST → open the draft. DRAFT detail: "Draft — not yet submitted" banner with **Submit** + **Delete**. When `status === 'RETURNED'`: a **Resubmit** button (calls the same `/submit` endpoint — upstream now allows it).
- `src/components/dashboard/statusBadge.ts`: add `DRAFT` (muted slate) and `RESUBMITTED` (amber, like SUBMITTED).
- `server/models/ApplicationWorkflow.js` `listApplications` / `listAllApplicationsWithProgress` already exclude `DRAFT` (via `WHERE status NOT IN (...)` upstream — verify), so drafts stay private to the proponent until submitted.

Actual implementation diverged: filing goes through the existing `/api/applications` routes (proponent-allowed, `loadWithAccess`-gated) rather than new `/me/applications` handlers, matching how create+submit were already wired; a mandatory-document submit gate was added (spec-driven, overrides "no gate"); `listApplications()` did **not** already exclude DRAFT, so a `WHERE` was added.

</details>

### Phase 6 — Profile activity history

**Schema** — new `activity_log` table:
- `id`, `actor_user_id`, `proponent_id` (nullable, for scoping), `entity_type` (`USER`|`PROPONENT`|`APPLICATION`|`DOCUMENT`|`CONTRACT`|`PERMIT`|`AUTH`), `entity_id`, `action` (e.g. `LOGIN`, `REGISTER`, `PROFILE_CHANGE_REQUESTED`, `PROFILE_CHANGE_APPROVED`, `DOCUMENT_UPLOADED`, `APPLICATION_STATUS_CHANGED`, `PASSWORD_RESET`), `meta` JSON, `ip`, `created_at`.

**Backend**
- Small `ActivityLog.record({...})` helper; call it from: `Auth.login` success, `register`, approve/reject, profile change request submit/approve/reject, `createDocument`, `updateApplicationStatus`, admin set-password.
- `GET /api/proponents/me/activity` — own log, paginated.
- (Optional) admin `GET /api/activity?proponent_id=` to power the existing `verification:audit` mock screen.

**Frontend**
- Proponent **Activity History** view (`me:activity`): timeline of logins + profile edits + application/document/contract events.

---

## 4. Suggested delivery order

1. Phase 0 (foundations — role seed, guards, proponent view-set skeleton with just Dashboard + empty My Profile).
2. Phase 1 (registration + admin approval + login gating).
3. Phase 2 (self-service profile + approval queue).
4. Phase 3 (read views for applications/status/history + contract).
5. Phase 5 (file upload) — needed before Documents tab is real.
6. Phase 4 (permits model) — can run parallel to 3/5.
7. Phase 6 (activity log) — instrument as each phase lands, ship the view last.

Each phase is independently shippable behind the proponent role.

---

## 5. Open questions / watch-outs

- **DB in use:** confirm `server/config/database.js` points at MSSQL (the models assume it) vs the root `bizreg.db` SQLite — all schema snippets above are T-SQL.
- **`user_roles` is many-to-many** but the UI assumes one role. Registration must not create a second role row for an existing username/email — reject duplicates.
- **`getProponentByUserId` filters `is_active = 1`** — Phase 1/2 need a variant that returns a pending/inactive proponent so the owner can see their own pending profile.
- **CORS / cookie `sameSite: 'lax'`, `secure` only in production** — fine for current setup; revisit if frontend and backend end up on different domains in prod.
- Permit taxonomy: enum vs. `compliance_types` table — decide before Phase 4 schema.
- Rate-limiting: `express-rate-limit` is not currently a dependency; add it for `/api/auth/register` and `/api/auth/login`.
