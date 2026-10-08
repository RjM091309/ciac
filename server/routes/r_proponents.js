const express = require("express");
const router = express.Router();
const proponentsController = require("../controller/c_proponents");
const portalController = require("../controller/c_proponent_portal");
const { requireMenuAccess, requireAnyMenuAccess, requireProponentSelf, requireOwnApplication, requireStaffRole } = require("../middleware/m_auth");
const { handleUpload } = require("../lib/fileStorage");
const { uploadDocumentOnly } = require("../middleware/m_upload");
const { verifyUploadedFile } = require("../lib/uploadCheck");

const MENU_KEY = "settings:proponents";

// Proponent self-service — must be declared before "/:id" so "me" isn't parsed as an id.
// There's no self-setup: staff (Assessment Officer) create a locator's
// business profile, so every /me route needs one (requireProponentSelf).
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
router.get("/me/contracts/:id/certificate", requireProponentSelf, portalController.downloadMyContractCertificate);
router.get("/me/permits", requireProponentSelf, portalController.listMyPermits);
router.get("/me/permits/:id/certificate", requireProponentSelf, portalController.downloadMyPermitCertificate);
router.get("/me/activity", requireProponentSelf, portalController.getMyActivity);

// Admin review of profile change requests — before "/:id" for the same reason.
router.get("/change-requests", requireMenuAccess(MENU_KEY, "view"), proponentsController.listChangeRequests);
router.patch("/change-requests/:id/approve", requireMenuAccess(MENU_KEY, "edit"), proponentsController.approveChangeRequest);
router.patch("/change-requests/:id/reject", requireMenuAccess(MENU_KEY, "edit"), proponentsController.rejectChangeRequest);

// Plain reference-data lookup (e.g. the locator dropdown on New
// Applications/Renewal Tracking and Permits Management) — not gated behind
// the settings:proponents CRUD menu, which no sidebar page grants access to
// any more now that the standalone Locator Management page is gone. Staff
// only, though: this returns every business's contact info and decrypted
// TIN, which a Locator account has no legitimate reason to enumerate.
router.get("/", requireStaffRole, proponentsController.list);
// Locators/Proponent List admin page — before "/:id" for the same reason as
// "me"/"change-requests" above.
router.get("/locator-list", requireMenuAccess(MENU_KEY, "view"), proponentsController.listForLocatorList);
router.get("/account-officers", requireMenuAccess(MENU_KEY, "view"), proponentsController.listAccountOfficerOptions);
router.get("/type-of-contract", requireMenuAccess(MENU_KEY, "view"), proponentsController.listTypeOfContractOptions);
router.get("/document-requirements", requireMenuAccess(MENU_KEY, "view"), proponentsController.listDocumentRequirementOptions);
router.get("/industries", requireMenuAccess(MENU_KEY, "view"), proponentsController.listIndustryOptions);
// Also used by Locator Accounts' New Locator Account form.
router.get("/land-uses", requireAnyMenuAccess([MENU_KEY, "settings:locator-users"], "view"), proponentsController.listLandUseOptions);
// Before "/:id" so it isn't read as an id.
router.get("/duplicates", requireMenuAccess(MENU_KEY, "view"), proponentsController.findDuplicates);
router.get("/:id", requireMenuAccess(MENU_KEY, "view"), proponentsController.requireOwnLocator, proponentsController.getById);
router.post("/:id/login", requireMenuAccess(MENU_KEY, "edit"), proponentsController.requireOwnLocator, proponentsController.createLogin);
router.get("/:id/documents", requireMenuAccess(MENU_KEY, "view"), proponentsController.requireOwnLocator, proponentsController.getDocuments);
router.post(
  "/:id/documents",
  requireMenuAccess(MENU_KEY, "edit"),
  proponentsController.requireOwnLocator,
  uploadDocumentOnly,
  verifyUploadedFile,
  proponentsController.uploadDocument
);
router.get("/:id/documents/:docId/download", requireMenuAccess(MENU_KEY, "view"), proponentsController.requireOwnLocator, proponentsController.downloadDocument);
router.delete("/:id/documents/:docId", requireMenuAccess(MENU_KEY, "edit"), proponentsController.requireOwnLocator, proponentsController.deleteDocument);
router.post("/", requireMenuAccess(MENU_KEY, "add"), proponentsController.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), proponentsController.requireOwnLocator, proponentsController.update);
// Section saves (Stockholders / Contact Person + Signatory / Property schedule) — see the controller.
router.put("/:id/stockholders", requireMenuAccess(MENU_KEY, "edit"), proponentsController.requireOwnLocator, proponentsController.saveStockholders);
router.put("/:id/contacts", requireMenuAccess(MENU_KEY, "edit"), proponentsController.requireOwnLocator, proponentsController.saveContacts);
router.put("/:id/properties", requireMenuAccess(MENU_KEY, "edit"), proponentsController.requireOwnLocator, proponentsController.saveProperties);
router.put("/:id/investment", requireMenuAccess(MENU_KEY, "edit"), proponentsController.requireOwnLocator, proponentsController.saveInvestment);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), proponentsController.requireOwnLocator, proponentsController.deactivate);
router.patch("/:id/reactivate", requireMenuAccess(MENU_KEY, "edit"), proponentsController.requireOwnLocator, proponentsController.reactivate);

module.exports = router;
