const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

function isTrustedConnection() {
  return String(process.env.DB_TRUSTED_CONNECTION || "").toLowerCase() === "true";
}

function getOdbcDriver() {
  // Ubuntu hosts commonly have msodbcsql18 installed.
  return process.env.DB_ODBC_DRIVER || "ODBC Driver 18 for SQL Server";
}

const sql = isTrustedConnection() ? require("mssql/msnodesqlv8") : require("mssql");

function getDbConfig() {
  if (isTrustedConnection()) {
    // Windows Authentication (Trusted Connection)
    // Requires msnodesqlv8 driver.
    return {
      connectionString: `Driver={${getOdbcDriver()}};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`,
    };
  }

  // SQL Authentication
  return {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };
}

let pool;

function hasDbEnv() {
  if (!process.env.DB_SERVER || !process.env.DB_NAME) return false;
  if (isTrustedConnection()) return true;
  return Boolean(process.env.DB_USER && process.env.DB_PASSWORD);
}

async function initializeDatabase() {
  try {
    if (pool) return pool;
    if (!hasDbEnv()) {
      console.warn("⚠️ DB env not set. Set DB_SERVER/DB_NAME and either DB_TRUSTED_CONNECTION=true OR DB_USER/DB_PASSWORD.");
      return null;
    }
    console.log("🔍 Connecting to database:", process.env.DB_NAME);
    pool = await sql.connect(getDbConfig());
    console.log("✅ Connected to CIAC database successfully");
    return pool;
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    throw error;
  }
}

async function getConnection() {
  if (!pool) {
    const connected = await initializeDatabase();
    if (!connected) {
      throw new Error("Database is not configured. Set DB_SERVER/DB_NAME and either DB_TRUSTED_CONNECTION=true OR DB_USER/DB_PASSWORD in .env.");
    }
  }
  return pool;
}

async function selectData(query, params = []) {
  const pool = await getConnection();
  const request = pool.request();
  params.forEach((param, index) => request.input(`param${index}`, param));
  const result = await request.query(query);
  return result.recordset;
}

async function insertData(query, params = []) {
  const pool = await getConnection();
  const request = pool.request();
  params.forEach((param, index) => request.input(`param${index}`, param));
  return await request.query(query);
}

async function updateData(query, params = []) {
  const pool = await getConnection();
  const request = pool.request();
  params.forEach((param, index) => request.input(`param${index}`, param));
  return await request.query(query);
}

// Alias for schema migrations/DDL (clearer intent)
async function updateSchema(query, params = []) {
  return await updateData(query, params);
}

module.exports = {
  initializeDatabase,
  getConnection,
  selectData,
  insertData,
  updateData,
  updateSchema,
};

