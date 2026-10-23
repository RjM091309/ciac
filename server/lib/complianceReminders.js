// Compliance expiry reminders: as a locator's compliance documents (insurance,
// AFS/GIS, FSIC, sanitary permit, ATO… — each checklist item's "valid until")
// approach expiry, the locator is emailed — 6 months, 3 months and 1 month
// before, then once when it lapses — plus an in-app notice. Everyone who
// reviews compliance (Compliance Officer roles + admins) gets an in-app alert
// at the same moments, and the Compliance dashboard keeps the standing alarm.
//
// One email per locator per run, listing every item that reached a new stage.
// dbo.compliance_expiry_reminders records which stage was sent for which
// expiry date, so each stage goes out once — and an item first noticed late
// (say 20 days out) only gets the 1-month reminder, not all three. A renewed
// document (new valid-until) starts its own series. If the email fails (no
// SMTP, server down), only the email is retried on later runs while the item
// is still at that stage — the in-app notices aren't repeated.
const { selectData, insertData, updateSchema } = require("../config/database");
const { sendMail } = require("./mailer");
const { escapeHtml } = require("./html");
const { getters: site } = require("./siteSettings");
const Notification = require("../models/Notification");
const AuditLog = require("../models/AuditLog");
const ActivityLog = require("../models/ActivityLog");
const ComplianceDocument = require("../models/ComplianceDocument");

const RUN_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 3 * 60 * 1000;
// An already-expired item still gets its one "expired" notice if it lapsed
// within this many days (avoids a burst for long-expired legacy data).
const EXPIRED_NOTICE_WITHIN_DAYS = 30;

// Smallest window wins: 20 days out is the 1-month stage.
const STAGES = [
  { key: "1M", maxDays: 31, label: "1 month" },
  { key: "3M", maxDays: 92, label: "3 months" },
  { key: "6M", maxDays: 183, label: "6 months" },
];

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF OBJECT_ID('dbo.compliance_expiry_reminders', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.compliance_expiry_reminders (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          proponent_id INT NOT NULL,
          item_code NVARCHAR(40) NOT NULL,
          validity_to DATE NOT NULL,
          stage NVARCHAR(10) NOT NULL,
          emailed BIT NOT NULL CONSTRAINT DF_compliance_expiry_reminders_emailed DEFAULT (0),
          sent_at DATETIME2(3) NOT NULL CONSTRAINT DF_compliance_expiry_reminders_sent_at DEFAULT (SYSUTCDATETIME())
        );
        CREATE UNIQUE INDEX UX_compliance_expiry_reminders
          ON dbo.compliance_expiry_reminders(proponent_id, item_code, validity_to, stage);
      END
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function stageFor(validityTo) {
  const end = new Date(validityTo);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (days < 0) return days >= -EXPIRED_NOTICE_WITHIN_DAYS ? { key: "EXPIRED", label: "expired", days } : null;
  const stage = STAGES.find((s) => days <= s.maxDays);
  return stage ? { ...stage, days } : null;
}

/** Checklist items with a valid-until inside the 6-month window (or just
 * lapsed), on active locators, whose current stage hasn't been sent yet. */
async function listDue() {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      i.proponent_id, i.item_code, i.validity_to,
      cr.name AS item_name,
      p.business_name, p.ref_no,
      u.id AS locator_user_id, NULLIF(u.email, '') AS locator_email, u.full_name AS locator_name
    FROM dbo.locator_compliance_items i
    INNER JOIN dbo.compliance_requirements cr ON cr.code = i.item_code AND cr.is_active = 1
    INNER JOIN dbo.proponents p ON p.id = i.proponent_id AND p.is_active = 1
    LEFT JOIN dbo.users u ON u.id = p.user_id
    WHERE i.validity_to IS NOT NULL
      -- Items marked Not applicable for the locator get no reminders.
      AND ISNULL(i.applicability, 'REQUIRED') = 'REQUIRED'
      -- A renewed document already uploaded and waiting for review: no reminder
      -- (the Compliance Officer sets the new validity when reviewing it).
      AND ISNULL(i.status, '') <> 'SUBMITTED'
      AND i.validity_to <= DATEADD(day, 183, CAST(SYSUTCDATETIME() AS DATE))
      AND i.validity_to >= DATEADD(day, -@param0, CAST(SYSUTCDATETIME() AS DATE))
    `,
    [EXPIRED_NOTICE_WITHIN_DAYS]
  );
  if (!rows.length) return [];
  const sent = await selectData(
    `SELECT proponent_id, item_code, CONVERT(varchar(10), validity_to, 23) AS validity_to, stage, emailed
     FROM dbo.compliance_expiry_reminders
     WHERE validity_to >= DATEADD(day, -@param0, CAST(SYSUTCDATETIME() AS DATE))`,
    [EXPIRED_NOTICE_WITHIN_DAYS]
  );
  const keyOf = (r, ymd, stage) => `${r.proponent_id}|${r.item_code}|${ymd}|${stage}`;
  const emailedKeys = new Set(sent.filter((s) => s.emailed).map((s) => keyOf(s, s.validity_to, s.stage)));
  const unemailedKeys = new Set(sent.filter((s) => !s.emailed).map((s) => keyOf(s, s.validity_to, s.stage)));
  const due = [];
  for (const r of rows) {
    const stage = stageFor(r.validity_to);
    if (!stage) continue;
    const ymd = new Date(r.validity_to).toISOString().slice(0, 10);
    const key = keyOf(r, ymd, stage.key);
    if (emailedKeys.has(key)) continue;
    if (unemailedKeys.has(key)) {
      // Notified in-app already; only the email failed — retry it if there's
      // an address to send to (still at this stage, so it's still relevant).
      if (r.locator_email) due.push({ ...r, validity_ymd: ymd, stage, retry: true });
      continue;
    }
    due.push({ ...r, validity_ymd: ymd, stage, retry: false });
  }
  return due;
}

function lineFor(item) {
  const when = fmtDate(item.validity_to);
  return item.stage.key === "EXPIRED"
    ? `${item.item_name} — expired on ${when}`
    : `${item.item_name} — expires on ${when} (about ${item.stage.label} left)`;
}

/** One locator, every item that reached a new stage this run. */
async function remindLocator(group, staffIds) {
  const first = group[0];
  const anyExpired = group.some((i) => i.stage.key === "EXPIRED");
  const loginUrl = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}/`;
  const portal = site.locatorPortalLabel();
  const lines = group.map(lineFor);
  // Items reaching this stage for the first time (in-app notices go out for
  // these); the rest are email retries of an earlier, failed send.
  const fresh = group.filter((i) => !i.retry);
  const freshLines = fresh.map(lineFor);

  // 1. Record first, so a later failure can't repeat the in-app notices.
  for (const item of fresh) {
    await insertData(
      `
      IF NOT EXISTS (
        SELECT 1 FROM dbo.compliance_expiry_reminders
        WHERE proponent_id = @param0 AND item_code = @param1 AND validity_to = @param2 AND stage = @param3
      )
        INSERT INTO dbo.compliance_expiry_reminders (proponent_id, item_code, validity_to, stage)
        VALUES (@param0, @param1, @param2, @param3)
      `,
      [item.proponent_id, item.item_code, item.validity_ymd, item.stage.key]
    );
  }

  // 2. Email the locator.
  let emailed = false;
  if (first.locator_email) {
    const subject = anyExpired
      ? `Compliance documents expired — ${first.business_name}`
      : `Compliance documents expiring soon — ${first.business_name}`;
    const result = await sendMail({
      to: first.locator_email,
      subject,
      text:
        `Hello ${first.locator_name || ""},\n\n` +
        `The following compliance document${group.length === 1 ? "" : "s"} for ${first.business_name} ` +
        `${anyExpired ? "need attention" : "will expire soon"}:\n\n` +
        lines.map((l) => `  • ${l}`).join("\n") +
        `\n\nPlease upload the renewed document${group.length === 1 ? "" : "s"} under Compliance in ${portal} ` +
        `so the Compliance Officer can review ${group.length === 1 ? "it" : "them"}.\n\nSign in: ${loginUrl}\n`,
      html:
        `<p>Hello ${escapeHtml(first.locator_name || "")},</p>` +
        `<p>The following compliance document${group.length === 1 ? "" : "s"} for <b>${escapeHtml(first.business_name)}</b> ` +
        `${anyExpired ? "need attention" : "will expire soon"}:</p>` +
        `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>` +
        `<p>Please upload the renewed document${group.length === 1 ? "" : "s"} under <b>Compliance</b> in ${escapeHtml(portal)} ` +
        `so the Compliance Officer can review ${group.length === 1 ? "it" : "them"}.</p>` +
        `<p><a href="${loginUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Sign in to the portal</a></p>`,
    });
    emailed = Boolean(result?.sent);
  }
  if (emailed) {
    for (const item of group) {
      await insertData(
        `UPDATE dbo.compliance_expiry_reminders SET emailed = 1
         WHERE proponent_id = @param0 AND item_code = @param1 AND validity_to = @param2 AND stage = @param3`,
        [item.proponent_id, item.item_code, item.validity_ymd, item.stage.key]
      );
    }
  }

  // Only email retries this run: nothing else to send.
  if (!fresh.length) {
    if (emailed) {
      await AuditLog.record({
        actorId: null,
        actorUsername: "system",
        action: "COMPLIANCE_EXPIRY_REMINDER_SENT",
        entityType: "proponent",
        entityId: first.proponent_id,
        details: {
          business_name: first.business_name,
          items: group.map((i) => ({ item: i.item_name, valid_until: i.validity_ymd, stage: i.stage.key })),
          emailed_to: first.locator_email,
          retry: true,
        },
      });
    }
    return;
  }

  // 3. In-app: the locator, then every compliance reviewer.
  if (first.locator_user_id) {
    await Notification.createNotification({
      userId: first.locator_user_id,
      subject: fresh.some((i) => i.stage.key === "EXPIRED") ? "Compliance documents expired" : "Compliance documents expiring soon",
      body: `${freshLines.join("; ")}. Upload the renewed document${fresh.length === 1 ? "" : "s"} under Compliance.`,
      eventType: "compliance",
    }).catch(() => {});
  }
  const emailNote = emailed
    ? "The locator was emailed."
    : first.locator_email
      ? "The email to the locator could not be sent — it will be retried."
      : "The locator has no email on file — reach out to them.";
  for (const userId of staffIds) {
    await Notification.createNotification({
      userId,
      subject: `${fresh.some((i) => i.stage.key === "EXPIRED") ? "Compliance expired" : "Compliance expiring"}: ${first.business_name}`,
      body: `${first.business_name} (${first.ref_no || "locator"}) — ${freshLines.join("; ")}. ${emailNote}`,
      eventType: "compliance",
    }).catch(() => {});
  }

  // 4. On record.
  await AuditLog.record({
    actorId: null,
    actorUsername: "system",
    action: "COMPLIANCE_EXPIRY_REMINDER_SENT",
    entityType: "proponent",
    entityId: first.proponent_id,
    details: {
      business_name: first.business_name,
      items: group.map((i) => ({ item: i.item_name, valid_until: i.validity_ymd, stage: i.stage.key })),
      emailed_to: emailed ? first.locator_email : null,
      email_failed: Boolean(first.locator_email && !emailed),
    },
  });
  await ActivityLog.record({
    actorUserId: null,
    proponentId: first.proponent_id,
    entityType: "COMPLIANCE",
    entityId: null,
    action: "COMPLIANCE_EXPIRY_REMINDER_SENT",
    meta: { items: group.map((i) => ({ item: i.item_name, valid_until: i.validity_ymd, stage: i.stage.key })) },
  });
}

async function run() {
  await ensureSchema();
  // locator_compliance_items.applicability comes from ComplianceInspection's schema.
  await require("../models/ComplianceInspection").ensureSchema();
  await ComplianceDocument.ensureSchema();
  const due = await listDue();
  if (!due.length) return { due: 0, locators: 0 };
  const byLocator = new Map();
  for (const item of due) {
    const list = byLocator.get(item.proponent_id) || [];
    list.push(item);
    byLocator.set(item.proponent_id, list);
  }
  const staffIds = await ComplianceDocument.listComplianceStaffIds().catch(() => []);
  let locators = 0;
  for (const group of byLocator.values()) {
    try {
      await remindLocator(group, staffIds);
      locators += 1;
    } catch (error) {
      console.error(`Compliance expiry reminder failed for locator ${group[0].proponent_id}:`, error.message);
    }
  }
  console.log(`[compliance-reminders] ${due.length} item(s) across ${locators} locator(s)`);
  return { due: due.length, locators };
}

let timer = null;
function start() {
  if (timer) return;
  const tick = () => run().catch((error) => console.error("Compliance reminders run failed:", error.message));
  setTimeout(tick, FIRST_RUN_AFTER_MS).unref?.();
  timer = setInterval(tick, RUN_EVERY_MS);
  timer.unref?.();
}

module.exports = { start, run, listDue, stageFor };
