const Inspection = require("../models/ComplianceInspection");

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: error.message || "Internal server error" });
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
      typeId: req.query.typeId,
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
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Create inspection");
  }
};

exports.update = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const data = await Inspection.updateInspection(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Inspection not found" });
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
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Update inspection finding");
  }
};

exports.deleteFinding = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const ok = await Inspection.deleteFinding(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Finding not found" });
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
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Update corrective action");
  }
};

exports.deleteAction = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const ok = await Inspection.deleteCorrectiveAction(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Corrective action not found" });
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
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Add inspection document");
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const id = idParam(req, res);
    if (id === null) return undefined;
    const ok = await Inspection.deleteDocument(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Document not found" });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Delete inspection document");
  }
};
