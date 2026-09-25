const express = require("express");
const router = express.Router();
const controller = require("../controller/c_approvals");
const { requireMenuAccess, requireRole } = require("../middleware/m_auth");

const MENU_KEY = "approval:queue";

// Read
router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.get("/summary", requireMenuAccess(MENU_KEY, "view"), controller.summary);
router.get("/:applicationId", requireMenuAccess(MENU_KEY, "view"), controller.detail);

// Header / approval decision
router.post("/:applicationId/start", requireMenuAccess(MENU_KEY, "edit"), controller.start);
router.patch("/:applicationId/reopen", requireRole("admin"), controller.reopen);
router.patch("/steps/:id/act", requireMenuAccess(MENU_KEY, "edit"), controller.actOnStep);
router.patch("/steps/:id/endorse", requireMenuAccess(MENU_KEY, "edit"), controller.endorseStep);

// Charges — assessed during Assessment Evaluation
router.post("/:applicationId/charges", requireMenuAccess(MENU_KEY, "add"), controller.addCharge);
router.patch("/charges/:id", requireMenuAccess(MENU_KEY, "edit"), controller.updateCharge);
router.delete("/charges/:id", requireMenuAccess(MENU_KEY, "delete"), controller.deleteCharge);

// Contract
router.put("/:applicationId/contract", requireMenuAccess(MENU_KEY, "edit"), controller.saveContract);
router.get("/contracts/:id/certificate", requireMenuAccess(MENU_KEY, "view"), controller.downloadContractCertificate);
router.get("/:applicationId/contract/next-number", requireMenuAccess(MENU_KEY, "view"), controller.previewContractNo);

module.exports = router;
