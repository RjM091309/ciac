// Country of an IP address, looked up offline (geoip-lite's bundled database
// — nothing is sent to an outside service). Used for the Audit Log's Country
// column/filter and the "sign-in from abroad" alert.
//
// The database ships with the package; `npm update geoip-lite` (or its
// `updatedb` script) refreshes it — country-level accuracy stays good for
// months between updates.
const net = require("net");

let geoip = null;
function db() {
  if (geoip === null) {
    try {
      geoip = require("geoip-lite");
    } catch (error) {
      console.error("geoip-lite unavailable — countries won't be shown:", error.message);
      geoip = false;
    }
  }
  return geoip || null;
}

/** Private, loopback and link-local addresses: someone on the office network. */
function isLocal(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    return s === "::1" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80");
  }
  return false;
}

/** "PH", "US"…; "LAN" for the local network; null when unknown. */
function countryCode(ip) {
  const value = String(ip || "").trim().replace(/^::ffff:/i, "");
  if (!value || !net.isIP(value)) return null;
  if (isLocal(value)) return "LAN";
  const hit = db()?.lookup(value);
  return hit?.country ? String(hit.country).toUpperCase() : null;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(code) {
  if (!code) return null;
  if (code === "LAN") return "Local network";
  try {
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

module.exports = { countryCode, countryName, isLocal };
