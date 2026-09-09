# CIAC / BRIDGE System — Team Guide

Business Registration and Information Database for Governance and Entities (BRIDGE) for the
Clark International Airport Corporation (CIAC).

**Stack (as built):** React 19 + Vite + TypeScript (frontend, `src/`) · Express 4 + MSSQL
(backend, `server/`) · JWT cookie auth + TOTP 2FA.
_TOR mandates PHP Laravel 10 + Bootstrap + MSSQL — the stack-compliance gap is a known,
separate decision._

**The 11 TOR modules and who owns them:**

| # | TOR Module | Owner |
|---|---|---|
| 1 | System Dashboard & Monitoring | RJ — Core |
| 2 | Proponent Profile Management | AXL — Proponent |
| 3 | Business Registration | AXL — Proponent |
| 4 | **Assessment & Evaluation** | **RAYNAN — Process** |
| 5 | Approval & Issuance | ROMAR — Output |
| 6 | Records Management | ROMAR — Output |
| 7 | Reports & Analytics | ROMAR — Output |
| 8 | Notifications & Alerts | ROMAR — Output |
| 9 | User Management, Security & Audit | RJ — Core |
| 10 | **Compliance & Inspection** | **RAYNAN — Process** |
| 11 | General System Requirements | all |

**Legend:** ✅ built & working · ⚠️ partial / admin-only / stub · ❌ not started

---

## The end-to-end flow

```
  AXL ───────────────►  RAYNAN ──────────────►  ROMAR ──────────────►  RAYNAN
  Proponent registers   Officer assesses:       Approver decides:      Post-approval
  & submits application  compliance, charges,    approve / disapprove   inspections,
  + uploads documents    findings, then          / return; issues       findings,
                         RETURN or ENDORSE       contract + permits     corrective actions,
        ▲                      │                        │               compliance monitoring
        │                      │ RETURN                 │
        └──────────────────────┘ (resubmit)             │
                                                        ▼
  RJ ──────────────────────────────────────────────────────────────────────────
  Dashboard rolls up every stage · RBAC gates every screen · audit logs every action
  ROMAR: notifications fire on submit / return / approve / deficiency / expiry
```

---

## RJ DEV — Core & Admin

**Scope:** authentication, RBAC, user management, audit, dashboard, system config.
**TOR modules:** 1, 9.

### 1a. Authentication & 2FA — ✅ built

- `POST /api/auth/login` — username + password, plus a `token` field once a 6-digit code is
  required. Responses: `enrollmentRequired` (returns a QR to self-enroll) · `mfaRequired`
  (authenticator active, code missing/wrong) · `success` (sets the JWT httpOnly cookie).
- TOTP 2FA is **mandatory for non-admin roles**; admins are password-only unless they opt in.
- Admin can reset a lost authenticator: `POST /api/users/:id/totp/reset`.
- Middleware: `attachUserFromJwt` runs globally, `isAuthenticated` guards protected routes.
- Code: `server/models/Auth.js`, `server/lib/totp.js`, `server/routes/r_auth.js`,
  `src/components/auth/LoginPage.tsx`. Full detail in the README.

### 1b. User Management — ✅ built

- **Settings → User Management** (`/settings/users`) — create / edit / deactivate / reactivate
  users, assign a role, see 2FA status, reset authenticator.
- `GET/POST/PUT /api/users`, `PATCH /api/users/:id/deactivate|reactivate`.
- Code: `server/models/User.js`, `server/routes/r_users.js`,
  `src/components/settings/UsersManagement.tsx`.
- Roles live in a `roles` table (`GET /api/roles`) — not a fixed enum; the UI normalises to
  `admin` / `officer` / `proponent` but custom roles are allowed.

### 1c. RBAC / Control Panel — ✅ built

- **Settings → Control Panel** (`/settings/control-panel`) — per **role**, toggle:
  - **Sidebar Menu** — which screens the role can see.
  - **Menu CRUD** — add / edit / delete permission per screen.
- `admin` is exempt (sees & does everything — `fullAccess`). Every other role is
  **fail-closed**: no saved permission row = hidden / denied.
- Enforced in two places: the UI (`useControlPanelAccess()` + `canView()`), and the backend
  (`requireMenuAccess(menuKey, action)` on each route).
- The screen registry is driven by `src/config/landingConfig.ts` — any view with an entry
  there (and `isCrud: true`) shows up in Control Panel automatically.
- Tables: `role_sidebar_menu_permissions`, `role_menu_crud_permissions`.
- Code: `server/models/ControlPanelPermission.js`, `server/routes/r_control_panel.js`,
  `src/components/settings/ControlPanelManagement.tsx`,
  `src/context/ControlPanelAccessContext.tsx`.

### 1d. Dashboard & Monitoring (TOR Module 1) — ⚠️ partial

- **Dashboard** (`/dashboard`) with role-specific layouts: `RoleDashboard`, `OfficerDashboard`,
  `ProponentDashboard`, `PreviewDashboard` (admin previews other roles).
- `GET /api/dashboard/me` (own data), `GET /api/dashboard/preview/:role` (admin).
- Widgets present: application counts, requirements-overview. Skeleton loading is in.
- **Pending:** reporting-period views (daily/weekly/monthly/quarterly/yearly),
  turnaround-time & processing-performance metrics, trend analysis, configurable widgets.
  Feed candidates already exist: `GET /api/assessments/summary`,
  `GET /api/inspections/summary`.
- **Known bug:** `src/App.tsx` renders `<Dashboard />` without its required `data` prop
  (`tsc` error) — fix before relying on the admin dashboard.
- Code: `server/routes/r_dashboard.js`, `src/components/dashboard/*`.

### 1e. Audit trail (TOR Module 9) — ⚠️ partial

- Per-domain activity logs exist: `application_status_history`, `assessment_activity`,
  `inspection_activity`.
- **Pending:** a single system-wide audit log (logins, every create/update/delete,
  record modifications) + audit reports.

### 1f. System config — ⚠️ partial

- **Settings → Master Checklist** (`src/components/settings/MasterChecklist.tsx`) — document
  checklist templates per application type.
- Lookup CRUD: Requirement Categories, Inspection Types, Compliance Types (see AXL / RAYNAN).

---

## AXL DEV — Proponent & Registration

**Scope:** proponent accounts & profiles, business registration/renewal filing, document
upload, application tracking.
**TOR modules:** 2, 3.

### 2. Proponent Profile Management (TOR Module 2) — ⚠️ partial

- **Admin side ✅:** Proponent Management (`/settings/proponents`) — create / edit /
  deactivate proponent business profiles. `GET/POST/PUT /api/proponents`.
- A `proponents` row links to a `users` row via `user_id` (the proponent's login).
- **Pending:** the self-service proponent **portal** — a proponent logging in to view their
  own profile, submitted applications, transaction status & history, uploaded documents,
  executed contracts & permits; limited profile editing subject to approval; profile
  activity history.
- Code: `server/models/Proponent.js`, `server/routes/r_proponents.js`,
  `src/components/proponent/ProponentsManagement.tsx`.

### 3. Business Registration (TOR Module 3) — ⚠️ partial

- **Applications Workflow** (`/applications/new`, `/applications/renewals`) —
  `src/components/applications/ApplicationsWorkflow.tsx` (large). Admin/officer-facing today.
- An application auto-generates its requirement checklist from the active `requirements`
  (filtered by new vs renewal), records `documents` (metadata), and tracks status via
  `application_status_history`.
- Requirement definitions: **Requirements** (`/applications/requirements`) and **Requirement
  Categories** (`/settings/requirement-categories`) — full CRUD.
- API: `GET/POST /api/applications`, `PATCH /api/applications/:id/status`,
  `GET /api/applications/:id/requirements|documents|status-history`,
  `PATCH /api/applications/requirements/:id/status`, `POST /api/applications/documents`.
- **Pending:** proponent-facing online filing form, mandatory-field/document validation UX,
  **save as draft**, **submission / resubmission** flow, auto reference-number generation,
  application-history view for the proponent.
- **Documents:** the system stores file **metadata only** (`file_name` + `storage_path` as a
  typed path/URL). There is **no binary upload** (no multer) — every "upload" screen records
  a reference. Any real file storage is a shared infrastructure decision.
- Tables: `applications`, `application_requirements`, `documents`,
  `application_status_history`, `requirements`, `requirement_categories`.
- Code: `server/models/ApplicationWorkflow.js`, `server/models/Requirement*.js`,
  `server/routes/r_applications.js`, `server/routes/r_requirement*.js`,
  `src/components/applications/*`.

---

## RAYNAN DEV — Process

**Scope:** everything between "submitted" and "approved", plus post-locator compliance.
**TOR modules:** 4, 10. **Both are built and E2E-tested.**
**Deep-dive doc:** [`docs/PROCESS-MODULES.md`](PROCESS-MODULES.md).

### 4. Assessment & Evaluation (TOR Module 4) — ✅ built

**Screen:** Sidebar → Assessment & Evaluation → Evaluation Queue (`/assessment`).

**Stages:** `UNASSIGNED → ASSIGNED → IN_REVIEW → FOR_RECOMMENDATION → COMPLETED | RETURNED`.

**Workflow:**

1. **Assign** a designated evaluator (notified; logged).
2. **Compliance tab** — verify / reject each documentary requirement.
3. **Findings tab** — record findings / comments / remarks / **deficiencies** / recommendations
   (category incl. `REGULATORY`, optional severity, status OPEN/RESOLVED/WAIVED). A DEFICIENCY
   notifies the proponent.
4. **Charges tab** — build the bill (rental / processing fee / tax / penalty / other);
   `qty × unit rate → amount` or manual override; **header total auto-recomputes**.
5. **Recommendation tab** — Endorse / Return / Recommend Disapproval + basis. This moves the
   application status: `RETURN → RETURNED` (proponent notified), `ENDORSE → FOR_APPROVAL`,
   `DISAPPROVE → DISAPPROVED`.
6. **Monitoring** — queue stat bar: per-stage counts, overdue (>5 days assigned), completed,
   returned. Admin can **Reopen** a finished assessment.

**API** `/api/assessments` (guard `assessment:queue`): `GET /`, `GET /summary`,
`GET /evaluators`, `GET /:applicationId`, `PATCH /:applicationId/assign|stage|reopen`,
`POST /:applicationId/recommendation`, findings & charges CRUD,
`PATCH /requirements/:id/status`.

**Tables:** `application_assessments`, `assessment_findings`, `assessment_charges`,
`assessment_activity`.

**Code:** `server/models/AssessmentEvaluation.js`, `server/controller/c_assessments.js`,
`server/routes/r_assessments.js`, `src/components/assessment/AssessmentEvaluation.tsx`.

### 10. Compliance & Inspection (TOR Module 10) — ✅ built

**Screen:** Sidebar → Compliance & Permits → Compliance & Inspection → Inspections & Monitoring
(`/compliance/inspections`).

**Inspection types (auto-seeded):** Performance Commitment, Compliance, Audit, Engineering,
Property, Marketing, Safety, Security, Legal.

**Lifecycle:** `SCHEDULED → IN_PROGRESS → COMPLETED` (+ result `PASSED` /
`PASSED_WITH_FINDINGS` / `FAILED`); or `CANCELLED`.

**Workflow:**

1. **New Inspection** — proponent, type, title, scheduled date, optional inspector.
2. **Assign inspector** (Overview tab).
3. **In Progress** — conducted date auto-stamped.
4. **Findings tab** — description + recommendation, severity, status.
5. **Corrective Actions tab** — action required, responsible party, due date, link to a
   finding; `PENDING → IN_PROGRESS → DONE`; past-due & not done → **OVERDUE**.
6. **Reports tab** — inspection report + supporting document references (metadata only).
7. **Complete** — pick result + summary.
8. **Compliance Monitor tab** — per-locator rollup with a standing badge:
   **Compliant** / **Monitoring** / **At Risk**.

**API** `/api/inspections` (guard `compliance:inspections`): `GET /`, `GET /summary`,
`GET /meta`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /:id/assign|status|result`,
findings / actions / documents CRUD.

**Tables:** `inspections`, `inspection_findings`, `inspection_corrective_actions`,
`inspection_documents`, `inspection_activity`.

**Code:** `server/models/ComplianceInspection.js`, `server/controller/c_inspections.js`,
`server/routes/r_inspections.js`, `src/components/compliance/ComplianceInspections.tsx`.

### Grey area — ⚠️ to be assigned

`compliance:permits` / `compliance:bir` / `compliance:expiry` (CDC/CIAC permit tracking,
BIR & tax records, expiry calendar) are still static placeholder screens
(`SectionLanding` mock data). Decide whether these belong to RAYNAN (compliance),
ROMAR (records), or RJ (dashboard/monitoring) before building.

---

## ROMAR DEV — Output

**Scope:** approval decisions, contract/permit issuance, records management, reporting,
notifications.
**TOR modules:** 5, 6, 7, 8.

### 5. Approval & Issuance (TOR Module 5) — ⚠️ partial

- A `Contract` model + `GET/POST/PUT /api/contracts` exist (contract no., issue date,
  effective start/end, linked document).
- **Pending:** the approval **workflow** — multi-level review/approval hierarchy, approve /
  disapprove / return actions, electronic endorsement between offices, approval-document
  generation & issuance, recording approving authorities & dates, complete approval history.
- **Entry point:** an application reaches ROMAR at status `FOR_APPROVAL` (set by RAYNAN's
  Endorse). ROMAR's module should pick up from there.
- Code: `server/models/Contract.js`, `server/routes/r_contracts.js` (no frontend yet).

### 6. Records Management (TOR Module 6) — ❌ not started

- Centralized registry, electronic storage of applications & documents, search / filter /
  retrieval, complete business profile / history / transactions, **archiving**,
  retention rules, **document version control**, backup/recovery support.

### 7. Reports & Analytics (TOR Module 7) — ❌ not started

- Lists (registered / renewed / pending / approved / rejected / returned), reports by
  business type / classification / status, period-based reports, statistical & graphical
  analytics, **printable** reports, **PDF & Excel export**, customizable filters.

### 8. Notifications & Alerts (TOR Module 8) — ⚠️ partial

- **In-app ✅:** `Notification` model, `GET /api/notifications/me`, live SSE stream
  (`GET /api/notifications/stream`, `server/lib/notificationStream.js`), mark read / read-all.
  Client: `src/lib/notificationClient.ts`, bell in `AppHeader`.
- Events already firing: application status change, requirement update, document upload,
  assessment recommendation / deficiency, inspection assignment / completion.
- **Email ⚠️:** `nodemailer` is wired (`server/config/mailer.js`) but `SMTP_*` env is empty —
  no mail is sent until configured.
- **Pending:** SMS notifications, renewal reminders, expiring-permit alerts, pending-action
  digests, configurable alert rules.

---

## Cross-cutting conventions

**Adding a new screen** (any dev) touches the same files — copy an existing view:

| File | Add |
|---|---|
| `src/layout/AppLayout.tsx` | the key in the `AppView` union |
| `src/App.tsx` | `VIEW_TO_PATH` entry, `React.lazy` import, render branch, local `LANDING_CONFIG` entry |
| `src/config/landingConfig.ts` | `LANDING_CONFIG` entry (`isCrud: true` if it has add/edit/delete) |
| `src/components/AppSidebar.tsx` | a `SidebarSubItem`, gated with `canView('<key>')` |
| `server/routes/routes.js` | `app.use("/api/<x>", require("./r_<x>"))` |

**Backend model pattern:** each `server/models/*.js` self-migrates via `ensureSchema()`
(`IF OBJECT_ID(...) IS NULL CREATE TABLE`), called lazily inside every model function.
No migration runner — the tables appear on first use.

**Route guard pattern:** `requireMenuAccess("<menuKey>", "view"|"add"|"edit"|"delete")` for
Control-Panel-governed screens; `requireRole("admin")` for admin-only endpoints.

**API envelope:** `{ success: true, data }` or `{ success: false, message }`.

**Database:** MSSQL only. `server/config/database.js` reads `server/.env`
(`DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`). The root `.env` is Vite-only and must set
`VITE_BACKEND_URL=http://localhost:3100`.

## Run it

```bash
npm run dev:all      # frontend :2500 + backend :3100
npm run build        # production build of the frontend
npm run lint         # tsc --noEmit (2 known pre-existing errors in src/App.tsx re: Dashboard)
```

Ports: frontend `2500`, backend `3100`. Login `admin` / `admin123` (dev default).
For any non-admin role, enable that role's screens in **Settings → Control Panel** first.
