const Workflow = require("../models/ApplicationWorkflow");
const Proponent = require("../models/Proponent");

/** Staff (admin/officer) can reach any application; a proponent only their
 * own. Returns the application row, or null with `forbidden` set when the
 * caller isn't allowed to see it (vs. not found, which is a plain null). */
async function loadWithAccess(req, applicationId) {
  const application = await Workflow.getApplicationById(applicationId);
  if (!application) return { application: null, forbidden: false };

  const role = String(req.user?.role || "").toLowerCase();
  if (role === "admin" || role === "officer") return { application, forbidden: false };

  if (role === "proponent") {
    const proponent = await Proponent.getProponentByUserId(req.user.id);
    if (proponent && proponent.id === application.proponent_id) {
      return { application, forbidden: false };
    }
  }
  return { application, forbidden: true };
}

exports.list = async (req, res) => {
  try {
    const rows = await Workflow.listApplications();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List applications error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { application, forbidden } = await loadWithAccess(req, id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: application });
  } catch (error) {
    console.error("Get application error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { application_type, is_renewal, save_as_draft, submitted_at, current_officer_id } = req.body || {};
    let { proponent_id } = req.body || {};

    const role = String(req.user?.role || "").toLowerCase();
    if (role === "proponent") {
      // Self-service filing: a proponent may only ever file for their own
      // business — the client-supplied proponent_id (if any) is ignored.
      const proponent = await Proponent.getProponentByUserId(req.user.id);
      if (!proponent) {
        return res.status(403).json({
          success: false,
          message: "Your account is not linked to a business record yet. Contact the administrator.",
        });
      }
      proponent_id = proponent.id;
    }

    if (!Number.isFinite(Number(proponent_id))) {
      return res.status(400).json({ success: false, message: "proponent_id is required" });
    }
    if (!application_type || !String(application_type).trim()) {
      return res.status(400).json({ success: false, message: "application_type is required" });
    }

    const row = await Workflow.createApplication({
      proponent_id,
      application_type: String(application_type).trim(),
      is_renewal: Number(is_renewal) ? 1 : 0,
      status: save_as_draft ? "DRAFT" : "SUBMITTED",
      submitted_at: submitted_at ?? null,
      current_officer_id,
      created_by: req.user?.id ?? null,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create application error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { to_status, remarks } = req.body || {};
    if (!to_status || !String(to_status).trim()) {
      return res.status(400).json({ success: false, message: "to_status is required" });
    }
    const row = await Workflow.updateApplicationStatus(id, {
      to_status: String(to_status).trim(),
      remarks: remarks ?? null,
      changed_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update application status error:", error);
    return res.status(400).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** The one status change a proponent may make on their own: submitting a
 * DRAFT, or resubmitting a RETURNED application. */
exports.submit = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { forbidden } = await loadWithAccess(req, id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });

    const row = await Workflow.submitApplication(id, { changed_by: req.user?.id ?? null });
    if (!row) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Submit application error:", error);
    return res.status(400).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.listRequirements = async (req, res) => {
  try {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId)) return res.status(400).json({ success: false, message: "Invalid application id" });
    const { forbidden, application } = await loadWithAccess(req, applicationId);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    const rows = await Workflow.listApplicationRequirements(applicationId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List application requirements error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.updateRequirementStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { status, remarks } = req.body || {};
    if (!status || !String(status).trim()) {
      return res.status(400).json({ success: false, message: "status is required" });
    }

    const row = await Workflow.updateApplicationRequirementStatus(id, {
      status: String(status).trim(),
      remarks: remarks ?? null,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Application requirement not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update application requirement status error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.listDocuments = async (req, res) => {
  try {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId)) return res.status(400).json({ success: false, message: "Invalid application id" });
    const { forbidden, application } = await loadWithAccess(req, applicationId);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    const rows = await Workflow.listDocumentsByApplication(applicationId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List documents error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** Runs after multer (upload.single("file")) has already saved the file to
 * disk — req.file holds where it landed and its original name/type/size. */
exports.createDocument = async (req, res) => {
  try {
    const applicationId = Number(req.body?.application_id);
    if (!Number.isFinite(applicationId)) {
      return res.status(400).json({ success: false, message: "application_id is required" });
    }
    const { forbidden, application } = await loadWithAccess(req, applicationId);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    if (!req.file) {
      return res.status(400).json({ success: false, message: "A file is required" });
    }

    const row = await Workflow.createDocument({
      application_id: applicationId,
      requirement_id: req.body?.requirement_id ?? null,
      file_name: req.file.filename,
      original_file_name: req.file.originalname,
      storage_path: req.file.path,
      content_type: req.file.mimetype,
      file_size_bytes: req.file.size,
      created_by: req.user?.id ?? null,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create document error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** Streams an uploaded document back with its original filename — gated the
 * same way as every other application sub-resource (staff, or the owning
 * proponent). */
exports.downloadDocument = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const document = await Workflow.getDocumentById(id);
    if (!document) return res.status(404).json({ success: false, message: "Document not found" });

    const { forbidden } = await loadWithAccess(req, document.application_id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });

    return res.download(document.storage_path, document.original_file_name || document.file_name);
  } catch (error) {
    console.error("Download document error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.listStatusHistory = async (req, res) => {
  try {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId)) return res.status(400).json({ success: false, message: "Invalid application id" });
    const { forbidden, application } = await loadWithAccess(req, applicationId);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    const rows = await Workflow.listApplicationStatusHistory(applicationId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List status history error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
