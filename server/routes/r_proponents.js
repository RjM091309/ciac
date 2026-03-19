const express = require("express");
const router = express.Router();
const proponentsController = require("../controller/c_proponents");
const { requireRole } = require("../middleware/m_auth");

router.get("/", requireRole("admin"), proponentsController.list);
router.get("/:id", requireRole("admin"), proponentsController.getById);
router.post("/", requireRole("admin"), proponentsController.create);
router.put("/:id", requireRole("admin"), proponentsController.update);
router.patch("/:id/deactivate", requireRole("admin"), proponentsController.deactivate);
router.patch("/:id/reactivate", requireRole("admin"), proponentsController.reactivate);

module.exports = router;

