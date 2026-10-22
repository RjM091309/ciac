// Emails a staff member about a hand-over that also gets an in-app notice —
// e.g. a locator turned over from the BDO to the Account Officers, or
// assigned / reassigned to a Level 2 Account Officer. Sent in the background:
// a slow or broken mail server must never hold up (or fail) the action
// itself; the mailer alerts admins when sending fails.
const { selectData } = require("../config/database");
const { sendMail } = require("./mailer");
const { escapeHtml } = require("./html");

/**
 * @param {number} userId  staff user to email (skipped when inactive or no email)
 * @param {{ subject: string, lines: string[], linkPath?: string, linkLabel?: string }} message
 */
async function emailStaff(userId, { subject, lines, linkPath = "/", linkLabel = "Open in the portal" }) {
  const rows = await selectData(
    `SELECT TOP (1) email, full_name, username, is_active FROM dbo.users WHERE id = @param0`,
    [Number(userId) || 0]
  );
  const user = rows?.[0];
  const to = String(user?.email || "").trim();
  if (!user || !user.is_active || !to) return { sent: false, reason: "NO_RECIPIENT" };

  const name = user.full_name || user.username || "";
  const url = `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}${linkPath}`;
  return sendMail({
    to,
    subject,
    text: `Hello ${name},\n\n${lines.join("\n\n")}\n\n${linkLabel}: ${url}\n`,
    html:
      `<p>Hello ${escapeHtml(name)},</p>` +
      lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") +
      `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">${escapeHtml(linkLabel)}</a></p>`,
  });
}

/** Fire-and-forget version for request handlers. */
function emailStaffInBackground(userId, message) {
  emailStaff(userId, message).catch((error) => console.error("Staff email error:", error.message || error));
}

module.exports = { emailStaff, emailStaffInBackground };
