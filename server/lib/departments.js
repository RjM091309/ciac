// The two staff departments in the application workflow, told apart by
// their Control Panel menus (no role names hardcoded):
//   - BDO (assessment:queue): new applications — Level 2 evaluates, Level 1
//     assigns and approves ("For Approval").
//   - Account Officer (applications:renewals / approval:queue): the Approved
//     Queue and, once a locator is theirs, its renewals — same Level 2 review
//     → Level 1 "For Approval" loop, without the BDO.
// Level 1 / Level 2 is per user (users.assessment_level, AssessmentEvaluation.isManager).
const { checkMenuAllowed } = require("../middleware/m_auth");

/** "admin" | "bdo" | "ao" | null */
async function departmentOf(user) {
  const role = String(user?.role || "").trim().toLowerCase();
  if (!role) return null;
  if (role === "admin") return "admin";
  if (await checkMenuAllowed(role, "assessment:queue", "view")) return "bdo";
  if (
    (await checkMenuAllowed(role, "applications:renewals", "view")) ||
    (await checkMenuAllowed(role, "approval:queue", "view"))
  ) {
    return "ao";
  }
  return null;
}

/** A Level 2 Account Officer's own user id (they only work their own
 * locators), or null for everyone else. */
async function aoLevel2Id(user) {
  if ((await departmentOf(user)) !== "ao") return null;
  const Assessment = require("../models/AssessmentEvaluation");
  if (await Assessment.isManager(user)) return null;
  return Number(user.id) || null;
}

module.exports = { departmentOf, aoLevel2Id };
