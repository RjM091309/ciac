// The look of every email the portal sends: a branded card (logo + portal
// name on top, the message, a footer with the support contact) around the
// HTML each call site writes. Applied in lib/mailer.js, so call sites keep
// writing plain <p> / one <a> button and don't repeat any of this. Table
// layout with inline styles — what email clients (Outlook included) render.
const siteSettings = require("./siteSettings");
const { escapeHtml } = require("./html");

const FONT = "Arial, Helvetica, sans-serif";
const INK = "#111827";

function frontendUrl() {
  return String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

/** The header logo (the CIAC mark, Portal Settings → Branding → Header logo)
 * as an absolute URL, or null without FRONTEND_URL. */
function logoUrl() {
  const base = frontendUrl();
  if (!base) return null;
  const file = siteSettings.assetFile?.("header_logo");
  return file ? `${base}/api/site-settings/assets/header_logo?v=${encodeURIComponent(file)}` : `${base}/images/ciac-logo-only.png`;
}

/** The call sites' dark button → the email's button style. */
function restyleButtons(html) {
  return String(html).replace(
    /style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;"/g,
    `style="display:inline-block;padding:12px 22px;background:${INK};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;font-family:${FONT};"`
  );
}

/**
 * @param {{ html: string, subject?: string, preheader?: string, sender?: { name: string, email: string } | null }} opts
 * @returns {string} a full HTML document
 */
function renderEmail({ html, subject = "", preheader = "", sender = null }) {
  const portal = siteSettings.getters.portalLabel();
  const org = siteSettings.getters.orgName?.() || "";
  const email = siteSettings.getters.supportEmail();
  const phone = siteSettings.getters.supportPhone();
  const footerText = String(siteSettings.get?.("branding.footer_text") || "").trim();
  const logo = logoUrl();
  const year = new Date().getFullYear();

  const help = [
    email ? `<a href="mailto:${escapeHtml(email)}" style="color:#374151;text-decoration:underline;">${escapeHtml(email)}</a>` : "",
    phone ? escapeHtml(phone) : "",
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");

  const brand = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(portal)}" height="40" style="display:block;height:40px;width:auto;border:0;outline:none;" />`
    : "";

  const senderRow = sender
    ? `<tr><td style="padding:0 32px 24px 32px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f3f4f6;border-radius:10px;">
           <tr><td style="padding:12px 14px;font-family:${FONT};font-size:12px;line-height:1.5;color:#4b5563;">
             Sent by <strong style="color:${INK};">${escapeHtml(sender.name)}</strong>, your officer at ${escapeHtml(org || portal)} —
             reply to this email to reach them directly.
           </td></tr>
         </table>
       </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f3f4f6;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-collapse:separate;width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
      <tr><td style="height:5px;background:${INK};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:22px 32px 18px 32px;border-bottom:1px solid #eef0f3;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            ${brand ? `<td width="1" style="padding-right:12px;vertical-align:middle;">${brand}</td>` : ""}
            <td style="vertical-align:middle;font-family:${FONT};">
              <div style="font-size:16px;font-weight:bold;color:${INK};">${escapeHtml(portal)}</div>
              ${org ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${escapeHtml(org)}</div>` : ""}
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:28px 32px 20px 32px;font-family:${FONT};font-size:14px;line-height:1.65;color:#1f2937;">
        ${restyleButtons(html)}
      </td></tr>
      ${senderRow}
      <tr><td style="padding:20px 32px 22px 32px;background:#f9fafb;border-top:1px solid #eef0f3;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b7280;">
        ${help ? `<div style="margin-bottom:6px;"><strong style="color:#374151;">Need help?</strong> ${help}</div>` : ""}
        <div>This is an automated message from ${escapeHtml(portal)}. ${escapeHtml(org || "We")} will never ask for your password.</div>
      </td></tr>
    </table>
    <div style="font-family:${FONT};font-size:11px;color:#9ca3af;margin-top:14px;">
      © ${year} ${escapeHtml(org || portal)}${footerText ? ` · ${escapeHtml(footerText)}` : ""}
    </div>
  </td></tr>
</table>
</body>
</html>`;
}

module.exports = { renderEmail };
