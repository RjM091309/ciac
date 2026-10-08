const { selectData, insertData, updateData, updateSchema, runInTransaction } = require("../config/database");
const Notification = require("./Notification");
const ApplicationType = require("./ApplicationType");
const Requirement = require("./Requirement");
const Permit = require("./Permit");
const { sendMail } = require("../lib/mailer");
const { escapeHtml } = require("../lib/html");

function toInt(v) {
  // Number(null) is 0, not NaN — without this guard, an explicitly-absent
  // optional FK (e.g. a document with no specific requirement) silently
  // became 0 instead of NULL and violated the foreign key.
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBit(v) {
  return Number(v) ? 1 : 0;
}

// Fixed application lifecycle. Kept as a flat list (rather than a strict
// per-from-status transition table) because staff need to move an
// application backward (e.g. APPROVED -> RETURNED on a later audit finding)
// as well as forward — updateApplicationStatus itself is a bare transition
// with no business-rule gate; the mandatory-document check on the normal
// APPROVED path lives in ApprovalIssuance.settleApproval() instead, so the
// admin-only raw status override (r_applications.js) isn't collaterally
// blocked by it.
const APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "RESUBMITTED",
  "RETURNED",
  "REJECTED",
  // Assessment endorses an application to the Approval & Issuance module by
  // moving it to FOR_APPROVAL; the approving hierarchy then settles it as
  // APPROVED or DISAPPROVED. DISAPPROVED is kept distinct from REJECTED
  // (a pre-assessment screening rejection) for reporting.
  "FOR_APPROVAL",
  "DISAPPROVED",
  "APPROVED",
];

// dbo.application_requirements.status — every comparison against this column
// elsewhere in this file (verified counts, the reupload auto-reset, etc.)
// hardcodes one of these three, so a value outside this set would silently
// never match any of them.
const REQUIREMENT_STATUSES = ["PENDING", "VERIFIED", "REJECTED"];

// Statuses a proponent can submit *from* via submitApplication(), mapped to
// the status that submission produces.
const SUBMIT_TRANSITIONS = {
  DRAFT: "SUBMITTED",
  RETURNED: "RESUBMITTED",
};

function isValidStatus(status) {
  return APPLICATION_STATUSES.includes(String(status || "").toUpperCase());
}

function filingConflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

/** One locator = one application (business rule, see
 * c_users.createLocatorWithApplication). A renewal is only for a Registered
 * Locator (has an Account Officer), one open renewal at a time.
 * `excludeId` skips the application being edited (updateDraft). */
async function assertFilingAllowed(proponentId, isRenewal, { excludeId = null } = {}) {
  if (isRenewal) {
    const prop = await selectData(`SELECT TOP (1) account_officer_id FROM dbo.proponents WHERE id = @param0`, [toInt(proponentId)]);
    if (!prop?.[0]?.account_officer_id) {
      throw filingConflict("Only a Registered Locator (with an Account Officer) can file a renewal.");
    }
    const open = await selectData(
      `
      SELECT TOP (1) application_no FROM dbo.applications
      WHERE proponent_id = @param0 AND ISNULL(is_renewal, 0) = 1
        AND status NOT IN ('APPROVED', 'DISAPPROVED', 'REJECTED')
        AND (@param1 IS NULL OR id <> @param1)
      `,
      [toInt(proponentId), toInt(excludeId)]
    );
    if (open?.[0]) throw filingConflict(`This locator already has a renewal in progress (${open[0].application_no}).`);
    return;
  }
  const rows = await selectData(
    `
    SELECT TOP (1) application_no
    FROM dbo.applications
    WHERE proponent_id = @param0 AND ISNULL(is_renewal, 0) = 0 AND (@param1 IS NULL OR id <> @param1)
    ORDER BY id
    `,
    [toInt(proponentId), toInt(excludeId)]
  );
  if (rows?.[0]) {
    throw filingConflict(
      `This locator already has an application (${rows[0].application_no}). A locator can only have one application.`
    );
  }
}

// File Maintenance-configurable (dbo.application_types, see ApplicationType.js)
// rather than a fixed list — both the create path and the draft-edit path
// validate against whichever codes are currently active there.
async function isValidApplicationType(type) {
  const activeCodes = await ApplicationType.listActiveCodes();
  return activeCodes.includes(String(type || "").trim().toUpperCase());
}


async function createStatusChangeNotifications({ application, toStatus, remarks, changedBy }) {
  try {
    const subject = `Application ${String(application?.application_no || "").trim()} status updated`;
    const bodyBase = `Status changed from ${String(application?.status || "UNKNOWN").trim()} to ${String(toStatus || "").trim()}.`;
    const body = remarks ? `${bodyBase} Remarks: ${String(remarks).trim()}` : bodyBase;
    await Notification.createApplicationScopedNotifications({
      applicationId: application?.id,
      actorId: changedBy,
      eventType: "application_status",
      subject,
      body,
    });
  } catch (error) {
    console.error("Create status-change notifications error:", error);
  }

  // A new application approved by Level 1 BDO waits in the Approved Queue for the
  // Level 1 Account Officer to assign a Level 2 — tell them.
  if (String(toStatus || "").toUpperCase() === "APPROVED" && !Number(application?.is_renewal)) {
    try {
      const officers = await selectData(`
        SELECT DISTINCT u.id
        FROM dbo.users u
        INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
        INNER JOIN dbo.roles r ON r.id = ur.role_id AND r.is_active = 1
        INNER JOIN dbo.role_sidebar_menu_permissions p
          ON p.role_id = r.id AND p.menu_key = 'approval:queue' AND p.is_enabled = 1
        WHERE u.is_active = 1 AND u.assessment_level = 1
          AND LOWER(LTRIM(RTRIM(r.name))) NOT IN ('admin', 'proponent')
          AND NOT EXISTS (
            SELECT 1 FROM dbo.role_sidebar_menu_permissions q
            WHERE q.role_id = r.id AND q.menu_key = 'assessment:queue' AND q.is_enabled = 1
          )
      `);
      const appNo = String(application?.application_no || "").trim();
      const locator = String(application?.proponent_name || "").trim();
      for (const { id } of officers) {
        if (Number(id) === Number(changedBy)) continue;
        await Notification.createNotification({
          userId: id,
          subject: `Ready for Account Officer: ${appNo}`,
          body: `${locator || "A locator"} (${appNo}) was approved and needs a Level 2 Account Officer assigned.`,
          createdBy: changedBy,
          applicationId: application?.id,
          eventType: "approval_ready",
        });
      }
    } catch (error) {
      console.error("Account Officer assignment notification error:", error);
    }
  }

  // FOR_APPROVAL needs no broadcast: the Level 1 BDO approves it themselves
  // ("For Approval" on the Evaluation Queue).

  // The locator's business only has a handful of moments worth emailing
  // about rather than watching the portal for: the application was
  // returned/rejected/disapproved, or it was finally approved (sign-contract
  // follows from there). Everything in between (FOR_APPROVAL,
  // etc.) stays an in-app notification only.
  const DECISION_STATUSES = ["APPROVED", "DISAPPROVED", "RETURNED", "REJECTED"];
  if (DECISION_STATUSES.includes(String(toStatus || "").toUpperCase())) {
    try {
      const locator = await getLocatorContactByProponentId(application?.proponent_id);
      if (locator?.email) {
        const applicationNo = String(application?.application_no || "").trim();
        const statusLabel = String(toStatus || "").trim();
        const trimmedRemarks = String(remarks || "").trim();
        const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
        await sendMail({
          to: locator.email,
          subject: `Business status update: ${applicationNo || "your application"} — ${statusLabel}`,
          text:
            `Hello ${locator.full_name || ""},\n\n` +
            `The status of your business application ${applicationNo} is now: ${statusLabel}.\n\n` +
            (trimmedRemarks ? `Remarks: ${trimmedRemarks}\n\n` : "") +
            `Sign in to the portal for details: ${loginUrl}\n`,
          html:
            `<p>Hello ${escapeHtml(locator.full_name || "")},</p>` +
            `<p>The status of your business application <b>${escapeHtml(applicationNo)}</b> is now: <b>${escapeHtml(statusLabel)}</b>.</p>` +
            (trimmedRemarks ? `<p><b>Remarks:</b> ${escapeHtml(trimmedRemarks)}</p>` : "") +
            `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to the portal</a></p>`,
        });
      }
    } catch (error) {
      console.error("Send business status email error:", error);
    }
  }
}

async function createApplicationCreatedNotifications({
  applicationId,
  applicationNo,
  proponentId,
  isRenewal,
  status,
  createdBy,
}) {
  const entryLabel = Number(isRenewal) ? "Renewal" : "New application";
  const appNo = String(applicationNo || "").trim();
  const currentStatus = String(status || "SUBMITTED").trim();
  try {
    await Notification.createApplicationScopedNotifications({
      applicationId,
      actorId: createdBy,
      eventType: "application_status",
      subject: `${entryLabel} ${appNo} created`,
      body: `${entryLabel} ${appNo} was created with initial status ${currentStatus}.`,
    });
  } catch (error) {
    console.error("Create application notifications error:", error);
  }

  // Staff files this on the locator's behalf, so they may not be watching
  // the portal — email them the same moment the in-app notice above fires
  // (SUBMITTED only; a DRAFT is private until submitted, same as elsewhere
  // in this file).
  try {
    const locator = await getLocatorContactByProponentId(proponentId);
    if (locator?.email) {
      const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
      await sendMail({
        to: locator.email,
        subject: `${entryLabel} filed: ${appNo}`,
        text:
          `Hello ${locator.full_name || ""},\n\n` +
          `${entryLabel} ${appNo} was filed on your behalf and is now ${currentStatus}.\n\n` +
          `Sign in to the portal to track it and upload requirements: ${loginUrl}\n`,
        html:
          `<p>Hello ${escapeHtml(locator.full_name || "")},</p>` +
          `<p>${escapeHtml(entryLabel)} <b>${escapeHtml(appNo)}</b> was filed on your behalf and is now <b>${escapeHtml(currentStatus)}</b>.</p>` +
          `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to the portal</a></p>`,
      });
    }
  } catch (error) {
    console.error("Send application-created email error:", error);
  }
}

// Locator's login email for an application, resolved via its proponent's
// linked user account — used to send a real email alongside the in-app
// notification (e.g. on a rejected requirement), since the locator may not
// be watching the portal in real time.
async function getLocatorContactByProponentId(proponentId) {
  if (!proponentId) return null;
  const rows = await selectData(
    `
    SELECT TOP (1) u.email, u.full_name
    FROM dbo.proponents p
    JOIN dbo.users u ON u.id = p.user_id
    WHERE p.id = @param0 AND u.email IS NOT NULL AND u.email <> ''
    `,
    [proponentId]
  );
  return rows?.[0] || null;
}

async function createRequirementStatusNotifications({
  application,
  applicationRequirementId,
  requirementCode,
  requirementName,
  nextStatus,
  remarks,
  actorId,
}) {
  const requirementLabel = [String(requirementCode || "").trim(), String(requirementName || "").trim()]
    .filter(Boolean)
    .join(" - ");
  const subject = `Requirement updated for ${String(application?.application_no || "").trim()}`;
  const bodyBase = `${requirementLabel || "Requirement"} changed to ${String(nextStatus || "").trim()}.`;
  const body = remarks ? `${bodyBase} Remarks: ${String(remarks).trim()}` : bodyBase;
  try {
    await Notification.createApplicationScopedNotifications({
      applicationId: application?.id,
      actorId,
      eventType: "requirement",
      subject,
      body,
      requirementId: applicationRequirementId,
    });
  } catch (error) {
    console.error("Create requirement notifications error:", error);
  }

  const upperStatus = String(nextStatus || "").toUpperCase();
  if (upperStatus === "REJECTED" || upperStatus === "VERIFIED") {
    try {
      const locator = await getLocatorContactByProponentId(application?.proponent_id);
      if (locator?.email) {
        const applicationNo = String(application?.application_no || "").trim();
        const trimmedRemarks = String(remarks || "").trim();
        const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
        const isRejected = upperStatus === "REJECTED";
        const actionLabel = isRejected ? "rejected" : "verified";
        const callToAction = isRejected ? "review and resubmit" : "review your application";
        await sendMail({
          to: locator.email,
          subject: `Requirement ${actionLabel} for ${applicationNo || "your application"}`,
          text:
            `Hello ${locator.full_name || ""},\n\n` +
            `${requirementLabel || "A requirement"} for application ${applicationNo} was ${actionLabel}.\n\n` +
            (trimmedRemarks ? `Reason: ${trimmedRemarks}\n\n` : "") +
            `Please sign in to the portal to ${callToAction}: ${loginUrl}\n`,
          html:
            `<p>Hello ${escapeHtml(locator.full_name || "")},</p>` +
            `<p><b>${escapeHtml(requirementLabel || "A requirement")}</b> for application <b>${escapeHtml(applicationNo)}</b> was ${escapeHtml(actionLabel)}.</p>` +
            (trimmedRemarks
              ? `<p><b>Reason:</b> ${escapeHtml(trimmedRemarks)}</p>`
              : "") +
            `<p>Please sign in to ${escapeHtml(callToAction)}.</p>` +
            `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to the portal</a></p>`,
        });
      }
    } catch (error) {
      console.error("Send requirement status email error:", error);
    }
  }
}

async function createDocumentNotifications({
  application,
  requirementCode,
  requirementName,
  fileName,
  originalFileName,
  actorId,
  reupload = null,
}) {
  try {
    const requirementLabel = [String(requirementCode || "").trim(), String(requirementName || "").trim()]
      .filter(Boolean)
      .join(" - ");
    const documentLabel = String(originalFileName || fileName || "Document").trim();
    const bodySuffix = requirementLabel ? ` for ${requirementLabel}` : "";
    await Notification.createApplicationScopedNotifications({
      applicationId: application?.id,
      actorId,
      eventType: "document",
      subject: reupload
        ? `Document re-uploaded for ${String(application?.application_no || "").trim()}`
        : `Document uploaded for ${String(application?.application_no || "").trim()}`,
      body: reupload
        ? `${documentLabel} was re-uploaded${bodySuffix} after it was rejected — ready for review again.${
            reupload.remarks ? ` Rejection remarks: ${String(reupload.remarks).trim().slice(0, 300)}` : ""
          }`
        : `${documentLabel} was uploaded${bodySuffix}.`,
    });
  } catch (error) {
    console.error("Create document notifications error:", error);
  }
}

// Once per process: the DDL below is idempotent but not free, and
// ensureSchema() is awaited at the top of most queries in this file.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = createSchema().catch((error) => {
      schemaReady = null; // retry on the next call if the DDL failed
      throw error;
    });
  }
  return schemaReady;
}

async function createSchema() {
  // Filing and the catalog sync query requirement_contract_types, which
  // Requirement's schema creates — otherwise only once someone opened the
  // Requirements page, so a fresh database failed until then.
  await Requirement.ensureSchema();
  await updateSchema(`
    IF OBJECT_ID('dbo.applications', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.applications (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proponent_id INT NOT NULL,
        application_no NVARCHAR(100) NOT NULL,
        application_type NVARCHAR(50) NOT NULL,
        is_renewal BIT NOT NULL CONSTRAINT DF_applications_is_renewal DEFAULT (0),
        status NVARCHAR(50) NOT NULL,
        submitted_at DATETIME2(3) NULL,
        current_officer_id INT NULL,
        created_by INT NOT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_applications_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_applications_proponent_id ON dbo.applications(proponent_id);
      CREATE INDEX IX_applications_status ON dbo.applications(status);
      CREATE INDEX IX_applications_application_no ON dbo.applications(application_no);
    END;

    -- Explicit link back to the specific permit/contract this application is
    -- renewing (Renewal Tracking) — nullable, since a renewal can still be
    -- filed free-form with no specific expiring permit selected, and a
    -- first-time filing never has one.
    IF COL_LENGTH('dbo.applications', 'renewed_from_permit_id') IS NULL
    BEGIN
      ALTER TABLE dbo.applications ADD renewed_from_permit_id INT NULL;
      CREATE INDEX IX_applications_renewed_from_permit_id ON dbo.applications(renewed_from_permit_id);
    END;

    -- Type of Contract picked at filing (dbo.type_of_contract) — decides
    -- which requirements get attached (see requirement_contract_types).
    IF COL_LENGTH('dbo.applications', 'contract_type_id') IS NULL
      ALTER TABLE dbo.applications ADD contract_type_id INT NULL;

    IF OBJECT_ID('dbo.application_requirements', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_requirements (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        requirement_id INT NOT NULL,
        status NVARCHAR(50) NOT NULL CONSTRAINT DF_app_req_status DEFAULT ('PENDING'),
        remarks NVARCHAR(1000) NULL,
        created_by INT NOT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_app_req_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_app_req_application_id ON dbo.application_requirements(application_id);
      CREATE INDEX IX_app_req_requirement_id ON dbo.application_requirements(requirement_id);
      CREATE UNIQUE INDEX UX_app_req_app_req ON dbo.application_requirements(application_id, requirement_id);
    END;

    -- Lets a Locator mark a rejection remark as read/addressed without that
    -- being the same thing as re-uploading a document — a lightweight
    -- handshake distinct from the requirement's own status.
    IF COL_LENGTH('dbo.application_requirements', 'acknowledged_at') IS NULL
      ALTER TABLE dbo.application_requirements ADD acknowledged_at DATETIME2(3) NULL;
    IF COL_LENGTH('dbo.application_requirements', 'acknowledged_by') IS NULL
      ALTER TABLE dbo.application_requirements ADD acknowledged_by INT NULL;

    -- Per-requirement two-way thread: the only in-system reply channel
    -- between a Locator and the staff reviewing their documents (previously
    -- the only "communication" was the one-line, one-shot 'remarks' field
    -- on a status change).
    IF OBJECT_ID('dbo.application_requirement_comments', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_requirement_comments (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_requirement_id INT NOT NULL,
        application_id INT NOT NULL,
        author_id INT NOT NULL,
        author_role NVARCHAR(50) NULL,
        message NVARCHAR(2000) NOT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_app_req_comments_created_at DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_app_req_comments_requirement FOREIGN KEY (application_requirement_id)
          REFERENCES dbo.application_requirements(id) ON DELETE CASCADE
      );
      CREATE INDEX IX_app_req_comments_requirement_id ON dbo.application_requirement_comments(application_requirement_id);
      CREATE INDEX IX_app_req_comments_application_id ON dbo.application_requirement_comments(application_id);
    END;

    -- Retrofits ON DELETE CASCADE onto an already-created FK (the table
    -- above shipped without it first) — a requirement rebuilt away by
    -- updateDraftApplication/deleteDraftApplication (see below) must be
    -- able to take its now-orphaned comment thread with it instead of
    -- throwing a raw FK-violation error.
    IF EXISTS (
      SELECT 1 FROM sys.foreign_keys
      WHERE name = 'FK_app_req_comments_requirement' AND delete_referential_action = 0
    )
    BEGIN
      ALTER TABLE dbo.application_requirement_comments DROP CONSTRAINT FK_app_req_comments_requirement;
      ALTER TABLE dbo.application_requirement_comments
        ADD CONSTRAINT FK_app_req_comments_requirement FOREIGN KEY (application_requirement_id)
          REFERENCES dbo.application_requirements(id) ON DELETE CASCADE;
    END;

    IF OBJECT_ID('dbo.documents', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.documents (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        requirement_id INT NULL,
        file_name NVARCHAR(260) NOT NULL,
        original_file_name NVARCHAR(260) NULL,
        storage_path NVARCHAR(1000) NOT NULL,
        content_type NVARCHAR(255) NULL,
        file_size_bytes BIGINT NULL,
        created_by INT NOT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_documents_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_documents_application_id ON dbo.documents(application_id);
      CREATE INDEX IX_documents_requirement_id ON dbo.documents(requirement_id);
    END;

    IF OBJECT_ID('dbo.application_status_history', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_status_history (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        application_id INT NOT NULL,
        from_status NVARCHAR(50) NULL,
        to_status NVARCHAR(50) NOT NULL,
        changed_by INT NOT NULL,
        remarks NVARCHAR(1000) NULL,
        changed_at DATETIME2(3) NOT NULL CONSTRAINT DF_app_status_changed_at DEFAULT (SYSUTCDATETIME())
      );
      CREATE INDEX IX_app_status_history_app_id ON dbo.application_status_history(application_id);
      CREATE INDEX IX_app_status_history_to_status ON dbo.application_status_history(to_status);
    END;

    IF OBJECT_ID('dbo.application_no_counters', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.application_no_counters (
        counter_key NVARCHAR(50) NOT NULL PRIMARY KEY,
        last_value INT NOT NULL CONSTRAINT DF_app_no_counters_last_value DEFAULT (0)
      );
    END;
  `);

  // Reference numbers are now always server-generated (see generateApplicationNo),
  // so enforce uniqueness going forward. Guarded: only adds the index once no
  // duplicate application_no values remain from before that change, so this
  // never fails against existing data on startup.
  await updateSchema(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes WHERE name = 'UX_applications_application_no' AND object_id = OBJECT_ID('dbo.applications')
    )
    BEGIN
      IF NOT EXISTS (
        SELECT application_no FROM dbo.applications GROUP BY application_no HAVING COUNT(*) > 1
      )
      BEGIN
        CREATE UNIQUE INDEX UX_applications_application_no ON dbo.applications(application_no);
      END
    END
  `);
}

/** Server-authoritative reference number: PREFIX-YYYY-00001, incrementing per
 * prefix+year. Generated inside the same transaction as the insert-or-update
 * of its counter row so concurrent filings never race onto the same number. */
async function generateApplicationNo(tx, isRenewal) {
  const prefix = isRenewal ? "REN" : "APP";
  const year = new Date().getFullYear();
  const counterKey = `${prefix}-${year}`;

  const result = await tx.query(
    `
    MERGE dbo.application_no_counters WITH (HOLDLOCK) AS target
    USING (SELECT @param0 AS counter_key) AS src
    ON target.counter_key = src.counter_key
    WHEN MATCHED THEN UPDATE SET last_value = target.last_value + 1
    WHEN NOT MATCHED THEN INSERT (counter_key, last_value) VALUES (src.counter_key, 1)
    OUTPUT INSERTED.last_value;
    `,
    [counterKey]
  );
  const seq = result?.recordset?.[0]?.last_value || 1;
  return `${counterKey}-${String(seq).padStart(5, "0")}`;
}

async function listApplications() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT
      a.id,
      a.proponent_id,
      p.business_name AS proponent_name,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.renewed_from_permit_id,
      a.contract_type_id,
      toc.name AS contract_type_name,
      a.status,
      a.submitted_at,
      a.current_officer_id,
      a.created_by,
      a.updated_by,
      a.created_at,
      a.updated_at,
      (
        SELECT COUNT(1)
        FROM dbo.application_requirements ar
        WHERE ar.application_id = a.id
      ) AS requirements_count
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    LEFT JOIN dbo.type_of_contract toc ON toc.id = a.contract_type_id
    ORDER BY a.id DESC
  `);
  return rows;
}

/** System-wide, same row shape as listApplicationsForOfficer. Used for the
 * admin-only "preview what an Officer/Proponent dashboard looks like" tool. */
async function listAllApplicationsWithProgress() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT
      a.id,
      a.proponent_id,
      p.business_name AS proponent_name,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.status,
      a.submitted_at,
      a.current_officer_id,
      a.created_at,
      a.updated_at,
      (
        SELECT COUNT(1) FROM dbo.application_requirements ar WHERE ar.application_id = a.id
      ) AS requirements_total,
      (
        SELECT COUNT(1) FROM dbo.application_requirements ar
        WHERE ar.application_id = a.id AND ar.status = 'VERIFIED'
      ) AS requirements_verified
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    ORDER BY a.id DESC
  `);
  return rows;
}

/** `applicationIds` (optional) as a SQL IN-list body. Only integers ever make
 * it into the string, so it's safe to inline — a parameter per id would hit
 * MSSQL's 2,100-parameter cap on a large scoped dashboard. */
function applicationIdFilter(column, applicationIds) {
  if (applicationIds == null) return "";
  const ids = [...new Set([...applicationIds].map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  return ids.length ? `AND ${column} IN (${ids.join(",")})` : "AND 1 = 0";
}

/** Requirement completion grouped by requirement category, for the
 * dashboards' "Requirements Overview" widget. System-wide unless
 * `applicationIds` scopes it to one role's applications. */
async function getRequirementCompletionByCategory(applicationIds = null) {
  await ensureSchema();
  const rows = await selectData(`
    SELECT
      ISNULL(rc.name, 'Uncategorized') AS category_name,
      COUNT(1) AS total,
      SUM(CASE WHEN ar.status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified
    FROM dbo.application_requirements ar
    INNER JOIN dbo.requirements r ON r.id = ar.requirement_id
    LEFT JOIN dbo.requirement_categories rc ON rc.id = r.category_id
    WHERE 1 = 1 ${applicationIdFilter("ar.application_id", applicationIds)}
    GROUP BY ISNULL(rc.name, 'Uncategorized')
    ORDER BY total DESC
  `);
  return rows.map((r) => ({
    category_name: r.category_name,
    total: Number(r.total || 0),
    verified: Number(r.verified || 0),
  }));
}

async function getMostActiveProponentId() {
  await ensureSchema();
  const rows = await selectData(`
    SELECT TOP (1) proponent_id
    FROM dbo.applications
    GROUP BY proponent_id
    ORDER BY COUNT(1) DESC
  `);
  return rows?.[0]?.proponent_id ?? null;
}

async function listApplicationsForProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      a.id,
      a.proponent_id,
      p.business_name AS proponent_name,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.status,
      a.submitted_at,
      a.current_officer_id,
      a.created_at,
      a.updated_at,
      (
        SELECT COUNT(1) FROM dbo.application_requirements ar WHERE ar.application_id = a.id
      ) AS requirements_total,
      (
        SELECT COUNT(1) FROM dbo.application_requirements ar
        WHERE ar.application_id = a.id AND ar.status = 'VERIFIED'
      ) AS requirements_verified
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    WHERE a.proponent_id = @param0
    ORDER BY a.id DESC
    `,
    [proponentId]
  );
  return rows;
}

async function listApplicationsForOfficer(officerId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      a.id,
      a.proponent_id,
      p.business_name AS proponent_name,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.status,
      a.submitted_at,
      a.current_officer_id,
      a.created_at,
      a.updated_at,
      (
        SELECT COUNT(1) FROM dbo.application_requirements ar WHERE ar.application_id = a.id
      ) AS requirements_total,
      (
        SELECT COUNT(1) FROM dbo.application_requirements ar
        WHERE ar.application_id = a.id AND ar.status = 'VERIFIED'
      ) AS requirements_verified
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    WHERE a.current_officer_id = @param0
    ORDER BY a.id DESC
    `,
    [officerId]
  );
  return rows;
}

async function getApplicationById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      a.id,
      a.proponent_id,
      p.business_name AS proponent_name,
      a.application_no,
      a.application_type,
      a.is_renewal,
      a.renewed_from_permit_id,
      a.contract_type_id,
      toc.name AS contract_type_name,
      a.status,
      a.submitted_at,
      a.current_officer_id,
      a.created_by,
      a.updated_by,
      a.created_at,
      a.updated_at
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    LEFT JOIN dbo.type_of_contract toc ON toc.id = a.contract_type_id
    WHERE a.id = @param0
    `,
    [id]
  );
  return rows?.[0] || null;
}

/** Validates an optional Type of Contract id for filing — null/'' = none
 * picked; anything else must be an active dbo.type_of_contract row. */
async function resolveContractTypeId(value) {
  if (value === undefined || value === null || value === "") return null;
  const id = toInt(value);
  const rows = id
    ? await selectData(`SELECT TOP (1) id FROM dbo.type_of_contract WHERE id = @param0 AND is_active = 1`, [id])
    : [];
  if (!rows?.[0]) throw new Error("Invalid type of contract.");
  return id;
}

async function createApplication({
  proponent_id,
  application_type,
  is_renewal,
  status = "SUBMITTED",
  submitted_at,
  current_officer_id,
  created_by,
  renewed_from_permit_id,
  contract_type_id,
}) {
  await ensureSchema();
  await Notification.ensureSchema();
  const proponentId = toInt(proponent_id);
  const officerId = toInt(current_officer_id);
  const createdBy = toInt(created_by);
  const renewalBit = toBit(is_renewal);
  const normalizedStatus = isValidStatus(status) ? String(status).toUpperCase() : "SUBMITTED";
  const isDraft = normalizedStatus === "DRAFT";
  if (!(await isValidApplicationType(application_type))) {
    throw new Error("Invalid application type.");
  }
  const normalizedType = String(application_type).trim().toUpperCase();
  const contractTypeId = await resolveContractTypeId(contract_type_id);

  await assertFilingAllowed(proponentId, renewalBit === 1);

  const renewedFromPermitId = toInt(renewed_from_permit_id);
  if (renewedFromPermitId) {
    const permit = await Permit.getById(renewedFromPermitId);
    if (!permit || Number(permit.proponent_id) !== proponentId) {
      throw new Error("The selected permit/contract doesn't belong to this locator.");
    }
  }

  const id = await runInTransaction(async (tx) => {
    // Reference numbers are always minted here, never accepted from the
    // caller — this is what makes BRM-09 (unique, system-issued numbers)
    // actually hold instead of being a client-suggested string.
    const applicationNo = await generateApplicationNo(tx, renewalBit === 1);

    const result = await tx.query(
      `
      INSERT INTO dbo.applications
        (proponent_id, application_no, application_type, is_renewal, status, submitted_at, current_officer_id, created_by, updated_by, created_at, updated_at, renewed_from_permit_id, contract_type_id)
      OUTPUT INSERTED.id
      VALUES
        (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, NULL, SYSUTCDATETIME(), NULL, @param8, @param9)
      `,
      [
        proponentId,
        applicationNo,
        normalizedType,
        renewalBit,
        normalizedStatus,
        isDraft ? null : submitted_at || null,
        officerId,
        createdBy,
        renewedFromPermitId,
        contractTypeId,
      ]
    );
    const newId = result?.recordset?.[0]?.id;

    const seeded = await tx.query(
      `
      INSERT INTO dbo.application_requirements
        (application_id, requirement_id, status, remarks, created_by, updated_by, created_at, updated_at)
      SELECT
        @param0,
        r.id,
        'PENDING',
        NULL,
        @param1,
        NULL,
        SYSUTCDATETIME(),
        NULL
      FROM dbo.requirements r
      WHERE r.is_active = 1
        AND (
          (@param2 = 1 AND r.for_renewal = 1)
          OR
          (@param2 = 0 AND r.for_new = 1)
        )
        AND (
          -- Requirements are restricted by Type of Contract (legacy BRIDGE
          -- rule). No rows in requirement_contract_types = applies to every
          -- contract type; an application with no contract type picked only
          -- gets those unrestricted ones.
          NOT EXISTS (SELECT 1 FROM dbo.requirement_contract_types rct WHERE rct.requirement_id = r.id)
          OR EXISTS (
            SELECT 1 FROM dbo.requirement_contract_types rct
            WHERE rct.requirement_id = r.id AND rct.contract_type_id = @param3
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.application_requirements ar
          WHERE ar.application_id = @param0 AND ar.requirement_id = r.id
        )
      `,
      [newId, createdBy, renewalBit, contractTypeId]
    );

    // A submitted application with an empty checklist leaves the locator
    // nothing to upload and Assessment nothing to verify — almost always a
    // missing Type of Contract or a Requirements catalog with no match for
    // it. Rolls back the whole transaction instead of filing it silently.
    // Drafts are let through since they can still be edited before submit.
    if (!isDraft && Number(seeded?.rowsAffected?.[0] || 0) === 0) {
      throw Object.assign(
        new Error(
          contractTypeId
            ? "No active requirements match this type of contract. Set them up in File Maintenance > Requirements first."
            : "Select a type of contract — no requirements apply to an application without one."
        ),
        { status: 400 }
      );
    }

    await tx.query(
      `
      INSERT INTO dbo.application_status_history
        (application_id, from_status, to_status, changed_by, remarks, changed_at)
      VALUES
        (@param0, NULL, @param1, @param2, @param3, SYSUTCDATETIME())
      `,
      [newId, normalizedStatus, createdBy, isDraft ? "Saved as draft" : "Initial status on create"]
    );

    return newId;
  });

  if (!id) return null;

  const application = await getApplicationById(id);
  // A DRAFT is private to the proponent until submitted — don't fan a
  // "created" notice out to staff. submitApplication() notifies on submit.
  if (!isDraft) {
    await createApplicationCreatedNotifications({
      applicationId: id,
      applicationNo: application?.application_no,
      proponentId: application?.proponent_id,
      isRenewal: renewalBit,
      status: normalizedStatus,
      createdBy,
    });
  }

  return application;
}

/** Moves a DRAFT to SUBMITTED, or a RETURNED application to RESUBMITTED,
 * stamping submitted_at the first time. Rejects any other current status —
 * this is the only path a proponent may use to change their own status. */
async function submitApplication(id, { changed_by }) {
  await ensureSchema();
  await Notification.ensureSchema();
  const application = await getApplicationById(id);
  if (!application) return null;

  const currentStatus = String(application.status || "").toUpperCase();
  const toStatus = SUBMIT_TRANSITIONS[currentStatus];
  if (!toStatus) {
    throw new Error(`Cannot submit an application while it is ${currentStatus}`);
  }

  // BRM — validation of supporting documents: every mandatory requirement
  // must have at least one uploaded document before a RESUBMIT (RETURNED ->
  // RESUBMITTED) goes through — at that point the locator already has
  // portal access (they had to, to get returned in the first place) and is
  // expected to have fixed what was missing/rejected.
  //
  // This deliberately does NOT apply to the first DRAFT -> SUBMITTED
  // handoff: staff files the draft on the locator's behalf before the
  // locator's account is even activated (see submit's caller,
  // activateLocatorIfPending — activation only fires on a successful
  // submit). Requiring documents here would be circular: the locator can't
  // upload anything until they can log in, and they can't log in until
  // this submit succeeds and emails them credentials. That first submit is
  // the hand-off that lets them start, not a "everything's already done"
  // checkpoint.
  if (currentStatus === "RETURNED") {
    const missingRows = await selectData(
      `
      SELECT COUNT(1) AS n
      FROM dbo.application_requirements ar
      INNER JOIN dbo.requirements r ON r.id = ar.requirement_id
      WHERE ar.application_id = @param0
        AND r.is_mandatory = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.documents d
          WHERE d.application_id = ar.application_id AND d.requirement_id = ar.requirement_id
        )
      `,
      [id]
    );
    const missing = Number(missingRows?.[0]?.n || 0);
    if (missing > 0) {
      throw new Error(
        `Upload the required document${missing === 1 ? "" : "s"} for ${missing} mandatory requirement${missing === 1 ? "" : "s"} before resubmitting.`
      );
    }
  }

  // Same empty-checklist guard createApplication applies to a direct submit —
  // a draft can be saved without a type of contract, so this is the first
  // point it's actually enforced for drafts.
  if (currentStatus === "DRAFT") {
    const reqRows = await selectData(
      `SELECT COUNT(1) AS n FROM dbo.application_requirements WHERE application_id = @param0`,
      [id]
    );
    if (Number(reqRows?.[0]?.n || 0) === 0) {
      throw Object.assign(
        new Error(
          application.contract_type_id
            ? "No active requirements match this type of contract. Set them up in File Maintenance > Requirements first."
            : "Select a type of contract before submitting — no requirements apply to an application without one."
        ),
        { status: 400 }
      );
    }
  }

  const changedBy = toInt(changed_by);

  await updateData(
    `
    UPDATE dbo.applications
    SET status = @param1,
        submitted_at = ISNULL(submitted_at, SYSUTCDATETIME()),
        updated_by = @param2,
        updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [id, toStatus, changedBy]
  );

  await insertData(
    `
    INSERT INTO dbo.application_status_history
      (application_id, from_status, to_status, changed_by, remarks, changed_at)
    VALUES
      (@param0, @param1, @param2, @param3, @param4, SYSUTCDATETIME())
    `,
    [id, application.status || null, toStatus, changedBy, currentStatus === "DRAFT" ? "Submitted" : "Resubmitted"]
  );

  await createStatusChangeNotifications({ application, toStatus, remarks: null, changedBy });

  return getApplicationById(id);
}

// Fixing a wrong application_type/is_renewal (a filing mistake) is allowed
// for as long as the application is still somewhere in Assessment — once it
// has an Assessment decision behind it (FOR_APPROVAL onward) or a terminal
// outcome (REJECTED), the type is locked in for good.
const TYPE_EDITABLE_STATUSES = ["DRAFT", "SUBMITTED", "RESUBMITTED", "RETURNED"];

/** Edits application_type/is_renewal — the two fields set at filing time —
 * for as long as the application hasn't moved past Assessment (see
 * TYPE_EDITABLE_STATUSES). Flipping either rebuilds the requirement
 * checklist for the other track, so it's refused once any document is
 * attached (a doc would be orphaned) — remove uploads first. proponent_id
 * is also editable, but DRAFT-only (see the check below) and never
 * triggers a notification/email either way — a draft is unfinished
 * filing, not an event worth telling anyone about yet. */
async function updateDraftApplication(id, { application_type, is_renewal, proponent_id, contract_type_id, changed_by }) {
  await ensureSchema();
  const application = await getApplicationById(id);
  if (!application) return null;
  const currentStatus = String(application.status || "").toUpperCase();
  if (!TYPE_EDITABLE_STATUSES.includes(currentStatus)) {
    throw new Error("This application's type can no longer be edited at its current stage.");
  }

  // Reassigning the locator is only safe while still DRAFT — nothing has
  // been filed/notified yet, so there's no one else's record of "who this
  // application belongs to" to contradict. Once submitted, the locator is
  // locked in the same way application_type/is_renewal stay locked once
  // documents exist.
  let nextProponentId = application.proponent_id;
  if (proponent_id !== undefined && proponent_id !== null) {
    if (currentStatus !== "DRAFT") {
      throw new Error("The locator can only be changed while this application is still a draft.");
    }
    nextProponentId = toInt(proponent_id);
    if (!nextProponentId) throw new Error("Invalid proponent_id.");
  }

  const nextType =
    application_type === undefined || application_type === null
      ? application.application_type
      : String(application_type).trim().toUpperCase();
  if (!(await isValidApplicationType(nextType))) {
    throw new Error("Invalid application type.");
  }

  const currentRenewal = toBit(application.is_renewal);
  const nextRenewal =
    is_renewal === undefined || is_renewal === null ? currentRenewal : toBit(is_renewal);
  const renewalChanged = nextRenewal !== currentRenewal;
  // A requirement can now be restricted to specific application types, so
  // switching types (e.g. Direct Lease -> Sublease) needs the same checklist
  // rebuild as switching New <-> Renewal used to trigger alone.
  const typeChanged = nextType !== String(application.application_type || "").trim().toUpperCase();
  // Requirements follow the Type of Contract, so changing it rebuilds the
  // checklist too (same document guard as the other two).
  const currentContractTypeId = toInt(application.contract_type_id);
  const nextContractTypeId =
    contract_type_id === undefined ? currentContractTypeId : await resolveContractTypeId(contract_type_id);
  const contractTypeChanged = nextContractTypeId !== currentContractTypeId;
  const changedBy = toInt(changed_by);

  if (renewalChanged || nextProponentId !== toInt(application.proponent_id)) {
    await assertFilingAllowed(nextProponentId, nextRenewal === 1, { excludeId: id });
  }

  if (renewalChanged || typeChanged || contractTypeChanged) {
    const docRows = await selectData(
      `SELECT COUNT(1) AS n FROM dbo.documents WHERE application_id = @param0`,
      [id]
    );
    if (Number(docRows?.[0]?.n || 0) > 0) {
      throw new Error("Remove the uploaded documents before switching between New and Renewal, or changing the application type or type of contract.");
    }
  }

  await runInTransaction(async (tx) => {
    await tx.query(
      `
      UPDATE dbo.applications
      SET application_type = @param1, is_renewal = @param2, proponent_id = @param3, updated_by = @param4,
          contract_type_id = @param5, updated_at = SYSUTCDATETIME()
      WHERE id = @param0
      `,
      [id, nextType, nextRenewal, nextProponentId, changedBy, nextContractTypeId]
    );

    if (renewalChanged || typeChanged || contractTypeChanged) {
      // Ad-hoc requirements (is_ad_hoc = 1) are scoped to just this one
      // application and never part of the catalog re-seed below — deleting
      // them here would silently lose a specific request the Assessment
      // Officer made to this locator, with no way to bring it back.
      await tx.query(
        `
        DELETE ar
        FROM dbo.application_requirements ar
        INNER JOIN dbo.requirements r ON r.id = ar.requirement_id
        WHERE ar.application_id = @param0 AND r.is_ad_hoc = 0
        `,
        [id]
      );
      const reseeded = await tx.query(
        `
        INSERT INTO dbo.application_requirements
          (application_id, requirement_id, status, remarks, created_by, updated_by, created_at, updated_at)
        SELECT @param0, r.id, 'PENDING', NULL, @param1, NULL, SYSUTCDATETIME(), NULL
        FROM dbo.requirements r
        WHERE r.is_active = 1
          AND ((@param2 = 1 AND r.for_renewal = 1) OR (@param2 = 0 AND r.for_new = 1))
          AND (
            NOT EXISTS (SELECT 1 FROM dbo.requirement_contract_types rct WHERE rct.requirement_id = r.id)
            OR EXISTS (
              SELECT 1 FROM dbo.requirement_contract_types rct
              WHERE rct.requirement_id = r.id AND rct.contract_type_id = @param3
            )
          )
        `,
        [id, changedBy, nextRenewal, nextContractTypeId]
      );

      // Same empty-checklist guard as createApplication: clearing or switching
      // the type of contract on an already-filed application must not leave
      // it with nothing to upload or verify. Ad-hoc rows survive the rebuild,
      // so they count too. Rolls back the whole edit.
      if (String(application.status || "").toUpperCase() !== "DRAFT") {
        const remaining = await tx.query(
          `SELECT COUNT(1) AS n FROM dbo.application_requirements WHERE application_id = @param0`,
          [id]
        );
        if (Number(remaining?.recordset?.[0]?.n || 0) === 0 && Number(reseeded?.rowsAffected?.[0] || 0) === 0) {
          throw Object.assign(
            new Error(
              nextContractTypeId
                ? "No active requirements match this type of contract. Set them up in File Maintenance > Requirements first."
                : "Select a type of contract — no requirements apply to an application without one."
            ),
            { status: 400 }
          );
        }
      }
    }
  });

  return getApplicationById(id);
}

/** Hard-deletes a DRAFT application plus its checklist and history rows.
 * Refuses once the application has left DRAFT or has documents attached.
 * Returns { deleted: true } or { deleted: false, reason }. */
async function deleteDraftApplication(id) {
  await ensureSchema();
  const application = await getApplicationById(id);
  if (!application) return { deleted: false, reason: "NOT_FOUND" };
  if (String(application.status || "").toUpperCase() !== "DRAFT") {
    return { deleted: false, reason: "NOT_DRAFT" };
  }
  const docRows = await selectData(
    `SELECT COUNT(1) AS n FROM dbo.documents WHERE application_id = @param0`,
    [id]
  );
  if (Number(docRows?.[0]?.n || 0) > 0) {
    return { deleted: false, reason: "HAS_DOCUMENTS" };
  }

  await runInTransaction(async (tx) => {
    await tx.query(`DELETE FROM dbo.application_requirements WHERE application_id = @param0`, [id]);
    await tx.query(`DELETE FROM dbo.application_status_history WHERE application_id = @param0`, [id]);
    // notifications.application_id has no FK, but the "draft created" notice
    // would otherwise dangle — clear it so it doesn't surface a dead link.
    await tx.query(`DELETE FROM dbo.notifications WHERE application_id = @param0`, [id]);
    await tx.query(`DELETE FROM dbo.applications WHERE id = @param0`, [id]);
  });

  return { deleted: true };
}

async function updateApplicationStatus(id, { to_status, remarks, changed_by }) {
  await ensureSchema();
  await Notification.ensureSchema();
  const application = await getApplicationById(id);
  if (!application) return null;

  const toStatus = String(to_status || "").trim().toUpperCase();
  if (!toStatus) {
    throw new Error("to_status is required");
  }
  if (!isValidStatus(toStatus)) {
    throw new Error(`Invalid status "${toStatus}". Must be one of: ${APPLICATION_STATUSES.join(", ")}`);
  }

  // Deliberately no mandatory-requirement gate here — this function is
  // shared by the approval-ladder's settleApproval() AND the raw
  // requireRole("admin") status-override endpoint (see r_applications.js),
  // and that admin escape hatch exists precisely to let someone force a
  // correction through without re-litigating business rules. The mandatory-
  // document check for the normal APPROVED path lives in settleApproval()
  // instead, scoped to only the caller it's meant for.
  const changedBy = toInt(changed_by);

  await updateData(
    `
    UPDATE dbo.applications
    SET status = @param1, updated_by = @param2, updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [id, toStatus, changedBy]
  );

  await insertData(
    `
    INSERT INTO dbo.application_status_history
      (application_id, from_status, to_status, changed_by, remarks, changed_at)
    VALUES
      (@param0, @param1, @param2, @param3, @param4, SYSUTCDATETIME())
    `,
    [id, application.status || null, toStatus, changedBy, remarks ?? null]
  );

  await createStatusChangeNotifications({
    application,
    toStatus,
    remarks,
    changedBy,
  });

  return getApplicationById(id);
}

// Application statuses whose checklist still follows the Requirements catalog.
// Past these (FOR_APPROVAL onward) Assessment has already signed off, so the
// checklist is frozen as reviewed.
const CATALOG_SYNC_STATUSES_SQL = "'DRAFT', 'SUBMITTED', 'RESUBMITTED', 'RETURNED'";

/** Attaches every catalog requirement that applies to an open application
 * but isn't on its checklist yet — e.g. a requirement added or re-tagged in
 * File Maintenance after the locator filed. Strictly additive: never removes
 * or resets a row, so uploads/verifications are untouched. Skips checklists
 * Assessment has already recommended on (same lock as
 * updateApplicationRequirementStatus). `applicationId` null = every open
 * application. Returns the number of rows added. */
async function syncRequirementsFromCatalog({ applicationId = null, actorId = null } = {}) {
  await ensureSchema();
  const appId = toInt(applicationId);
  const result = await updateData(
    `
    INSERT INTO dbo.application_requirements
      (application_id, requirement_id, status, remarks, created_by, updated_by, created_at, updated_at)
    SELECT a.id, r.id, 'PENDING', NULL, COALESCE(@param1, a.created_by, p.user_id), NULL, SYSUTCDATETIME(), NULL
    FROM dbo.applications a
    LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
    JOIN dbo.requirements r
      ON r.is_active = 1
     AND r.is_ad_hoc = 0
     AND ((a.is_renewal = 1 AND r.for_renewal = 1) OR (a.is_renewal = 0 AND r.for_new = 1))
     AND (
       NOT EXISTS (SELECT 1 FROM dbo.requirement_contract_types rct WHERE rct.requirement_id = r.id)
       OR EXISTS (
         SELECT 1 FROM dbo.requirement_contract_types rct
         WHERE rct.requirement_id = r.id AND rct.contract_type_id = a.contract_type_id
       )
     )
    WHERE a.status IN (${CATALOG_SYNC_STATUSES_SQL})
      AND (@param0 IS NULL OR a.id = @param0)
      AND COALESCE(@param1, a.created_by, p.user_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dbo.application_assessments asm
        WHERE asm.application_id = a.id AND UPPER(asm.stage) IN ('COMPLETED', 'RETURNED')
      )
      AND NOT EXISTS (
        SELECT 1 FROM dbo.application_requirements ar
        WHERE ar.application_id = a.id AND ar.requirement_id = r.id
      )
    `,
    [appId, toInt(actorId)]
  );
  return Number(result?.rowsAffected?.[0] || 0);
}

async function listApplicationRequirements(applicationId) {
  await ensureSchema();
  // Reading a checklist (Locator portal, Assessment, staff) first pulls in
  // anything the catalog gained since filing, so every screen downstream of
  // File Maintenance sees the same, current list. Never blocks the read.
  try {
    await syncRequirementsFromCatalog({ applicationId });
  } catch (error) {
    console.error("Sync requirements from catalog error:", error);
  }
  const rows = await selectData(
    `
    SELECT
      ar.id,
      ar.application_id,
      ar.requirement_id,
      ar.status,
      ar.remarks,
      ar.created_by,
      ar.updated_by,
      ar.created_at,
      ar.updated_at,
      r.code AS requirement_code,
      r.name AS requirement_name,
      r.description AS requirement_description,
      r.is_mandatory,
      r.category_id,
      rc.name AS category_name
    FROM dbo.application_requirements ar
    INNER JOIN dbo.requirements r ON r.id = ar.requirement_id
    LEFT JOIN dbo.requirement_categories rc ON rc.id = r.category_id
    WHERE ar.application_id = @param0
    ORDER BY ar.id ASC
    `,
    [applicationId]
  );
  return rows;
}

async function updateApplicationRequirementStatus(id, { status, remarks, updated_by }) {
  const nextStatus = String(status || "").trim().toUpperCase();
  if (!REQUIREMENT_STATUSES.includes(nextStatus)) {
    throw Object.assign(
      new Error(`Invalid requirement status "${status}" — must be one of ${REQUIREMENT_STATUSES.join(", ")}.`),
      { status: 400 }
    );
  }
  // Nothing to verify or reject until the locator has uploaded a file.
  if (nextStatus === "VERIFIED" || nextStatus === "REJECTED") {
    const uploaded = await selectData(
      `SELECT TOP (1) 1 AS ok
       FROM dbo.application_requirements ar
       INNER JOIN dbo.documents d ON d.application_id = ar.application_id AND d.requirement_id = ar.requirement_id
       WHERE ar.id = @param0`,
      [toInt(id)]
    );
    if (!uploaded.length) {
      throw Object.assign(new Error("No document uploaded yet — nothing to verify or reject."), { status: 400 });
    }
  }

  await ensureSchema();
  await Notification.ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      ar.id,
      ar.application_id,
      ar.requirement_id,
      r.code AS requirement_code,
      r.name AS requirement_name
    FROM dbo.application_requirements ar
    LEFT JOIN dbo.requirements r ON r.id = ar.requirement_id
    WHERE ar.id = @param0
    `,
    [id]
  );
  const row = rows?.[0];
  if (!row) return null;

  // Once the assessment has been recommended on (ENDORSE/RETURN/DISAPPROVE),
  // requirement verification shouldn't keep moving underneath an
  // already-submitted recommendation — an admin Reopen is required first.
  const assessmentRows = await selectData(
    `SELECT TOP (1) stage FROM dbo.application_assessments WHERE application_id = @param0`,
    [row.application_id]
  );
  const assessmentStage = String(assessmentRows?.[0]?.stage || "").toUpperCase();
  if (assessmentStage === "COMPLETED" || assessmentStage === "RETURNED") {
    throw Object.assign(
      new Error("This application's assessment has already been recommended on. An admin must reopen it before requirements can change."),
      { status: 400 }
    );
  }

  await updateData(
    `
    UPDATE dbo.application_requirements
    SET
      status = @param1,
      remarks = @param2,
      updated_by = @param3,
      updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [id, nextStatus, remarks ?? null, toInt(updated_by)]
  );

  const updatedRows = await selectData(
    `
    SELECT TOP (1)
      ar.id,
      ar.application_id,
      ar.requirement_id,
      ar.status,
      ar.remarks,
      ar.created_by,
      ar.updated_by,
      ar.created_at,
      ar.updated_at
    FROM dbo.application_requirements ar
    WHERE ar.id = @param0
    `,
    [id]
  );
  const updated = updatedRows?.[0] || null;
  if (updated) {
    const application = await getApplicationById(row.application_id);
    await createRequirementStatusNotifications({
      application,
      applicationRequirementId: row.id,
      requirementCode: row.requirement_code,
      requirementName: row.requirement_name,
      nextStatus,
      remarks,
      actorId: updated_by,
    });

    const requirementLabel = [String(row.requirement_code || "").trim(), String(row.requirement_name || "").trim()]
      .filter(Boolean)
      .join(" - ") || `Requirement #${row.id}`;
    const upperStatus = nextStatus;
    try {
      // Lazy require: AssessmentEvaluation.js requires this module at the
      // top, so requiring it back at module-load time would be circular.
      const Assessment = require("./AssessmentEvaluation");
      await Assessment.logRequirementActivity(row.application_id, {
        action: upperStatus === "VERIFIED" ? "REQUIREMENT_VERIFIED" : upperStatus === "REJECTED" ? "REQUIREMENT_REJECTED" : "REQUIREMENT_STATUS_CHANGED",
        detail: remarks ? `${requirementLabel} — ${String(remarks).trim()}` : requirementLabel,
        actorId: updated_by,
      });
    } catch (error) {
      console.error("Log requirement activity error:", error);
    }
  }
  return updated;
}

/** Evaluator's per-document note — updates only the remarks, leaving the
 * status (and its notifications) alone. Same "already recommended on" lock
 * as updateApplicationRequirementStatus. */
async function updateApplicationRequirementRemarks(id, { remarks, updated_by }) {
  await ensureSchema();
  const row = await getApplicationRequirementById(id);
  if (!row) return null;

  const assessmentRows = await selectData(
    `SELECT TOP (1) stage FROM dbo.application_assessments WHERE application_id = @param0`,
    [row.application_id]
  );
  const assessmentStage = String(assessmentRows?.[0]?.stage || "").toUpperCase();
  if (assessmentStage === "COMPLETED" || assessmentStage === "RETURNED") {
    throw Object.assign(
      new Error("This application's assessment has already been recommended on. An admin must reopen it before remarks can change."),
      { status: 400 }
    );
  }

  const nextRemarks = remarks == null ? null : String(remarks).trim() || null;
  await updateData(
    `
    UPDATE dbo.application_requirements
    SET
      remarks = @param1,
      updated_by = @param2,
      updated_at = SYSUTCDATETIME()
    WHERE id = @param0
    `,
    [id, nextRemarks, toInt(updated_by)]
  );

  const requirementLabel = [String(row.requirement_code || "").trim(), String(row.requirement_name || "").trim()]
    .filter(Boolean)
    .join(" - ") || `Requirement #${row.id}`;
  try {
    const Assessment = require("./AssessmentEvaluation");
    await Assessment.logRequirementActivity(row.application_id, {
      action: "REQUIREMENT_REMARKS_UPDATED",
      detail: nextRemarks ? `${requirementLabel} — ${nextRemarks}` : `${requirementLabel} — remarks cleared`,
      actorId: updated_by,
    });
  } catch (error) {
    console.error("Log requirement activity error:", error);
  }

  return getApplicationRequirementById(id);
}

/** Bare row lookup used by the comments/acknowledge endpoints to resolve
 * which application a requirement belongs to (for the access check) without
 * pulling in the full requirement-catalog join listApplicationRequirements
 * does. */
async function getApplicationRequirementById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      ar.id,
      ar.application_id,
      ar.requirement_id,
      ar.status,
      ar.remarks,
      ar.acknowledged_at,
      ar.acknowledged_by,
      r.code AS requirement_code,
      r.name AS requirement_name
    FROM dbo.application_requirements ar
    LEFT JOIN dbo.requirements r ON r.id = ar.requirement_id
    WHERE ar.id = @param0
    `,
    [id]
  );
  return rows?.[0] || null;
}

async function listRequirementComments(applicationRequirementId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      c.id,
      c.application_requirement_id,
      c.application_id,
      c.author_id,
      c.author_role,
      c.message,
      c.created_at,
      u.full_name AS author_name,
      u.username AS author_username
    FROM dbo.application_requirement_comments c
    LEFT JOIN dbo.users u ON u.id = c.author_id
    WHERE c.application_requirement_id = @param0
    ORDER BY c.id ASC
    `,
    [applicationRequirementId]
  );
  return rows;
}

/** Posts a reply on a requirement's thread and notifies whichever side
 * didn't write it — a Locator's reply pings staff (same menu-permission
 * fan-out as any other requirement event), a staff reply pings the Locator
 * in-app AND by email, since they may not be watching the portal. */
async function addRequirementComment({ applicationRequirementId, authorId, authorRole, message }) {
  const trimmed = String(message || "").trim();
  if (!trimmed) throw new Error("message is required");

  const requirement = await getApplicationRequirementById(applicationRequirementId);
  if (!requirement) return null;

  await insertData(
    `
    INSERT INTO dbo.application_requirement_comments
      (application_requirement_id, application_id, author_id, author_role, message, created_at)
    VALUES
      (@param0, @param1, @param2, @param3, @param4, SYSUTCDATETIME())
    `,
    [applicationRequirementId, requirement.application_id, toInt(authorId), authorRole ? String(authorRole).slice(0, 50) : null, trimmed]
  );

  const application = await getApplicationById(requirement.application_id);
  const requirementLabel = [String(requirement.requirement_code || "").trim(), String(requirement.requirement_name || "").trim()]
    .filter(Boolean)
    .join(" - ");
  const applicationNo = String(application?.application_no || "").trim();
  const isProponentAuthor = String(authorRole || "").toLowerCase() === "proponent";

  try {
    await Notification.createApplicationScopedNotifications({
      applicationId: requirement.application_id,
      actorId: authorId,
      eventType: "requirement",
      subject: `New reply on ${requirementLabel || "a requirement"} for ${applicationNo}`,
      body: trimmed,
      requirementId: applicationRequirementId,
    });
  } catch (error) {
    console.error("Create requirement comment notification error:", error);
  }

  if (isProponentAuthor) {
    // Staff already got the in-app notice above (they hold the relevant
    // menu permission); nothing further to send by email for a locator's
    // own reply.
    return true;
  }

  try {
    const locator = await getLocatorContactByProponentId(application?.proponent_id);
    if (locator?.email) {
      const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
      await sendMail({
        to: locator.email,
        subject: `New reply on ${requirementLabel || "a requirement"} for ${applicationNo || "your application"}`,
        text:
          `Hello ${locator.full_name || ""},\n\n` +
          `${requirementLabel || "A requirement"} for application ${applicationNo} has a new reply:\n\n"${trimmed}"\n\n` +
          `Sign in to the portal to view and reply: ${loginUrl}\n`,
        html:
          `<p>Hello ${escapeHtml(locator.full_name || "")},</p>` +
          `<p><b>${escapeHtml(requirementLabel || "A requirement")}</b> for application <b>${escapeHtml(applicationNo)}</b> has a new reply:</p>` +
          `<blockquote>${escapeHtml(trimmed)}</blockquote>` +
          `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to reply</a></p>`,
      });
    }
  } catch (error) {
    console.error("Send requirement comment email error:", error);
  }

  return true;
}

/** Locator-only handshake: marks a requirement's current remarks as
 * seen/addressed. Distinct from re-uploading a document — a Locator may
 * want to acknowledge a REJECTED reason (e.g. "will comply on renewal")
 * without necessarily having a new file to attach yet. */
async function acknowledgeRequirement(applicationRequirementId, { acknowledgedBy }) {
  await ensureSchema();
  const requirement = await getApplicationRequirementById(applicationRequirementId);
  if (!requirement) return null;

  await updateData(
    `
    UPDATE dbo.application_requirements
    SET acknowledged_at = SYSUTCDATETIME(), acknowledged_by = @param1
    WHERE id = @param0
    `,
    [applicationRequirementId, toInt(acknowledgedBy)]
  );

  return getApplicationRequirementById(applicationRequirementId);
}

/** Attaches a one-off ask to THIS application only — the normal checklist
 * is rebuilt wholesale from the shared `requirements` catalog (see
 * createApplication/updateDraftApplication), which has no room for
 * "please also submit X" scoped to a single applicant. Modeled instead as a
 * catalog row with for_new/for_renewal both 0 (so the bulk auto-seed never
 * pulls it into any OTHER application) and is_ad_hoc = 1 (so it's filtered
 * out of the shared Requirements file-maintenance screen). */
async function addCustomRequirementToApplication({ applicationId, name, description, isMandatory, createdBy }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("name is required");

  const application = await getApplicationById(applicationId);
  if (!application) return null;

  // Same "already recommended on" lock as updateApplicationRequirementStatus —
  // no new requirements should attach to a checklist Assessment has already
  // signed off on.
  const assessmentRows = await selectData(
    `SELECT TOP (1) stage FROM dbo.application_assessments WHERE application_id = @param0`,
    [applicationId]
  );
  const assessmentStage = String(assessmentRows?.[0]?.stage || "").toUpperCase();
  if (assessmentStage === "COMPLETED" || assessmentStage === "RETURNED") {
    throw Object.assign(
      new Error("This application's assessment has already been recommended on. An admin must reopen it before adding requirements."),
      { status: 400 }
    );
  }

  const code = `ADHOC-${applicationId}-${Date.now()}`;
  const catalogRequirement = await Requirement.createRequirement({
    code,
    name: trimmedName,
    description: description ?? null,
    category_id: null,
    for_new: 0,
    for_renewal: 0,
    is_mandatory: isMandatory ? 1 : 0,
    is_active: 1,
    created_by: createdBy,
  });
  await Requirement.markAdHoc(catalogRequirement.id);

  const result = await insertData(
    `
    INSERT INTO dbo.application_requirements
      (application_id, requirement_id, status, remarks, created_by, updated_by, created_at, updated_at)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, 'PENDING', NULL, @param2, NULL, SYSUTCDATETIME(), NULL)
    `,
    [applicationId, catalogRequirement.id, toInt(createdBy)]
  );
  const newRowId = result?.recordset?.[0]?.id;

  try {
    await Notification.createApplicationScopedNotifications({
      applicationId,
      actorId: createdBy,
      eventType: "requirement",
      subject: `New requirement requested for ${String(application.application_no || "").trim()}`,
      body: `${trimmedName} was added to your requirement checklist and is now pending.`,
      requirementId: newRowId,
    });
  } catch (error) {
    console.error("Create ad-hoc requirement notification error:", error);
  }

  try {
    const locator = await getLocatorContactByProponentId(application.proponent_id);
    if (locator?.email) {
      const applicationNo = String(application.application_no || "").trim();
      const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
      await sendMail({
        to: locator.email,
        subject: `New requirement requested for ${applicationNo || "your application"}`,
        text:
          `Hello ${locator.full_name || ""},\n\n` +
          `A new requirement was requested for application ${applicationNo}: ${trimmedName}` +
          (description ? ` — ${String(description).trim()}` : "") +
          `\n\nSign in to the portal to upload it: ${loginUrl}\n`,
        html:
          `<p>Hello ${escapeHtml(locator.full_name || "")},</p>` +
          `<p>A new requirement was requested for application <b>${escapeHtml(applicationNo)}</b>:</p>` +
          `<p><b>${escapeHtml(trimmedName)}</b>${description ? ` — ${escapeHtml(String(description).trim())}` : ""}</p>` +
          `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to the portal</a></p>`,
      });
    }
  } catch (error) {
    console.error("Send ad-hoc requirement email error:", error);
  }

  return getApplicationRequirementById(newRowId);
}

/** Every requirement across all of one locator's (non-draft) applications,
 * with its Assessment status and latest uploaded document — the read-only
 * "Documents" tab on the Locator Information panel. Status/remarks are the
 * same application_requirements columns the Assessment Officer sets. */
async function listRequirementDocumentsByProponent(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      ar.id,
      ar.application_id,
      ar.requirement_id,
      ar.status,
      ar.remarks,
      ar.updated_at,
      r.code AS requirement_code,
      r.name AS requirement_name,
      r.is_mandatory,
      r.category_id,
      rc.name AS category_name,
      a.application_no,
      a.application_type,
      ISNULL(at.name, a.application_type) AS application_type_name,
      a.is_renewal,
      a.status AS application_status,
      a.created_at AS application_created_at,
      u.full_name AS reviewed_by_name,
      d.id AS document_id,
      d.original_file_name,
      d.file_name,
      d.created_at AS uploaded_at,
      d.version AS document_version
    FROM dbo.application_requirements ar
    INNER JOIN dbo.applications a ON a.id = ar.application_id
    LEFT JOIN dbo.application_types at ON at.code = a.application_type
    INNER JOIN dbo.requirements r ON r.id = ar.requirement_id
    LEFT JOIN dbo.requirement_categories rc ON rc.id = r.category_id
    LEFT JOIN dbo.users u ON u.id = ar.updated_by
    OUTER APPLY (
      SELECT TOP (1) x.id, x.original_file_name, x.file_name, x.created_at,
        (SELECT COUNT(1) FROM dbo.documents c
         WHERE c.application_id = ar.application_id AND c.requirement_id = ar.requirement_id) AS version
      FROM dbo.documents x
      WHERE x.application_id = ar.application_id AND x.requirement_id = ar.requirement_id
      ORDER BY x.id DESC
    ) d
    WHERE a.proponent_id = @param0 AND a.status <> 'DRAFT'
    ORDER BY a.id DESC, ar.id ASC
    `,
    [proponentId]
  );
  return rows;
}

async function listDocumentsByApplication(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      d.id,
      d.application_id,
      d.requirement_id,
      d.file_name,
      d.original_file_name,
      d.storage_path,
      d.content_type,
      d.file_size_bytes,
      d.created_by,
      d.updated_by,
      d.created_at,
      d.updated_at,
      r.code AS requirement_code,
      r.name AS requirement_name,
      -- V1 = first ever upload for this requirement, V2 = the reupload after
      -- a rejection, and so on — partitioned per requirement_id (not per
      -- application) since a locator reuploads one requirement at a time,
      -- and shared by every caller of this function (proponent portal,
      -- Assessment, Approval) so the version label is consistent everywhere
      -- a document shows up.
      ROW_NUMBER() OVER (PARTITION BY d.requirement_id ORDER BY d.id ASC) AS version
    FROM dbo.documents d
    LEFT JOIN dbo.requirements r ON r.id = d.requirement_id
    WHERE d.application_id = @param0
    ORDER BY d.id DESC
    `,
    [applicationId]
  );
  return rows;
}

async function getDocumentById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      d.id,
      d.application_id,
      d.requirement_id,
      d.file_name,
      d.original_file_name,
      d.storage_path,
      d.content_type,
      d.file_size_bytes,
      d.created_by,
      d.created_at,
      a.proponent_id
    FROM dbo.documents d
    LEFT JOIN dbo.applications a ON a.id = d.application_id
    WHERE d.id = @param0
    `,
    [toInt(id)]
  );
  return rows?.[0] || null;
}

async function createDocument({
  application_id,
  requirement_id,
  file_name,
  original_file_name,
  storage_path,
  content_type,
  file_size_bytes,
  created_by,
}) {
  await ensureSchema();
  await Notification.ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.documents
      (application_id, requirement_id, file_name, original_file_name, storage_path, content_type, file_size_bytes, created_by, updated_by, created_at, updated_at)
    OUTPUT INSERTED.id
    VALUES
      (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, NULL, SYSUTCDATETIME(), NULL)
    `,
    [
      toInt(application_id),
      toInt(requirement_id),
      String(file_name || "").trim(),
      original_file_name ?? null,
      String(storage_path || "").trim(),
      content_type ?? null,
      toInt(file_size_bytes),
      toInt(created_by),
    ]
  );
  const id = result?.recordset?.[0]?.id;

  // A reupload against a previously REJECTED requirement is a new submission
  // that needs review again — otherwise it stays REJECTED until an officer
  // happens to revisit it, even though a fresh document is now sitting there
  // unreviewed. Only REJECTED resets; VERIFIED never reaches here since the
  // proponent UI disables reupload once a requirement is VERIFIED.
  // Remembered so the notification can say it's a reupload, and why the
  // previous one was rejected.
  let reupload = null;
  if (toInt(requirement_id)) {
    const rejected = await selectData(
      `SELECT TOP (1) remarks FROM dbo.application_requirements
       WHERE application_id = @param0 AND requirement_id = @param1 AND status = 'REJECTED'`,
      [toInt(application_id), toInt(requirement_id)]
    );
    const reset = await updateData(
      `
      UPDATE dbo.application_requirements
      SET status = 'PENDING', updated_at = SYSUTCDATETIME()
      WHERE application_id = @param0 AND requirement_id = @param1 AND status = 'REJECTED'
      `,
      [toInt(application_id), toInt(requirement_id)]
    );
    if (reset?.rowsAffected?.[0]) reupload = { remarks: rejected?.[0]?.remarks ?? null };
  }

  const rows = await selectData(
    `
    SELECT TOP (1)
      d.*,
      r.code AS requirement_code,
      r.name AS requirement_name
    FROM dbo.documents d
    LEFT JOIN dbo.requirements r ON r.id = d.requirement_id
    WHERE d.id = @param0
    `,
    [id]
  );
  const document = rows?.[0] || null;
  if (document) {
    const application = await getApplicationById(application_id);
    await createDocumentNotifications({
      application,
      requirementCode: document.requirement_code,
      requirementName: document.requirement_name,
      fileName: document.file_name,
      originalFileName: document.original_file_name,
      actorId: created_by,
      reupload,
    });
  }
  return document;
}

// Statuses that end an application — a DISAPPROVED application is decided,
// not still open.
const FINAL_STATUSES_SQL = "'APPROVED', 'REJECTED', 'DISAPPROVED'";

/** End-to-end turnaround: SUBMITTED (or RESUBMITTED, whichever came last
 * before the terminal decision) -> APPROVED/REJECTED/DISAPPROVED, in days.
 * Also reports how many open applications are still in flight and how long
 * the oldest one has been waiting, for the dashboard's processing-performance
 * widget. `applicationIds` (optional) scopes it to one role's applications. */
async function getApplicationTurnaroundStats(applicationIds = null) {
  await ensureSchema();
  const completedRows = await selectData(`
    SELECT
      h.application_id,
      h.to_status,
      h.changed_at,
      ROW_NUMBER() OVER (PARTITION BY h.application_id ORDER BY h.id ASC) AS rn_asc,
      ROW_NUMBER() OVER (PARTITION BY h.application_id ORDER BY h.id DESC) AS rn_desc
    FROM dbo.application_status_history h
    WHERE h.application_id IN (
      SELECT application_id FROM dbo.application_status_history WHERE to_status IN (${FINAL_STATUSES_SQL})
    ) ${applicationIdFilter("h.application_id", applicationIds)}
  `);

  const byApp = new Map();
  for (const row of completedRows) {
    if (!byApp.has(row.application_id)) byApp.set(row.application_id, { first: null, last: null });
    const bucket = byApp.get(row.application_id);
    if (row.rn_asc === 1) bucket.first = row.changed_at;
    if (row.rn_desc === 1) bucket.last = row.changed_at;
  }

  const durationsDays = [];
  for (const { first, last } of byApp.values()) {
    if (!first || !last) continue;
    const ms = new Date(last).getTime() - new Date(first).getTime();
    if (Number.isFinite(ms) && ms >= 0) durationsDays.push(ms / (1000 * 60 * 60 * 24));
  }
  const avgTurnaroundDays = durationsDays.length
    ? Math.round((durationsDays.reduce((a, b) => a + b, 0) / durationsDays.length) * 10) / 10
    : null;

  const openRows = await selectData(`
    SELECT id, created_at
    FROM dbo.applications
    WHERE status NOT IN ('DRAFT', ${FINAL_STATUSES_SQL}) ${applicationIdFilter("id", applicationIds)}
  `);
  const now = Date.now();
  const openAges = openRows
    .map((r) => (r.created_at ? (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24) : null))
    .filter((v) => v != null && Number.isFinite(v));
  const avgOpenAgeDays = openAges.length
    ? Math.round((openAges.reduce((a, b) => a + b, 0) / openAges.length) * 10) / 10
    : null;
  const oldestOpenDays = openAges.length ? Math.round(Math.max(...openAges) * 10) / 10 : null;

  return {
    avgTurnaroundDays,
    completedCount: durationsDays.length,
    openCount: openRows.length,
    avgOpenAgeDays,
    oldestOpenDays,
  };
}

async function listApplicationStatusHistory(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      h.id,
      h.application_id,
      h.from_status,
      h.to_status,
      h.changed_by,
      h.remarks,
      h.changed_at
    FROM dbo.application_status_history h
    WHERE h.application_id = @param0
    ORDER BY h.id DESC
    `,
    [applicationId]
  );
  return rows;
}

/** The locator's latest APPROVED application (new or renewal) — what a
 * renewal from Permits copies its industry type / type of contract from. */
async function getLatestApprovedApplication(proponentId) {
  await ensureSchema();
  const rows = await selectData(
    `SELECT TOP (1) id, application_type, contract_type_id FROM dbo.applications
     WHERE proponent_id = @param0 AND status = 'APPROVED' ORDER BY id DESC`,
    [toInt(proponentId)]
  );
  return rows?.[0] || null;
}

module.exports = {
  getLatestApprovedApplication,
  APPLICATION_STATUSES,
  isValidApplicationType,
  ensureSchema,
  listApplications,
  listAllApplicationsWithProgress,
  getRequirementCompletionByCategory,
  getMostActiveProponentId,
  listApplicationsForProponent,
  listApplicationsForOfficer,
  getApplicationById,
  createApplication,
  submitApplication,
  updateDraftApplication,
  deleteDraftApplication,
  updateApplicationStatus,
  listApplicationRequirements,
  syncRequirementsFromCatalog,
  updateApplicationRequirementStatus,
  updateApplicationRequirementRemarks,
  getApplicationRequirementById,
  listRequirementComments,
  addRequirementComment,
  acknowledgeRequirement,
  addCustomRequirementToApplication,
  listDocumentsByApplication,
  listRequirementDocumentsByProponent,
  getDocumentById,
  createDocument,
  listApplicationStatusHistory,
  getApplicationTurnaroundStats,
};
