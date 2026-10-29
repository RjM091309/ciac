const Assessment = require("../models/AssessmentEvaluation");
const Workflow = require("../models/ApplicationWorkflow");
const AuditLog = require("../models/AuditLog");
const { publicErrorMessage } = require("../lib/httpError");
const { departmentOf } = require("../lib/departments");
const { checkMenuAllowed } = require("../middleware/m_auth");
const Proponent = require("../models/Proponent");
const Notification = require("../models/Notification");
const { partyOf } = require("../lib/party");

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  // Deliberate business-rule rejections tag their own Error with
  // .status = 400 at the throw site — everything else defaults to 500.
  return res.status(error.status || 500).json({ success: false, message: publicErrorMessage(error) });
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
    const department = await departmentOf(req.user);
    const track = String(req.query?.track || "").toLowerCase();
    req.assessmentScope = {
      manager: await Assessment.isManager(req.user),
      userId: Number(req.user?.id) || null,
      department,
      // BDO works new applications, the Account Officer works renewals;
      // admin sees both unless the screen asks for one (?track=new|renewal).
      renewal:
        department === "bdo" ? false : department === "ao" ? true : track === "renewal" ? true : track === "new" ? false : undefined,
    };
  }
  return req.assessmentScope;
}

/** Sends a 403 and returns false when the application belongs to the other
 * department (a renewal for the BDO, a new application for an Account Officer). */
async function ensureDepartment(req, res, applicationId) {
  const scope = await scopeFor(req);
  if (scope.department !== "bdo" && scope.department !== "ao") return true;
  const app = await Workflow.getApplicationById(applicationId);
  if (!app) return true; // the handler reports the 404
  if (Boolean(Number(app.is_renewal)) === (scope.department === "ao")) return true;
  console.warn(
    `[assessments] ${req.method} ${req.originalUrl}: ${req.user?.username} (${scope.department}) denied ${app.application_no} (app ${app.id})`
  );
  res.status(403).json({
    success: false,
    message: scope.department === "ao" ? "New applications are handled by the BDO." : "Renewals are handled by the Account Officer.",
  });
  return false;
}

/** A Level 2 may only touch applications assigned to them; Level 1 passes
 * straight through — both only within their own department. Sends the 403
 * itself and returns false on denial. */
async function ensureCanAct(req, res, applicationId) {
  const scope = await scopeFor(req);
  if (applicationId && !(await ensureDepartment(req, res, applicationId))) return false;
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
      renewal: scope.renewal,
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
    return res.json({
      success: true,
      data: { level: scope.manager ? 1 : 2, manager: scope.manager, userId: scope.userId, department: scope.department },
    });
  } catch (error) {
    return fail(res, error, "Assessment level");
  }
};

exports.summary = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    const data = await Assessment.getSummary({ evaluatorId: scope.manager ? null : scope.userId, renewal: scope.renewal });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Assessment summary");
  }
};

exports.evaluators = async (req, res) => {
  try {
    // Only a Manager assigns, so only a Manager needs the picker's list.
    const scope = await scopeFor(req);
    // Renewals are evaluated by a Level 2 Account Officer, new applications by a Level 2 BDO.
    const data = !scope.manager
      ? []
      : scope.renewal
        ? await require("../models/ApprovalIssuance").listAssignableAccountOfficers()
        : await Assessment.listAssignableEvaluators();
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
    // Level 2 opening their assigned application = review started. Only with
    // Edit on their queue (view-only opening changes nothing).
    const scope = await scopeFor(req);
    let reviewStarted = false;
    if (!scope.manager && scope.userId) {
      const app = await Workflow.getApplicationById(id);
      const menuKey = Number(app?.is_renewal) ? "applications:renewals" : "assessment:queue";
      if (await checkMenuAllowed(String(req.user?.role || "").toLowerCase(), menuKey, "edit")) {
        reviewStarted = await Assessment.startReviewOnOpen(id, scope.userId).catch((error) => {
          console.error("Start review on open error:", error);
          return false;
        });
        // Tell the locator their application is now being reviewed (in-app only).
        if (reviewStarted && app?.proponent_id) {
          try {
            const owner = await Proponent.getProponentById(app.proponent_id);
            if (owner?.user_id) {
              await Notification.createNotification({
                userId: owner.user_id,
                subject: `Application in review: ${app.application_no}`,
                body: `Your ${Number(app.is_renewal) ? "renewal" : "application"} ${app.application_no} is now being reviewed.`,
                createdBy: scope.userId,
                applicationId: id,
                eventType: "application_status",
              });
            }
          } catch (error) {
            console.error("Review-started notification error:", error);
          }
        }
      }
    }
    const data = await Assessment.getAssessmentDetail(id);
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    // Where the terms and contract stand (Terms / Contract / Recommendation tabs).
    const [terms, contract] = await Promise.all([
      require("../models/ApplicationTerms").getForApplication(id),
      require("../models/Contract").getByApplicationId(id),
    ]);
    data.contract_progress = {
      terms_status: terms?.status || null,
      contract_no: contract?.contract_no || null,
      signed: Boolean(contract?.document_id),
    };
    return res.json({ success: true, data, reviewStarted: reviewStarted || undefined });
  } catch (error) {
    return fail(res, error, "Assessment detail");
  }
};

exports.assign = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await scopeFor(req)).manager) {
      return res.status(403).json({ success: false, message: "Only a Manager can assign evaluators." });
    }
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const { evaluator_id } = req.body || {};
    if (!Number.isFinite(Number(evaluator_id))) {
      return res.status(400).json({ success: false, message: "evaluator_id is required" });
    }
    // Only a Level 2 of the application's own department can take it.
    const app = await Workflow.getApplicationById(id);
    const pool = Number(app?.is_renewal)
      ? await require("../models/ApprovalIssuance").listAssignableAccountOfficers()
      : await Assessment.listAssignableEvaluators();
    if (!pool.some((u) => Number(u.id) === Number(evaluator_id))) {
      return res.status(400).json({ success: false, message: "That user can't evaluate this application." });
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

/** Level 2 Officer → Manager: the officer's own recommendation. */
exports.officerReview = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    // Level 2 submits only with the signed contract uploaded.
    const signed = await require("../models/Contract").getByApplicationId(id);
    if (!signed?.document_id) {
      return res.status(409).json({
        success: false,
        message: "Upload the signed contract first (Contract tab) — the review goes to the Manager with it.",
      });
    }
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
      return res.status(403).json({ success: false, message: "Only a Manager can return a review." });
    }
    if (!(await ensureCanAct(req, res, id))) return undefined;
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

/** Level 1 "For Approval" on a new application: takes it to approval
 * themselves (the approval panel opens next, on the same page). */
exports.forApproval = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await scopeFor(req)).manager) {
      return res.status(403).json({ success: false, message: "Only a Manager can send an application for approval." });
    }
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const data = await Assessment.sendForApproval(id, { summary: req.body?.summary, actorId: req.user?.id ?? null });
    if (!data) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "ASSESSMENT_SENT_FOR_APPROVAL",
      entityType: "application",
      entityId: id,
      details: { application_no: data?.assessment?.application_no, proponent_name: data?.assessment?.proponent_name },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Send for approval");
  }
};

/* -------------- Proponent Information (Evaluation Queue tab) -------------- */
// The BDO encodes the proponent's details while evaluating (B-09). Same
// dbo.proponents row (and contact / signatory tables) the Registered Locator
// shows once approved — nothing is copied. Same edit rule as the Terms tab:
// the assigned Level 2 while the review is open; Level 1 views; locked once
// the review is submitted (admin Reopen).

const PROFILE_FIELDS = [
  "business_name",
  "address",
  "lease_address",
  "location",
  "land_use_id",
  "proposed_lease_term_years",
  "proposed_lease_term_unit",
  "contact_no",
  "business_activities",
];

/** { editable, reason } for the profile tabs of one application. */
async function profileEditState(req, applicationId) {
  const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
  if (!isAdmin && (await scopeFor(req)).manager) {
    return { editable: false, reason: "Encoded by the assigned evaluator — view only for Level 1." };
  }
  const asm = await Assessment.getOrCreateAssessment(applicationId, null);
  if (["FOR_RECOMMENDATION", "COMPLETED", "RETURNED"].includes(String(asm?.stage || ""))) {
    return { editable: false, reason: "The review was already submitted — the proponent's details can't change now." };
  }
  return { editable: true, reason: null };
}

async function profilePayload(req, applicationId) {
  const app = await Workflow.getApplicationById(applicationId);
  if (!app?.proponent_id) return null;
  const p = await Proponent.getProponentById(app.proponent_id);
  if (!p) return null;
  const data = { proponent_id: p.id };
  for (const key of PROFILE_FIELDS) data[key] = p[key] ?? null;
  return {
    ...data,
    login_email: p.login_email ?? null,
    contract_type_name: p.contract_type_name ?? null,
    business_type: p.business_type ?? null,
    land_use_name: p.land_use_name ?? null,
    contact_persons: p.contact_persons || [],
    signatories: p.signatories || [],
    ...(await profileEditState(req, applicationId)),
  };
}

exports.getProfile = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const data = await profilePayload(req, id);
    if (!data) return res.status(404).json({ success: false, message: "Proponent not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Get proponent information");
  }
};

exports.saveProfile = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const state = await profileEditState(req, id);
    if (!state.editable) return res.status(409).json({ success: false, message: state.reason });

    const app = await Workflow.getApplicationById(id);
    if (!app?.proponent_id) return res.status(404).json({ success: false, message: "Proponent not found" });
    const b = req.body || {};
    const { leaseTermValue, leaseTermUnit, isValidLeaseTerm, LEASE_TERM_MESSAGE } = require("./c_users").leaseTerm;

    if (b.business_name !== undefined && !String(b.business_name || "").trim()) {
      return res.status(400).json({ success: false, message: "Business name is required." });
    }
    if (!isValidLeaseTerm(b.proposed_lease_term_years, b.proposed_lease_term_unit)) {
      return res.status(400).json({ success: false, message: LEASE_TERM_MESSAGE });
    }
    if (b.land_use_id) {
      const LandUse = require("../models/LandUse");
      if (!(await LandUse.listLandUses()).some((r) => Number(r.id) === Number(b.land_use_id))) {
        return res.status(400).json({ success: false, message: "Unknown land use" });
      }
    }
    const text = (v) => (v === undefined ? undefined : String(v || "").trim() || null);
    const patch = {
      business_name: b.business_name !== undefined ? String(b.business_name).trim() : undefined,
      address: text(b.address),
      lease_address: text(b.lease_address),
      location: text(b.location),
      land_use_id: b.land_use_id !== undefined ? (b.land_use_id ? Number(b.land_use_id) : null) : undefined,
      proposed_lease_term_years:
        b.proposed_lease_term_years !== undefined ? leaseTermValue(b.proposed_lease_term_years) : undefined,
      proposed_lease_term_unit: b.proposed_lease_term_unit !== undefined ? leaseTermUnit(b.proposed_lease_term_unit) : undefined,
      contact_no: text(b.contact_no),
      business_activities: text(b.business_activities),
      contact_persons: Array.isArray(b.contact_persons) ? b.contact_persons : undefined,
      signatories: Array.isArray(b.signatories) ? b.signatories : undefined,
      updated_by: req.user?.id ?? null,
    };
    await Proponent.updateProponent(app.proponent_id, patch);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_PROFILE_UPDATED",
      entityType: "proponent",
      entityId: app.proponent_id,
      details: { application_no: app.application_no, section: "proponent_information", via: "evaluation" },
      req,
    });
    return res.json({ success: true, data: await profilePayload(req, id) });
  } catch (error) {
    return fail(res, error, "Save proponent information");
  }
};

/* ------------ Performance Commitment (Evaluation Queue tab, B-10) ---------- */
// What the proponent commits to (investment, employees), encoded by the BDO
// while evaluating. Same dbo.proponent_investment row the Registered Locator's
// Performance Commitment card shows; the BDO sets only the Commitment column —
// the Actual figures are the Account Officer's once it's a locator. Same edit
// rule as Proponent Information.

async function commitmentPayload(req, applicationId) {
  const app = await Workflow.getApplicationById(applicationId);
  if (!app?.proponent_id) return null;
  const Investment = require("../models/Investment");
  const figures = await Investment.getForProponent(app.proponent_id);
  return {
    investment_commitment: figures.investment_commitment ?? null,
    employee_commitment: figures.employee_commitment ?? null,
    // Shown read-only for reference; only the Registered Locator edits these.
    investment_actual: figures.investment_actual ?? null,
    employee_actual: figures.employee_actual ?? null,
    ...(await profileEditState(req, applicationId)),
  };
}

exports.getCommitment = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const data = await commitmentPayload(req, id);
    if (!data) return res.status(404).json({ success: false, message: "Proponent not found" });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Get performance commitment");
  }
};

exports.saveCommitment = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const state = await profileEditState(req, id);
    if (!state.editable) return res.status(409).json({ success: false, message: state.reason });
    const app = await Workflow.getApplicationById(id);
    if (!app?.proponent_id) return res.status(404).json({ success: false, message: "Proponent not found" });
    const b = req.body || {};
    const text = (v) => (v === undefined ? undefined : String(v ?? "").trim() || null);
    // Commitment only — the Actual columns are left as they are.
    await Proponent.saveInvestment(
      app.proponent_id,
      { investment_commitment: text(b.investment_commitment), employee_commitment: text(b.employee_commitment) },
      req.user?.id ?? null
    );
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_INVESTMENT_UPDATED",
      entityType: "proponent",
      entityId: app.proponent_id,
      details: { application_no: app.application_no, section: "performance_commitment", via: "evaluation" },
      req,
    });
    return res.json({ success: true, data: await commitmentPayload(req, id) });
  } catch (error) {
    return fail(res, error, "Save performance commitment");
  }
};

/* ------------------------- Terms and conditions -------------------------- */

const Terms = require("../models/ApplicationTerms");

/** Terms can be written while the review is open — not once it's with
 * Level 1 (For Recommendation) or decided. */
async function ensureTermsEditable(res, applicationId, req) {
  // Level 2 writes the terms and makes the contract; Level 1 only checks them.
  if (req && String(req.user?.role || "").toLowerCase() !== "admin" && (await scopeFor(req)).manager) {
    res.status(403).json({ success: false, message: "The terms and the contract are done by the assigned evaluator." });
    return false;
  }
  const asm = await Assessment.getOrCreateAssessment(applicationId, null);
  if (["FOR_RECOMMENDATION", "COMPLETED", "RETURNED"].includes(String(asm?.stage || ""))) {
    res.status(409).json({ success: false, message: "The review was already submitted — the terms can't change now." });
    return false;
  }
  return true;
}

exports.getTerms = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    return res.json({ success: true, data: await Terms.getForApplication(id) });
  } catch (error) {
    return fail(res, error, "Get terms");
  }
};

exports.saveTerms = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    if (!(await ensureTermsEditable(res, id, req))) return undefined;
    const data = await Terms.saveDraft(id, req.body?.body, req.user?.id ?? null);
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Save terms");
  }
};

exports.reopenTerms = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    if (!(await ensureTermsEditable(res, id, req))) return undefined;
    const data = await Terms.reopen(id, { reason: req.body?.reason, actorId: req.user?.id ?? null });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "APPLICATION_TERMS_REOPENED",
      entityType: "application",
      entityId: id,
      details: { version: data?.version, reason: String(req.body?.reason || "").trim().slice(0, 500) || null },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Reopen terms");
  }
};

exports.sendTerms = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    if (!(await ensureTermsEditable(res, id, req))) return undefined;
    const data = await Terms.send(id, req.user?.id ?? null);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "APPLICATION_TERMS_SENT",
      entityType: "application",
      entityId: id,
      details: { version: data?.version },
      req,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, "Send terms");
  }
};

/* -------------------------------- Contract -------------------------------- */
// Level 2 makes the contract once the locator agreed to the terms: records it
// (contract no., dates), prints the package (contract + terms + the locator's
// requirements, one PDF), has it signed, then uploads the signed scan. Level 1
// only checks it on the approval panel.

const Contract = require("../models/Contract");
const Approval = require("../models/ApprovalIssuance");

exports.getContract = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const contract = await Contract.getByApplicationId(id);
    const terms = await Terms.getForApplication(id);
    const nextNo = contract ? null : await Approval.previewContractNo(id).catch(() => null);
    return res.json({ success: true, data: { contract: contract || null, terms_status: terms?.status || null, next_contract_no: nextNo } });
  } catch (error) {
    return fail(res, error, "Get contract");
  }
};

exports.saveContract = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    if (!(await ensureTermsEditable(res, id, req))) return undefined;
    const terms = await Terms.getForApplication(id);
    if (terms?.status !== "AGREED") {
      return res.status(409).json({ success: false, message: `The ${await partyOf(id)} hasn't agreed to the terms and conditions yet.` });
    }
    // The signed scan must be a file uploaded to this same application.
    const documentId = req.body?.document_id == null || req.body?.document_id === "" ? undefined : Number(req.body.document_id);
    if (documentId !== undefined) {
      const owned = await require("../config/database").selectData(
        `SELECT TOP (1) id FROM dbo.documents WHERE id = @param0 AND application_id = @param1`,
        [documentId, id]
      );
      if (!owned?.[0]) return res.status(400).json({ success: false, message: "That file doesn't belong to this application." });
    }
    const row = await Approval.saveContract(
      id,
      { effective_start: req.body?.effective_start ?? null, effective_end: req.body?.effective_end ?? null, document_id: documentId },
      req.user?.id ?? null
    );
    if (!row) return res.status(404).json({ success: false, message: "Application not found" });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "CONTRACT_SAVED",
      entityType: "application",
      entityId: id,
      details: { contract_no: row?.contract_no, signed_copy_uploaded: Boolean(row?.document_id) },
      req,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    return fail(res, error, "Save contract");
  }
};

/** One PDF to print and sign: contract + agreed terms + requirement files. */
exports.printContract = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const bundle = await require("../lib/contractBundle").buildContractBundle(id);
    if (!bundle) return res.status(404).json({ success: false, message: "Record the contract first." });
    AuditLog.recordFileAccess(req, {
      kind: "DOCUMENT",
      entityType: "application",
      entityId: id,
      details: { file_name: bundle.fileName, purpose: "contract for signing" },
    });
    res.type("application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${bundle.fileName}"`);
    return res.send(Buffer.from(bundle.bytes));
  } catch (error) {
    return fail(res, error, "Print contract");
  }
};

/** The lease agreement form (lib/leaseAgreement.js): fields and values. */
exports.getLeaseAgreement = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const form = await require("../lib/leaseAgreement").getForm(id);
    if (!form) return res.status(404).json({ success: false, message: "Application not found" });
    return res.json({ success: true, data: form });
  } catch (error) {
    return fail(res, error, "Lease agreement");
  }
};

/** Saves the form and downloads the filled lease agreement (Word). */
exports.generateLeaseAgreement = async (req, res) => {
  try {
    const id = appIdParam(req, res);
    if (id === null) return undefined;
    if (!(await ensureCanAct(req, res, id))) return undefined;
    const terms = await Terms.getForApplication(id);
    if (terms?.status !== "AGREED") {
      return res.status(409).json({ success: false, message: `The ${await partyOf(id)} hasn't agreed to the terms and conditions yet.` });
    }
    const doc = await require("../lib/leaseAgreement").generate(id, req.body?.values, req.user?.id);
    if (!doc) return res.status(404).json({ success: false, message: "Application not found" });
    AuditLog.recordFileAccess(req, {
      kind: "DOCUMENT",
      entityType: "application",
      entityId: id,
      details: { file_name: doc.fileName, purpose: "lease agreement (Word)" },
    });
    res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName}"`);
    return res.send(doc.bytes);
  } catch (error) {
    return fail(res, error, "Generate lease agreement");
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
