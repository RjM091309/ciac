const Auth = require("../models/Auth");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { verifyFirebaseIdToken } = require("../config/firebaseAdmin");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

function normalizePhoneE164(value) {
  return String(value || "").trim();
}

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required" });
    }

    if (!password) {
      return res.status(400).json({ success: false, message: "Password is required" });
    }

    const result = await Auth.login(username, password);

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

exports.firebasePhoneLogin = async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) {
      return res.status(400).json({ success: false, message: "idToken is required" });
    }

    const decoded = await verifyFirebaseIdToken(idToken);
    const phone = normalizePhoneE164(decoded?.phone_number);
    if (!phone) {
      return res.status(401).json({ success: false, message: "No verified phone number found in Firebase token." });
    }

    const mappedUser = await User.getActiveUserByPhone(phone);
    if (!mappedUser) {
      return res.status(404).json({ success: false, message: "No active account is linked to this phone number." });
    }

    const user = {
      id: mappedUser.id,
      username: mappedUser.username,
      role: mappedUser.role || "user",
    };
    const token = jwt.sign(user, getJwtSecret(), { expiresIn: "24h" });

    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.json({ success: true, message: "Login successful", user });
  } catch (error) {
    console.error("Firebase phone login error:", error);
    return res.status(401).json({ success: false, message: "Invalid or expired phone verification token." });
  }
};

