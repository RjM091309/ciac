// Who's on the other side of an application, in messages: a "proponent"
// while a new application is with the BDO; a "locator" once it's the
// Account Officer's (approved, and its renewals). Same as src/lib/party.ts.
const { selectData } = require("../config/database");

function partyWord(isRenewal) {
  return Number(isRenewal) ? "locator" : "proponent";
}

/** The word for this application ("proponent" | "locator"). */
async function partyOf(applicationId) {
  const rows = await selectData(`SELECT TOP (1) is_renewal FROM dbo.applications WHERE id = @param0`, [Number(applicationId) || 0]);
  return partyWord(rows?.[0]?.is_renewal);
}

module.exports = { partyWord, partyOf };
