// Who an evaluation / renewal email to the locator comes from: the officer on
// the application — the assigned evaluator (BDO for a new application, the
// Account Officer for a renewal), else the locator's Account Officer. Passed
// to sendMail({ sender }), which shows "<name> via <portal>" with replies to
// the officer. Null (= the system sender) when there's no officer with an
// email. Account, security and automated emails never use this.
const { selectData } = require("../config/database");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @returns {Promise<{ name: string, email: string } | null>} */
async function officerSenderFor(applicationId) {
  try {
    const rows = await selectData(
      `SELECT TOP (1) u.first_name, u.last_name, u.full_name, u.username, u.email, u.is_active
       FROM dbo.applications a
       INNER JOIN dbo.proponents p ON p.id = a.proponent_id
       LEFT JOIN dbo.application_assessments asm ON asm.application_id = a.id
       INNER JOIN dbo.users u ON u.id = COALESCE(asm.assigned_evaluator_id, p.account_officer_id)
       WHERE a.id = @param0`,
      [Number(applicationId) || 0]
    );
    const u = rows?.[0];
    const email = String(u?.email || "").trim();
    if (!u || !Number(u.is_active) || !EMAIL_RE.test(email) || /@ciac\.local$/i.test(email)) return null;
    // A person's name in the inbox ("Raynan Paras via BRIDGE+"), not the
    // "BDO - Raynan_P" label staff see in the app.
    const name = [u.first_name, u.last_name].map((v) => String(v || "").trim()).filter(Boolean).join(" ") || u.full_name || u.username;
    return { name, email };
  } catch (error) {
    console.error("Officer sender lookup error:", error.message || error);
    return null;
  }
}

module.exports = { officerSenderFor };
