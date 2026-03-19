const jwt = require("jsonwebtoken");
const { selectData } = require("../config/database");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

function getDemoAdminCreds() {
  return {
    username: process.env.CIAC_ADMIN_USERNAME || "admin",
    password: process.env.CIAC_ADMIN_PASSWORD || "admin123",
  };
}

function normalizeString(v) {
  return String(v ?? "").trim();
}

function pickPasswordField(row) {
  if (!row || typeof row !== "object") return null;
  const keys = Object.keys(row);
  const candidates = ["password", "passwd", "pass", "user_password", "password_hash", "hash"];
  const found = candidates.find((c) => keys.some((k) => k.toLowerCase() === c));
  if (!found) return null;
  const actualKey = keys.find((k) => k.toLowerCase() === found);
  return actualKey || null;
}

async function loginViaDatabase(username, password, req) {
  const userKey = normalizeString(username);
  const pass = String(password ?? "");
  const isAdminMode = req?.body?.adminlogin === "1" || req?.body?.adminlogin === 1 || req?.body?.adminlogin === true;

  // Prefer active accounts first
  const activeRows = await selectData(
    `
      SELECT TOP (1)
        u.*,
        r.name as role_name
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE (u.username = @param0 OR u.email = @param0)
        AND u.is_active = 1
    `,
    [userKey]
  );

  let row = activeRows?.[0];

  // If not active, check if account exists but locked/inactive
  if (!row) {
    const inactiveRows = await selectData(
      `
        SELECT TOP (1) u.id, u.is_active
        FROM users u
        WHERE (u.username = @param0 OR u.email = @param0)
          AND u.is_active = 0
      `,
      [userKey]
    );
    if (inactiveRows?.[0]) {
      return { success: false, message: "Your account was locked." };
    }
    return { success: false, message: "User not found" };
  }

  if (!isAdminMode) {
    const passField = pickPasswordField(row);
    if (!passField) {
      return { success: false, message: "Password field not found in users. Configure your schema or update Auth model." };
    }
    const stored = String(row[passField] ?? "");
    // If bcrypt hash, require bcrypt implementation
    if (stored.startsWith("$2")) {
      return { success: false, message: "Password appears hashed (bcrypt). Install bcrypt and update password check." };
    }
    if (stored !== pass) return { success: false, message: "Username and Password incorrect!" };
  }

  const id = row.id ?? row.user_id ?? 0;
  const role = row.role_name || row.role || "user";
  const user = { id, username: row.username || row.email || userKey, role };
  const token = jwt.sign(user, getJwtSecret(), { expiresIn: "24h" });
  return { success: true, message: "Login successful", user, token };
}

async function login(username, password, req) {
  // Prefer DB if configured; fallback to demo creds
  try {
    return await loginViaDatabase(username, password, req);
  } catch (err) {
    // Only fallback if DB isn't configured; otherwise surface the real issue.
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : "";
    if (msg && !msg.toLowerCase().includes("database is not configured") && !msg.toLowerCase().includes("db env not set")) {
      return { success: false, message: msg || "Login failed" };
    }

    const { username: adminUser, password: adminPass } = getDemoAdminCreds();
    const isAdminMode =
      req?.body?.adminlogin === "1" || req?.body?.adminlogin === 1 || req?.body?.adminlogin === true;

    if (isAdminMode) {
      if (normalizeString(username) !== normalizeString(adminUser)) {
        return { success: false, message: "Invalid admin username" };
      }
    } else {
      if (normalizeString(username) !== normalizeString(adminUser) || String(password) !== String(adminPass)) {
        return { success: false, message: "Username and Password incorrect!" };
      }
    }

    const user = { id: 1, username: adminUser, role: "admin" };
    const token = jwt.sign(user, getJwtSecret(), { expiresIn: "24h" });
    return { success: true, message: "Login successful", user, token };
  }
}

module.exports = {
  login,
};

