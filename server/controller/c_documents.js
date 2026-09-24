const fs = require("fs");
const path = require("path");
const Workflow = require("../models/ApplicationWorkflow");
const AuditLog = require("../models/AuditLog");
const Proponent = require("../models/Proponent");
const Role = require("../models/Role");
const ControlPanelPermission = require("../models/ControlPanelPermission");
const Assessment = require("../models/AssessmentEvaluation");
const { resolveStoredPath } = require("../lib/fileStorage");

const APPLICATION_ACCESS_MENU_KEYS = ["applications:new", "applications:renewals", "assessment:queue", "approval:queue"];

/** Same check as c_applications.js's hasStaffApplicationAccess — by Control
 * Panel permission rather than a hardcoded role name, so a renamed or custom
 * staff role (e.g. Assessment Officer) isn't wrongly treated as a proponent
 * and 404'd out of documents on applications it's allowed to review. */
async function hasStaffApplicationAccess(role) {
  if (role === "admin") return true;
  const roleId = await Role.getActiveRoleIdByName(role);
  if (!roleId) return false;
  const permissions = await ControlPanelPermission.getSidebarPermissions(roleId);
  return permissions.some(
    (p) => APPLICATION_ACCESS_MENU_KEYS.includes(p.menu_key) && (Number(p.is_enabled) === 1 || p.is_enabled === true)
  );
}

// Authenticated + ownership-checked download. Staff with application access
// may fetch any document; a proponent may only fetch documents on their own
// applications.
exports.download = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }

    const document = await Workflow.getDocumentById(id);
    if (!document) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    const role = String(req.user.role || "").toLowerCase();
    if (!(await hasStaffApplicationAccess(role))) {
      const proponent = await Proponent.getProponentByUserId(req.user.id);
      if (!proponent || Number(document.proponent_id) !== Number(proponent.id)) {
        return res.status(404).json({ success: false, message: "Document not found" });
      }
    } else {
      // A Level 2 Assessment Officer only reaches documents on applications
      // assigned to them.
      const level2UserId = await Assessment.getLevel2OnlyUserId(req.user);
      if (level2UserId && (await Assessment.getAssignedEvaluatorId(document.application_id)) !== level2UserId) {
        return res.status(404).json({ success: false, message: "Document not found" });
      }
    }

    const abs = resolveStoredPath(document.storage_path);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({ success: false, message: "File is no longer available." });
    }

    if (document.content_type) res.type(document.content_type);
    const downloadName = document.original_file_name || document.file_name || path.basename(abs);
    const application = await Workflow.getApplicationById(document.application_id).catch(() => null);
    AuditLog.recordFileAccess(req, {
      kind: "DOCUMENT",
      entityType: "application",
      entityId: document.application_id,
      details: { application_no: application?.application_no, file_name: downloadName },
    });

    // ?view=1 renders the PDF in the browser (officer clicking a requirement
    // to check what the locator submitted) instead of forcing a download —
    // res.download() always sets Content-Disposition: attachment, so that
    // path needs its own inline header + res.sendFile() instead.
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${downloadName.replace(/"/g, "")}"`);
      return res.sendFile(abs);
    }
    return res.download(abs, downloadName);
  } catch (error) {
    console.error("Document download error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
