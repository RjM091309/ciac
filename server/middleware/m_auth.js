const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

function attachUserFromJwt(req, res, next) {
  const token = req.cookies?.jwt;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
    };
    res.locals.user = req.user;
  } catch {
    res.clearCookie("jwt");
  }

  next();
}

function isAuthenticated(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  return res.redirect("/authentication/signin");
}

function authenticateToken(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Access token required" });
  }
  return next();
}

module.exports = {
  attachUserFromJwt,
  isAuthenticated,
  authenticateToken,
};

