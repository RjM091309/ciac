// Builds the `changes` list an audit entry stores for an update: which fields
// actually changed, with their old and new values. Callers pass a snapshot of
// the record taken before the save and one taken after, both from the same
// getter, so the two sides always come in the same shape. (Diffing against
// req.body instead reports every field the form happened to send, whether or
// not its value changed.)

// Bookkeeping columns that change on every save and mean nothing to a reviewer.
const IGNORED = new Set(["id", "created_at", "updated_at", "created_by", "updated_by"]);
// Recorded as "changed" without either value, so the audit trail never holds
// a copy of the secret itself.
const MASKED = new Set(["password", "password_hash", "tin", "totp_secret"]);
const MAX_VALUE_LENGTH = 200;
const MAX_CHANGES = 40;

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

function isDateOnly(d) {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

/** Comparable/displayable form of a scalar: "", null and undefined all mean
 * "empty"; booleans (SQL BIT) print as Yes/No; dates at midnight UTC print as
 * plain dates (SQL DATE columns come back that way). */
function normalize(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return isDateOnly(v) ? v.toISOString().slice(0, 10) : v.toISOString();
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v).trim();
  return s === "" ? null : s;
}

function truncate(s) {
  if (s == null) return null;
  return s.length > MAX_VALUE_LENGTH ? `${s.slice(0, MAX_VALUE_LENGTH - 1)}…` : s;
}

/** Collection fingerprint that ignores row ids/timestamps and the parent key,
 * so re-saving the same stockholders (which may be deleted and re-inserted
 * with new ids) doesn't count as a change. */
function fingerprint(list) {
  return JSON.stringify(
    (Array.isArray(list) ? list : []).map((item) => {
      if (!isPlainObject(item)) return normalize(item);
      const out = {};
      for (const key of Object.keys(item).sort()) {
        if (IGNORED.has(key) || key === "proponent_id") continue;
        const value = item[key];
        out[key] = isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : normalize(value);
      }
      return out;
    })
  );
}

/**
 * @param before  record snapshot taken before the save
 * @param after   same getter, after the save
 * @param fields  optional list of fields to compare (e.g. Object.keys(req.body));
 *                defaults to every key on either snapshot
 * @returns array of { field, from, to } | { field, masked: true } |
 *          { field, from_count, to_count } (for list-valued fields)
 *
 * A `<name>_id` field is compared through its `<name>_name` sibling when the
 * snapshot has one (account_officer_id → account_officer_name), so the log
 * reads "Juan → Maria" instead of "12 → 17". An id with no readable sibling
 * is recorded as changed without values.
 */
function diffChanges(before, after, fields) {
  const a = before || {};
  const b = after || {};
  const keys = fields ? [...new Set(fields)] : [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const changes = [];

  for (const field of keys) {
    if (IGNORED.has(field)) continue;
    if (!(field in a) && !(field in b)) continue;
    // Already reported through its `<name>_id` field below.
    if (field.endsWith("_name") && keys.includes(`${field.slice(0, -5)}_id`)) continue;

    if (MASKED.has(field)) {
      if (normalize(a[field]) !== normalize(b[field])) changes.push({ field, masked: true });
      continue;
    }

    const prev = a[field];
    const next = b[field];

    if (Array.isArray(prev) || Array.isArray(next)) {
      if (fingerprint(prev) !== fingerprint(next)) {
        changes.push({
          field,
          from_count: Array.isArray(prev) ? prev.length : 0,
          to_count: Array.isArray(next) ? next.length : 0,
        });
      }
      continue;
    }
    if (isPlainObject(prev) || isPlainObject(next)) {
      if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) changes.push({ field });
      continue;
    }

    if (field.endsWith("_id")) {
      if (normalize(prev) === normalize(next)) continue;
      const nameField = `${field.slice(0, -3)}_name`;
      if (nameField in a || nameField in b) {
        changes.push({ field, from: truncate(normalize(a[nameField])), to: truncate(normalize(b[nameField])) });
      } else {
        changes.push({ field });
      }
      continue;
    }

    const from = normalize(prev);
    const to = normalize(next);
    if (from !== to) changes.push({ field, from: truncate(from), to: truncate(to) });
  }

  return changes.slice(0, MAX_CHANGES);
}

module.exports = { diffChanges };
