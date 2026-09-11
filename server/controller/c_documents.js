const fs = require("fs");
const path = require("path");
const Workflow = require("../models/ApplicationWorkflow");
const Proponent = require("../models/Proponent");
const { resolveStoredPath } = require("../lib/fileStorage");

const PRIVILEGED_ROLES = new Set(["admin", "administrator", "officer", "account officer"]);

// Authenticated + ownership-checked download. Admins/officers may fetch any
// document; a proponent may only fetch documents on their own applications.
exports.download = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }

    const document = await Workflow.getDocumentById(id);
    if (!document) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    const role = String(req.user.role || "").toLowerCase();
    if (!PRIVILEGED_ROLES.has(role)) {
      const proponent = await Proponent.getProponentByUserId(req.user.id);
      if (!proponent || Number(document.proponent_id) !== Number(proponent.id)) {
        return res.status(404).json({ success: false, message: "Document not found" });
      }
    }

    const abs = resolveStoredPath(document.storage_path);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({ success: false, message: "File is no longer available." });
    }

    if (document.content_type) res.type(document.content_type);
    const downloadName = document.original_file_name || document.file_name || path.basename(abs);

    // ?view=1 renders the PDF in the browser (officer clicking a requirement
    // to check what the locator submitted) instead of forcing a download —
    // res.download() always sets Content-Disposition: attachment, so that
    // path needs its own inline header + res.sendFile() instead.
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${downloadName.replace(/"/g, "")}"`);
      return res.sendFile(abs);
    }
    return res.download(abs, downloadName);
  } catch (error) {
    console.error("Document download error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
