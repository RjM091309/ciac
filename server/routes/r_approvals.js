const express = require("express");
const router = express.Router();
const controller = require("../controller/c_approvals");
const { requireMenuAccess, requireApprovalAccess, requireRole } = require("../middleware/m_auth");

const MENU_KEY = "approval:queue";

// Account Officer assignment queue (/approval): new applications a Level 1
// BDO approved, waiting for Level 1 Account Officer to assign a Level 2.
router.get("/assignment-queue", requireMenuAccess(MENU_KEY, "view"), controller.assignmentQueue);
router.post("/assignment-queue/:applicationId/assign", requireMenuAccess(MENU_KEY, "edit"), controller.assignAccountOfficer);

// Read
router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.get("/summary", requireMenuAccess(MENU_KEY, "view"), controller.summary);

// The approval panel itself — approval:queue, or a Level 1 BDO approving a
// new application from the Evaluation Queue (see requireApprovalAccess).
router.get("/contracts/:id/certificate", requireApprovalAccess("view"), controller.downloadContractCertificate);
router.get("/:applicationId", requireApprovalAccess("view"), controller.detail);

// Header / approval decision
router.post("/:applicationId/start", requireApprovalAccess("edit"), controller.start);
router.patch("/:applicationId/reopen", requireRole("admin"), controller.reopen);
router.patch("/steps/:id/act", requireApprovalAccess("edit"), controller.actOnStep);
router.patch("/steps/:id/endorse", requireApprovalAccess("edit"), controller.endorseStep);

// Charges — assessed during Assessment Evaluation
router.post("/:applicationId/charges", requireApprovalAccess("add"), controller.addCharge);
router.patch("/charges/:id", requireApprovalAccess("edit"), controller.updateCharge);
router.delete("/charges/:id", requireApprovalAccess("delete"), controller.deleteCharge);

// Contract
router.put("/:applicationId/contract", requireApprovalAccess("edit"), controller.saveContract);
router.get("/:applicationId/contract/next-number", requireApprovalAccess("view"), controller.previewContractNo);

module.exports = router;
