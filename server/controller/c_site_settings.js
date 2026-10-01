const siteSettings = require("../lib/siteSettings");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");
const UserSession = require("../models/UserSession");
const { diffChanges } = require("../lib/auditDiff");
const { publicErrorMessage } = require("../lib/httpError");
const { checkPassword } = require("../lib/reauth");
const { escapeHtml } = require("../lib/html");
const { sendTestMail } = require("../lib/mailer");
const { publishToAll, endSessionStreams } = require("../lib/notificationStream");
const {
  saveBrandingAsset,
  resolveBrandingAsset,
  brandingContentType,
  deleteBrandingAsset,
} = require("../lib/brandingStorage");

// Portal Settings (settings:portal). The public endpoints serve only what the
// login page needs; everything else is admin-only (r_site_settings.js).

function fail(res, status, message, extra = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

function serverError(res, label, error) {
  console.error(`${label} error:`, error);
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  return res.status(status).json({ success: false, message: publicErrorMessage(error) });
}

/** Tells every open page to re-fetch the public settings (names, images,
 * rules, banner) — the event carries no data of its own. */
function broadcastChanged() {
  publishToAll({ at: Date.now() }, "site-settings");
}

/* ------------------------------- public ------------------------------- */

exports.getPublic = async (req, res) => {
  try {
    await siteSettings.ensureLoaded();
  } catch (error) {
    // DB down: the built-in defaults still render a working login page.
    console.error("Portal settings load failed:", error.message);
  }
  res.set("Cache-Control", "no-cache");
  return res.json({ success: true, data: siteSettings.publicSettings() });
};

/** Web app manifest, so "Add to home screen" uses the configured name/icon. */
exports.getManifest = async (req, res) => {
  try {
    await siteSettings.ensureLoaded();
  } catch {
    // defaults below
  }
  const pub = siteSettings.publicSettings();
  const fav = pub.assets.favicon;
  const icons = fav.url
    ? [{ src: fav.url, sizes: "any", type: fav.type }]
    : [
        { src: "/images/favicon/web-app-manifest-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/images/favicon/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ];
  res.set("Cache-Control", "no-cache");
  res.type("application/manifest+json");
  return res.send(
    JSON.stringify({
      name: `${pub.branding.portal_name} — ${pub.branding.org_short_name}`,
      short_name: pub.branding.portal_name,
      icons,
      theme_color: "#ffffff",
      background_color: "#ffffff",
      display: "standalone",
    })
  );
};

exports.getAsset = async (req, res) => {
  try {
    const slot = String(req.params.slot || "");
    if (!siteSettings.isAssetSlot(slot)) return res.status(404).end();
    await siteSettings.ensureLoaded();
    const fileName = siteSettings.assetFile(slot);
    const abs = resolveBrandingAsset(fileName);
    const type = brandingContentType(fileName);
    if (!abs || !type) return res.status(404).end();
    // ?v= is the stored file name, which changes on every upload — a URL
    // with the current one can be cached for good; anything else revalidates.
    res.set("Cache-Control", req.query.v === fileName ? "public, max-age=31536000, immutable" : "no-cache");
    // Served as a bare image only: nothing in it may run or load anything,
    // even if someone opens the URL directly.
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    res.type(type);
    return res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch (error) {
    console.error("Get portal asset error:", error);
    return res.status(404).end();
  }
};

/** Values the signed-in app needs at runtime but that aren't for the public
 * login page. The Maps key is a browser key — Google shows it to the browser
 * anyway — so this is about not handing it to anonymous visitors. */
exports.getRuntime = async (req, res) => {
  try {
    await siteSettings.ensureLoaded();
    return res.json({ success: true, data: { google_maps_api_key: siteSettings.getters.googleMapsApiKey() || null } });
  } catch (error) {
    return serverError(res, "Get portal runtime settings", error);
  }
};

/* -------------------------------- admin -------------------------------- */

exports.getAll = async (req, res) => {
  try {
    await siteSettings.init(); // admin pages never work from an unloaded snapshot
    return res.json({ success: true, data: siteSettings.adminSettings() });
  } catch (error) {
    return serverError(res, "Get portal settings", error);
  }
};

exports.updateSection = async (req, res) => {
  try {
    const section = String(req.params.section || "");
    if (!siteSettings.isSection(section)) return fail(res, 404, "Unknown settings section");
    const meta = siteSettings.SECTIONS[section];
    await siteSettings.init(); // admin pages never work from an unloaded snapshot

    const values = req.body?.values;
    if (!values || typeof values !== "object" || Array.isArray(values)) return fail(res, 400, "Nothing to save.");

    const maintenanceBefore = siteSettings.getters.maintenance().enabled;
    const turningMaintenanceOn = section === "announcements" && values.maintenance_enabled === true && !maintenanceBefore;

    // Email, API key and security policy — and switching the portal off for
    // everyone else — need the admin's password again, under the sign-in
    // lockout (lib/reauth.js), so an unattended or hijacked session can't.
    if (meta.sensitive || turningMaintenanceOn) {
      const password = req.body?.current_password;
      if (!password) return fail(res, 400, "Enter your password to save these settings.", { reauthRequired: true });
      const check = await checkPassword(req, password, "Your password is incorrect.");
      if (!check.ok) return fail(res, check.status, check.message, { reauthRequired: !check.locked, locked: Boolean(check.locked) });
    }

    const result = await siteSettings.saveSection(section, values, {
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      version: typeof req.body?.version === "string" ? req.body.version : null,
    });
    if (result.nothingChanged) return res.json({ success: true, data: siteSettings.adminSettings() });

    const changes = diffChanges(result.before, result.after, result.changedFields);
    if (changes.length) {
      await AuditLog.record({
        actorId: req.user?.id,
        actorUsername: req.user?.username,
        action: "SITE_SETTINGS_UPDATED",
        entityType: "site_settings",
        details: { section, section_label: meta.label, changes },
        req,
      });
    }

    const maintenanceAfter = siteSettings.getters.maintenance().enabled;
    if (maintenanceAfter !== maintenanceBefore) {
      let sessionsEnded = 0;
      if (maintenanceAfter) {
        // Best effort: the setting is already saved, and m_auth.js rejects
        // non-admin tokens on their next request regardless.
        try {
          const ended = await UserSession.endNonAdminSessions();
          sessionsEnded = ended.length;
          const byUser = new Map();
          for (const row of ended) byUser.set(row.user_id, [...(byUser.get(row.user_id) || []), row.id]);
          for (const [userId, sessionIds] of byUser) endSessionStreams(userId, sessionIds, "maintenance");
        } catch (error) {
          console.error("Ending sessions for maintenance mode failed:", error);
        }
      }
      await AuditLog.record({
        actorId: req.user?.id,
        actorUsername: req.user?.username,
        action: maintenanceAfter ? "MAINTENANCE_MODE_ENABLED" : "MAINTENANCE_MODE_DISABLED",
        entityType: "site_settings",
        details: { section, section_label: meta.label, ...(maintenanceAfter ? { sessions_ended: sessionsEnded } : {}) },
        req,
      });
    }

    broadcastChanged();
    return res.json({ success: true, data: siteSettings.adminSettings() });
  } catch (error) {
    return serverError(res, "Update portal settings", error);
  }
};

exports.uploadAsset = async (req, res) => {
  try {
    const slot = String(req.params.slot || "");
    if (!siteSettings.isAssetSlot(slot)) return fail(res, 404, "Unknown image");
    const meta = siteSettings.ASSET_SLOTS[slot];
    if (!req.file?.buffer) return fail(res, 400, "Choose an image to upload.");
    let saved;
    try {
      saved = saveBrandingAsset(slot, req.file.buffer);
    } catch (error) {
      if (error.status === 400) return fail(res, 400, error.message);
      throw error;
    }
    let previous;
    try {
      previous = await siteSettings.setAssetFile(slot, saved.fileName, { actorId: req.user?.id, actorUsername: req.user?.username });
    } catch (error) {
      deleteBrandingAsset(saved.fileName);
      throw error;
    }
    if (previous) deleteBrandingAsset(previous);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "SITE_ASSET_UPLOADED",
      entityType: "site_settings",
      details: { section: "branding", section_label: "Branding", asset: slot, asset_label: meta.label, type: saved.type, size: saved.size, replaced: Boolean(previous) },
      req,
    });
    broadcastChanged();
    return res.json({ success: true, data: siteSettings.adminSettings() });
  } catch (error) {
    return serverError(res, "Upload portal image", error);
  }
};

exports.removeAsset = async (req, res) => {
  try {
    const slot = String(req.params.slot || "");
    if (!siteSettings.isAssetSlot(slot)) return fail(res, 404, "Unknown image");
    const meta = siteSettings.ASSET_SLOTS[slot];
    await siteSettings.init(); // admin pages never work from an unloaded snapshot
    if (!siteSettings.assetFile(slot)) return res.json({ success: true, data: siteSettings.adminSettings() });
    const previous = await siteSettings.setAssetFile(slot, null, { actorId: req.user?.id, actorUsername: req.user?.username });
    if (previous) deleteBrandingAsset(previous);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "SITE_ASSET_REMOVED",
      entityType: "site_settings",
      details: { section: "branding", section_label: "Branding", asset: slot, asset_label: meta.label },
      req,
    });
    broadcastChanged();
    return res.json({ success: true, data: siteSettings.adminSettings() });
  } catch (error) {
    return serverError(res, "Remove portal image", error);
  }
};

const TEST_FIELDS = ["smtp_host", "smtp_port", "smtp_security", "smtp_user", "smtp_pass", "mail_from_address", "mail_from_name", "mail_reply_to"];

/** "Send test email": the Email tab's current (maybe unsaved) values, on top
 * of the saved ones, to the signed-in admin's own address only — never an
 * address from the request, so this can't be used to send mail to anyone. */
exports.sendTestEmail = async (req, res) => {
  try {
    await siteSettings.init(); // admin pages never work from an unloaded snapshot
    const profile = await User.getOwnProfile(req.user.id);
    const to = profile?.email;
    if (!to) return fail(res, 400, "Add an email address to your own account (My Profile) first — the test is sent there.");

    const input = req.body?.values && typeof req.body.values === "object" ? req.body.values : {};
    const overrides = {};
    for (const name of TEST_FIELDS) {
      const field = siteSettings.FIELDS.find((f) => f.key === `email.${name}`);
      const raw = input[name];
      if (raw === undefined || raw === null || (field.type === "secret" && raw === "")) continue;
      overrides[name] = siteSettings.validateValue(field, raw);
    }
    // Same rule as saving: the stored password is only used against the
    // saved server and username, never sent to a different server.
    if (!("smtp_pass" in overrides)) {
      const hostChanged = "smtp_host" in overrides && overrides.smtp_host !== siteSettings.get("email.smtp_host");
      const userChanged = "smtp_user" in overrides && overrides.smtp_user !== siteSettings.get("email.smtp_user");
      if ((hostChanged || userChanged) && siteSettings.get("email.smtp_pass")) {
        return fail(res, 400, "Enter the SMTP password to test a different server or username.");
      }
    }

    const portal = siteSettings.getters.portalLabel();
    const result = await sendTestMail(overrides, {
      to,
      subject: `${portal} test email`,
      text: `This is a test email from ${portal}, sent from Portal Settings by ${req.user.username}. If you received it, the email settings work.\n`,
      html: `<p>This is a test email from <b>${escapeHtml(portal)}</b>, sent from Portal Settings by <b>${escapeHtml(req.user.username)}</b>.</p><p>If you received it, the email settings work.</p>`,
    });
    const effective = siteSettings.mailConfig(overrides).transport;
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "SITE_EMAIL_TEST_SENT",
      entityType: "site_settings",
      details: { section: "email", section_label: "Email", sent: result.sent, host: effective.host || null, port: effective.port, to },
      req,
    });
    if (!result.sent) return fail(res, 400, result.message);
    return res.json({ success: true, message: `Test email sent to ${to}.` });
  } catch (error) {
    return serverError(res, "Send test email", error);
  }
};
