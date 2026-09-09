const express = require("express");
const router = express.Router();
const controller = require("../controller/c_applications");
const { requireRole } = require("../middleware/m_auth");
const { upload } = require("../middleware/m_upload");

// Staff-only: full listing and staff-driven status decisions.
router.get("/", requireRole("admin", "officer"), controller.list);
router.patch("/:id/status", requireRole("admin", "officer"), controller.updateStatus);
router.patch("/requirements/:id/status", requireRole("admin", "officer"), controller.updateRequirementStatus);

// Staff + proponent: a proponent may only ever reach their own application —
// enforced in the controller (loadWithAccess), not here, since that check
// needs the row itself.
router.get("/:id", requireRole("admin", "officer", "proponent"), controller.getById);
router.get("/:id/requirements", requireRole("admin", "officer", "proponent"), controller.listRequirements);
router.get("/:id/documents", requireRole("admin", "officer", "proponent"), controller.listDocuments);
router.get("/:id/status-history", requireRole("admin", "officer", "proponent"), controller.listStatusHistory);

// Self-service filing (BRM-01/02): a proponent files for their own business;
// staff can still file/upload on a proponent's behalf.
router.post("/", requireRole("admin", "officer", "proponent"), controller.create);
router.patch("/:id/submit", requireRole("admin", "officer", "proponent"), controller.submit);
router.post("/documents", requireRole("admin", "officer", "proponent"), upload.single("file"), controller.createDocument);
router.get("/documents/:id/file", requireRole("admin", "officer", "proponent"), controller.downloadDocument);

module.exports = router;
