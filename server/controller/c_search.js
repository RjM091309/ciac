const Role = require("../models/Role");
const ControlPanelPermission = require("../models/ControlPanelPermission");
const Assessment = require("../models/AssessmentEvaluation");
const { BUCKET_MENU_KEYS, searchApplications } = require("../models/Search");
const { publicErrorMessage } = require("../lib/httpError");

/** Which buckets (queue) the requesting role may see through search — same
 * Control Panel sidebar permission each queue's own screen already checks,
 * so search never surfaces an application through a door the role couldn't
 * otherwise open. Admin sees every bucket; a Locator sees none (they have
 * their own self-service application list, not this staff-wide search). */
async function resolveAllowedBuckets(role) {
  const normalizedRole = String(role || "").toLowerCase();
  if (normalizedRole === "admin") {
    return new Set(Object.keys(BUCKET_MENU_KEYS));
  }
  if (normalizedRole === "proponent") {
    return new Set();
  }

  const roleId = await Role.getActiveRoleIdByName(role);
  if (!roleId) return new Set();

  const allowed = new Set();
  await Promise.all(
    Object.entries(BUCKET_MENU_KEYS).map(async ([bucket, menuKey]) => {
      if (await ControlPanelPermission.isSidebarVisible(roleId, menuKey)) {
        allowed.add(bucket);
      }
    })
  );
  return allowed;
}

/** Prefers the most "current" queue a result lives in — but only among the
 * buckets this specific viewer can actually open. Without that guard, an
 * Assessment Officer who can see a FOR_APPROVAL application purely through
 * their applications:new access (it's still a non-renewal row) would get
 * routed to /approval and 403 there, since they were never granted
 * approval:queue in the first place. */
function targetPathFor(row, allowedBuckets) {
  if (row.in_approval && allowedBuckets.has("in_approval")) return "/approval";
  if (row.in_assessment && allowedBuckets.has("in_assessment")) return "/assessment";
  if (row.in_renewals && allowedBuckets.has("in_renewals")) return "/applications/renewals";
  if (row.in_completed && allowedBuckets.has("in_completed")) return "/applications/proponents";
  return "/applications/new";
}

exports.search = async (req, res) => {
  try {
    const term = String(req.query?.q || "").trim();
    if (term.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const allowedBuckets = await resolveAllowedBuckets(req.user?.role);
    if (allowedBuckets.size === 0) {
      return res.json({ success: true, data: [] });
    }

    const allRows = await searchApplications(term);
    // A Level 2 Assessment Officer only finds, through the Evaluation Queue
    // door, the applications a Manager assigned to them.
    const level2UserId =
      allowedBuckets.has("in_assessment") && !(await Assessment.isManager(req.user)) ? Number(req.user?.id) : null;
    // Likewise an Account Officer only finds, through the Approval Queue door,
    // approvals assigned to them (or still unassigned).
    const approverId =
      allowedBuckets.has("in_approval") && String(req.user?.role || "").toLowerCase() !== "admin"
        ? Number(req.user?.id)
        : null;
    const rows = allRows.map((row) => {
      let next = row;
      if (level2UserId && Number(row.assessment_evaluator_id) !== level2UserId) next = { ...next, in_assessment: 0 };
      if (approverId && row.approval_assignee_id != null && Number(row.approval_assignee_id) !== approverId) {
        next = { ...next, in_approval: 0 };
      }
      return next;
    });
    const visible = rows.filter((row) =>
      Object.keys(BUCKET_MENU_KEYS).some((bucket) => Number(row[bucket]) === 1 && allowedBuckets.has(bucket))
    );

    const data = visible.map((row) => ({
      id: row.id,
      application_no: row.application_no,
      application_type: row.application_type,
      is_renewal: Boolean(row.is_renewal),
      status: row.status,
      proponent_id: row.proponent_id,
      proponent_name: row.proponent_name,
      target_path: targetPathFor(row, allowedBuckets),
    }));

    return res.json({ success: true, data });
  } catch (error) {
    console.error("Search error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};
