// Cross-site request forgery guard for the cookie-based JWT session. Browsers
// send an Origin header on every state-changing fetch/XHR/form submission —
// including same-origin ones — so rejecting state-changing /api requests
// whose Origin isn't in the same allowlist CORS already trusts blocks a
// malicious page from riding the victim's session cookie, without requiring
// every frontend call site to attach a CSRF token.
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfGuard(allowedOrigins) {
  return function csrfGuardMiddleware(req, res, next) {
    if (!MUTATING_METHODS.has(req.method)) return next();
    if (!req.path.startsWith("/api/")) return next();

    const origin = req.get("origin");
    // No Origin header: same-origin top-level navigation, or a non-browser
    // client (curl, server-to-server) — matches the CORS allowance below for
    // the same reason, and login itself needs to work for such clients.
    if (!origin) return next();

    const normalized = String(origin).trim().replace(/\/+$/, "");
    if (allowedOrigins.includes(normalized)) return next();

    return res.status(403).json({ success: false, message: "Cross-site request blocked" });
  };
}

module.exports = { csrfGuard };
