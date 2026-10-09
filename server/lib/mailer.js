const nodemailer = require("nodemailer");
const siteSettings = require("./siteSettings");
const { escapeHtml } = require("./html");

// The SMTP connection comes from Portal Settings (Email tab) only — SMTP_* in
// server/.env was imported once and is no longer read (lib/siteSettings.js).
// The transporter is rebuilt whenever those settings change, so a save takes
// effect on the next email without a restart.
let cached = { fingerprint: null, transporter: null };

function currentTransporter(config) {
  const fingerprint = JSON.stringify(config.transport);
  if (cached.fingerprint !== fingerprint) {
    // The old one isn't closed: it keeps no pooled connection, and closing
    // could cut off a message that's still being sent through it.
    cached = { fingerprint, transporter: nodemailer.createTransport(config.transport) };
  }
  return cached.transporter;
}

function isConfigured() {
  return siteSettings.mailConfig().configured;
}

/** Signature added to every email: the portal's name plus the support
 * contact from Portal Settings, so each message says who it's from and where
 * to get help without every call site repeating it. */
function withSignature({ text, html }) {
  const portal = siteSettings.getters.portalLabel();
  const email = siteSettings.getters.supportEmail();
  const phone = siteSettings.getters.supportPhone();
  const help = [email, phone].filter(Boolean).join(" · ");
  return {
    text: text ? `${text}\n—\n${portal}${help ? `\nNeed help? ${help}` : ""}\n` : text,
    html: html
      ? `${html}<p style="margin-top:24px;color:#6b7280;font-size:12px;">— ${escapeHtml(portal)}` +
        `${help ? `<br/>Need help? ${escapeHtml(help)}` : ""}</p>`
      : html,
  };
}

/**
 * Best-effort email send. Email is optional in this deployment — when
 * Portal Settings has no SMTP server/username yet, this logs the content to the
 * server console instead of throwing, so admin-triggered flows that include
 * an email step (e.g. password reset) still complete and stay usable in
 * dev/test without real SMTP credentials. Returns whether the mail actually
 * went out, so a caller can tell the admin if delivery didn't happen.
 */
async function sendMail({ to, cc, subject, text, html }) {
  const config = siteSettings.mailConfig();
  if (!config.configured) {
    console.warn(
      `[mailer] SMTP not configured — email not sent. To: ${to}, Subject: ${subject}\n${text || html || ""}`
    );
    require("./systemAlerts").alertAdmins({
      key: "mail-not-configured",
      throttleMs: 24 * 60 * 60 * 1000,
      subject: "Emails are not being sent",
      body: "The SMTP server isn't set up, so emails (locator logins, filing and decision notices, password resets) are not going out. Set it up in Portal Settings → Email.",
    });
    return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  }
  try {
    await currentTransporter(config).sendMail({
      from: config.from,
      replyTo: config.replyTo,
      to,
      ...(cc ? { cc } : {}),
      subject,
      ...withSignature({ text, html }),
    });
    return { sent: true };
  } catch (error) {
    console.error("[mailer] Failed to send email:", error.message || error);
    require("./systemAlerts").alertAdmins({
      key: "mail-send-failed",
      subject: "An email could not be sent",
      body: `Sending "${subject}" to ${to} failed: ${describeSendError(error)} Check Portal Settings → Email (use Send test email).`,
    });
    return { sent: false, reason: "SEND_FAILED" };
  }
}

/** What went wrong with a test send, in words for the admin — never the raw
 * SMTP/driver message (see lib/httpError.js). */
function describeSendError(error) {
  const code = String(error?.code || "");
  if (code === "EAUTH") return "The SMTP server rejected the username or password.";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED"].includes(code)) {
    return "Couldn't connect to the SMTP server. Check the server name, port and connection security.";
  }
  if (code === "ETLS" || /tls|ssl|certificate/i.test(String(error?.message || ""))) {
    return "The secure connection to the SMTP server failed. Check the connection security setting and port.";
  }
  if (code === "EENVELOPE") return "The SMTP server refused the sender or recipient address.";
  return "The test email could not be sent. Check the settings and try again.";
}

/** Sends one message through a throwaway transporter built from `overrides`
 * (unsaved form values) on top of the saved settings — used by Portal
 * Settings' "Send test email" so a typo is caught before it's saved. */
async function sendTestMail(overrides, { to, subject, text, html }) {
  const config = siteSettings.mailConfig(overrides);
  if (!config.configured) return { sent: false, message: "Enter the SMTP server and username first." };
  const transporter = nodemailer.createTransport(config.transport);
  try {
    await transporter.sendMail({ from: config.from, replyTo: config.replyTo, to, subject, ...withSignature({ text, html }) });
    return { sent: true };
  } catch (error) {
    console.error("[mailer] Test email failed:", error.code || "", error.message || error);
    return { sent: false, message: describeSendError(error) };
  } finally {
    transporter.close?.();
  }
}

module.exports = { sendMail, sendTestMail, isConfigured };
