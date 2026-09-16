const express = require("express");
const router = express.Router();
const controller = require("../controller/c_reports");
const { requireMenuAccess } = require("../middleware/m_auth");

const MENU_KEY = "reports:analytics";

router.get("/overview", requireMenuAccess(MENU_KEY, "view"), controller.overview);
router.get("/applications", requireMenuAccess(MENU_KEY, "view"), controller.applications);

module.exports = router;
