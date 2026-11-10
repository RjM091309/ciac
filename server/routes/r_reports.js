const express = require("express");
const router = express.Router();
const controller = require("../controller/c_reports");
const { requireMenuAccess } = require("../middleware/m_auth");

const MENU_KEY = "reports:analytics";

router.get("/overview", requireMenuAccess(MENU_KEY, "view"), controller.overview);
router.get("/applications", requireMenuAccess(MENU_KEY, "view"), controller.applications);
router.get("/stockholders", requireMenuAccess(MENU_KEY, "view"), controller.stockholders);
router.get("/investments", requireMenuAccess(MENU_KEY, "view"), controller.investments);
router.get("/locator-status", requireMenuAccess(MENU_KEY, "view"), controller.locatorStatus);
router.get("/gis", requireMenuAccess(MENU_KEY, "view"), controller.gis);
router.get("/summary", requireMenuAccess(MENU_KEY, "view"), controller.summary);
router.post("/export-log", requireMenuAccess(MENU_KEY, "view"), controller.logExport);
// Custom Report: dataset / columns / filters chosen by the user; templates are per user.
router.get("/custom/catalog", requireMenuAccess(MENU_KEY, "view"), controller.customCatalog);
router.post("/custom/run", requireMenuAccess(MENU_KEY, "view"), controller.customRun);
router.get("/custom/quick-total/options", requireMenuAccess(MENU_KEY, "view"), controller.customQuickTotalOptions);
router.post("/custom/quick-total", requireMenuAccess(MENU_KEY, "view"), controller.customQuickTotal);
router.get("/custom/templates", requireMenuAccess(MENU_KEY, "view"), controller.customTemplates);
router.post("/custom/templates", requireMenuAccess(MENU_KEY, "view"), controller.saveCustomTemplate);
router.delete("/custom/templates/:id", requireMenuAccess(MENU_KEY, "view"), controller.deleteCustomTemplate);
router.post("/custom/templates/:id/send-test", requireMenuAccess(MENU_KEY, "view"), controller.sendCustomTemplateTest);
router.get("/custom/monthly-recipients", requireMenuAccess(MENU_KEY, "view"), controller.monthlyReportRecipients);

module.exports = router;
