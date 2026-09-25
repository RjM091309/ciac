const Inspection = require("../models/ComplianceInspection");
const AuditLog = require("../models/AuditLog");
const { diffChanges } = require("../lib/auditDiff");
const { publicErrorMessage } = require("../lib/httpError");

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  return res.status(error.status || 500).json({ success: false, message: publicErrorMessage(error) });
}

function idParam(req, res, key = "id", label = "id") {
  const id = Number(req.params[key]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, message: `Invalid ${label}` });
    return null;
  }
  return id;
}

exports.list = async (req, res) => {
  try {
    const rows = await Inspection.listInspections({
      status: req.query.status,
      result: req.query.result,
      typeCode: req.query.typeCode,
      inspectorId: req.query.inspectorId,
      proponentId: req.query.proponentId,
      search: req.query.search,
    });
    return res.json({ success: true, data: rows });
  } catch (error) {
    return fail(res, error, "List inspections");
  }
};

exports.summary = async (req, res) => {
  try {
    const [summary, byProponent] = await Promise.all([
      Inspection.getComplianceSummary(),
      Inspection.getComplianceByProponent(),
    ]);
    return res.json({ success: true, data: { ...summary, by_proponent: byProponent } });
  } catch (error) {
    return fail(res, error, "Compliance summary");
  }
};

exports.meta = async (req, res) => {
  try {
    const data = await Inspection.getMeta();
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Inspection meta");
  }
};

exports.detail = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const data = await Inspection.getInspectionDetail(id);
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Inspection detail");
  }
};

exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    if (!Number.isFinite(Number(b.proponent_id))) {
      return res.status(400).json({ success: false, message: "proponent_id is required" });
    }
    if (!String(b.title ?? "").trim()) {
      return res.status(400).json({ success: false, message: "title is required" });
    }
    const data = await Inspection.createInspection(b, req.user?.id ?? null);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_SCHEDULED",
      entityType: "inspection",
      entityId: data?.inspection?.id,
      details: { title: data?.inspection?.title, proponent_name: data?.inspection?.proponent_name },
      req,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Create inspection");
  }
};

exports.update = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const before = await Inspection.getInspectionById(id);
    const data = await Inspection.updateInspection(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
    // The inspector's readable name comes back as inspector_name; alias it
    // so the diff shows the name instead of the assigned_inspector_id.
    const withInspectorName = (i) => i && { ...i, assigned_inspector_name: i.inspector_name };
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_UPDATED",
      entityType: "inspection",
      entityId: id,
      details: {
        title: data?.inspection?.title,
        proponent_name: data?.inspection?.proponent_name,
        changes: diffChanges(withInspectorName(before), withInspectorName(data?.inspection), Object.keys(req.body || {})),
      },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Update inspection");
  }
};

exports.assign = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    if (!Number.isFinite(Number(req.body?.inspector_id))) {
      return res.status(400).json({ success: false, message: "inspector_id is required" });
    }
    const data = await Inspection.assignInspector(id, {
      inspectorId: req.body.inspector_id,
      actorId: req.user?.id ?? null,
    });
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_INSPECTOR_ASSIGNED",
      entityType: "inspection",
      entityId: id,
      details: {
        title: data?.inspection?.title,
        proponent_name: data?.inspection?.proponent_name,
        inspector_name: data?.inspection?.inspector_name || data?.inspection?.inspector_username,
      },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Assign inspector");
  }
};

exports.setStatus = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const data = await Inspection.setStatus(id, { status: req.body?.status, actorId: req.user?.id ?? null });
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_STATUS_CHANGED",
      entityType: "inspection",
      entityId: id,
      details: { title: data?.inspection?.title, proponent_name: data?.inspection?.proponent_name, status: data?.inspection?.status },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Set inspection status");
  }
};

exports.setResult = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const data = await Inspection.setResult(id, {
      result: req.body?.result,
      summary: req.body?.summary,
      actorId: req.user?.id ?? null,
    });
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: data?.inspection?.result === "FAILED" ? "INSPECTION_FAILED" : "INSPECTION_RESULT_RECORDED",
      entityType: "inspection",
      entityId: id,
      details: {
        title: data?.inspection?.title,
        proponent_name: data?.inspection?.proponent_name,
        result: data?.inspection?.result,
        summary: req.body?.summary || undefined,
      },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Set inspection result");
  }
};

// ---- Findings ----
exports.addFinding = async (req, res) => {
  try {
    const id = idParam(req, res, "id", "inspection id");
    if (id === null) return undefined;
    if (!String(req.body?.description ?? "").trim()) {
      return res.status(400).json({ success: false, message: "description is required" });
    }
    const data = await Inspection.addFinding(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_FINDING_ADDED",
      entityType: "inspection",
      entityId: id,
      details: { description: String(req.body?.description ?? "").trim().slice(0, 200) },
      req,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Add inspection finding");
  }
};

exports.updateFinding = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const data = await Inspection.updateFinding(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Finding not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_FINDING_UPDATED",
      entityType: "inspection_finding",
      entityId: id,
      details: { description: String(data?.description ?? "").trim().slice(0, 200) },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Update inspection finding");
  }
};

exports.deleteFinding = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const before = await Inspection.getFindingById(id);
    const ok = await Inspection.deleteFinding(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Finding not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_FINDING_DELETED",
      entityType: "inspection_finding",
      entityId: id,
      details: { description: String(before?.description ?? "").trim().slice(0, 200) },
      req,
    });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Delete inspection finding");
  }
};

// ---- Corrective actions ----
exports.addAction = async (req, res) => {
  try {
    const id = idParam(req, res, "id", "inspection id");
    if (id === null) return undefined;
    if (!String(req.body?.action_required ?? "").trim()) {
      return res.status(400).json({ success: false, message: "action_required is required" });
    }
    const data = await Inspection.addCorrectiveAction(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_ACTION_ADDED",
      entityType: "inspection",
      entityId: id,
      details: { action_required: String(data?.action_required ?? "").trim().slice(0, 200) },
      req,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Add corrective action");
  }
};

exports.updateAction = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const data = await Inspection.updateCorrectiveAction(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Corrective action not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_ACTION_UPDATED",
      entityType: "inspection_action",
      entityId: id,
      details: { action_required: String(data?.action_required ?? "").trim().slice(0, 200), status: data?.status },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Update corrective action");
  }
};

exports.deleteAction = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const before = await Inspection.getActionById(id);
    const ok = await Inspection.deleteCorrectiveAction(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Corrective action not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_ACTION_DELETED",
      entityType: "inspection_action",
      entityId: id,
      details: { action_required: String(before?.action_required ?? "").trim().slice(0, 200) },
      req,
    });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Delete corrective action");
  }
};

// ---- Documents ----
exports.addDocument = async (req, res) => {
  try {
    const id = idParam(req, res, "id", "inspection id");
    if (id === null) return undefined;
    const data = await Inspection.addDocument(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_DOCUMENT_ADDED",
      entityType: "inspection",
      entityId: id,
      details: { file_name: data?.original_file_name || data?.file_name },
      req,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Add inspection document");
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const before = await Inspection.getDocumentById(id);
    const ok = await Inspection.deleteDocument(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Document not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "INSPECTION_DOCUMENT_DELETED",
      entityType: "inspection",
      entityId: before?.inspection_id,
      details: { file_name: before?.original_file_name || before?.file_name },
      req,
    });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Delete inspection document");
  }
};

exports.listLocatorCompliance = async (req, res) => {
  try {
    const data = await Inspection.listLocatorCompliance();
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "List locator compliance");
  }
};

exports.listComplianceItems = async (req, res) => {
  try {
    const id = idParam(req, res, "id", "locator id");
    if (id === null) return undefined;
    const data = await Inspection.listComplianceItems(id);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "List locator compliance items");
  }
};

const CHECKLIST_FIELDS = [
  "particular",
  "commitment",
  "actual",
  "validity_from",
  "validity_to",
  "status",
  "remarks",
  "date_submitted",
];

exports.listLocatorActivity = async (req, res) => {
  try {
    const id = idParam(req, res, "id", "locator id");
    if (id === null) return undefined;
    const data = await Inspection.listLocatorActivity(id);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "List locator compliance activity");
  }
};

exports.saveComplianceItem = async (req, res) => {
  try {
    const id = idParam(req, res, "id", "locator id");
    if (id === null) return undefined;
    const beforeItems = await Inspection.listComplianceItems(id);
    const before = beforeItems.find((i) => i.code === String(req.params.code)) || null;
    const data = await Inspection.saveComplianceItem(id, req.params.code, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Locator not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "LOCATOR_COMPLIANCE_UPDATED",
      entityType: "proponent",
      entityId: id,
      details: {
        item: data.name,
        status: data.status,
        changes: diffChanges(before, data, CHECKLIST_FIELDS),
      },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Save locator compliance item");
  }
};
