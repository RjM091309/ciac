# Process Track — Assessment & Evaluation + Compliance & Inspection

**Owner:** RAYNAN (DEV 3 — "Process")
**BRIDGE TOR modules:** 4 (Assessment and Evaluation) · 10 (Compliance)
**Org-chart items covered:** Assessment · Evaluation · Assignment · Compliance · Inspection

This track handles everything that happens to an application **after it is submitted and
before it is approved**, plus the **post-locator compliance monitoring** that continues for
the life of the lease.

```
Module 3 (Registration)          Module 4 (Assessment & Evaluation)          Module 5 (Approval & Issuance)
proponent submits application  →  AO reviews, evaluates compliance,       →   approver decides,
                                  assesses charges, records findings,          issues contract + permits
                                  RETURNS or ENDORSES                                │
                                        │                                           ▼
                                        └── RETURN → proponent resubmits     Module 10 (Compliance & Inspection)
                                                                             inspections + findings + corrective
                                                                             actions + compliance monitoring
```

---

## 1. Assessment & Evaluation Module (BRIDGE Module 4)

### Purpose

An **Account Officer / evaluator** takes a submitted application and decides whether it is
ready for approval. They do **not** approve — they produce the *basis* for approval: a
verified compliance check, a computed bill of charges, and a written recommendation.

### Roles

| Role | Can do |
|------|--------|
| Admin | everything, incl. reopen a completed/returned assessment |
| Account Officer (`officer`) | assign, review, add findings/charges, recommend — **only if** `assessment:queue` is enabled for the role in **Settings → Control Panel** |
| Proponent | receives a notification when their application is RETURNED |

### Assessment stages

```
UNASSIGNED ──assign──► ASSIGNED ──start review──► IN_REVIEW ──► FOR_RECOMMENDATION
                                                       │
                                    submit recommendation
                                                       │
                          ┌────────────────────────────┼────────────────────────────┐
                     RETURN                        ENDORSE                       DISAPPROVE
                          │                            │                            │
                    stage RETURNED               stage COMPLETED              stage COMPLETED
              application → RETURNED         application → FOR_APPROVAL   application → DISAPPROVED
              (proponent notified)
```

Admin can **Reopen** a COMPLETED / RETURNED assessment → back to `IN_REVIEW`.

### The workflow, step by step

1. **Assignment** — Admin (or officer) opens an application from the Assessment queue and
   assigns a designated evaluator. The evaluator is notified; an `ASSIGNED` entry is written
   to the activity log.
2. **Review & verification** *(Compliance tab)* — the evaluator opens each requirement and
   marks it `VERIFIED` or `REJECTED`. This reuses the application's own requirement checklist
   (documentary compliance).
3. **Regulatory compliance** *(Findings tab)* — anything that is not a document check
   (zoning, environmental clearance, policy) is captured as a finding with
   `category = REGULATORY`.
4. **Charge assessment** *(Charges tab)* — the evaluator builds the bill of what the
   proponent must pay: rental, processing fee, tax, penalty, other. Each line is
   `type + description + basis note + quantity + unit rate → amount` (or a manual amount
   override). The header **total is recomputed automatically** on every add/edit/delete.
5. **Findings & recommendations** *(Findings tab)* — findings, comments, remarks,
   deficiencies and recommendations are recorded, each with a category, optional severity,
   and a status (`OPEN` / `RESOLVED` / `WAIVED`). Adding a **DEFICIENCY** notifies the
   proponent.
6. **Recommendation** *(Recommendation tab)* — the evaluator picks **Endorse**, **Return**,
   or **Recommend Disapproval**, writes the basis, and submits. The application status and
   the assessment stage move together (see stage diagram).
7. **Monitoring** — the queue's top stat bar shows counts per stage, the overdue count
   (assigned more than 5 days and still open), and completed/returned totals. Every row shows
   verified-requirements progress, open findings, charges total, and days-in-assessment.

### Screen

**Sidebar → Assessment & Evaluation → Evaluation Queue** (`/assessment`)

- Monitoring stat bar + filters (stage, evaluator, search)
- Queue table of every application with its assessment state
- Row click → right drawer with tabs: **Overview · Compliance · Charges · Findings ·
  Recommendation · Activity**

### API (`/api/assessments`, guard: `requireMenuAccess("assessment:queue", …)`)

| Method & path | Purpose |
|---|---|
| `GET /` `?stage&evaluatorId&search` | queue list |
| `GET /summary` | monitoring stat tiles |
| `GET /evaluators` | assignable evaluators (officer/admin users) |
| `GET /:applicationId` | full detail (header + findings + charges + activity + requirements + documents) |
| `PATCH /:applicationId/assign` `{evaluator_id}` | assign / reassign |
| `PATCH /:applicationId/stage` `{stage}` | move stage |
| `PATCH /:applicationId/reopen` | admin only |
| `POST /:applicationId/recommendation` `{recommendation, summary}` | endorse / return / disapprove |
| `POST /:applicationId/findings` · `PATCH /findings/:id` · `DELETE /findings/:id` | findings CRUD |
| `POST /:applicationId/charges` · `PATCH /charges/:id` · `DELETE /charges/:id` | charges CRUD |
| `PATCH /requirements/:id/status` `{status, remarks}` | verify/reject a requirement (proxy) |

### Database tables (auto-created by `ensureSchema()` on first API call)

| Table | Holds |
|---|---|
| `application_assessments` | one row per application — evaluator, stage, recommendation, `charges_total` |
| `assessment_findings` | findings/comments/remarks/deficiencies/recommendations |
| `assessment_charges` | fee / rental / tax / penalty line items |
| `assessment_activity` | append-only action log |

### Code

| Layer | File |
|---|---|
| Model | `server/models/AssessmentEvaluation.js` |
| Controller | `server/controller/c_assessments.js` |
| Routes | `server/routes/r_assessments.js` (mounted in `server/routes/routes.js`) |
| Frontend | `src/components/assessment/AssessmentEvaluation.tsx` |

---

## 2. Compliance & Inspection Module (BRIDGE Module 10)

### Purpose

After a locator is approved, CIAC keeps inspecting them — safety, engineering, property,
performance commitment, etc. This module **schedules inspections, records what was found,
tracks the fixes, and shows each locator's overall compliance standing**.

### Inspection types (seeded automatically into `inspection_types`)

Performance Commitment · Compliance · Audit · Engineering · Property · Marketing · Safety ·
Security · Legal Inspection. (Editable at **Settings → File Maintenance → Inspection Types**.)

### Inspection lifecycle

```
SCHEDULED ──assign inspector──► (still SCHEDULED)
     │
  set status IN_PROGRESS  ──►  conducted_date auto-set
     │
  record findings ──► link corrective actions ──► attach report/docs
     │
  complete with a result
     │
     ▼
  COMPLETED  +  result = PASSED | PASSED_WITH_FINDINGS | FAILED
```

(A scheduled inspection can also be set to `CANCELLED`.)

### The workflow, step by step

1. **Schedule** — *New Inspection*: pick proponent, inspection type, title, scheduled date,
   optionally the inspector.
2. **Assign inspector** *(Overview tab)* — assign / reassign the designated inspector.
   Notified if the inspection is tied to an application.
3. **Conduct** — set status to **In Progress**; the conducted date is stamped automatically.
4. **Record findings** *(Findings tab)* — each finding has a category, optional severity
   (`LOW` / `MEDIUM` / `HIGH`), a description, and a recommendation. Findings are
   `OPEN` → `RESOLVED` / `WAIVED`.
5. **Corrective actions** *(Corrective Actions tab)* — for each thing the locator must fix:
   the action required, responsible party, due date, optional link to a finding. Status is
   `PENDING` → `IN_PROGRESS` → `DONE`. Anything past its due date and not done shows as
   **OVERDUE** (in the list, the row, and the summary).
6. **Reports & documents** *(Reports tab)* — record references to the inspection report and
   supporting documents. *This system stores file metadata (name + path/URL), not the binary.*
7. **Complete** *(Overview tab)* — choose the result and write a summary; status becomes
   `COMPLETED`.
8. **Compliance monitoring** *(Compliance Monitor tab)* — a per-locator rollup: total /
   completed / failed inspections, open findings, open & overdue corrective actions, last
   inspection date, and a standing badge:
   - **Compliant** — nothing open
   - **Monitoring** — open findings or actions, none overdue
   - **At Risk** — an overdue corrective action or a failed inspection

### Screen

**Sidebar → Compliance & Permits → Compliance & Inspection → Inspections & Monitoring**
(`/compliance/inspections`)

- Stat bar (scheduled / in progress / completed / open findings / overdue actions)
- Two in-page tabs: **Inspections** (queue, filters, *New Inspection*) and
  **Compliance Monitor** (per-locator table)
- Row click → right drawer: **Overview · Findings · Corrective Actions · Reports · Activity**

### API (`/api/inspections`, guard: `requireMenuAccess("compliance:inspections", …)`)

| Method & path | Purpose |
|---|---|
| `GET /` `?status&result&typeId&inspectorId&proponentId&search` | inspection list |
| `GET /summary` | stat tiles + `by_proponent` compliance rollup |
| `GET /meta` | dropdown data (inspectors, proponents, types) |
| `GET /:id` | full detail |
| `POST /` | schedule an inspection |
| `PUT /:id` | edit header |
| `PATCH /:id/assign` `{inspector_id}` | assign inspector |
| `PATCH /:id/status` `{status}` | move status |
| `PATCH /:id/result` `{result, summary}` | complete |
| `POST /:id/findings` · `PATCH /findings/:id` · `DELETE /findings/:id` | findings CRUD |
| `POST /:id/actions` · `PATCH /actions/:id` · `DELETE /actions/:id` | corrective actions CRUD |
| `POST /:id/documents` · `DELETE /documents/:id` | report/supporting doc references |

### Database tables (auto-created by `ensureSchema()` on first API call)

| Table | Holds |
|---|---|
| `inspections` | header — proponent, type, inspector, status, result, dates |
| `inspection_findings` | findings + recommendations |
| `inspection_corrective_actions` | what must be fixed, by whom, by when |
| `inspection_documents` | report / supporting document references (metadata only) |
| `inspection_activity` | append-only action log |

`inspection_types` is also seeded with the TOR list on first run if empty.

### Code

| Layer | File |
|---|---|
| Model | `server/models/ComplianceInspection.js` |
| Controller | `server/controller/c_inspections.js` |
| Routes | `server/routes/r_inspections.js` (mounted in `server/routes/routes.js`) |
| Frontend | `src/components/compliance/ComplianceInspections.tsx` |

---

## Access control (both modules)

- The `admin` role sees and can do everything (`fullAccess`).
- Any other role needs the menu key enabled in **Settings → Control Panel**:
  - Sidebar Menu → toggle `assessment:queue` / `compliance:inspections` to show the screen.
  - Menu CRUD → toggle **add / edit / delete** to enable the buttons.
- The backend enforces the same rules per request (`requireMenuAccess`) — the UI gate is not
  the only check.

## Wiring reference (for future edits)

Adding either screen touched these shared files — follow the same pattern for any new view:

| File | What was added |
|---|---|
| `src/layout/AppLayout.tsx` | `AppView` union — `'assessment:queue'`, `'compliance:inspections'` |
| `src/App.tsx` | `VIEW_TO_PATH`, a `React.lazy` import, a render branch, and a local `LANDING_CONFIG` entry |
| `src/config/landingConfig.ts` | `LANDING_CONFIG` entry with `isCrud: true` (drives the Control Panel registry) |
| `src/components/AppSidebar.tsx` | a `SidebarDropdown` + `SidebarSubItem`, gated by `canView(...)` |
| `server/routes/routes.js` | `app.use("/api/…", require("./r_…"))` |

## Testing quickstart

1. `npm run dev:all` from the repo root (frontend :2500, backend :3100 — backend reads
   `server/.env`, and the root `.env` must set `VITE_BACKEND_URL=http://localhost:3100`).
2. Log in as `admin`.
3. **Assessment:** open an application from the Assessment queue → assign an evaluator →
   Compliance tab (verify a requirement) → Charges tab (add a rental line, check the total) →
   Findings tab (add a deficiency) → Recommendation tab (Return or Endorse). Confirm the
   application status changed and the proponent was notified on Return.
4. **Compliance:** *New Inspection* → assign inspector → set In Progress → add a finding →
   add a corrective action with a past due date (shows OVERDUE) → attach a report reference →
   complete with a result → check the **Compliance Monitor** tab.
