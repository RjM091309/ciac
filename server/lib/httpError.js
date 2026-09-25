// What an API error response may tell the client. Models and controllers
// throw plain `new Error("…")` with a message written for the user (validation
// and business rules), and those should keep reaching the UI. Everything else
// — MSSQL errors (which quote SQL, table and constraint names), Node system
// errors (file paths), library errors, and JS runtime bugs (TypeError …) —
// gets a generic message instead; the real error is still in the server log.
const GENERIC_MESSAGE = "Something went wrong. Please try again or contact the administrator.";

// Error classes thrown by the mssql / tedious / msnodesqlv8 drivers.
const DB_ERROR_NAMES = new Set([
  "RequestError",
  "ConnectionError",
  "TransactionError",
  "PreparedStatementError",
]);

function isInternalError(error) {
  if (!error || typeof error !== "object") return true;
  // A deliberate HTTP status (e.g. businessError() in AssessmentEvaluation.js)
  // marks the message as written for the client.
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) return false;
  if (DB_ERROR_NAMES.has(error.name)) return true;
  // Plain Error thrown by our own code is the only other trusted kind.
  if (error.name !== "Error") return true;
  // Driver/system/library errors carry these; our own throws don't.
  if (error.code !== undefined || error.errno !== undefined || error.number !== undefined) return true;
  if (error.originalError || error.precedingErrors) return true;
  return false;
}

/** Message safe to send in a JSON error response. */
function publicErrorMessage(error, fallback = GENERIC_MESSAGE) {
  if (isInternalError(error)) return fallback;
  return String(error.message || "").trim() || fallback;
}

module.exports = { publicErrorMessage, isInternalError, GENERIC_MESSAGE };
