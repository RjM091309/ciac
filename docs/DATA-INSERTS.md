# Data Inserts — Where the System Writes Rows

Every place in the backend that inserts data, grouped by **what triggers it**.
Use this to answer "where did this row come from?" and to spot code that can
create data nobody asked for (duplicates, orphaned IDs, discrepancies).

Paths are relative to `server/`. Line numbers drift, so each entry names the
function — search for it.

**Timestamps:** most tables use `SYSUTCDATETIME()` (UTC). A few use `GETDATE()`
(server local time, PH +8) — notably `dbo.requirements` and `dbo.contracts`
updates. Convert before comparing times across tables.

---

## 1. Automatic on server start (boot seeds)

These run every time the server starts (`app.js` startup steps, or a model's
`ensureSchema()` on first use). They insert rows **without any user action**,
so they are the ones that can cause surprise data.

| Table | What gets inserted | Rule | Where |
|---|---|---|---|
| `type_of_contract` (File Maintenance → **Type of Contract**) | 5 types — see list below | **Only if the table is empty** | `models/TypeOfContract.js` → `seedDefaults` |
| `application_types` (File Maintenance → **Industry Type**) | 3 types — see list below | **Only if the table is empty** | `models/ApplicationType.js` → `createSchema` |
| `compliance_requirements` | 14 legacy BRIDGE compliance rows (INSURANCE, AFS, GIS, ATO, FSIC, SANITARY_PERMIT, ECC, …) | **Only if the table is empty** | `models/ComplianceRequirement.js` → `createSchema` |
| `compliance_requirements` | MAYORS_PERMIT | If that **code** is missing | same function |
| `roles` | `proponent`, `ACCOUNT OFFICER`, `ASSESSMENT OFFICER`, `VIEWER` | If that **name** is missing (case-insensitive) | `models/Role.js` → `createSchema` |
| `department` | 18 legacy BRIDGE departments (MD, MISD, PD, …, FD) | If that **code** is missing | `models/Department.js` → `seedDefaultDepartments` |
| `user_roles` | ACCOUNT OFFICER role for the 4 "(Legacy Import)" officers | Only users that have **no role yet**; no-op if the users don't exist | `models/AccountOfficer.js` → `applyLegacyOfficerDefaults` |
| `proponent_financial_terms` | Copies the 9 old financial columns off `proponents`, then drops them | One-time; no-op once the columns are gone | `models/FinancialTerms.js` → `carryOverLegacyColumns` |
| `locator_compliance_items` | Copies rows from the retired `inspection_compliance_items` table | Only if the old table exists; skips items the locator already has | `models/ComplianceInspection.js` → `createSchema` |
| `site_settings` | SMTP / login-lockout / TOTP values imported from `.env` | One-time, the first time the DB is initialised (marker key `system.env_imported_at`) | `lib/siteSettings.js` → `init` → `models/SiteSetting.js` `saveMany` |
| `application_requirements` | Missing catalog requirements on open applications | Every boot; additive only (see §3) | `models/ApplicationWorkflow.js` → `syncRequirementsFromCatalog` |

### Starter File Maintenance lists

Inserted on a brand-new database only. Once a table has any row, its list
belongs to File Maintenance and the server never adds, renames or deletes
anything in it.

**Type of Contract** (`dbo.type_of_contract`) — names match the live database:

| name |
|---|
| DIRECT LEASE |
| SHORT TERM LEASE |
| SUBLEASE AGREEMENT |
| MEMORANDUM OF UNDERSTANDING (MOU) |
| MEMORANDUM OF AGREEMENT (MOA) |

**Industry Type** (`dbo.application_types`):

| code | name |
|---|---|
| DIRECT_LEASE | DIRECT LEASE |
| WAREHOUSE_LEASE | WAREHOUSE LEASE |
| SUBLEASE | SUBLEASE |

### ⚠️ Seeds that can still re-create data an admin changed

"If the **name/code** is missing" seeds put back a row that an admin renamed,
because the renamed row no longer matches. This is exactly what would have
duplicated Type of Contract before it was switched to "only if empty".

| Seed | Admin action that triggers a duplicate on next restart |
|---|---|
| `department` | Changing a department's **code** in File Maintenance (code is editable) → the original code is inserted again as a new department. |
| `roles` | Renaming `ACCOUNT OFFICER`, `ASSESSMENT OFFICER` or `VIEWER` in Control Panel → the original role is inserted again. Renaming `proponent` also breaks the locator portal (code looks it up by that name). |

Not affected: `type_of_contract`, `application_types`, the 14 compliance rows
(all "only if empty"), and MAYORS_PERMIT (compliance codes aren't editable).

---

## 2. Manual / one-time scripts (run by a person)

Never run automatically. Each is idempotent (safe to re-run).

| Script | Inserts | Notes |
|---|---|---|
| `sql/001_departments_and_account_officers.sql` | `department` (18 rows by code), `user_roles` (4 legacy officers) | Same as the boot seeds above; optional |
| `sql/002_type_of_contract.sql` | `type_of_contract` (5 rows) | Same as the boot seed: **only if the table is empty** |
| `scripts/create-admin.js <username> <email> ["Full Name"]` | `roles` (`admin` if missing), `users` (+ `user_roles`) | First admin on a fresh DB; refuses if username/email exists |
| `scripts/migrate-legacy-locators.js` | `users` (placeholder accounts), `proponents`, `applications` (one historical record each), `contracts` | Imports from `bridge_import.dbo.dbLocator`; skips RefNos already imported. These applications are inserted directly, **not** via `createApplication`, so they have **no requirement checklist** |
| `scripts/backfill-legacy-profile-fields.js` | `users` (placeholder account-officer logins) | Fills profile fields on imported locators; only rows with `ref_code` still NULL |

---

## 3. Requirement checklist (File Maintenance → Locator → Assessment)

How `application_requirements` is filled — the chain behind "what documents
does this locator need to upload".

**Rule — a requirement applies to an application when all are true:**
1. `requirements.is_active = 1` and `is_ad_hoc = 0`
2. `for_new = 1` (new application) or `for_renewal = 1` (renewal)
3. it has **no** row in `requirement_contract_types`, **or** one whose
   `contract_type_id` = `applications.contract_type_id`

| When | Inserts | Where |
|---|---|---|
| Application filed (staff New Application, Create Locator + Application) | All applicable requirements. A **submitted** application with 0 matches is rejected and rolled back | `ApplicationWorkflow.js` → `createApplication` |
| Contract type / application type / New↔Renewal changed on an application | Checklist rebuilt (non–ad-hoc rows deleted, applicable ones re-inserted). Rejected if a filed application would end with 0 | `updateDraftApplication` |
| Draft submitted | Nothing inserted — rejected if the checklist is empty | `submitApplication` |
| Requirement or category created / edited / reactivated in File Maintenance | Missing applicable requirements added to every **open** application | `controller/c_requirements.js`, `c_requirement_categories.js` → `syncRequirementsFromCatalog` |
| Checklist opened (Locator portal, Assessment, staff) | Same sync, for that one application | `listApplicationRequirements` |
| Server start | Same sync, all open applications | `app.js` |
| Assessment "Request additional requirement" | One `requirements` row (`is_ad_hoc = 1`) + its `application_requirements` row | `addCustomRequirementToApplication` |

**Open application** = status DRAFT, SUBMITTED, RESUBMITTED or RETURNED, and
Assessment hasn't recommended on it (stage not COMPLETED / RETURNED). After
that the checklist is frozen as reviewed.

**Sync is additive only.** Deactivating a requirement, removing a contract-type
tag, or unticking New/Renewal does **not** remove it from applications that
already have it.

**Guard:** saving a requirement with a contract type ID that doesn't exist (or
is inactive) in `type_of_contract` is rejected — `requirement_contract_types`
has no foreign key, so a bad ID would otherwise never match anything.

---

## 4. Inserts from user actions (by module)

Normal app usage — a row is inserted only when someone does the action.

### Locators & accounts
| Table | Action | Where |
|---|---|---|
| `users`, `user_roles` | Create user / locator account; set primary role | `models/User.js` → `createUser`, `setUserPrimaryRole` |
| `proponents` | Create locator / business profile | `models/Proponent.js` → `createProponent` |
| `application_no_counters` | Next locator reference number | `Proponent.js` → `generateLocatorRefNo` |
| `proponent_properties` | Save a locator's properties (replaced as a set) | `Proponent.js` → `replaceProponentProperties` |
| `stockholder`, `contact_person`, `signatory` | Save those tabs (synced as a set) | `Stockholder.js`, `ContactPerson.js`, `Signatory.js` → `syncForProponent` |
| `proponent_financial_terms`, `proponent_investment` | Save financial terms / investment | `FinancialTerms.js`, `Investment.js` → `upsertForProponent` |
| `proponent_documents` | Upload a locator document | `ProponentDocument.js` → `create` |
| `proponent_profile_change_requests` | Locator requests a profile change | `ProponentChangeRequest.js` → `create` |

### Applications & assessment
| Table | Action | Where |
|---|---|---|
| `applications` | File an application | `ApplicationWorkflow.js` → `createApplication` |
| `application_no_counters` | Next APP-/REN- number | `generateApplicationNo` |
| `application_status_history` | Create, submit, status change | `createApplication`, `submitApplication`, `updateApplicationStatus` |
| `application_requirement_comments` | Discuss thread reply | `addRequirementComment` |
| `documents` | Upload a requirement document | `createDocument` |
| `application_assessments` | First time an application is opened in Assessment | `AssessmentEvaluation.js` → `getOrCreateAssessment` |
| `assessment_charges` | Add a charge | `AssessmentEvaluation.js` → `addCharge` |
| `assessment_activity` | Assessment activity log | `AssessmentEvaluation.js` → `logActivity` |

### Approval, contracts, permits
| Table | Action | Where |
|---|---|---|
| `application_approvals` | First time an application reaches Approval | `ApprovalIssuance.js` → `getOrCreateApproval` |
| `approval_steps` | Start the approval chain | `ApprovalIssuance.js` → `startApproval` |
| `approval_activity` | Approval activity log | `ApprovalIssuance.js` → `logActivity` |
| `contracts` | Issue a contract | `Contract.js` → `createContract` |
| `application_no_counters` | Next contract number | `Contract.js` → `generateContractNo` |
| `permits` | Issue a permit | `Permit.js` → `create` |

### Compliance & inspection
| Table | Action | Where |
|---|---|---|
| `inspections` | Schedule an inspection | `ComplianceInspection.js` → `createInspection` |
| `inspection_findings`, `inspection_corrective_actions`, `inspection_documents` | Record findings / actions / documents | `addFinding`, `addCorrectiveAction`, `addDocument` |
| `locator_compliance_items` | Save a locator compliance item | `saveComplianceItem` |
| `inspection_activity` | Inspection activity log | `logActivity` |

### File Maintenance & settings
| Table | Action | Where |
|---|---|---|
| `requirements`, `requirement_contract_types` | Create requirement / set its contract types | `Requirement.js` → `createRequirement`, `setContractTypes` |
| `requirement_categories` | Create category | `RequirementCategory.js` → `createRequirementCategory` |
| `compliance_requirements` | Create compliance requirement | `ComplianceRequirement.js` → `createRequirement` |
| `type_of_contract` | Create type of contract | `TypeOfContract.js` → `createTypeOfContract` |
| `application_types` | Create application type | `ApplicationType.js` → `createApplicationType` |
| `department`, `building`, `land_use` | Create entries | `Department.js`, `Building.js`, `LandUse.js` |
| `roles` | Create role | `Role.js` → `createRole` |
| `role_sidebar_menu_permissions`, `role_menu_crud_permissions`, `role_dashboard_widget_permissions` | Save Control Panel permissions | `ControlPanelPermission.js` |
| `site_settings` | Save Portal Settings | `SiteSetting.js` → `saveMany` |

### Logs & system
| Table | Action | Where |
|---|---|---|
| `audit_logs` | Most create/update/delete actions | `AuditLog.js` → `record` |
| `activity_log` | Locator-facing activity history | `ActivityLog.js` → `record` |
| `notifications` | Status changes, requirement updates, etc. | `Notification.js` → `createNotification` |
| `user_sessions` | Sign-in | `UserSession.js` → `start` |
| `quick_tasks` | Create a quick task | `QuickTask.js` → `create` |
