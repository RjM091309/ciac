const express = require("express");
const router = express.Router();
const controller = require("../controller/c_applications");
const { requireApplicationsAccess } = require("../middleware/m_auth");
const { upload } = require("../middleware/m_upload");

// Staff-only: full listing and staff-driven status decisions.
router.get("/", requireApplicationsAccess(), controller.list);
router.patch("/:id/status", requireApplicationsAccess(), controller.updateStatus);
router.patch("/requirements/:id/status", requireApplicationsAccess(), controller.updateRequirementStatus);

// Staff + proponent: a proponent may only ever reach their own application —
// enforced in the controller (loadWithAccess), not here, since that check
// needs the row itself.
router.get("/:id", requireApplicationsAccess({ allowProponent: true }), controller.getById);
router.get("/:id/requirements", requireApplicationsAccess({ allowProponent: true }), controller.listRequirements);
router.get("/:id/documents", requireApplicationsAccess({ allowProponent: true }), controller.listDocuments);
router.get("/:id/status-history", requireApplicationsAccess({ allowProponent: true }), controller.listStatusHistory);

// Filing a new application is staff-only now (Assessment Officer creates it
// on the locator's behalf) — a locator's only self-service actions are
// viewing their own applications and uploading documents against them.
router.post("/", requireApplicationsAccess(), controller.create);
router.patch("/:id/submit", requireApplicationsAccess({ allowProponent: true }), controller.submit);
// Editing/deleting a draft is staff-only too (Assessment Officer's call).
router.patch("/:id", requireApplicationsAccess(), controller.updateDraft);
router.delete("/:id", requireApplicationsAccess(), controller.remove);
router.post("/documents", requireApplicationsAccess({ allowProponent: true }), upload.single("file"), controller.createDocument);
router.get("/documents/:id/file", requireApplicationsAccess({ allowProponent: true }), controller.downloadDocument);

module.exports = router;
