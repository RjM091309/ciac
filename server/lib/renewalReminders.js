// Renewal reminder: once a locator's lease contract is within the EXPIRING
// window (Portal Settings → Renewals, default 6 months) — the same moment it
// shows on Renewal Tracking — the locator is emailed (plus an in-app notice)
// that it's time to renew, and their Account Officer is told too.
//
// The first reminder goes out when the window opens, then a follow-up every
// N months (default 1) until the renewal is filed (or the contract is
// renewed/revoked). Reminders can be switched off, and stop a set number of
// months after expiry (default 6) — all in Portal Settings → Renewals.
// dbo.permits keeps which expiry the reminders are for (expiry_notice_for),
// when the last one went out and how many — a new contract (new expiry)
// starts its own series. Each reminder is logged: Audit Log (system) and the
// locator's activity history.
// If the email can't go out (e.g. SMTP not set up, a bad address) the in-app
// notices still go and the reminder counts — the next one is a month later —
// so nothing repeats every run; the AO's notice says the email failed.
const { selectData, updateData, updateSchema } = require("../config/database");
const { sendMail } = require("./mailer");
const { escapeHtml } = require("./html");
const { getters: site } = require("./siteSettings");
const renewalSettings = () => site.renewals();
const Permit = require("../models/Permit");
const Notification = require("../models/Notification");
const AuditLog = require("../models/AuditLog");
const ActivityLog = require("../models/ActivityLog");

const RUN_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 2 * 60 * 1000;

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF COL_LENGTH('dbo.permits', 'expiry_notice_for') IS NULL
        ALTER TABLE dbo.permits ADD expiry_notice_for DATE NULL;
      IF COL_LENGTH('dbo.permits', 'last_renewal_reminder_at') IS NULL
        ALTER TABLE dbo.permits ADD last_renewal_reminder_at DATETIME2(3) NULL;
      IF COL_LENGTH('dbo.permits', 'renewal_reminder_count') IS NULL
        ALTER TABLE dbo.permits ADD renewal_reminder_count INT NULL;
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Contract permits due for a reminder: none sent yet for this expiry, or
 * the last one is a month old. */
async function listDue() {
  return selectData(
    `
    SELECT
      pm.id, pm.permit_no, pm.expiry_date, pm.application_id,
      CASE WHEN pm.expiry_notice_for = pm.expiry_date THEN ISNULL(pm.renewal_reminder_count, 0) ELSE 0 END AS reminders_sent,
      p.id AS proponent_id, p.business_name, p.ref_no,
      lu.id AS locator_user_id, NULLIF(lu.email, '') AS locator_email, lu.full_name AS locator_name,
      ao.id AS ao_id, ao.full_name AS ao_name, NULLIF(ao.email, '') AS ao_email
    FROM dbo.permits pm
    INNER JOIN dbo.proponents p ON p.id = pm.proponent_id AND p.is_active = 1
    LEFT JOIN dbo.users lu ON lu.id = p.user_id
    LEFT JOIN dbo.users ao ON ao.id = p.account_officer_id
    WHERE pm.permit_type = 'CONTRACT'
      AND pm.is_active = 1
      AND pm.status NOT IN ('RENEWED', 'REVOKED')
      AND pm.expiry_date IS NOT NULL
      AND pm.expiry_date <= DATEADD(day, @param0, CAST(SYSUTCDATETIME() AS DATE))
      -- Stop N months after expiry (Portal Settings): long-expired contracts get no reminders.
      AND pm.expiry_date >= DATEADD(month, -@param1, CAST(SYSUTCDATETIME() AS DATE))
      AND (
        pm.expiry_notice_for IS NULL
        OR pm.expiry_notice_for <> pm.expiry_date
        OR pm.last_renewal_reminder_at IS NULL
        OR pm.last_renewal_reminder_at <= DATEADD(month, -@param2, SYSUTCDATETIME())
      )
      -- Only a contract that's in force: its application approved (or an
      -- encoded existing locator's lease, which has no application).
      AND (pm.application_id IS NULL
        OR EXISTS (SELECT 1 FROM dbo.applications a WHERE a.id = pm.application_id AND a.status = 'APPROVED'))
      -- Nothing to remind about once the locator's renewal is filed (from any permit).
      AND NOT EXISTS (
        SELECT 1 FROM dbo.applications r
        WHERE r.proponent_id = pm.proponent_id AND r.is_renewal = 1
          AND r.status NOT IN ('APPROVED', 'REJECTED', 'DISAPPROVED')
      )
    `,
    [Permit.expiringWindowDays(), renewalSettings().stopAfterExpiryMonths, renewalSettings().reminderIntervalMonths]
  );
}

async function remind(row) {
  const expiry = fmtDate(row.expiry_date);
  const daysLeft = Math.ceil((new Date(row.expiry_date).getTime() - Date.now()) / 86400000);
  const when = daysLeft < 0 ? `expired on ${expiry}` : `expires on ${expiry}`;
  const portal = site.locatorPortalLabel();
  const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
  const nth = Number(row.reminders_sent || 0) + 1;
  const followUp = nth > 1 ? `Follow-up reminder #${nth}: ` : "";
  const contact = row.ao_name
    ? `your Account Officer, ${row.ao_name}${row.ao_email ? ` (${row.ao_email})` : ""}`
    : site.orgShortName();

  // 1. Mark it first, so a later failure can't repeat the same reminder every
  //    run (the next one is due a month from now either way).
  await updateData(
    `UPDATE dbo.permits
     SET expiry_notice_for = expiry_date, last_renewal_reminder_at = SYSUTCDATETIME(), renewal_reminder_count = @param1
     WHERE id = @param0`,
    [row.id, nth]
  );

  // 2. The locator's email.
  let emailed = false;
  if (row.locator_email) {
    const result = await sendMail({
      to: row.locator_email,
      // Optionally copy their Account Officer (Portal Settings → Renewals).
      cc: renewalSettings().ccAccountOfficer && row.ao_email ? row.ao_email : undefined,
      subject: `${followUp}Time to renew your lease contract — ${row.business_name}`,
      text:
        `Hello ${row.locator_name || ""},\n\n` +
        `Your lease contract ${row.permit_no} for ${row.business_name} ${when}.\n\n` +
        `Please start your renewal now so it can be processed in time. ` +
        `Coordinate with ${contact}, who will file the renewal; you'll then upload the renewal requirements in ${portal}.\n\n` +
        `Sign in: ${loginUrl}\n`,
      html:
        `<p>Hello ${escapeHtml(row.locator_name || "")},</p>` +
        `<p>Your lease contract <b>${escapeHtml(row.permit_no)}</b> for <b>${escapeHtml(row.business_name)}</b> ${escapeHtml(when)}.</p>` +
        `<p>Please start your renewal now so it can be processed in time. Coordinate with ${escapeHtml(contact)}, ` +
        `who will file the renewal; you'll then upload the renewal requirements in ${escapeHtml(portal)}.</p>` +
        `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to the portal</a></p>`,
    });
    emailed = Boolean(result?.sent);
  }

  // 3. In-app notices (sent even if the email didn't go out) (locator, if they have a login; their Account Officer).
  if (row.locator_user_id) {
    await Notification.createNotification({
      userId: row.locator_user_id,
      subject: nth > 1 ? `Renewal reminder #${nth}: your lease contract` : "Your lease contract is due for renewal",
      body: `Contract ${row.permit_no} ${when}. Please coordinate your renewal with ${contact}.`,
      applicationId: row.application_id || null,
      eventType: "contract",
    }).catch(() => {});
  }
  if (row.ao_id) {
    await Notification.createNotification({
      userId: row.ao_id,
      subject: `${nth > 1 ? `Renewal reminder #${nth}` : "Due for renewal"}: ${row.business_name}`,
      body: `${row.business_name} (${row.ref_no || "locator"}) — contract ${row.permit_no} ${when}. ` +
        `${emailed ? "The locator was emailed a renewal reminder." : row.locator_email ? "The reminder email to the locator could not be sent — reach out to them." : "The locator has no email on file — reach out to them."} ` +
        "Renew it from Renewal Tracking.",
      eventType: "application_status",
    }).catch(() => {});
  }

  // 4. On record: Audit Log (by the system) and the locator's activity history.
  const details = {
    business_name: row.business_name,
    ref_no: row.ref_no,
    permit_no: row.permit_no,
    expiry_date: row.expiry_date,
    reminder: nth,
    emailed_to: emailed ? row.locator_email : null,
    email_failed: Boolean(row.locator_email && !emailed),
  };
  await AuditLog.record({
    actorId: null,
    actorUsername: "system",
    action: "RENEWAL_REMINDER_SENT",
    entityType: "proponent",
    entityId: row.proponent_id,
    details,
  });
  await ActivityLog.record({
    actorUserId: null,
    proponentId: row.proponent_id,
    entityType: "PERMIT",
    entityId: row.id,
    action: "RENEWAL_REMINDER_SENT",
    meta: { permit_no: row.permit_no, expiry_date: row.expiry_date, reminder: nth },
  });
  return true;
}

async function run() {
  await ensureSchema();
  if (!renewalSettings().remindersEnabled) return { due: 0, sent: 0, disabled: true };
  const due = await listDue();
  let sent = 0;
  for (const row of due) {
    try {
      if (await remind(row)) sent += 1;
    } catch (error) {
      console.error(`Renewal reminder failed for permit ${row.id}:`, error.message);
    }
  }
  if (due.length) console.log(`[renewal-reminders] ${sent}/${due.length} reminder(s) sent`);
  return { due: due.length, sent };
}

let timer = null;
function start() {
  if (timer) return;
  const tick = () => run().catch((error) => console.error("Renewal reminders run failed:", error.message));
  setTimeout(tick, FIRST_RUN_AFTER_MS).unref?.();
  timer = setInterval(tick, RUN_EVERY_MS);
  timer.unref?.();
}

module.exports = { start, run, listDue };
