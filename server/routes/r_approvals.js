const express = require("express");
const router = express.Router();
const controller = require("../controller/c_approvals");
const { requireMenuAccess, requireRole } = require("../middleware/m_auth");

const MENU_KEY = "approval:queue";

// Configurable approval hierarchy (Workflow Setup). Declared before the
// dynamic "/:applicationId" route so "levels" isn't swallowed as an id.
router.get("/levels", requireMenuAccess(MENU_KEY, "view"), controller.listLevels);
router.post("/levels", requireMenuAccess(MENU_KEY, "edit"), controller.createLevel);
router.put("/levels/:id", requireMenuAccess(MENU_KEY, "edit"), controller.updateLevel);
router.delete("/levels/:id", requireMenuAccess(MENU_KEY, "edit"), controller.deleteLevel);

// Read
router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.get("/summary", requireMenuAccess(MENU_KEY, "view"), controller.summary);
router.get("/approvers", requireMenuAccess(MENU_KEY, "view"), controller.approvers);
router.get("/:applicationId", requireMenuAccess(MENU_KEY, "view"), controller.detail);

// Header / routing ladder
router.post("/:applicationId/start", requireMenuAccess(MENU_KEY, "edit"), controller.start);
router.patch("/:applicationId/reopen", requireRole("admin"), controller.reopen);
router.patch("/steps/:id/act", requireMenuAccess(MENU_KEY, "edit"), controller.actOnStep);
router.patch("/steps/:id/endorse", requireMenuAccess(MENU_KEY, "edit"), controller.endorseStep);
router.patch("/steps/:id/assign", requireMenuAccess(MENU_KEY, "edit"), controller.assignStep);

// Charges — assessed by the Account Officer at Level 1 review
router.post("/:applicationId/charges", requireMenuAccess(MENU_KEY, "add"), controller.addCharge);
router.patch("/charges/:id", requireMenuAccess(MENU_KEY, "edit"), controller.updateCharge);
router.delete("/charges/:id", requireMenuAccess(MENU_KEY, "delete"), controller.deleteCharge);

// Issuance + contract
router.post("/:applicationId/issuances", requireMenuAccess(MENU_KEY, "add"), controller.addIssuance);
router.delete("/issuances/:id", requireMenuAccess(MENU_KEY, "delete"), controller.deleteIssuance);
router.put("/:applicationId/contract", requireMenuAccess(MENU_KEY, "edit"), controller.saveContract);
router.get("/contracts/:id/certificate", requireMenuAccess(MENU_KEY, "view"), controller.downloadContractCertificate);
router.get("/:applicationId/contract/next-number", requireMenuAccess(MENU_KEY, "view"), controller.previewContractNo);

module.exports = router;
