const Assessment = require("../models/AssessmentEvaluation");
const Workflow = require("../models/ApplicationWorkflow");
const AuditLog = require("../models/AuditLog");

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  // Deliberate business-rule rejections tag their own Error with
  // .status = 400 at the throw site — everything else defaults to 500.
  return res.status(error.status || 500).json({ success: false, message: error.message || "Internal server error" });
}

function appIdParam(req, res) {
  const id = Number(req.params.applicationId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, message: "Invalid application id" });
    return null;
  }
  return id;
}

/** Level 1 (Manager) vs Level 2 (Officer) for this request — see
 * Assessment.isManager. Cached on req so a route that checks it twice
 * doesn't re-query the Control Panel tables. */
async function scopeFor(req) {
  if (!req.assessmentScope) {
    req.assessmentScope = {
      manager: await Assessment.isManager(req.user),
      userId: Number(req.user?.id) || null,
    };
  }
  return req.assessmentScope;
}

/** A Level 2 Officer may only touch applications assigned to them; a Manager
 * passes straight through. Sends the 403 itself and returns false on denial. */
async function ensureCanAct(req, res, applicationId) {
  const scope = await scopeFor(req);
  if (scope.manager) return true;
  if (applicationId && scope.userId && (await Assessment.getAssignedEvaluatorId(applicationId)) === scope.userId) {
    return true;
  }
  res.status(403).json({ success: false, message: "This application is not assigned to you." });
  return false;
}

exports.list = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    const rows = await Assessment.listAssessments({
      stage: req.query.stage,
      // Level 2 only ever sees their own assignments, whatever the query says.
      evaluatorId: scope.manager ? req.query.evaluatorId : scope.userId,
      search: req.query.search,
    });
    return res.json({ success: true, data: rows });
  } catch (error) {
    return fail(res, error, "List assessments");
  }
};

/** The signed-in user's level, so the screen knows whether to show the
 * Manager controls (assign, final recommendation). */
exports.me = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    return res.json({ success: true, data: { level: scope.manager ? 1 : 2, manager: scope.manager } });
  } catch (error) {
    return fail(res, error, "Assessment level");
  }
};

exports.summary = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    const data = await Assessment.getSummary({ evaluatorId: scope.manager ? null : scope.userId });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Assessment summary");
  }
};

exports.evaluators = async (req, res) => {
  try {
    // Only a Manager assigns, so only a Manager needs the picker's list.
    const scope = await scopeFor(req);
    const data = scope.manager ? await Assessment.listAssignableEvaluators() : [];
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "List evaluators");
  }
};

exports.detail = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const data = await Assessment.getAssessmentDetail(id);
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Assessment detail");
  }
};

exports.assign = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await scopeFor(req)).manager) {
      return res.status(403).json({ success: false, message: "Only a Level 1 Manager can assign evaluators." });
    }
    const { evaluator_id } = req.body || {};
    if (!Number.isFinite(Number(evaluator_id))) {
      return res.status(400).json({ success: false, message: "evaluator_id is required" });
    }
    const data = await Assessment.assignEvaluator(id, {
      evaluatorId: evaluator_id,
      actorId: req.user?.id ?? null,
    });
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_EVALUATOR_ASSIGNED",
      entityType: "application",
      entityId: id,
      details: {
        application_no: data?.assessment?.application_no,
        proponent_name: data?.assessment?.proponent_name,
        evaluator_name: data?.assessment?.evaluator_name || data?.assessment?.evaluator_username,
      },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Assign evaluator");
  }
};

exports.setStage = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const { stage } = req.body || {};
    const data = await Assessment.setStage(id, { stage, actorId: req.user?.id ?? null });
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_STAGE_CHANGED",
      entityType: "application",
      entityId: id,
      details: { application_no: data?.assessment?.application_no, proponent_name: data?.assessment?.proponent_name, stage },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Set assessment stage");
  }
};

// Admin-only — enforced by requireRole("admin") on this route, not here.
exports.reopen = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    const data = await Assessment.reopen(id, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_REOPENED",
      entityType: "application",
      entityId: id,
      details: { application_no: data?.assessment?.application_no, proponent_name: data?.assessment?.proponent_name },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reopen assessment");
  }
};

exports.approvers = async (req, res) => {
  try {
    // Only the Manager's final recommendation picks an Account Officer.
    const scope = await scopeFor(req);
    const data = scope.manager ? await Assessment.listAssignableApprovers() : [];
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "List approvers");
  }
};

/** Level 2 Officer → Manager: the officer's own recommendation. */
exports.officerReview = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const { recommendation, summary } = req.body || {};
    const data = await Assessment.submitOfficerReview(id, {
      recommendation,
      summary,
      actorId: req.user?.id ?? null,
    });
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_OFFICER_REVIEW_SUBMITTED",
      entityType: "application",
      entityId: id,
      details: {
        application_no: data?.assessment?.application_no,
        proponent_name: data?.assessment?.proponent_name,
        recommendation,
        summary: summary || undefined,
      },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Submit officer review");
  }
};

exports.returnToOfficer = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await scopeFor(req)).manager) {
      return res.status(403).json({ success: false, message: "Only a Level 1 Manager can return a review." });
    }
    const { note } = req.body || {};
    const data = await Assessment.returnToOfficer(id, { note, actorId: req.user?.id ?? null });
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_RETURNED_TO_OFFICER",
      entityType: "application",
      entityId: id,
      details: { application_no: data?.assessment?.application_no, proponent_name: data?.assessment?.proponent_name, note: note || undefined },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Return to officer");
  }
};

/** Level 1 Manager's final recommendation (Approve → Account Officer, or Disapprove). */
exports.recommendation = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await scopeFor(req)).manager) {
      return res.status(403).json({ success: false, message: "Only a Level 1 Manager can make the final recommendation." });
    }
    const { recommendation, summary, approver_id } = req.body || {};
    const data = await Assessment.submitRecommendation(id, {
      recommendation,
      summary,
      approverId: approver_id,
      actorId: req.user?.id ?? null,
    });
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_RECOMMENDATION_SUBMITTED",
      entityType: "application",
      entityId: id,
      details: {
        application_no: data?.assessment?.application_no,
        proponent_name: data?.assessment?.proponent_name,
        recommendation,
        approver_name: data?.assessment?.approver_name || data?.assessment?.approver_username || undefined,
        summary: summary || undefined,
      },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Submit recommendation");
  }
};

exports.updateRequirementStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await ensureCanAct(req, res, await Assessment.getApplicationIdForRequirement(id)))) return undefined;
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
    return fail(res, error, "Update requirement status (assessment)");
  }
};

exports.updateRequirementRemarks = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await ensureCanAct(req, res, await Assessment.getApplicationIdForRequirement(id)))) return undefined;
    const { remarks } = req.body || {};
    const row = await Workflow.updateApplicationRequirementRemarks(id, {
      remarks: remarks ?? null,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Application requirement not found" });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Update requirement remarks (assessment)");
  }
};

// Documentary compliance thread — proxy to the same requirement-comment
// workflow the Locator's own portal posts/reads, gated by assessment access
// rather than requireApplicationsAccess (an Assessment Officer may not hold
// applications:new/renewals, only assessment:queue).
exports.listRequirementComments = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await ensureCanAct(req, res, await Assessment.getApplicationIdForRequirement(id)))) return undefined;
    const rows = await Workflow.listRequirementComments(id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    return fail(res, error, "List requirement comments (assessment)");
  }
};

exports.addRequirementComment = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await ensureCanAct(req, res, await Assessment.getApplicationIdForRequirement(id)))) return undefined;
    const { message } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: "message is required" });
    }
    await Workflow.addRequirementComment({
      applicationRequirementId: id,
      authorId: req.user?.id ?? null,
      authorRole: req.user?.role ?? null,
      message: String(message).trim(),
    });
    const rows = await Workflow.listRequirementComments(id);
    return res.status(201).json({ success: true, data: rows });
  } catch (error) {
    return fail(res, error, "Add requirement comment (assessment)");
  }
};

/** Attaches a one-off requirement to just this application (see
 * Workflow.addCustomRequirementToApplication) — for asking the Locator for
 * something outside the pre-seeded catalog checklist. */
exports.addCustomRequirement = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const { name, description, is_mandatory } = req.body || {};
    const row = await Workflow.addCustomRequirementToApplication({
      applicationId: id,
      name,
      description,
      isMandatory: is_mandatory,
      createdBy: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "REQUIREMENT_ADDED_ADHOC",
      entityType: "application",
      entityId: id,
      details: { requirement_name: name, is_mandatory: Boolean(is_mandatory) },
      req,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Add custom requirement (assessment)");
  }
};

exports.addCharge = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    if (!String(req.body?.description ?? "").trim()) {
      return res.status(400).json({ success: false, message: "description is required" });
    }
    const data = await Assessment.addCharge(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_CHARGE_ADDED",
      entityType: "application",
      entityId: id,
      details: { description: String(req.body?.description ?? "").trim().slice(0, 200), amount: req.body?.amount },
      req,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Add charge");
  }
};

exports.updateCharge = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await ensureCanAct(req, res, await Assessment.getApplicationIdForCharge(id)))) return undefined;
    const data = await Assessment.updateCharge(id, req.body || {}, req.user?.id ?? null);
    if (!data) return res.status(404).json({ success: false, message: "Charge not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_CHARGE_UPDATED",
      entityType: "assessment_charge",
      entityId: id,
      details: { description: String(data?.description ?? "").trim().slice(0, 200), amount: data?.amount },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Update charge");
  }
};

exports.deleteCharge = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await ensureCanAct(req, res, await Assessment.getApplicationIdForCharge(id)))) return undefined;
    const before = await Assessment.getChargeById(id);
    const ok = await Assessment.deleteCharge(id, req.user?.id ?? null);
    if (!ok) return res.status(404).json({ success: false, message: "Charge not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_CHARGE_DELETED",
      entityType: "assessment_charge",
      entityId: id,
      details: { description: String(before?.description ?? "").trim().slice(0, 200) },
      req,
    });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Delete charge");
  }
};
