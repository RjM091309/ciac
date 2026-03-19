const express = require("express");
const router = express.Router();
const controller = require("../controller/c_applications");
const { requireRole } = require("../middleware/m_auth");

router.get("/", requireRole("admin"), controller.list);
router.get("/:id", requireRole("admin"), controller.getById);
router.post("/", requireRole("admin"), controller.create);
router.patch("/:id/status", requireRole("admin"), controller.updateStatus);

router.get("/:id/requirements", requireRole("admin"), controller.listRequirements);
router.get("/:id/documents", requireRole("admin"), controller.listDocuments);
router.get("/:id/status-history", requireRole("admin"), controller.listStatusHistory);

router.patch("/requirements/:id/status", requireRole("admin"), controller.updateRequirementStatus);
router.post("/documents", requireRole("admin"), controller.createDocument);

module.exports = router;
