const NodeCache = require("node-cache");

// In-process cache for hot, rarely-changing lookups (role ids, Control Panel
// permissions) that every guarded request would otherwise re-query. Writers
// invalidate their own keys; the TTL only bounds staleness from changes made
// outside this process (another instance, or a manual SQL edit).
const cache = new NodeCache({
  stdTTL: 30,
  checkperiod: 60,
  useClones: false,
});

/** Cached `load()` under `key`; a failed load is not cached. */
async function remember(key, load, ttl) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await load();
  if (ttl === undefined) cache.set(key, value);
  else cache.set(key, value, ttl);
  return value;
}

module.exports = {
  remember,
  del: (key) => cache.del(key),
  delPrefix: (prefix) => cache.del(cache.keys().filter((k) => k.startsWith(prefix))),
  flushAll: () => cache.flushAll(),
};
