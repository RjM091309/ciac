const express = require("express");
const router = express.Router();
const controller = require("../controller/c_permits");
const { requireMenuAccess, requireAnyMenuAccess } = require("../middleware/m_auth");

const MENU_KEY = "compliance:permits";
// The Expiry Calendar (compliance:expiry) is a filtered view of this same
// permit data, not a separate dataset — a role holding only that sidebar
// entry still needs to read/view-certificate these records.
const READ_MENU_KEYS = [MENU_KEY, "compliance:expiry"];

router.get("/", requireAnyMenuAccess(READ_MENU_KEYS, "view"), controller.list);
router.get("/:id/certificate", requireAnyMenuAccess(READ_MENU_KEYS, "view"), controller.downloadCertificate);
router.get("/:id/contract-certificate", requireAnyMenuAccess(READ_MENU_KEYS, "view"), controller.downloadContractCertificate);
router.get("/:id", requireAnyMenuAccess(READ_MENU_KEYS, "view"), controller.getById);
router.post("/", requireMenuAccess(MENU_KEY, "add"), controller.create);
router.put("/:id", requireMenuAccess(MENU_KEY, "edit"), controller.update);
router.patch("/:id/deactivate", requireMenuAccess(MENU_KEY, "delete"), controller.deactivate);

module.exports = router;
