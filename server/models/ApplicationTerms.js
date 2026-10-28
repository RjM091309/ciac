const { selectData, updateData, updateSchema } = require("../config/database");
const Notification = require("./Notification");
const { sendMail } = require("../lib/mailer");
const { escapeHtml } = require("../lib/html");
const { emailStaffInBackground } = require("../lib/staffEmail");
const { getters: site } = require("../lib/siteSettings");
const { partyWord } = require("../lib/party");

// Terms and conditions negotiated for an application, before its contract.
// The Level 2 evaluator (BDO for a new application, Account Officer for a
// renewal) writes them and sends them to the locator, who agrees in the
// portal or asks for changes. Only agreed terms let Level 2 make the contract.
//
//   DRAFT              written, not sent yet (the locator can't see it)
//   SENT               waiting for the locator
//   CHANGES_REQUESTED  the locator asked for changes (their remarks)
//   AGREED             the locator agreed to this version
//
// One row per application; each send bumps `version`. Editing sent or agreed
// terms puts them back to DRAFT (they must be sent and agreed again), and
// they're locked once the contract is recorded.

const STATUSES = ["DRAFT", "SENT", "CHANGES_REQUESTED", "AGREED"];

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function clientError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF OBJECT_ID('dbo.application_terms', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.application_terms (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          application_id INT NOT NULL,
          body NVARCHAR(MAX) NOT NULL,
          status NVARCHAR(20) NOT NULL CONSTRAINT DF_application_terms_status DEFAULT ('DRAFT'),
          version INT NOT NULL CONSTRAINT DF_application_terms_version DEFAULT (0),
          sent_at DATETIME2(3) NULL,
          sent_by INT NULL,
          responded_at DATETIME2(3) NULL,
          responded_by INT NULL,
          locator_remarks NVARCHAR(2000) NULL,
          created_by INT NULL,
          created_at DATETIME2(3) NOT NULL CONSTRAINT DF_application_terms_created_at DEFAULT (SYSUTCDATETIME()),
          updated_by INT NULL,
          updated_at DATETIME2(3) NULL,
          CONSTRAINT FK_application_terms_application FOREIGN KEY (application_id)
            REFERENCES dbo.applications(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX UX_application_terms_application ON dbo.application_terms(application_id);
      END
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function getForApplication(applicationId) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT t.*, su.full_name AS sent_by_name, ru.full_name AS responded_by_name
    FROM dbo.application_terms t
    LEFT JOIN dbo.users su ON su.id = t.sent_by
    LEFT JOIN dbo.users ru ON ru.id = t.responded_by
    WHERE t.application_id = @param0
    `,
    [toInt(applicationId)]
  );
  return rows?.[0] || null;
}

async function hasContract(applicationId) {
  const rows = await selectData(`SELECT TOP (1) id FROM dbo.contracts WHERE application_id = @param0`, [toInt(applicationId)]);
  return Boolean(rows?.[0]);
}

async function appContext(applicationId) {
  const rows = await selectData(
    `
    SELECT TOP (1) a.id, a.application_no, a.is_renewal, a.proponent_id, p.business_name, p.user_id AS locator_user_id,
           NULLIF(lu.email, '') AS locator_email, lu.full_name AS locator_name,
           asm.assigned_evaluator_id
    FROM dbo.applications a
    INNER JOIN dbo.proponents p ON p.id = a.proponent_id
    LEFT JOIN dbo.users lu ON lu.id = p.user_id
    LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
    WHERE a.id = @param0
    `,
    [toInt(applicationId)]
  );
  return rows?.[0] || null;
}

async function logActivity(applicationId, action, detail, actorId) {
  // Lazy: AssessmentEvaluation requires models that require this one.
  await require("./AssessmentEvaluation").logRequirementActivity(applicationId, { action, detail, actorId });
}

/** Level 2 writes (or rewrites) the terms. Back to DRAFT if they were sent. */
async function saveDraft(applicationId, body, actorId) {
  await ensureSchema();
  const appId = toInt(applicationId);
  const text = String(body || "").trim();
  if (!text) throw clientError("Write the terms and conditions first.");
  if (text.length > 20000) throw clientError("The terms are too long (20,000 characters at most).");
  if (await hasContract(appId)) throw clientError("The contract is already recorded — the terms can't change anymore.", 409);
  const current = await getForApplication(appId);
  if (current) {
    await updateData(
      `UPDATE dbo.application_terms
       SET body = @param1, status = 'DRAFT', updated_by = @param2, updated_at = SYSUTCDATETIME()
       WHERE id = @param0`,
      [current.id, text, toInt(actorId)]
    );
  } else {
    await updateData(
      `INSERT INTO dbo.application_terms (application_id, body, status, created_by) VALUES (@param0, @param1, 'DRAFT', @param2)`,
      [appId, text, toInt(actorId)]
    );
  }
  return getForApplication(appId);
}

/** Sends the current draft to the locator (in-app + email). */
async function send(applicationId, actorId) {
  await ensureSchema();
  const appId = toInt(applicationId);
  const current = await getForApplication(appId);
  if (!current) throw clientError("Write the terms and conditions first.");
  const ctx = await appContext(appId);
  const who = partyWord(ctx?.is_renewal);
  if (current.status === "SENT") throw clientError(`These terms were already sent — waiting for the ${who}.`, 409);
  if (current.status === "AGREED") throw clientError(`The ${who} already agreed to these terms.`, 409);
  if (!ctx?.locator_user_id) {
    throw clientError(`This ${who} has no portal login yet, so they can't see the terms. Add one on Registered Locator first.`);
  }
  await updateData(
    `UPDATE dbo.application_terms
     SET status = 'SENT', version = version + 1, sent_at = SYSUTCDATETIME(), sent_by = @param1,
         responded_at = NULL, responded_by = NULL, locator_remarks = NULL,
         updated_by = @param1, updated_at = SYSUTCDATETIME()
     WHERE id = @param0`,
    [current.id, toInt(actorId)]
  );
  await logActivity(appId, "TERMS_SENT", `Terms and conditions sent to the ${who} (version ${current.version + 1})`, actorId);

  const what = Number(ctx.is_renewal) ? "renewal" : "application";
  await Notification.createNotification({
    userId: ctx.locator_user_id,
    subject: `Terms and conditions for ${ctx.application_no}`,
    body: `Please review the terms and conditions for your ${what} ${ctx.application_no} and agree, or ask for changes.`,
    createdBy: toInt(actorId),
    applicationId: appId,
    eventType: "application_status",
  }).catch((error) => console.error("Terms notification error:", error));
  if (ctx.locator_email) {
    const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/me/applications?applicationId=${appId}`;
    sendMail({
      to: ctx.locator_email,
      subject: `Terms and conditions for ${ctx.application_no} — please review`,
      text:
        `Hello ${ctx.locator_name || ""},\n\n` +
        `The terms and conditions for your ${what} ${ctx.application_no} (${ctx.business_name}) are ready. ` +
        `Please review them in the ${site.locatorPortalLabel()} and agree, or ask for changes.\n\nOpen: ${loginUrl}\n`,
      html:
        `<p>Hello ${escapeHtml(ctx.locator_name || "")},</p>` +
        `<p>The terms and conditions for your ${what} <b>${escapeHtml(ctx.application_no)}</b> (${escapeHtml(ctx.business_name)}) are ready. ` +
        `Please review them in the ${escapeHtml(site.locatorPortalLabel())} and agree, or ask for changes.</p>` +
        `<p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Review the terms</a></p>`,
    }).catch((error) => console.error("Terms email error:", error));
  }
  return getForApplication(appId);
}

/** The locator's answer from the portal: AGREE or REQUEST_CHANGES (remarks). */
async function respond(applicationId, { action, remarks, userId }) {
  await ensureSchema();
  const appId = toInt(applicationId);
  const current = await getForApplication(appId);
  if (!current || current.status !== "SENT") throw clientError("There are no terms waiting for your answer.", 409);
  const agree = String(action || "").toUpperCase() === "AGREE";
  const note = String(remarks || "").trim().slice(0, 2000) || null;
  if (!agree && !note) throw clientError("Tell us what you'd like changed.");
  const result = await updateData(
    `UPDATE dbo.application_terms
     SET status = @param1, responded_at = SYSUTCDATETIME(), responded_by = @param2, locator_remarks = @param3
     WHERE id = @param0 AND status = 'SENT'`,
    [current.id, agree ? "AGREED" : "CHANGES_REQUESTED", toInt(userId), note]
  );
  if (!result?.rowsAffected?.[0]) throw clientError("These terms were just changed — reload and try again.", 409);
  const ctx = await appContext(appId);
  const who = partyWord(ctx?.is_renewal);
  await logActivity(
    appId,
    agree ? "TERMS_AGREED" : "TERMS_CHANGES_REQUESTED",
    agree ? `The ${who} agreed to the terms (version ${current.version})` : `The ${who} asked for changes: ${note}`,
    userId
  );

  // Tell the evaluator (in-app + email): agreed → make the contract.
  const evaluatorId = toInt(ctx?.assigned_evaluator_id);
  if (evaluatorId) {
    const subject = agree
      ? `Terms agreed: ${ctx.application_no}`
      : `Changes requested on the terms: ${ctx.application_no}`;
    const body = agree
      ? `${ctx.business_name} agreed to the terms and conditions of ${ctx.application_no}. You can now make the contract.`
      : `${ctx.business_name} asked for changes to the terms of ${ctx.application_no}: ${note}`;
    await Notification.createNotification({
      userId: evaluatorId,
      subject,
      body,
      createdBy: toInt(userId),
      applicationId: appId,
      eventType: "assessment",
    }).catch((error) => console.error("Terms response notification error:", error));
    emailStaffInBackground(evaluatorId, {
      subject,
      lines: [body],
      linkPath: `${Number(ctx.is_renewal) ? "/applications/renewals" : "/assessment"}?applicationId=${appId}&tab=Terms`,
      linkLabel: "Open the application",
    });
  }
  return getForApplication(appId);
}

module.exports = { ensureSchema, STATUSES, getForApplication, saveDraft, send, respond };
