const { selectData, updateSchema, runInTransaction } = require("../config/database");

// Portal Settings (settings:portal) — what an administrator can change about
// the portal itself without a developer: branding, outgoing email, the Google
// Maps key, security policy and announcements. One row per setting; which
// keys exist, their types and limits live in server/lib/siteSettings.js, so
// this table never holds a key the app doesn't know about. Secrets are stored
// encrypted (lib/crypto.js) and flagged is_secret so they're never sent back.
async function createSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.site_settings', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.site_settings (
        setting_key NVARCHAR(100) NOT NULL CONSTRAINT PK_site_settings PRIMARY KEY,
        setting_value NVARCHAR(MAX) NULL,
        is_secret BIT NOT NULL CONSTRAINT DF_site_settings_is_secret DEFAULT (0),
        updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_site_settings_updated_at DEFAULT (SYSUTCDATETIME()),
        updated_by INT NULL,
        updated_by_username NVARCHAR(100) NULL
      );
    END
  `);
}

// Once per process; cleared on failure so the next call retries.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = createSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function listAll() {
  await ensureSchema();
  return selectData(
    `SELECT setting_key, setting_value, is_secret, updated_at, updated_by, updated_by_username FROM dbo.site_settings`
  );
}

/**
 * Writes several settings in one transaction. `values` maps key → { value,
 * isSecret }. A null value means "back to the default"; the row is kept
 * (value NULL) rather than deleted so the section's version still moves on.
 * `expectedVersion` is the section's version the admin's form was loaded at
 * (latest updated_at of `versionKeys`, ISO string or null): if another save
 * landed in between, nothing is written and a 409 error is thrown instead of
 * silently overwriting it.
 *
 * For the one-time .env import: `requireAbsentKey` makes the whole write a
 * no-op ({ written: false }) if that key already exists, and `insertOnly`
 * adds only keys that don't exist yet, never touching a saved row. Both are
 * checked under lock inside the transaction, so two servers starting at
 * once can't both import, and nothing saved meanwhile is overwritten.
 * Resolves { written, inserted } (inserted = keys actually added).
 */
async function saveMany(values, { actorId, actorUsername, versionKeys, expectedVersion, requireAbsentKey, insertOnly } = {}) {
  await ensureSchema();
  const entries = Object.entries(values);
  const actor = [Number.isFinite(Number(actorId)) ? Number(actorId) : null, actorUsername ?? null];
  return runInTransaction(async (tx) => {
    if (requireAbsentKey) {
      const existing = await tx.query(
        `SELECT 1 AS found FROM dbo.site_settings WITH (UPDLOCK, HOLDLOCK) WHERE setting_key = @param0`,
        [requireAbsentKey]
      );
      if (existing.recordset?.length) return { written: false, inserted: [] };
    }
    if (insertOnly) {
      const inserted = [];
      for (const [key, { value, isSecret }] of entries) {
        const result = await tx.query(
          `
          IF NOT EXISTS (SELECT 1 FROM dbo.site_settings WITH (UPDLOCK, HOLDLOCK) WHERE setting_key = @param0)
            INSERT INTO dbo.site_settings (setting_key, setting_value, is_secret, updated_at, updated_by, updated_by_username)
            VALUES (@param0, @param1, @param2, SYSUTCDATETIME(), @param3, @param4);
          `,
          [key, value === null || value === undefined ? null : String(value), isSecret ? 1 : 0, ...actor]
        );
        if ((result.rowsAffected || []).some((n) => n > 0)) inserted.push(key);
      }
      return { written: true, inserted };
    }
    if (versionKeys?.length) {
      const placeholders = versionKeys.map((_, i) => `@param${i}`).join(", ");
      // UPDLOCK + HOLDLOCK: two saves racing on the same section serialize here.
      const result = await tx.query(
        `SELECT MAX(updated_at) AS version FROM dbo.site_settings WITH (UPDLOCK, HOLDLOCK) WHERE setting_key IN (${placeholders})`,
        versionKeys
      );
      const current = result.recordset?.[0]?.version;
      const currentIso = current ? new Date(current).toISOString() : null;
      if ((expectedVersion || null) !== currentIso) {
        throw Object.assign(
          new Error("These settings were changed by someone else since you opened them. Reload to see the latest values, then try again."),
          { status: 409 }
        );
      }
    }
    for (const [key, { value, isSecret }] of entries) {
      await tx.query(
        `
        MERGE dbo.site_settings WITH (HOLDLOCK) AS t
        USING (SELECT @param0 AS setting_key) AS s ON t.setting_key = s.setting_key
        WHEN MATCHED THEN
          UPDATE SET setting_value = @param1, is_secret = @param2, updated_at = SYSUTCDATETIME(),
                     updated_by = @param3, updated_by_username = @param4
        WHEN NOT MATCHED THEN
          INSERT (setting_key, setting_value, is_secret, updated_at, updated_by, updated_by_username)
          VALUES (@param0, @param1, @param2, SYSUTCDATETIME(), @param3, @param4);
        `,
        [key, value === null || value === undefined ? null : String(value), isSecret ? 1 : 0, ...actor]
      );
    }
    return { written: true, inserted: entries.map(([key]) => key) };
  });
}

module.exports = { ensureSchema, listAll, saveMany };
