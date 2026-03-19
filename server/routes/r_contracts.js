const express = require("express");
const router = express.Router();
const controller = require("../controller/c_contracts");
const { requireRole } = require("../middleware/m_auth");

router.get("/application/:applicationId", requireRole("admin"), controller.getByApplicationId);
router.get("/:id", requireRole("admin"), controller.getById);
router.post("/", requireRole("admin"), controller.create);
router.put("/:id", requireRole("admin"), controller.update);

module.exports = router;

