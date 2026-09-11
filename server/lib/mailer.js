const transporter = require("../config/mailer");

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
}

/**
 * Best-effort email send. SMTP_* is optional in this deployment (see
 * .env.example) — when it isn't configured, this logs the content to the
 * server console instead of throwing, so admin-triggered flows that include
 * an email step (e.g. password reset) still complete and stay usable in
 * dev/test without real SMTP credentials. Returns whether the mail actually
 * went out, so a caller can tell the admin if delivery didn't happen.
 */
async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) {
    console.warn(
      `[mailer] SMTP not configured — email not sent. To: ${to}, Subject: ${subject}\n${text || html || ""}`
    );
    return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (error) {
    console.error("[mailer] Failed to send email:", error.message || error);
    return { sent: false, reason: "SEND_FAILED" };
  }
}

module.exports = { sendMail, isConfigured };
