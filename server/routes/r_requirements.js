const express = require("express");
const router = express.Router();
const controller = require("../controller/c_requirements");
const { requireRole } = require("../middleware/m_auth");

router.get("/", requireRole("admin"), controller.list);
router.get("/:id", requireRole("admin"), controller.getById);
router.post("/", requireRole("admin"), controller.create);
router.put("/:id", requireRole("admin"), controller.update);
router.patch("/:id/deactivate", requireRole("admin"), controller.deactivate);
router.patch("/:id/reactivate", requireRole("admin"), controller.reactivate);

module.exports = router;
