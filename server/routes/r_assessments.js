const express = require("express");
const router = express.Router();
const controller = require("../controller/c_assessments");
const { requireMenuAccess, requireRole } = require("../middleware/m_auth");

const MENU_KEY = "assessment:queue";

// Read
router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.get("/summary", requireMenuAccess(MENU_KEY, "view"), controller.summary);
router.get("/evaluators", requireMenuAccess(MENU_KEY, "view"), controller.evaluators);
router.get("/:applicationId", requireMenuAccess(MENU_KEY, "view"), controller.detail);

// Assessment header actions
router.patch("/:applicationId/assign", requireMenuAccess(MENU_KEY, "edit"), controller.assign);
router.patch("/:applicationId/stage", requireMenuAccess(MENU_KEY, "edit"), controller.setStage);
router.patch("/:applicationId/reopen", requireRole("admin"), controller.reopen);
router.post("/:applicationId/recommendation", requireMenuAccess(MENU_KEY, "edit"), controller.recommendation);

// Documentary compliance — proxy to the application requirement workflow, gated by assessment access
router.patch("/requirements/:id/status", requireMenuAccess(MENU_KEY, "edit"), controller.updateRequirementStatus);
router.patch("/requirements/:id/remarks", requireMenuAccess(MENU_KEY, "edit"), controller.updateRequirementRemarks);
router.get("/requirements/:id/comments", requireMenuAccess(MENU_KEY, "view"), controller.listRequirementComments);
router.post("/requirements/:id/comments", requireMenuAccess(MENU_KEY, "edit"), controller.addRequirementComment);
// Ad-hoc ask outside the pre-seeded requirement catalog, scoped to this one application.
router.post("/:applicationId/requirements/custom", requireMenuAccess(MENU_KEY, "add"), controller.addCustomRequirement);

// Charges
router.post("/:applicationId/charges", requireMenuAccess(MENU_KEY, "add"), controller.addCharge);
router.patch("/charges/:id", requireMenuAccess(MENU_KEY, "edit"), controller.updateCharge);
router.delete("/charges/:id", requireMenuAccess(MENU_KEY, "delete"), controller.deleteCharge);

module.exports = router;
