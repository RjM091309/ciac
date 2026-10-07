const express = require("express");
const router = express.Router();
const controller = require("../controller/c_assessments");
const { requireAssessmentAccess, requireRole } = require("../middleware/m_auth");

// BDO (assessment:queue, new applications) or Account Officer
// (applications:renewals, renewals) — see requireAssessmentAccess.

// Read
router.get("/", requireAssessmentAccess("view"), controller.list);
router.get("/summary", requireAssessmentAccess("view"), controller.summary);
router.get("/me", requireAssessmentAccess("view"), controller.me);
router.get("/evaluators", requireAssessmentAccess("view"), controller.evaluators);
router.get("/:applicationId", requireAssessmentAccess("view"), controller.detail);

// Assessment header actions
router.patch("/:applicationId/assign", requireAssessmentAccess("edit"), controller.assign);
router.patch("/:applicationId/stage", requireAssessmentAccess("edit"), controller.setStage);
router.patch("/:applicationId/reopen", requireRole("admin"), controller.reopen);
// Two-level review: Level 2 Officer submits their review, Level 1 Manager
// either returns it or sends it For Approval (approval panel).
router.post("/:applicationId/officer-review", requireAssessmentAccess("edit"), controller.officerReview);
router.post("/:applicationId/return-to-officer", requireAssessmentAccess("edit"), controller.returnToOfficer);
router.post("/:applicationId/for-approval", requireAssessmentAccess("edit"), controller.forApproval);

// Documentary compliance — proxy to the application requirement workflow, gated by assessment access
router.patch("/requirements/:id/status", requireAssessmentAccess("edit"), controller.updateRequirementStatus);
router.patch("/requirements/:id/remarks", requireAssessmentAccess("edit"), controller.updateRequirementRemarks);
router.get("/requirements/:id/comments", requireAssessmentAccess("view"), controller.listRequirementComments);
router.post("/requirements/:id/comments", requireAssessmentAccess("edit"), controller.addRequirementComment);
// Ad-hoc ask outside the pre-seeded requirement catalog, scoped to this one application.
router.post("/:applicationId/requirements/custom", requireAssessmentAccess("add"), controller.addCustomRequirement);

// Charges
router.post("/:applicationId/charges", requireAssessmentAccess("add"), controller.addCharge);
router.patch("/charges/:id", requireAssessmentAccess("edit"), controller.updateCharge);
router.delete("/charges/:id", requireAssessmentAccess("delete"), controller.deleteCharge);

module.exports = router;
