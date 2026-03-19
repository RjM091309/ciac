const NodeCache = require("node-cache");

const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  useClones: false,
});

const CACHE_KEYS = {
  USERS: "users",
  ROLES: "roles",
  PERMISSIONS: "permissions",
};

module.exports = {
  CACHE_KEYS,
  get: (key) => cache.get(key),
  set: (key, data, ttl = 300) => cache.set(key, data, ttl),
  del: (key) => cache.del(key),
  flushAll: () => cache.flushAll(),
  getStats: () => cache.getStats(),
  has: (key) => cache.has(key),
};

