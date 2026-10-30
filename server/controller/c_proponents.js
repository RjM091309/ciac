const Proponent = require("../models/Proponent");
const ChangeRequest = require("../models/ProponentChangeRequest");
const Notification = require("../models/Notification");
const ActivityLog = require("../models/ActivityLog");
const AuditLog = require("../models/AuditLog");
const { diffChanges } = require("../lib/auditDiff");
const Contract = require("../models/Contract");
const AccountOfficer = require("../models/AccountOfficer");
const TypeOfContract = require("../models/TypeOfContract");
const LandUse = require("../models/LandUse");
const ApplicationType = require("../models/ApplicationType");
const Workflow = require("../models/ApplicationWorkflow");
const ProponentDocument = require("../models/ProponentDocument");
const SecRegistration = require("../models/SecRegistration");
const fs = require("fs");
const path = require("path");
const { resolveStoredPath, relativeStoragePath, contentDisposition } = require("../lib/fileStorage");
const { placeLocatorUpload } = require("../lib/locatorFolders");
const { publicErrorMessage } = require("../lib/httpError");
const Assessment = require("../models/AssessmentEvaluation");
const Approval = require("../models/ApprovalIssuance");
const { emailStaffInBackground } = require("../lib/staffEmail");
const { checkMenuAllowed } = require("../middleware/m_auth");
const { getters: site } = require("../lib/siteSettings");
const Permit = require("../models/Permit");
const User = require("../models/User");
const Role = require("../models/Role");
const { generateTempPassword } = require("../lib/password");

/** "", null, undefined -> null; otherwise the id as a number (NaN passes through and is rejected below). */
function toNullableId(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

/** Checks that a submitted lookup id points at a real File Maintenance row. Returns an error message or null. */
async function unknownLookup(id, list, label) {
  if (id === null || id === undefined) return null;
  return (await list()).some((row) => row.id === id) ? null : `Unknown ${label}`;
}

exports.list = async (req, res) => {
  try {
    // approvedOnly is opt-in — the New Application proponent picker and
    // Locator Users' "has business profile" filter both need the FULL
    // proponent universe (a locator filing their first-ever application has
    // no approved application yet), so only the Registered Locator master
    // checklist page passes this.
    const approvedOnly = String(req.query.approvedOnly || "") === "1";
    let rows = await Proponent.listProponents({ approvedOnly });
    if (approvedOnly) {
      // Registered Locator: a newly approved locator still waiting in the
      // Approved Queue (no Account Officer yet) isn't registered yet — older
      // locators with no officer (e.g. legacy imports) stay listed so Level 1
      // can assign one. A Level 2 Account Officer sees only their own.
      const waiting = new Set((await Approval.listAssignmentQueue()).map((r) => Number(r.proponent_id)));
      const me = await accountOfficerScope(req);
      rows = rows.filter((r) =>
        me !== null
          ? Number(r.account_officer_id) === me
          : r.account_officer_id != null || !waiting.has(Number(r.id))
      );
    }
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List proponents error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Locators/Proponent List page: same underlying proponents, but with
// Business Type / Start-End-Lease Term / Encoded By resolved dynamically
// from the applications/contracts/users tables instead of duplicated data.
/** A Level 2 Account Officer (role has approval:queue, not Level 1, not
 * admin) only sees the locators assigned to them in Registered Locator.
 * Returns their user id, or null for everyone else. */
async function accountOfficerScope(req) {
  const role = String(req.user?.role || "").toLowerCase();
  if (!req.user?.id || role === "admin") return null;
  if (!(await checkMenuAllowed(role, "approval:queue", "view"))) return null;
  if (await Assessment.isManager(req.user)) return null;
  return Number(req.user.id);
}

/** A locator's Account Officer was set or changed (Level 1 assigning a
 * Level 2): the new officer gets the "locator assigned" pop-up, the previous
 * one hears it was handed over. Nobody is told about their own action. */
async function notifyOfficerChange({ proponent, fromId, toId, actorId }) {
  const from = Number(fromId) || null;
  const to = Number(toId) || null;
  if (!to || from === to) return;
  const label = `${proponent?.business_name || "A locator"}${proponent?.ref_no ? ` (${proponent.ref_no})` : ""}`;
  try {
    const toUser = await AccountOfficer.getAccountOfficerById(to);
    const toName = toUser?.full_name || toUser?.username || "another Account Officer";
    if (to !== Number(actorId)) {
      await Notification.createNotification({
        userId: to,
        subject: `New locator assigned: ${proponent?.business_name || "locator"}`,
        body: `${label} was assigned to you as their Account Officer.`,
        createdBy: actorId,
        eventType: "locator_assigned",
      });
      emailStaffInBackground(to, {
        subject: `New locator assigned to you: ${proponent?.business_name || "locator"}`,
        lines: [`${label} was assigned to you as their Account Officer.`, "You'll find them in your Registered Locators."],
        linkPath: "/applications/proponents",
        linkLabel: "Open Registered Locators",
      });
    }
    if (from && from !== Number(actorId)) {
      await Notification.createNotification({
        userId: from,
        subject: `Locator reassigned: ${proponent?.business_name || "locator"}`,
        body: `${label} was reassigned to ${toName}. It's no longer in your Registered Locators.`,
        createdBy: actorId,
        eventType: "approval",
      });
      emailStaffInBackground(from, {
        subject: `Locator reassigned: ${proponent?.business_name || "locator"}`,
        lines: [`${label} was reassigned to ${toName}.`, "It's no longer in your Registered Locators."],
        linkPath: "/dashboard",
        linkLabel: "Open the portal",
      });
    }
  } catch (error) {
    console.error("Account Officer change notification error:", error);
  }
}

/** For the /:id Registered Locator routes: a Level 2 Account Officer can only
 * open their own locators. */
exports.requireOwnLocator = async (req, res, next) => {
  try {
    const me = await accountOfficerScope(req);
    if (me === null) return next();
    const row = await Proponent.getProponentById(Number(req.params.id));
    if (row && Number(row.account_officer_id) === me) return next();
    return res.status(403).json({ success: false, message: "This locator is assigned to another Account Officer." });
  } catch (error) {
    console.error("Locator scope check error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.listForLocatorList = async (req, res) => {
  try {
    const rows = await Proponent.listProponentsForLocatorList({ accountOfficerId: await accountOfficerScope(req) });
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List locators error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Lookup for the Account Officer dropdown on the New/Edit Locator form: only
// users holding the ACCOUNT OFFICER role, with their department. Deactivated
// officers are included (flagged) so a locator still assigned to one can show it;
// the form itself only offers active ones for new assignments.
exports.listAccountOfficerOptions = async (req, res) => {
  try {
    const rows = await AccountOfficer.listAccountOfficers();
    // Who is asking: a Level 2 Account Officer's locators are always their
    // own (read-only field); Level 1 assigns them to a Level 2.
    const me = await accountOfficerScope(req);
    const role = String(req.user?.role || "").toLowerCase();
    const isAo = role !== "admin" && (await checkMenuAllowed(role, "approval:queue", "view"));
    return res.json({
      success: true,
      data: rows.map((o) => ({
        id: o.id,
        username: o.username,
        full_name: o.full_name,
        is_active: o.is_active,
        assessment_level: o.assessment_level,
        department_code: o.department_code,
        department_name: o.department_name,
      })),
      viewer: { userId: Number(req.user?.id) || null, accountOfficerLevel: me !== null ? 2 : isAo ? 1 : null },
    });
  } catch (error) {
    console.error("List account officer options error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Lookup for the Type of Contract dropdown on the New/Edit Locator form
// (File Maintenance > Type of Contract). Inactive types are included, flagged, so
// a locator whose contract still uses one can display it.
exports.listTypeOfContractOptions = async (req, res) => {
  try {
    const rows = await TypeOfContract.listTypeOfContracts();
    return res.json({
      success: true,
      data: rows.map((t) => ({ id: t.id, name: t.name, is_active: t.is_active })),
    });
  } catch (error) {
    console.error("List type of contract options error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Lookup for the Land Use dropdown on the New/Edit Locator form (File Maintenance > Land
// Use). Inactive rows are included, flagged, so a locator that still uses one can display it.
exports.listLandUseOptions = async (req, res) => {
  try {
    const rows = await LandUse.listLandUses();
    return res.json({ success: true, data: rows.map((r) => ({ id: r.id, name: r.name, is_active: r.is_active })) });
  } catch (error) {
    console.error("List land use options error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Industry dropdown on the locator form — the Application Types catalog
// (Industry is normally the latest filed application's type).
exports.listIndustryOptions = async (req, res) => {
  try {
    const rows = await ApplicationType.listApplicationTypes();
    return res.json({
      success: true,
      data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, is_active: r.is_active })),
    });
  } catch (error) {
    console.error("List industry options error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Validates contract_type_id / industry_code from a create/update body.
// Returns { error } or { contractTypeId, industryCode } (undefined = not sent).
async function readClassification(body) {
  const rawType = body?.contract_type_id;
  const rawIndustry = body?.industry_code;
  const contractTypeId =
    rawType === undefined ? undefined : rawType === null || rawType === "" ? null : Number(rawType);
  if (contractTypeId !== undefined && contractTypeId !== null) {
    const known = (await TypeOfContract.listTypeOfContracts()).find((t) => t.id === contractTypeId);
    if (!known) return { error: "Unknown type of contract" };
  }
  const industryCode =
    rawIndustry === undefined ? undefined : String(rawIndustry || "").trim() || null;
  if (industryCode) {
    const known = (await ApplicationType.listApplicationTypes()).find(
      (t) => String(t.code).toUpperCase() === industryCode.toUpperCase()
    );
    if (!known) return { error: "Unknown industry" };
  }
  return { contractTypeId, industryCode };
}

// Proponent self-service: returns the caller's own linked profile plus any
// pending change request and recent request history.
// `req.proponent` is populated by requireProponentSelf.
exports.getMine = async (req, res) => {
  try {
    const [pendingRequest, requestHistory] = await Promise.all([
      ChangeRequest.getPendingForProponent(req.proponent.id),
      ChangeRequest.listForProponent(req.proponent.id, 10),
    ]);
    return res.json({
      success: true,
      data: req.proponent,
      pendingChangeRequest: pendingRequest,
      changeRequestHistory: requestHistory,
      editableFields: ChangeRequest.EDITABLE_FIELDS,
    });
  } catch (error) {
    console.error("Get my proponent error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Proponent self-service: submits a change request instead of writing the
// profile directly. Rejected if a request is already pending or nothing changed.
exports.updateMine = async (req, res) => {
  try {
    const current = req.proponent;
    const body = req.body || {};

    const existingPending = await ChangeRequest.getPendingForProponent(current.id);
    if (existingPending) {
      return res.status(409).json({
        success: false,
        code: "PENDING_REQUEST_EXISTS",
        message: `You already have a pending change request. Please wait for ${site.orgShortName()} to review it.`,
      });
    }

    const payload = {};
    for (const field of ChangeRequest.EDITABLE_FIELDS) {
      if (!(field in body)) continue;
      const nextRaw = body[field];
      const next = nextRaw == null ? "" : String(nextRaw).trim();
      const currentValue = current[field] == null ? "" : String(current[field]).trim();
      if (next !== currentValue) payload[field] = next || null;
    }

    if (!payload.business_name && "business_name" in payload) {
      return res.status(400).json({ success: false, message: "Business name cannot be empty." });
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ success: false, message: "No changes to submit." });
    }

    const request = await ChangeRequest.create({
      proponent_id: current.id,
      requested_by: req.user?.id ?? null,
      payload,
    });

    ActivityLog.recordFromReq(req, {
      entityType: "PROPONENT",
      entityId: current.id,
      action: "PROFILE_CHANGE_REQUESTED",
      meta: { fields: Object.keys(payload) },
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_CHANGE_REQUESTED",
      entityType: "proponent",
      entityId: current.id,
      details: {
        business_name: current?.business_name,
        changes: diffChanges(current, { ...current, ...payload }, Object.keys(payload)),
      },
      req,
    });

    try {
      await Notification.createNotification({
        userId: req.user?.id ?? null,
        subject: "Profile change request submitted",
        body: `Your requested changes to your business profile were submitted to ${site.orgShortName()} for review.`,
        createdBy: req.user?.id ?? null,
        eventType: "application_status",
      });
    } catch (notifyError) {
      console.error("Change request notification error:", notifyError);
    }
    // …and their Account Officer, who reviews it on Registered Locator.
    try {
      const full = await Proponent.getProponentById(current.id);
      if (full?.account_officer_id) {
        await Notification.createNotification({
          userId: full.account_officer_id,
          subject: `Profile change request: ${current.business_name}`,
          body: `${current.business_name} (${full.ref_no || "locator"}) asked to change ${Object.keys(payload).length} field(s) of its business profile. Review it on Registered Locator.`,
          createdBy: req.user?.id ?? null,
          eventType: "application_status",
        });
      }
    } catch (notifyError) {
      console.error("Change request staff notification error:", notifyError);
    }

    return res.status(202).json({ success: true, data: request });
  } catch (error) {
    console.error("Submit proponent change request error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// --- Admin review of proponent profile change requests ---

/** Level 2 Account Officers review only their own locators' requests. */
async function canReviewChangeRequest(req, request) {
  const me = await accountOfficerScope(req);
  if (me === null) return true;
  const p = await Proponent.getProponentById(request.proponent_id);
  return Number(p?.account_officer_id) === me;
}

exports.listChangeRequests = async (req, res) => {
  try {
    const status = String(req.query.status || "PENDING").toUpperCase();
    // A Level 2 Account Officer sees only their own locators' requests.
    const me = await accountOfficerScope(req);
    const rows = (await ChangeRequest.listByStatus(status)).filter(
      (r) => me === null || Number(r.account_officer_id) === me
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List change requests error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.approveChangeRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const request = await ChangeRequest.getById(id);
    if (!request) return res.status(404).json({ success: false, message: "Change request not found" });
    if (!(await canReviewChangeRequest(req, request))) {
      return res.status(403).json({ success: false, message: "You can only review requests for your own locators." });
    }
    if (request.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "This request has already been reviewed." });
    }

    const patch = {};
    for (const field of ChangeRequest.EDITABLE_FIELDS) {
      if (field in request.payload) patch[field] = request.payload[field];
    }
    const before = await Proponent.getProponentById(request.proponent_id);
    if (Object.keys(patch).length) {
      await Proponent.updateProponent(request.proponent_id, { ...patch, updated_by: req.user?.id ?? null });
    }

    const remarks = String(req.body?.remarks ?? "").trim() || null;
    const reviewed = await ChangeRequest.markReviewed(id, "APPROVED", req.user?.id ?? null, remarks);

    const patchedProponent = await Proponent.getProponentById(request.proponent_id);
    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      proponentId: request.proponent_id,
      entityType: "PROPONENT",
      entityId: request.proponent_id,
      action: "PROFILE_CHANGE_APPROVED",
      meta: { request_id: id, fields: Object.keys(patch) },
      ip: req.ip,
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_CHANGE_APPROVED",
      entityType: "proponent",
      entityId: request.proponent_id,
      details: { business_name: patchedProponent?.business_name, changes: diffChanges(before, patchedProponent, Object.keys(patch)) },
      req,
    });

    try {
      const proponent = patchedProponent;
      if (proponent?.user_id) {
        await Notification.createNotification({
          userId: proponent.user_id,
          subject: "Profile change request approved",
          body: `${site.orgShortName()} approved your requested changes. Your business profile has been updated.`,
          createdBy: req.user?.id ?? null,
          eventType: "application_status",
        });
      }
    } catch (notifyError) {
      console.error("Approve change request notification error:", notifyError);
    }

    return res.json({ success: true, data: reviewed });
  } catch (error) {
    if (error?.status === 409) return res.status(409).json({ success: false, message: error.message, field: error.field });
    console.error("Approve change request error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.rejectChangeRequest = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const request = await ChangeRequest.getById(id);
    if (!request) return res.status(404).json({ success: false, message: "Change request not found" });
    if (!(await canReviewChangeRequest(req, request))) {
      return res.status(403).json({ success: false, message: "You can only review requests for your own locators." });
    }
    if (request.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "This request has already been reviewed." });
    }

    const remarks = String(req.body?.remarks ?? "").trim() || null;
    const reviewed = await ChangeRequest.markReviewed(id, "REJECTED", req.user?.id ?? null, remarks);

    const rejectedProponent = await Proponent.getProponentById(request.proponent_id);
    ActivityLog.record({
      actorUserId: req.user?.id ?? null,
      proponentId: request.proponent_id,
      entityType: "PROPONENT",
      entityId: request.proponent_id,
      action: "PROFILE_CHANGE_REJECTED",
      meta: remarks ? { request_id: id, remarks } : { request_id: id },
      ip: req.ip,
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_CHANGE_REJECTED",
      entityType: "proponent",
      entityId: request.proponent_id,
      details: { business_name: rejectedProponent?.business_name, remarks: remarks || undefined },
      req,
    });

    try {
      const proponent = rejectedProponent;
      if (proponent?.user_id) {
        await Notification.createNotification({
          userId: proponent.user_id,
          subject: "Profile change request declined",
          body: remarks
            ? `${site.orgShortName()} declined your requested profile changes. Note: ${remarks}`
            : `${site.orgShortName()} declined your requested profile changes. Please ${site.contactPhrase()} for details.`,
          createdBy: req.user?.id ?? null,
          eventType: "application_status",
        });
      }
    } catch (notifyError) {
      console.error("Reject change request notification error:", notifyError);
    }

    return res.json({ success: true, data: reviewed });
  } catch (error) {
    console.error("Reject change request error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.getById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.getProponentById(id);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    // The latest GIS upload on the locator's Compliance page (Stockholders tab, read only).
    let gis_document = null;
    try {
      gis_document = await require("../models/ComplianceDocument").latestGisSummary(id);
    } catch (error) {
      console.error("GIS document lookup error:", error);
    }

    return res.json({ success: true, data: { ...row, gis_document } });
  } catch (error) {
    console.error("Get proponent error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Documents tab on the Locator Information panel: application requirement
// documents (with the Assessment Officer's status) plus files uploaded
// directly onto the locator (manual registrations have no application).
exports.getDocuments = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const [requirements, uploads] = await Promise.all([
      Workflow.listRequirementDocumentsByProponent(id),
      ProponentDocument.listByProponent(id),
    ]);
    return res.json({ success: true, data: { requirements, uploads } });
  } catch (error) {
    console.error("Get proponent documents error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.listDocumentRequirementOptions = async (req, res) => {
  try {
    const rows = await ProponentDocument.listRequirementOptions();
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List document requirement options error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.uploadDocument = async (req, res) => {
  const discardFile = () => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  };
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      discardFile();
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    if (!req.file) return res.status(400).json({ success: false, message: "A file is required" });
    const proponent = await Proponent.getProponentById(id);
    if (!proponent) {
      discardFile();
      return res.status(404).json({ success: false, message: "Proponent not found" });
    }
    const requirementId = Number(req.body?.requirement_id) || null;
    const documentName = String(req.body?.document_name || "").trim() || null;
    if (!requirementId && !documentName) {
      discardFile();
      return res.status(400).json({ success: false, message: "Select a document type or enter a document name." });
    }

    // Filed under the locator's folder: locators/<Ref No>/documents/
    const storedPath = await placeLocatorUpload(req.file.path, id);
    req.file.path = storedPath; // so a failed save below cleans up the moved file
    const row = await ProponentDocument.create({
      proponent_id: id,
      requirement_id: requirementId,
      document_name: documentName,
      file_name: req.file.filename,
      original_file_name: req.file.originalname,
      storage_path: relativeStoragePath(storedPath),
      content_type: req.file.mimetype,
      file_size_bytes: req.file.size,
      created_by: req.user?.id ?? null,
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_DOCUMENT_UPLOADED",
      entityType: "proponent",
      entityId: id,
      details: { document_id: row?.id, document_name: row?.document_name, file_name: req.file.originalname },
      req,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    discardFile();
    console.error("Upload proponent document error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

async function loadProponentDocument(req, res) {
  const id = Number(req.params.id);
  const docId = Number(req.params.docId);
  if (!Number.isFinite(id) || !Number.isFinite(docId)) {
    res.status(400).json({ success: false, message: "Invalid id" });
    return null;
  }
  const doc = await ProponentDocument.getById(docId);
  if (!doc || Number(doc.proponent_id) !== id) {
    res.status(404).json({ success: false, message: "Document not found" });
    return null;
  }
  return doc;
}

exports.downloadDocument = async (req, res) => {
  try {
    const doc = await loadProponentDocument(req, res);
    if (!doc) return;
    const abs = resolveStoredPath(doc.storage_path);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({ success: false, message: "File is no longer available." });
    }
    const downloadName = doc.original_file_name || doc.file_name || path.basename(abs);
    AuditLog.recordFileAccess(req, {
      kind: "DOCUMENT",
      entityType: "proponent",
      entityId: doc.proponent_id,
      details: { proponent_document_id: doc.id, file_name: downloadName },
    });
    if (doc.content_type) res.type(doc.content_type);
    if (req.query.view === "1") {
      res.setHeader("Content-Disposition", contentDisposition("inline", downloadName));
      return res.sendFile(abs);
    }
    return res.download(abs, downloadName);
  } catch (error) {
    console.error("Download proponent document error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const doc = await loadProponentDocument(req, res);
    if (!doc) return;
    await ProponentDocument.remove(doc.id);
    const abs = resolveStoredPath(doc.storage_path);
    if (abs) fs.unlink(abs, () => {});
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_DOCUMENT_DELETED",
      entityType: "proponent",
      entityId: doc.proponent_id,
      details: { document_id: doc.id, document_name: doc.document_name, file_name: doc.original_file_name },
      req,
    });
    return res.json({ success: true });
  } catch (error) {
    console.error("Delete proponent document error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// ---- Existing locators encoded by hand (no application in this system) ----

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Start/End Term from the form: both or neither (null = clear). */
function readLeaseTerm(body) {
  const raw = (v) => (v === undefined ? undefined : String(v || "").trim() || null);
  const start = raw(body?.start_term);
  const end = raw(body?.end_term);
  if (start === undefined && end === undefined) return { sent: false };
  if (!start !== !end) return { error: "Enter both the Start Term and the End Term (or neither)." };
  if (start && (!DATE_RE.test(start) || !DATE_RE.test(end))) return { error: "Start/End Term must be dates." };
  if (start && end < start) return { error: "End Term can't be before Start Term." };
  return { sent: true, start, end };
}

/** An encoded locator's lease term → its CONTRACT permit (no application),
 * so it counts down on Renewal Tracking and can be renewed like any other.
 * Once the locator has an approved contract that one rules instead (an
 * approved renewal marks this permit RENEWED, see settleApproval). */
async function syncEncodedLeasePermit(proponentId, actorId) {
  try {
    const p = await Proponent.getProponentById(proponentId);
    if (!p || p.has_contract) return;
    const existing = (await Permit.listByProponent(proponentId)).find(
      (x) => x.permit_type === "CONTRACT" && !x.application_id
    );
    if (!p.manual_end_term) {
      if (existing) await Permit.deactivate(existing.id, actorId);
      return;
    }
    const payload = {
      permit_type: "CONTRACT",
      permit_no: `LEASE-${p.ref_no || p.id}`,
      issuing_authority: "CIAC",
      issue_date: p.manual_start_term,
      expiry_date: p.manual_end_term,
      remarks: "Lease term encoded on Registered Locator",
    };
    if (existing) await Permit.update(existing.id, { ...payload, updated_by: actorId });
    else await Permit.create({ ...payload, proponent_id: proponentId, application_id: null, created_by: actorId });
  } catch (error) {
    console.error("Sync encoded lease permit error:", error);
    require("../lib/systemAlerts").alertAdmins({
      key: `lease-permit-${proponentId}`,
      subject: "Encoded lease term not on Renewal Tracking",
      body: "A locator's Start/End Term was saved but its permit couldn't be created or updated. Save the locator again to retry.",
    });
  }
}

/** Saves the typed Start/End Term — only while there's no approved contract. */
async function applyLeaseTerm(proponentId, term, actorId) {
  if (!term?.sent) return;
  const current = await Proponent.getProponentById(proponentId);
  if (!current || current.has_contract) return; // the contract's dates rule
  await Proponent.setManualLeaseTerm(proponentId, { start_term: term.start, end_term: term.end });
  await syncEncodedLeasePermit(proponentId, actorId);
}

const normalizeName = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const normalizeTin = (v) => String(v || "").replace(/\D+/g, "");

/** GET /api/proponents/duplicates?business_name=&tin=&excludeId= — locators
 * that look like the same business (same name ignoring case/punctuation, or
 * same TIN), so encoding an existing locator twice gets a warning. */
exports.findDuplicates = async (req, res) => {
  try {
    const name = normalizeName(req.query?.business_name);
    const tin = normalizeTin(req.query?.tin);
    // SEC Registration No.: one per company for life, so a match is the strongest sign.
    const secNo = String(req.query?.registration_no || "").trim().toUpperCase();
    const excludeId = Number(req.query?.excludeId) || null;
    if (!name && tin.length < 9 && !secNo) return res.json({ success: true, data: [] });
    const sameSec = (p) => secNo && String(p.registration_no || "").trim().toUpperCase() === secNo;
    const rows = (await Proponent.listProponents())
      .filter((p) => Number(p.id) !== excludeId)
      .filter(
        (p) => sameSec(p) || (name && normalizeName(p.business_name) === name) || (tin.length >= 9 && normalizeTin(p.tin) === tin)
      )
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        ref_no: p.ref_no,
        business_name: p.business_name,
        match: sameSec(p) ? "registration_no" : name && normalizeName(p.business_name) === name ? "name" : "tin",
      }));
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Find duplicate locators error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** POST /api/proponents/:id/login — gives an encoded locator (no login yet)
 * a portal account, linked to this same record (no second locator). It
 * starts PENDING like any new locator: the login and temporary password are
 * emailed when their first application or renewal is filed. */
/** "Send login now": emails a PENDING portal login its username and a
 * temporary password right away (instead of waiting for the renewal). The
 * login only becomes ACTIVE once the email has gone out. */
exports.sendLogin = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const proponent = await Proponent.getProponentById(id);
    if (!proponent) return res.status(404).json({ success: false, message: "Locator not found" });
    if (!proponent.user_id) {
      return res.status(400).json({ success: false, message: "This locator has no portal login yet — add one first." });
    }
    if (proponent.login_status !== "PENDING") {
      return res.status(409).json({
        success: false,
        message: "This login was already sent. To send a new password, use Reset password on Proponent Accounts.",
      });
    }
    const result = await require("./c_applications").activateLocatorIfPending(id, req.user?.id ?? null);
    if (!result?.emailSent) {
      return res.status(result?.reason === "NO_EMAIL" ? 400 : 502).json({
        success: false,
        message:
          result?.reason === "NO_EMAIL"
            ? "This login has no valid email — the locator's real email is needed."
            : "The email couldn't be sent (check Portal Settings → Email). The login stays pending — try again.",
      });
    }
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "LOCATOR_LOGIN_SENT",
      entityType: "proponent",
      entityId: id,
      details: { business_name: proponent.business_name, username: proponent.login_username, email: proponent.login_email },
      req,
    });
    return res.json({ success: true, data: await Proponent.getProponentById(id), message: `Login sent to ${proponent.login_email}.` });
  } catch (error) {
    console.error("Send locator login error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.createLogin = async (req, res) => {
  let createdUserId = null;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const proponent = await Proponent.getProponentById(id);
    if (!proponent) return res.status(404).json({ success: false, message: "Locator not found" });
    if (proponent.user_id) return res.status(409).json({ success: false, message: "This locator already has a login." });

    const email = String(req.body?.email || "").trim();
    // users.full_name is required: no contact name → the business name.
    const fullName = String(req.body?.full_name || "").trim() || proponent.business_name;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /@ciac\.local$/i.test(email)) {
      return res.status(400).json({ success: false, message: "Enter the locator's real email.", field: "email" });
    }
    // No username typed: one from the Ref No (2024000002, LOC-2026-00002 →
    // loc202600002), numbered if taken. The locator can sign in with the
    // email too.
    let username = String(req.body?.username || "").trim();
    if (!username) {
      const base = String(proponent.ref_no || "").toLowerCase().replace(/[^a-z0-9]/g, "") || `locator${id}`;
      username = base;
      for (let n = 2; !(await User.isFieldAvailable("username", username)) && n < 50; n += 1) username = `${base}-${n}`;
    }
    if (!(await User.isFieldAvailable("username", username))) {
      return res.status(409).json({ success: false, message: "That username is already taken.", field: "username" });
    }
    if (!(await User.isFieldAvailable("email", email))) {
      return res.status(409).json({ success: false, message: "That email is already in use.", field: "email" });
    }
    const roleId = await Role.getActiveRoleIdByName("proponent");
    if (!roleId) return res.status(500).json({ success: false, message: "The Locator role is missing." });

    const user = await User.createUser({
      username,
      email,
      full_name: fullName,
      password: generateTempPassword(), // placeholder; replaced on activation
      is_active: 0,
      role_id: roleId,
      status: "PENDING",
    });
    createdUserId = user?.id ?? null;
    if (!createdUserId || !(await Proponent.linkUser(id, createdUserId))) {
      throw new Error("Couldn't link the login to this locator.");
    }

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "LOCATOR_LOGIN_CREATED",
      entityType: "proponent",
      entityId: id,
      details: { business_name: proponent.business_name, username, email },
      req,
    });
    return res.status(201).json({
      success: true,
      data: { user_id: createdUserId, username, email, status: "PENDING" },
      message: "Login created — pending. Send it now, or it goes to the locator when their renewal is filed.",
    });
  } catch (error) {
    console.error("Create locator login error:", error);
    // Don't leave an unlinked account behind.
    if (createdUserId) {
      await require("../config/database")
        .updateData(`DELETE FROM dbo.user_roles WHERE user_id = @param0; DELETE FROM dbo.users WHERE id = @param0`, [createdUserId])
        .catch(() => {});
    }
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.create = async (req, res) => {
  try {
    const {
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      location,
      ref_code,
      lease_address,
      account_officer_id,
      sec_registration_date,
      date_signed,
      grace_period,
      is_sublease,
      sub_pgro,
      sub_pgrr,
      land_use,
      extension_date,
      extension_remarks,
      authorized_capital,
      authorized_capital_currency,
      subscribed_capital,
      subscribed_capital_currency,
      paid_up_capital,
      paid_up_capital_currency,
      business_activities,
      nationality,
      advance_lease_payment_months,
      advance_lease_payment_amount,
      advance_lease_payment_currency,
      security_deposit_months,
      security_deposit_amount,
      security_deposit_currency,
      performance_security_months,
      performance_security_amount,
      performance_security_currency,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      properties,
      land_use_id,
      stockholders,
      contact_persons,
      signatories,
      sublessor_id,
      is_active,
    } = req.body || {};
    if (!business_name) return res.status(400).json({ success: false, message: "business_name is required" });
    // Registered Locator only lists locators with an Account Officer. The
    // form hides that field from an Account Officer, so theirs defaults to them.
    let accountOfficerId = toNullableId(account_officer_id);
    // A Level 2 Account Officer's new locator is always their own.
    const ownOnly = await accountOfficerScope(req);
    if (ownOnly !== null) accountOfficerId = ownOnly;
    // A new sub-lessee (Add Sub-Lessee): a Level 2 only under their own locator.
    const sublessorId = toNullableId(sublessor_id);
    if (sublessorId !== null) {
      const parent = await Proponent.assertSublessor(sublessorId);
      if (ownOnly !== null && Number(parent.account_officer_id) !== ownOnly) {
        return res.status(403).json({ success: false, message: "This locator is assigned to another Account Officer." });
      }
    }
    if (!accountOfficerId && (await checkMenuAllowed(String(req.user?.role || "").toLowerCase(), "approval:queue", "view"))) {
      accountOfficerId = Number(req.user?.id) || null;
    }
    if (!accountOfficerId) {
      return res.status(400).json({ success: false, message: "Choose the locator's Account Officer." });
    }

    const landUseId = toNullableId(land_use_id);
    const lookupError = await unknownLookup(landUseId, () => LandUse.listLandUses(), "land use");
    if (lookupError) return res.status(400).json({ success: false, message: lookupError });

    const classification = await readClassification(req.body);
    if (classification.error) return res.status(400).json({ success: false, message: classification.error });
    const leaseTerm = readLeaseTerm(req.body);
    if (leaseTerm.error) return res.status(400).json({ success: false, message: leaseTerm.error });

    const row = await Proponent.createProponent({
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      location,
      ref_code,
      lease_address,
      account_officer_id: accountOfficerId,
      sec_registration_date,
      date_signed,
      grace_period,
      is_sublease,
      sub_pgro,
      sub_pgrr,
      land_use,
      extension_date,
      extension_remarks,
      authorized_capital,
      authorized_capital_currency,
      subscribed_capital,
      subscribed_capital_currency,
      paid_up_capital,
      paid_up_capital_currency,
      business_activities,
      nationality,
      advance_lease_payment_months,
      advance_lease_payment_amount,
      advance_lease_payment_currency,
      security_deposit_months,
      security_deposit_amount,
      security_deposit_currency,
      performance_security_months,
      performance_security_amount,
      performance_security_currency,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      properties,
      land_use_id: landUseId,
      stockholders,
      contact_persons,
      signatories,
      sec_registration: SecRegistration.pickFields(req.body),
      sublessor_id: sublessorId,
      created_by: req.user?.id ?? null,
      is_active,
      // POST / is only called from the Registered Locator page's New Locator
      // modal — every locator created here is a manual registration.
      is_manual_registration: true,
    });
    // A new locator has no contract/application yet, so Type of Contract and
    // Industry go straight to the manual fallback columns.
    if (row?.id) {
      await Proponent.setManualClassification(row.id, {
        contract_type_id: classification.contractTypeId,
        industry_code: classification.industryCode,
      });
      await applyLeaseTerm(row.id, leaseTerm, req.user?.id ?? null);
    }
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_CREATED",
      entityType: "proponent",
      entityId: row?.id,
      details: { business_name: row?.business_name },
      req,
    });
    await notifyOfficerChange({ proponent: row, fromId: null, toId: accountOfficerId, actorId: req.user?.id });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    if (error?.status === 409) return res.status(409).json({ success: false, message: error.message, field: error.field });
    if (error?.status === 400) return res.status(400).json({ success: false, message: error.message });
    console.error("Create proponent error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

// Section saves for the locator form's Stockholders / Contact Person + Signatory / Property
// schedule tabs — each writes only its own child table(s), independently of the main Save.
function sectionHandler(label, action, run) {
  return async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
      const problem = run.validate(req.body || {});
      if (problem) return res.status(400).json({ success: false, message: problem });
      const data = await run.save(id, req.body || {}, req.user?.id ?? null);
      if (!data) return res.status(404).json({ success: false, message: "Proponent not found" });

      const proponent = await Proponent.getProponentById(id).catch(() => null);
      await AuditLog.record({
        actorId: req.user?.id,
        actorUsername: req.user?.username,
        action,
        entityType: "proponent",
        entityId: id,
        details: { business_name: proponent?.business_name, section: label },
        req,
      });

      return res.json({ success: true, data });
    } catch (error) {
      console.error(`Save ${label} error:`, error);
      // Amount fields that aren't numbers are the caller's mistake, not a server fault.
      const status = error?.status === 409 ? 409 : /must be a number/.test(error?.message || "") ? 400 : 500;
      return res.status(status).json({ success: false, message: publicErrorMessage(error) });
    }
  };
}

exports.saveStockholders = sectionHandler("stockholders", "PROPONENT_STOCKHOLDERS_UPDATED", {
  validate: (b) => (Array.isArray(b.stockholders) ? null : "stockholders must be a list"),
  save: (id, b, actor) => Proponent.saveStockholders(id, b.stockholders, actor),
});

exports.saveContacts = sectionHandler("contacts", "PROPONENT_CONTACTS_UPDATED", {
  validate: (b) =>
    Array.isArray(b.contact_persons) || Array.isArray(b.signatories) ? null : "contact_persons or signatories must be a list",
  save: (id, b, actor) =>
    Proponent.saveContacts(
      id,
      {
        contact_persons: Array.isArray(b.contact_persons) ? b.contact_persons : undefined,
        signatories: Array.isArray(b.signatories) ? b.signatories : undefined,
      },
      actor
    ),
});

exports.saveProperties = sectionHandler("properties", "PROPONENT_PROPERTIES_UPDATED", {
  validate: (b) => (Array.isArray(b.properties) ? null : "properties must be a list"),
  save: (id, b, actor) => Proponent.saveProperties(id, b.properties, actor),
});

exports.saveInvestment = sectionHandler("investment", "PROPONENT_INVESTMENT_UPDATED", {
  validate: (b) =>
    ["investment_commitment", "investment_actual", "employee_commitment", "employee_actual"].some(
      (k) => b[k] !== undefined
    )
      ? null
      : "at least one investment field is required",
  save: (id, b, actor) =>
    Proponent.saveInvestment(
      id,
      {
        investment_commitment: b.investment_commitment,
        investment_actual: b.investment_actual,
        employee_commitment: b.employee_commitment,
        employee_actual: b.employee_actual,
      },
      actor
    ),
});

/** GET /api/proponents/:id/leases — the Lease Agreements card. */
exports.listLeases = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    return res.json({ success: true, data: await Proponent.listLeases(id) });
  } catch (error) {
    console.error("List leases error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** GET /api/proponents/ref-code-available?code=…&excludeId=…[&field=registration_no]
 * — the as-you-type check of the Ref. Code (default) or the SEC Registration No.
 * (the save checks again). */
exports.refCodeAvailable = async (req, res) => {
  try {
    const field = req.query.field === "registration_no" ? "registration_no" : "ref_code";
    const result = await Proponent.isFieldAvailable(field, req.query.code, req.query.excludeId);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Ref code check error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.saveSecRegistration = sectionHandler("sec_registration", "PROPONENT_SEC_REGISTRATION_UPDATED", {
  validate: (b) => {
    if (b.sec_gis_date && !/^\d{4}-\d{2}-\d{2}/.test(String(b.sec_gis_date))) return "sec_gis_date must be a date";
    if (b.sec_registration_date && !/^\d{4}-\d{2}-\d{2}/.test(String(b.sec_registration_date))) {
      return "sec_registration_date must be a date";
    }
    return null;
  },
  save: (id, b, actor) => Proponent.saveSecRegistration(id, b, actor),
});

/** PUT /:id/sublessor { sublessor_id } — links an existing locator as a
 * sub-lessee of another (A-07), or unlinks it (null). A Level 2 Account
 * Officer only between their own locators. */
exports.setSublessor = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const before = await Proponent.getProponentById(id);
    if (!before) return res.status(404).json({ success: false, message: "Proponent not found" });
    const sublessorId = toNullableId(req.body?.sublessor_id);
    if (sublessorId !== null && !Number.isFinite(sublessorId)) {
      return res.status(400).json({ success: false, message: "Invalid sublessor" });
    }
    if (sublessorId !== null) {
      const parent = await Proponent.assertSublessor(sublessorId, id);
      const me = await accountOfficerScope(req);
      if (me !== null && Number(parent.account_officer_id) !== me) {
        return res.status(403).json({ success: false, message: "That locator is assigned to another Account Officer." });
      }
    }
    await Proponent.setSublessor(id, sublessorId, req.user?.id ?? null);
    const after = await Proponent.getProponentById(id);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: sublessorId ? "PROPONENT_SUBLESSOR_LINKED" : "PROPONENT_SUBLESSOR_UNLINKED",
      entityType: "proponent",
      entityId: id,
      details: {
        business_name: before.business_name,
        from: before.sublessor_name ?? null,
        to: after?.sublessor_name ?? null,
      },
      req,
    });
    return res.json({ success: true, data: after });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ success: false, message: error.message });
    console.error("Set sublessor error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const {
      user_id,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      location,
      ref_code,
      lease_address,
      account_officer_id,
      sec_registration_date,
      date_signed,
      grace_period,
      is_sublease,
      sub_pgro,
      sub_pgrr,
      land_use,
      extension_date,
      extension_remarks,
      authorized_capital,
      authorized_capital_currency,
      subscribed_capital,
      subscribed_capital_currency,
      paid_up_capital,
      paid_up_capital_currency,
      business_activities,
      nationality,
      advance_lease_payment_months,
      advance_lease_payment_amount,
      advance_lease_payment_currency,
      security_deposit_months,
      security_deposit_amount,
      security_deposit_currency,
      performance_security_months,
      performance_security_amount,
      performance_security_currency,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      properties,
      land_use_id,
      stockholders,
      contact_persons,
      signatories,
      contract_type_id,
      is_active,
    } = req.body || {};

    // Validate the Type of Contract up front so a bad code can't leave the rest of
    // the edit half-saved.
    const typeId = contract_type_id === null || contract_type_id === undefined || contract_type_id === "" ? null : Number(contract_type_id);
    if (typeId !== null) {
      const known = (await TypeOfContract.listTypeOfContracts()).find((t) => t.id === typeId);
      if (!known) return res.status(400).json({ success: false, message: "Unknown type of contract" });
    }
    // Registered Locator only lists locators with an Account Officer, so it
    // can be changed but not cleared — and a Level 2 Account Officer can't
    // hand their locator to someone else (Level 1 assigns).
    if (account_officer_id !== undefined) {
      const nextOfficer = toNullableId(account_officer_id);
      if (!nextOfficer) return res.status(400).json({ success: false, message: "Choose the locator's Account Officer." });
      const me = await accountOfficerScope(req);
      if (me !== null && nextOfficer !== me) {
        return res.status(403).json({ success: false, message: "Only a Manager can change a locator's Account Officer." });
      }
    }
    // undefined = "not sent, leave alone"; null = "cleared".
    const landUseId = land_use_id === undefined ? undefined : toNullableId(land_use_id);
    const lookupError = await unknownLookup(landUseId, () => LandUse.listLandUses(), "land use");
    if (lookupError) return res.status(400).json({ success: false, message: lookupError });
    const leaseTerm = readLeaseTerm(req.body);
    if (leaseTerm.error) return res.status(400).json({ success: false, message: leaseTerm.error });
    // Sub-Lease stays ticked while the locator has active sub-lessees.
    if (is_sublease !== undefined && !is_sublease && (await Proponent.countActiveSublessees(id)) > 0) {
      return res.status(400).json({ success: false, message: "This locator still has sub-lessees — unlink them before unticking Sub-Lease." });
    }

    const before = await Proponent.getProponentById(id);
    const row = await Proponent.updateProponent(id, {
      // The portal login is linked only through POST /:id/login — never
      // changed or cleared by this form.
      user_id: undefined,
      business_name,
      registration_no,
      tin,
      address,
      contact_no,
      location,
      ref_code,
      lease_address,
      account_officer_id,
      sec_registration_date,
      date_signed,
      grace_period,
      is_sublease,
      sub_pgro,
      sub_pgrr,
      land_use,
      extension_date,
      extension_remarks,
      authorized_capital,
      authorized_capital_currency,
      subscribed_capital,
      subscribed_capital_currency,
      paid_up_capital,
      paid_up_capital_currency,
      business_activities,
      nationality,
      advance_lease_payment_months,
      advance_lease_payment_amount,
      advance_lease_payment_currency,
      security_deposit_months,
      security_deposit_amount,
      security_deposit_currency,
      performance_security_months,
      performance_security_amount,
      performance_security_currency,
      investment_commitment,
      investment_actual,
      employee_commitment,
      employee_actual,
      properties,
      land_use_id: landUseId,
      stockholders,
      contact_persons,
      signatories,
      sec_registration: SecRegistration.pickFields(req.body),
      is_active,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    // Type of Contract lives on the proponent's current contract, not the
    // proponent record — a no-op if there's no contract yet (same as
    // Start/End/Lease Term, it only ever describes one that already exists).
    // No contract yet (e.g. a manual registration) -> the proponent's own
    // fallback column instead of a silent no-op.
    if (contract_type_id !== undefined) {
      const onContract = await Contract.setContractTypeForProponent(id, typeId, req.user?.id ?? null);
      if (!onContract) await Proponent.setManualClassification(id, { contract_type_id: typeId });
    }
    if (req.body?.industry_code !== undefined) {
      const classification = await readClassification({ industry_code: req.body.industry_code });
      if (classification.error) return res.status(400).json({ success: false, message: classification.error });
      await Proponent.setManualClassification(id, { industry_code: classification.industryCode });
    }
    await applyLeaseTerm(id, leaseTerm, req.user?.id ?? null);
    const refreshed = await Proponent.getProponentById(id);
    await notifyOfficerChange({
      proponent: refreshed || row,
      fromId: before?.account_officer_id,
      toId: (refreshed || row)?.account_officer_id,
      actorId: req.user?.id,
    });

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_UPDATED",
      entityType: "proponent",
      entityId: id,
      details: {
        business_name: (refreshed || row)?.business_name,
        changes: diffChanges(before, refreshed, Object.keys(req.body || {})),
      },
      req,
    });

    return res.json({ success: true, data: refreshed || row });
  } catch (error) {
    if (error?.status === 409) return res.status(409).json({ success: false, message: error.message, field: error.field });
    if (error?.status === 400) return res.status(400).json({ success: false, message: error.message });
    console.error("Update proponent error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.deactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.deactivateProponent(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_DEACTIVATED",
      entityType: "proponent",
      entityId: id,
      details: { business_name: row?.business_name },
      req,
    });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Deactivate proponent error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.reactivate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Proponent.reactivateProponent(id, req.user?.id ?? null);
    if (!row) return res.status(404).json({ success: false, message: "Proponent not found" });

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_REACTIVATED",
      entityType: "proponent",
      entityId: id,
      details: { business_name: row?.business_name },
      req,
    });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Reactivate proponent error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

