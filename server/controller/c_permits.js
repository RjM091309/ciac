const fs = require("fs");
const path = require("path");
const Permit = require("../models/Permit");
const Proponent = require("../models/Proponent");
const Workflow = require("../models/ApplicationWorkflow");
const User = require("../models/User");
const Contract = require("../models/Contract");
const ComplianceType = require("../models/ComplianceType");
const AuditLog = require("../models/AuditLog");
const { renderPermitCertificate } = require("../lib/permitCertificate");
const { STORAGE_ROOT, relativeStoragePath, resolveStoredPath } = require("../lib/fileStorage");

/** Title-cases a stored role name ("ASSESSMENT OFFICER" -> "Assessment
 * Officer") for the certificate's signature block — roles are stored
 * uppercase, but a certificate reads better in normal case. */
function titleCaseRoleName(name) {
  return String(name || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Renders and saves the certificate PDF for a permit, then points the
 * permit row at it. Best-effort — a failure here shouldn't fail the
 * create/update itself; the permit record is still valid without a
 * certificate, same as before this existed. */
async function generateAndAttachCertificate(permit) {
  try {
    const approverId = permit.updated_by || permit.created_by;
    const [proponent, application, approver, complianceType] = await Promise.all([
      Proponent.getProponentById(permit.proponent_id),
      permit.application_id ? Workflow.getApplicationById(permit.application_id) : Promise.resolve(null),
      approverId ? User.getUserById(approverId) : Promise.resolve(null),
      ComplianceType.getByCode(permit.permit_type),
    ]);
    const pdfBuffer = await renderPermitCertificate({
      permit,
      typeName: complianceType?.name || null,
      proponentName: proponent?.business_name || null,
      proponentAddress: proponent?.address || null,
      applicationNo: application?.application_no || null,
      approvedByName: approver?.full_name || approver?.username || null,
      approvedByPosition: titleCaseRoleName(approver?.roles?.[0]?.name) || null,
    });
    const dir = path.join(STORAGE_ROOT, "permits", String(permit.id));
    fs.mkdirSync(dir, { recursive: true });
    const absPath = path.join(dir, "certificate.pdf");
    fs.writeFileSync(absPath, pdfBuffer);
    await Permit.setCertificatePath(permit.id, relativeStoragePath(absPath));
  } catch (error) {
    console.error("Generate permit certificate error:", error);
  }
}

exports.list = async (req, res) => {
  try {
    const rows = await Permit.listAll();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List permits error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Permit.getById(id);
    if (!row) return res.status(404).json({ success: false, message: "Permit not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Get permit error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const { proponent_id, permit_type, permit_no } = req.body || {};
    if (!Number.isFinite(Number(proponent_id))) {
      return res.status(400).json({ success: false, message: "proponent_id is required" });
    }
    if (!permit_type) return res.status(400).json({ success: false, message: "permit_type is required" });
    if (!permit_no || !String(permit_no).trim()) {
      return res.status(400).json({ success: false, message: "permit_no is required" });
    }
    let row = await Permit.create({ ...req.body, created_by: req.user?.id ?? null });
    await generateAndAttachCertificate(row);
    row = await Permit.getById(row.id);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PERMIT_CREATED",
      entityType: "permit",
      entityId: row?.id,
      details: { permit_no: row?.permit_no, permit_type: row?.permit_type },
      ipAddress: req.ip,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create permit error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    let row = await Permit.update(id, { ...req.body, updated_by: req.user?.id ?? null });
    if (!row) return res.status(404).json({ success: false, message: "Permit not found" });
    // Regenerate so the certificate always reflects the latest details
    // (dates, permit no, issuing authority, etc. may have just changed).
    await generateAndAttachCertificate(row);
    row = await Permit.getById(id);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PERMIT_UPDATED",
      entityType: "permit",
      entityId: id,
      details: { permit_no: row?.permit_no, permit_type: row?.permit_type, fields: Object.keys(req.body || {}) },
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update permit error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await Permit.deactivate(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Permit not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PERMIT_DEACTIVATED",
      entityType: "permit",
      entityId: id,
      details: { permit_no: row?.permit_no },
      ipAddress: req.ip,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate permit error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** Serves the auto-generated certificate PDF — ?view=1 renders it inline in
 * the browser (staff clicking to preview), otherwise it downloads. */
exports.downloadCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const certificatePath = await Permit.getCertificatePath(id);
    if (!certificatePath) {
      return res.status(404).json({ success: false, message: "No certificate has been generated for this permit yet." });
    }
    const absPath = resolveStoredPath(certificatePath);
    if (!absPath || !fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: "Certificate file is no longer available." });
    }
    const filename = `Permit-Certificate-${id}.pdf`;
    res.type("application/pdf");
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.sendFile(absPath);
    }
    return res.download(absPath, filename);
  } catch (error) {
    console.error("Download permit certificate error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

/** Serves the contract certificate linked to this permit's application —
 * a separate PDF from the permit certificate, surfaced here so staff working
 * the Permits Management table don't have to go find it in the Approval
 * Queue. Gated by compliance:permits (same as the rest of this page) rather
 * than approval:queue, since that's the permission the caller actually has. */
exports.downloadContractCertificate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const permit = await Permit.getById(id);
    if (!permit || !permit.application_id) {
      return res.status(404).json({ success: false, message: "This permit isn't linked to an application." });
    }
    const contract = await Contract.getByApplicationId(permit.application_id);
    if (!contract) {
      return res.status(404).json({ success: false, message: "No contract recorded for this application yet." });
    }
    const certificatePath = await Contract.getCertificatePath(contract.id);
    if (!certificatePath) {
      return res.status(404).json({ success: false, message: "No certificate has been generated for this contract yet." });
    }
    const absPath = resolveStoredPath(certificatePath);
    if (!absPath || !fs.existsSync(absPath)) {
      return res.status(404).json({ success: false, message: "Certificate file is no longer available." });
    }
    const filename = `Contract-Certificate-${contract.id}.pdf`;
    res.type("application/pdf");
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.sendFile(absPath);
    }
    return res.download(absPath, filename);
  } catch (error) {
    console.error("Download contract certificate (via permit) error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
