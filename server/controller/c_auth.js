const Auth = require("../models/Auth");

exports.login = async (req, res) => {
  try {
    const { username, password, adminlogin } = req.body || {};

    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required" });
    }

    if (!adminlogin && !password) {
      return res.status(400).json({ success: false, message: "Password is required" });
    }

    const result = await Auth.login(username, password, req);

    if (!result.success) {
      return res.status(401).json({ success: false, message: result.message });
    }

    res.cookie("jwt", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.json({ success: true, message: result.message, user: result.user });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.logout = async (req, res) => {
  res.clearCookie("jwt");
  return res.json({ success: true, message: "Logged out successfully" });
};

exports.checkAuth = async (req, res) => {
  if (req.user) return res.json({ success: true, authenticated: true, user: req.user });
  return res.json({ success: true, authenticated: false });
};

