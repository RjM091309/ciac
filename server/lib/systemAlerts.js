// System alerts: the only notifications an admin gets. Routine application
// events go to the people who act on them (BDO / Account Officer / locator);
// an admin hears about things that broke and need fixing — an email that
// couldn't be sent, a step that saved halfway, a certificate that failed.
//
// The same alert (by `key`) is sent at most once per `throttleMs`, so a
// recurring failure (e.g. SMTP down) doesn't flood the bell.

const DEFAULT_THROTTLE_MS = 30 * 60 * 1000;
const lastSent = new Map();

async function alertAdmins({ key, subject, body, applicationId = null, throttleMs = DEFAULT_THROTTLE_MS }) {
  try {
    const k = String(key || subject);
    const now = Date.now();
    if (lastSent.has(k) && now - lastSent.get(k) < throttleMs) return;
    // Forget alerts older than a day so the map doesn't grow forever.
    for (const [old, at] of lastSent) if (now - at > 24 * 60 * 60 * 1000) lastSent.delete(old);

    // Lazy: models require the mailer, which reports through here.
    const { selectData } = require("../config/database");
    const Notification = require("../models/Notification");
    const admins = await selectData(`
      SELECT DISTINCT u.id
      FROM dbo.users u
      INNER JOIN dbo.user_roles ur ON ur.user_id = u.id
      INNER JOIN dbo.roles r ON r.id = ur.role_id
      WHERE u.is_active = 1 AND LOWER(LTRIM(RTRIM(r.name))) = 'admin'
    `);
    for (const { id } of admins) {
      await Notification.createNotification({
        userId: id,
        subject: String(subject).slice(0, 200),
        body: body ? String(body).slice(0, 2000) : null,
        applicationId,
        eventType: "system",
      });
    }
    // Throttle only once it actually went out — a failed attempt retries next time.
    lastSent.set(k, now);
  } catch (error) {
    console.error("System alert error:", error);
  }
}

module.exports = { alertAdmins };
