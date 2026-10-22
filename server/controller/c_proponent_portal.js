const fs = require("fs");
const Workflow = require("../models/ApplicationWorkflow");
const Contract = require("../models/Contract");
const Permit = require("../models/Permit");
const ActivityLog = require("../models/ActivityLog");
const AuditLog = require("../models/AuditLog");
const path = require("path");
const Inspection = require("../models/ComplianceInspection");
const ComplianceDocument = require("../models/ComplianceDocument");
const { relativeStoragePath, resolveStoredPath, contentDisposition } = require("../lib/fileStorage");
const { placeApplicationUpload, placeComplianceUpload } = require("../lib/locatorFolders");
const { publicErrorMessage } = require("../lib/httpError");

// All handlers below assume requireProponentSelf (req.proponent) has run, and
// the per-application ones assume requireOwnApplication (req.application) has run.


/** Streams a stored compliance document; ?view=1 opens it inline. */
function sendComplianceFile(req, res, doc) {
  const abs = resolveStoredPath(doc.storage_path);
  if (!abs || !fs.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "File is no longer available." });
  }
  const name = doc.original_file_name || doc.file_name || path.basename(abs);
  AuditLog.recordFileAccess(req, {
    kind: "DOCUMENT",
    entityType: "proponent",
    entityId: doc.proponent_id,
    details: { compliance_document_id: doc.id, item_code: doc.item_code, file_name: name },
  });
  if (doc.content_type) res.type(doc.content_type);
  if (req.query.view === "1") {
    res.setHeader("Content-Disposition", contentDisposition("inline", name));
    return res.sendFile(abs);
  }
  return res.download(abs, name);
}

// ---- Compliance (portal "Compliance" page) ----

/** Checklist + inspections/findings/actions + standing, with every uploaded
 * file per item (newest first) so the page can show current + history. */
exports.getMyCompliance = async (req, res) => {
  try {
    const [overview, documents] = await Promise.all([
      Inspection.getLocatorComplianceOverview(req.proponent.id),
      ComplianceDocument.listForProponent(req.proponent.id),
    ]);
    const byItem = new Map();
    for (const d of documents) {
      const list = byItem.get(d.item_code) || [];
      // storage_path stays server-side.
      const { storage_path, ...safe } = d;
      list.push(safe);
      byItem.set(d.item_code, list);
    }
    const items = overview.items.map((i) => ({ ...i, documents: byItem.get(i.code) || [] }));
    return res.json({ success: true, data: { ...overview, items } });
  } catch (error) {
    console.error("Get my compliance error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.uploadMyComplianceDocument = async (req, res) => {
  const discard = () => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  };
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file was uploaded." });
    const items = await Inspection.listComplianceItems(req.proponent.id);
    const item = items.find((i) => i.code === String(req.params.code));
    if (!item) {
      discard();
      return res.status(400).json({ success: false, message: "Unknown or inactive compliance requirement." });
    }
    if (item.applicability === "NOT_APPLICABLE") {
      discard();
      return res.status(400).json({ success: false, message: "This item is marked not applicable for your business." });
    }
    const storedPath = await placeComplianceUpload(req.file.path, req.proponent.id);
    req.file.path = storedPath;
    const { document } = await ComplianceDocument.createUpload({
      proponentId: req.proponent.id,
      itemCode: item.code,
      file: req.file,
      storagePath: relativeStoragePath(storedPath),
      validityFrom: req.body?.validity_from,
      validityTo: req.body?.validity_to,
      userId: req.user?.id ?? null,
    });

    ActivityLog.recordFromReq(req, {
      entityType: "COMPLIANCE",
      entityId: document?.id ?? null,
      action: "COMPLIANCE_DOCUMENT_UPLOADED",
      meta: { item: item.name, file_name: req.file.originalname },
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "COMPLIANCE_DOCUMENT_UPLOADED",
      entityType: "proponent",
      entityId: req.proponent.id,
      details: { item: item.name, file_name: req.file.originalname, uploaded_by: "locator" },
      req,
    });
    await ComplianceDocument.notifyReviewers({
      proponentName: req.proponent.business_name,
      itemName: item.name,
      actorId: req.user?.id ?? null,
    });

    const { storage_path, ...safe } = document || {};
    return res.status(201).json({ success: true, data: safe });
  } catch (error) {
    discard();
    console.error("Upload my compliance document error:", error);
    return res.status(error.status || 500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.downloadMyComplianceDocument = async (req, res) => {
  try {
    const doc = await ComplianceDocument.getById(req.params.docId);
    if (!doc || Number(doc.proponent_id) !== Number(req.proponent.id)) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }
    return sendComplianceFile(req, res, doc);
  } catch (error) {
    console.error("Download my compliance document error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.listMyApplications = async (req, res) => {
  try {
    const applications = await Workflow.listApplicationsForProponent(req.proponent.id);
    return res.json({ success: true, data: applications });
  } catch (error) {
    console.error("List my applications error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getMyApplication = async (req, res) => {
  try {
    return res.json({ success: true, data: await Workflow.attachLocatorProgress({ ...req.application }) });
  } catch (error) {
    console.error("Get my application error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getMyApplicationRequirements = async (req, res) => {
  try {
    const rows = await Workflow.listApplicationRequirements(req.application.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my application requirements error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

/* The contract (and its permit, certificate and executed file) is saved
 * on the approval panel before Approve — the locator only sees it once the
 * application is APPROVED. */
const isApproved = (application) => String(application?.status || "").toUpperCase() === "APPROVED";

async function approvedApplicationIds(proponentId) {
  const rows = await Workflow.listApplicationsForProponent(proponentId);
  return new Set(rows.filter(isApproved).map((a) => Number(a.id)));
}

exports.getMyApplicationDocuments = async (req, res) => {
  try {
    let rows = await Workflow.listDocumentsByApplication(req.application.id);
    if (!isApproved(req.application)) {
      // Hide the executed contract file uploaded with a not-yet-approved contract.
      const contract = await Contract.getByApplicationId(req.application.id);
      if (contract?.document_id) rows = rows.filter((d) => Number(d.id) !== Number(contract.document_id));
    }
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my application documents error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Proponent uploads a supporting document to their own application.
// `handleUpload` (multer) has already written the file to disk and set req.file.
exports.uploadMyApplicationDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file was uploaded." });
    }

    const requirementId = Number(req.body?.requirement_id);
    if (!Number.isFinite(requirementId) || requirementId <= 0) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: "Select which requirement this document is for." });
    }
    // Guard: the requirement must belong to this application's checklist.
    const reqs = await Workflow.listApplicationRequirements(req.application.id);
    const match = reqs.find((r) => Number(r.requirement_id) === requirementId);
    if (!match) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: "That requirement doesn't belong to this application." });
    }
    // The portal hides Upload on a verified requirement; enforce it here too,
    // or a direct API call could slip an unreviewed file under a VERIFIED one.
    if (String(match.status || "").toUpperCase() === "VERIFIED") {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: "This requirement is already verified." });
    }

    // Filed under the locator's folder: locators/<Ref No>/<APP-…>/
    const storedPath = await placeApplicationUpload(req.file.path, req.application.id);
    req.file.path = storedPath; // so a failed save below cleans up the moved file
    const document = await Workflow.createDocument({
      application_id: req.application.id,
      requirement_id: requirementId,
      file_name: req.file.filename,
      original_file_name: req.file.originalname,
      storage_path: relativeStoragePath(storedPath),
      content_type: req.file.mimetype,
      file_size_bytes: req.file.size,
      created_by: req.user?.id ?? null,
    });

    ActivityLog.recordFromReq(req, {
      entityType: "DOCUMENT",
      entityId: document?.id ?? null,
      action: "DOCUMENT_UPLOADED",
      meta: { application_id: req.application.id, file_name: req.file.originalname, requirement_id: requirementId },
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "DOCUMENT_UPLOADED",
      entityType: "application",
      entityId: req.application.id,
      details: { application_no: req.application.application_no, file_name: req.file.originalname, uploaded_by: "locator" },
      req,
    });

    return res.status(201).json({ success: true, data: document });
  } catch (error) {
    console.error("Upload my application document error:", error);
    // Best-effort cleanup of the orphaned file.
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getMyApplicationStatusHistory = async (req, res) => {
  try {
    const rows = await Workflow.listApplicationStatusHistory(req.application.id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my application status history error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getMyApplicationContract = async (req, res) => {
  try {
    const contract = isApproved(req.application) ? await Contract.getByApplicationId(req.application.id) : null;
    return res.json({ success: true, data: contract || null });
  } catch (error) {
    console.error("Get my application contract error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getMyApplicationPermits = async (req, res) => {
  try {
    const rows = isApproved(req.application) ? await Permit.listByApplication(req.application.id) : [];
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my application permits error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// --- Aggregate "Contracts & Permits" views (across all the proponent's applications) ---

exports.listMyContracts = async (req, res) => {
  try {
    const approved = await approvedApplicationIds(req.proponent.id);
    const rows = (await Contract.listByProponentId(req.proponent.id)).filter((c) => approved.has(Number(c.application_id)));
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List my contracts error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.downloadMyContractCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const contract = await Contract.getById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });
    const application = await Workflow.getApplicationById(contract.application_id);
    if (!application || Number(application.proponent_id) !== Number(req.proponent.id) || !isApproved(application)) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    const certificatePath = await Contract.getCertificatePath(id);
    if (!certificatePath) {
      return res.status(404).json({ success: false, message: "No certificate has been generated for this contract yet." });
    }
    const absPath = resolveStoredPath(certificatePath);
    if (!absPath || !fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: "Certificate file is no longer available." });
    }
    const filename = `Contract-Certificate-${id}.pdf`;
    AuditLog.recordFileAccess(req, {
      kind: "CERTIFICATE",
      entityType: "contract",
      entityId: id,
      details: { certificate: "contract", contract_no: contract.contract_no, file_name: filename },
    });
    res.type("application/pdf");
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.sendFile(absPath);
    }
    return res.download(absPath, filename);
  } catch (error) {
    console.error("Download my contract certificate error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.listMyPermits = async (req, res) => {
  try {
    // Permits tied to an application show once it's approved; ones added by
    // staff without an application always show.
    const approved = await approvedApplicationIds(req.proponent.id);
    const rows = (await Permit.listByProponent(req.proponent.id)).filter(
      (p) => !p.application_id || approved.has(Number(p.application_id))
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List my permits error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.downloadMyPermitCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const permit = await Permit.getById(id);
    if (!permit || Number(permit.proponent_id) !== Number(req.proponent.id)) {
      return res.status(404).json({ success: false, message: "Permit not found" });
    }
    if (permit.application_id && !isApproved(await Workflow.getApplicationById(permit.application_id))) {
      return res.status(404).json({ success: false, message: "Permit not found" });
    }
    const certificatePath = await Permit.getCertificatePath(id);
    if (!certificatePath) {
      return res.status(404).json({ success: false, message: "No certificate has been generated for this permit yet." });
    }
    const absPath = resolveStoredPath(certificatePath);
    if (!absPath || !fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: "Certificate file is no longer available." });
    }
    const filename = `Permit-Certificate-${id}.pdf`;
    AuditLog.recordFileAccess(req, {
      kind: "CERTIFICATE",
      entityType: "permit",
      entityId: id,
      details: { certificate: "permit", permit_no: permit.permit_no, file_name: filename },
    });
    res.type("application/pdf");
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.sendFile(absPath);
    }
    return res.download(absPath, filename);
  } catch (error) {
    console.error("Download my permit certificate error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getMyActivity = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 30;
    const cursor = req.query.cursor;
    const rows = await ActivityLog.listForProponent(req.proponent.id, req.user?.id ?? null, { limit, cursor });
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Get my activity error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};
