// Proponent intake (see models/ProponentIntake.js): BDO Level 1 records the
// letter and hands it to a Level 2, who files the account and application.
const fs = require("fs");
const Intake = require("../models/ProponentIntake");
const Assessment = require("../models/AssessmentEvaluation");
const Notification = require("../models/Notification");
const AuditLog = require("../models/AuditLog");
const { departmentOf } = require("../lib/departments");
const { contentDisposition } = require("../lib/fileStorage");
const { emailStaffInBackground } = require("../lib/staffEmail");
const { publicErrorMessage } = require("../lib/httpError");

const PAGE = "/applications/new-proponent";

function fail(res, error, label) {
  console.error(`${label} error:`, error);
  return res.status(error.status || 500).json({ success: false, message: publicErrorMessage(error) });
}

/** BDO or admin only; `manager` = Level 1 (admin counts as one). */
async function scopeFor(req) {
  const department = await departmentOf(req.user);
  return {
    allowed: department === "bdo" || department === "admin",
    manager: department === "admin" || (await Assessment.isManager(req.user)),
    userId: Number(req.user?.id) || null,
  };
}

function dropUpload(req) {
  if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
}

async function isAssignable(userId) {
  const pool = await Assessment.listAssignableEvaluators();
  return pool.some((u) => Number(u.id) === Number(userId));
}

async function tellAssignee(intake, actor) {
  const by = actor?.full_name || actor?.username || "BDO - MANAGER";
  try {
    await Notification.createNotification({
      userId: intake.assigned_to,
      subject: `New proponent: ${intake.business_name}`,
      body: `${by} assigned you ${intake.business_name}. Open New Proponent and click "Start application" to file it.`,
      createdBy: actor?.id ?? null,
      eventType: "proponent_intake",
    });
  } catch (error) {
    console.error("Intake notification error:", error);
  }
  emailStaffInBackground(intake.assigned_to, {
    subject: `New proponent assigned to you: ${intake.business_name}`,
    lines: [
      `${by} received the letter of ${intake.business_name} and assigned the proponent to you.`,
      `Open New Proponent and click "Start application" to create the proponent's account and application. The letter is attached there.`,
    ],
    linkPath: PAGE,
    linkLabel: "Open New Proponent",
  });
}

exports.list = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    if (!scope.allowed) return res.json({ success: true, data: [], allowed: false, manager: false });
    // ?mine=1: only the ones assigned to me (Locator Accounts).
    const mine = req.query?.mine === "1";
    const data = await Intake.list({ assignedTo: scope.manager && !mine ? null : scope.userId });
    return res.json({ success: true, data, allowed: true, manager: scope.manager });
  } catch (error) {
    return fail(res, error, "List intakes");
  }
};

exports.evaluators = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    if (!scope.allowed || !scope.manager) return res.json({ success: true, data: [] });
    return res.json({ success: true, data: await Assessment.listAssignableEvaluators() });
  } catch (error) {
    return fail(res, error, "List intake evaluators");
  }
};

exports.create = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    if (!scope.allowed || !scope.manager) {
      dropUpload(req);
      return res.status(403).json({ success: false, message: "Only the BDO - MANAGER records a new proponent." });
    }
    const businessName = String(req.body?.business_name || "").trim();
    const assignedTo = Number(req.body?.assigned_to);
    if (!businessName) {
      dropUpload(req);
      return res.status(400).json({ success: false, message: "Business name is required." });
    }
    if (!req.file) return res.status(400).json({ success: false, message: "Upload the letter (PDF)." });
    if (!Number.isFinite(assignedTo) || !(await isAssignable(assignedTo))) {
      dropUpload(req);
      return res.status(400).json({ success: false, message: "Choose a BDO." });
    }
    const intake = await Intake.create({
      businessName,
      assignedTo,
      letterAbsPath: req.file.path,
      letterName: req.file.originalname,
      actorId: req.user?.id,
    });
    await tellAssignee(intake, req.user);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_INTAKE_CREATED",
      entityType: "proponent_intake",
      entityId: intake.id,
      details: { business_name: intake.business_name, assigned_to: intake.assigned_name },
      req,
    });
    return res.status(201).json({ success: true, data: intake, message: `Sent to ${intake.assigned_name}.` });
  } catch (error) {
    dropUpload(req);
    return fail(res, error, "Create intake");
  }
};

exports.letter = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    const intake = await Intake.getById(req.params.id);
    if (!intake || !scope.allowed || (!scope.manager && Number(intake.assigned_to) !== scope.userId)) {
      return res.status(404).json({ success: false, message: "Letter not found" });
    }
    const file = await Intake.letterFile(intake.id);
    if (!file) return res.status(404).json({ success: false, message: "Letter not found" });
    AuditLog.recordFileAccess(req, {
      kind: "INTAKE_LETTER",
      entityType: "proponent_intake",
      entityId: intake.id,
      details: { business_name: intake.business_name, file: file.name },
    }).catch(() => {});
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDisposition("inline", file.name));
    return fs.createReadStream(file.path).pipe(res);
  } catch (error) {
    return fail(res, error, "Intake letter");
  }
};

exports.reassign = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    if (!scope.allowed || !scope.manager) return res.status(403).json({ success: false, message: "Only the BDO - MANAGER can reassign." });
    const current = await Intake.getById(req.params.id);
    if (!current || current.status !== "OPEN") return res.status(404).json({ success: false, message: "Not found" });
    const assignedTo = Number(req.body?.assigned_to);
    if (!(await isAssignable(assignedTo))) return res.status(400).json({ success: false, message: "Choose a BDO." });
    if (assignedTo === Number(current.assigned_to)) return res.json({ success: true, data: current });
    const intake = await Intake.reassign(current.id, assignedTo);
    await tellAssignee(intake, req.user);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_INTAKE_REASSIGNED",
      entityType: "proponent_intake",
      entityId: intake.id,
      details: { business_name: intake.business_name, from: current.assigned_name, to: intake.assigned_name },
      req,
    });
    return res.json({ success: true, data: intake });
  } catch (error) {
    return fail(res, error, "Reassign intake");
  }
};

exports.cancel = async (req, res) => {
  try {
    const scope = await scopeFor(req);
    if (!scope.allowed || !scope.manager) return res.status(403).json({ success: false, message: "Only the BDO - MANAGER can cancel." });
    const current = await Intake.getById(req.params.id);
    if (!current || current.status !== "OPEN") return res.status(404).json({ success: false, message: "Not found" });
    const intake = await Intake.cancel(current.id);
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "PROPONENT_INTAKE_CANCELLED",
      entityType: "proponent_intake",
      entityId: intake.id,
      details: { business_name: intake.business_name },
      req,
    });
    return res.json({ success: true, data: intake });
  } catch (error) {
    return fail(res, error, "Cancel intake");
  }
};

/** A submitted application filed from an intake goes straight to the Level 2
 * Level 1 picked — no separate assignment step. Best-effort; no-op when it
 * wasn't from an intake or already has an evaluator. */
async function assignFromIntake(applicationId) {
  try {
    const intake = await Intake.getByApplicationId(applicationId);
    if (!intake || (await Assessment.getAssignedEvaluatorId(applicationId))) return;
    await Assessment.assignEvaluator(applicationId, { evaluatorId: intake.assigned_to, actorId: intake.created_by });
  } catch (error) {
    console.error("Assign from intake error:", error);
  }
}

exports.scopeFor = scopeFor;
exports.assignFromIntake = assignFromIntake;
