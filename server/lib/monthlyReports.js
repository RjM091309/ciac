// Recurring monthly reports (Reports & Analytics → Custom Report → a template
// ticked "Recurring every month"): at the start of each month in the
// template's from–to range, the report is generated from the template and
// emailed as an Excel file to every active Account Officer. A Level 2 Account
// Officer's copy has only their own locators (same as on screen); Level 1
// gets every locator. Each template goes out once a month
// (report_templates.last_sent_month); a run that finds it already sent skips it.
const { selectData } = require("../config/database");
const { sendMail } = require("./mailer");
const { escapeHtml } = require("./html");
const CustomReport = require("../models/CustomReport");
const AuditLog = require("../models/AuditLog");

const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 3 * 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");
const monthOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthLabel = (ym) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

/** Active Account Officers with an email, and whether each sees every locator (Level 1). */
async function recipients() {
  const AccountOfficer = require("../models/AccountOfficer");
  const { isManager } = require("../models/AssessmentEvaluation");
  const officers = (await AccountOfficer.listAccountOfficers()).filter((o) => o.is_active && o.email);
  const out = [];
  for (const o of officers) {
    // Level 1 (manager) sees every locator; Level 2 only their own.
    const manager = await isManager({ id: o.id, role: "account officer" }).catch(() => false);
    out.push({ id: o.id, name: o.full_name, email: o.email, ownOnly: !manager });
  }
  return out;
}

/** Builds one recipient's copy: { buffer, fileName, rows }. */
async function buildFor(template, month, ownOfficerId) {
  const cfg = template.config || {};
  // A Totals template: "Total … by …" as of the send date (this year), with its filters.
  const totals = cfg.mode === "totals" && cfg.totals ? cfg.totals : null;
  const result = totals
    ? CustomReport.totalsAsTable(
        await CustomReport.quickTotal({
          measure: totals.measure,
          by: totals.by,
          period: totals.period,
          year: new Date().getFullYear(),
          filters: cfg.filters || {},
          ownOfficerId,
        })
      )
    : await CustomReport.run({
        dataset: template.dataset,
        columns: cfg.columns,
        filters: cfg.filters || {},
        sort: cfg.sort || null,
        ownOfficerId,
      });
  const ds = CustomReport.DATASETS[template.dataset];
  // Title, sheet and subtitle as the page's own Excel download names them.
  const title = `${template.name} — ${monthLabel(month)}`;
  const asOf = `As of ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  const applied = await CustomReport.filterText(template.dataset, cfg.filters || {});
  if (ownOfficerId) applied.push("Your locators only");
  if (result.truncated) applied.push(`First ${CustomReport.MAX_ROWS.toLocaleString("en-US")} rows only`);
  // A Totals template says what it totals ("Total MGL per month by Type of Property").
  if (totals) {
    const opts = CustomReport.quickTotalOptions();
    const m = opts.measures.find((x) => x.value === totals.measure)?.label || totals.measure;
    const b = opts.by.find((x) => x.value === totals.by)?.label || totals.by;
    applied.unshift(`Total ${m} by ${b}${totals.period === "in" ? ` (signed in ${new Date().getFullYear()})` : ""}`);
  }
  const subtitle = [asOf, ...applied].join(" · ");
  const buffer = await CustomReport.buildWorkbook(result, { title, subtitle, sheetName: totals ? "Totals" : ds?.label || template.name });
  const fileName = `${template.name.replace(/[^A-Za-z0-9]+/g, "-")}-${month}.xlsx`;
  return { buffer, fileName, rows: result.total, title };
}

async function emailOne(template, month, to, { test = false } = {}) {
  const copy = await buildFor(template, month, to.ownOnly ? to.id : null);
  const html = `
    <p>Hi ${escapeHtml(to.name || "")},</p>
    <p>Attached is the monthly report <strong>${escapeHtml(template.name)}</strong> for ${escapeHtml(monthLabel(month))}
       (${copy.rows.toLocaleString("en-US")} row${copy.rows === 1 ? "" : "s"}${to.ownOnly ? ", your locators" : ""}).</p>
    ${test ? "<p><em>This is a test send — only you received it.</em></p>" : ""}
    <p style="color:#666;font-size:12px">Sent automatically every month from Reports &amp; Analytics → Custom Report.</p>`;
  const r = await sendMail({
    to: to.email,
    subject: `${test ? "[Test] " : ""}${copy.title}`,
    html,
    attachments: [
      {
        filename: copy.fileName,
        content: copy.buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });
  return { sent: Boolean(r?.sent), rows: copy.rows, reason: r?.reason || null };
}

/** Sends one template's report for `month` to every Account Officer. */
async function sendTemplate(id, month = monthOf()) {
  const template = await CustomReport.getTemplate(id);
  if (!template) return null;
  const list = await recipients();
  const results = [];
  for (const to of list) {
    try {
      results.push({ to: to.email, ...(await emailOne(template, month, to)) });
    } catch (error) {
      console.error(`[monthly-reports] "${template.name}" to ${to.email} failed:`, error.message);
      results.push({ to: to.email, sent: false, reason: "BUILD_FAILED" });
    }
  }
  await CustomReport.markSent(id, month);
  await AuditLog.record({
    actorId: null,
    actorUsername: "system",
    action: "MONTHLY_REPORT_SENT",
    entityType: "report_template",
    entityId: id,
    details: { template: template.name, month, recipients: results },
  });
  return results;
}

/** A test copy to one user (the one asking), built as they would see it. */
async function sendTest(id, user) {
  const template = await CustomReport.getTemplate(id);
  if (!template) throw Object.assign(new Error("Template not found."), { status: 404 });
  const [u] = await selectData(`SELECT id, full_name, email FROM dbo.users WHERE id = @param0`, [Number(user.id)]);
  if (!u?.email) throw Object.assign(new Error("Your account has no email address."), { status: 400 });
  const { aoLevel2Id } = require("./departments");
  const own = await aoLevel2Id(user);
  const r = await emailOne(template, monthOf(), { id: u.id, name: u.full_name, email: u.email, ownOnly: Boolean(own) }, { test: true });
  return { ...r, email: u.email };
}

async function run() {
  const month = monthOf();
  const due = await CustomReport.listDueRecurring(month);
  for (const id of due) {
    try {
      const results = await sendTemplate(id, month);
      const sent = (results || []).filter((r) => r.sent).length;
      console.log(`[monthly-reports] template ${id} for ${month}: ${sent}/${(results || []).length} sent`);
    } catch (error) {
      console.error(`[monthly-reports] template ${id} failed:`, error.message);
    }
  }
  return { month, due: due.length };
}

let timer = null;
function start() {
  if (timer) return;
  const tick = () => run().catch((error) => console.error("Monthly reports run failed:", error.message));
  setTimeout(tick, FIRST_RUN_AFTER_MS).unref?.();
  timer = setInterval(tick, RUN_EVERY_MS);
  timer.unref?.();
}

module.exports = { start, run, sendTemplate, sendTest, recipients };
