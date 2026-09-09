const express = require("express");
const router = express.Router();
const proponentsController = require("../controller/c_proponents");
const portalController = require("../controller/c_proponent_portal");
const { requireMenuAccess, requireProponentSelf, requireOwnApplication } = require("../middleware/m_auth");
const { handleUpload } = require("../lib/fileStorage");

const MENU_KEY = "settings:proponents";

// Proponent self-service — must be declared before "/:id" so "me" isn't parsed as an id.
router.get("/me", requireProponentSelf, proponentsController.getMine);
router.patch("/me", requireProponentSelf, proponentsController.updateMine);

// Proponent read-only portal: their own applications and related records.
router.get("/me/applications", requireProponentSelf, portalController.listMyApplications);
router.get("/me/applications/:id", requireProponentSelf, requireOwnApplication, portalController.getMyApplication);
router.get("/me/applications/:id/requirements", requireProponentSelf, requireOwnApplication, portalController.getMyApplicationRequirements);
router.get("/me/applications/:id/documents", requireProponentSelf, requireOwnApplication, portalController.getMyApplicationDocuments);
router.post(
  "/me/applications/:id/documents",
  requireProponentSelf,
  requireOwnApplication,
  handleUpload,
  portalController.uploadMyApplicationDocument
);
router.get("/me/applications/:id/status-history", requireProponentSelf, requireOwnApplication, portalController.getMyApplicationStatusHistory);
router.get("/me/applications/:id/contract", requireProponentSelf, requireOwnApplication, portalController.getMyApplicationContract);
router.get("/me/applications/:id/permits", requireProponentSelf, requireOwnApplication, portalController.getMyApplicationPermits);

router.get("/me/contracts", requireProponentSelf, portalController.listMyContracts);
router.get("/me/permits", requireProponentSelf, portalController.listMyPermits);
router.get("/me/activity", requireProponentSelf, portalController.getMyActivity);

// Admin review of profile change requests — before "/:id" for the same reason.
router.get("/change-requests", requireMenuAccess(MENU_KEY, "view"), proponentsController.listChangeRequests);
router.patch("/change-requests/:id/approve", requireMenuAccess(MENU_KEY, "edit"), proponentsController.approveChangeRequest);
router.patch("/change-requests/:id/reject", requireMenuAccess(MENU_KEY, "edit"), proponentsController.rejectChangeRequest);

router.get("/", requireMenuAccess(MENU_KEY, "view"), proponentsController.list);
router.get("/:id", requireMenuAccess(MENU_KEY, "view"), proponentsController.getById);
router.post("/", requireMenuAccess(MENU_KEY, "add"), proponentsController.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), proponentsController.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), proponentsController.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), proponentsController.reactivate);

module.exports = router;
