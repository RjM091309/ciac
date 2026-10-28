const express = require("express");
const router = express.Router();
const controller = require("../controller/c_intakes");
const { requireAnyMenuAccess } = require("../middleware/m_auth");
const { handleUpload } = require("../lib/fileStorage");

// New proponents (New Proponent page): BDO Level 1 records them (the
// controller checks the level); the assigned Level 2 sees theirs there and
// files them with the Locator Accounts form.
const INTAKE = ["applications:proponent-intake"];
const EITHER = ["applications:proponent-intake", "settings:locator-users"];

router.get("/", requireAnyMenuAccess(EITHER, "view"), controller.list);
router.get("/evaluators", requireAnyMenuAccess(INTAKE, "view"), controller.evaluators);
router.post("/", requireAnyMenuAccess(INTAKE, "add"), handleUpload, controller.create);
router.get("/:id/letter", requireAnyMenuAccess(EITHER, "view"), controller.letter);
router.patch("/:id/assign", requireAnyMenuAccess(INTAKE, "edit"), controller.reassign);
router.delete("/:id", requireAnyMenuAccess(INTAKE, "delete"), controller.cancel);

module.exports = router;
