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

module.exports = router;
