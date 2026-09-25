const express = require("express");
const router = express.Router();
const controller = require("../controller/c_inspections");
const { requireMenuAccess } = require("../middleware/m_auth");

const MENU_KEY = "compliance:inspections";

// Read
router.get("/", requireMenuAccess(MENU_KEY, "view"), controller.list);
router.get("/summary", requireMenuAccess(MENU_KEY, "view"), controller.summary);
router.get("/meta", requireMenuAccess(MENU_KEY, "view"), controller.meta);
router.get("/:id", requireMenuAccess(MENU_KEY, "view"), controller.detail);

// Inspection header
router.post("/", requireMenuAccess(MENU_KEY, "add"), controller.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), controller.update);
router.patch("/:id/assign", requireMenuAccess(MENU_KEY, "edit"), controller.assign);
router.patch("/:id/status", requireMenuAccess(MENU_KEY, "edit"), controller.setStatus);
router.patch("/:id/result", requireMenuAccess(MENU_KEY, "edit"), controller.setResult);

// Locator compliance checklist (legacy Compliance / Permits / Performance tabs)
router.get("/locators/compliance", requireMenuAccess(MENU_KEY, "view"), controller.listLocatorCompliance);
router.get("/locators/:id/compliance", requireMenuAccess(MENU_KEY, "view"), controller.listComplianceItems);
router.get("/locators/:id/activity", requireMenuAccess(MENU_KEY, "view"), controller.listLocatorActivity);
router.put("/locators/:id/compliance/:code", requireMenuAccess(MENU_KEY, "edit"), controller.saveComplianceItem);

// Findings
router.post("/:id/findings", requireMenuAccess(MENU_KEY, "add"), controller.addFinding);
router.patch("/findings/:id", requireMenuAccess(MENU_KEY, "edit"), controller.updateFinding);
router.delete("/findings/:id", requireMenuAccess(MENU_KEY, "delete"), controller.deleteFinding);

// Corrective actions
router.post("/:id/actions", requireMenuAccess(MENU_KEY, "add"), controller.addAction);
router.patch("/actions/:id", requireMenuAccess(MENU_KEY, "edit"), controller.updateAction);
router.delete("/actions/:id", requireMenuAccess(MENU_KEY, "delete"), controller.deleteAction);

// Report / supporting documents (metadata only)
router.post("/:id/documents", requireMenuAccess(MENU_KEY, "add"), controller.addDocument);
router.delete("/documents/:id", requireMenuAccess(MENU_KEY, "delete"), controller.deleteDocument);

module.exports = router;
