const express = require("express");
const router = express.Router();
const controller = require("../controller/c_applications");
const { requireApplicationsAccess, requireMenuAccess, requireRole } = require("../middleware/m_auth");
const { upload } = require("../middleware/m_upload");
const { verifyUploadedFile } = require("../lib/uploadCheck");

// Staff-only: full listing.
router.get("/", requireApplicationsAccess(), controller.list);
// Admin-only escape hatch: a raw, business-rule-free status jump (no
// mandatory-document check, doesn't start Approval routing on FOR_APPROVAL,
// etc.) — the real path is Assessment's Compliance verify/reject +
// Recommendation submit. Was reachable by any staff role with applications
// access until this lockdown. Deliberately hardcoded to admin only, unlike
// Assessment/Approval's own Reopen (requireMenuAccess(..., "edit")), which
// stays a configurable Control Panel permission any staff role can be
// granted — this one has no such per-role opt-in.
router.patch("/:id/status", requireRole("admin"), controller.updateStatus);
// Verifying/rejecting a requirement is Assessment's job specifically, not
// "any staff role that can see an applications-adjacent queue" — this is
// a legacy duplicate of Assessment's own route
// (POST /api/assessments/requirements/:id/status, requireMenuAccess(MENU_KEY,
// "edit")), unused by the frontend, but still reachable directly. Gated the
// same way that route is, instead of the broad requireApplicationsAccess()
// every other route here uses, so it can't be used to bypass the Assessment
// Officer permission the intended route enforces.
router.patch("/requirements/:id/status", requireMenuAccess("assessment:queue", "edit"), controller.updateRequirementStatus);

// Staff + proponent: a proponent may only ever reach their own application —
// enforced in the controller (loadWithAccess), not here, since that check
// needs the row itself.
router.get("/:id", requireApplicationsAccess({ allowProponent: true }), controller.getById);
router.get("/:id/requirements", requireApplicationsAccess({ allowProponent: true }), controller.listRequirements);
router.get("/:id/documents", requireApplicationsAccess({ allowProponent: true }), controller.listDocuments);
router.get("/:id/status-history", requireApplicationsAccess({ allowProponent: true }), controller.listStatusHistory);

// Per-requirement reply thread + Locator acknowledge — staff + proponent,
// ownership enforced in the controller (loadRequirementWithAccess), same
// pattern as the application-level routes above.
router.get("/requirements/:id/comments", requireApplicationsAccess({ allowProponent: true }), controller.listRequirementComments);
router.post("/requirements/:id/comments", requireApplicationsAccess({ allowProponent: true }), controller.addRequirementComment);
router.patch("/requirements/:id/acknowledge", requireApplicationsAccess({ allowProponent: true }), controller.acknowledgeRequirement);

// Filing a new application is staff-only now (Assessment Officer creates it
// on the locator's behalf) — a locator's only self-service actions are
// viewing their own applications and uploading documents against them.
router.post("/", requireApplicationsAccess(), controller.create);
router.patch("/:id/submit", requireApplicationsAccess({ allowProponent: true }), controller.submit);
// Fixing application_type/is_renewal is staff-only, allowed through the
// Assessment stage (see Workflow.TYPE_EDITABLE_STATUSES); deleting stays
// DRAFT-only (see Workflow.deleteDraftApplication).
router.patch("/:id", requireApplicationsAccess(), controller.updateDraft);
router.delete("/:id", requireApplicationsAccess(), controller.remove);
router.post("/documents", requireApplicationsAccess({ allowProponent: true }), upload.single("file"), verifyUploadedFile, controller.createDocument);
router.get("/documents/:id/file", requireApplicationsAccess({ allowProponent: true }), controller.downloadDocument);

module.exports = router;
