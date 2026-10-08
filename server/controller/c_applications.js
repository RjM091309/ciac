const fs = require("fs");
const Workflow = require("../models/ApplicationWorkflow");
const Proponent = require("../models/Proponent");
const Role = require("../models/Role");
const User = require("../models/User");
const ApplicationType = require("../models/ApplicationType");
const ControlPanelPermission = require("../models/ControlPanelPermission");
const Assessment = require("../models/AssessmentEvaluation");
const AuditLog = require("../models/AuditLog");
const { diffChanges } = require("../lib/auditDiff");
const { generateTempPassword } = require("../lib/password");
const { sendTempPasswordEmail } = require("./c_users");
const { publicErrorMessage } = require("../lib/httpError");
const { departmentOf, aoLevel2Id } = require("../lib/departments");
const { resolveStoredPath, relativeStoragePath } = require("../lib/fileStorage");
const { placeApplicationUpload } = require("../lib/locatorFolders");

/** A locator account created via Locator Accounts with a business profile
 * starts PENDING (see c_users.js's exports.create) — no login access, no
 * email sent yet. The first real application filed for them (SUBMITTED, not
 * a draft) is what actually activates it: generate a real temp password,
 * flip the account ACTIVE, and email their credentials now that they have
 * something to act on. Best-effort — the application itself is already
 * created by the time this runs, so a failure here shouldn't undo that. */
async function activateLocatorIfPending(proponentId, actorId) {
  try {
    const proponent = await Proponent.getProponentById(proponentId);
    const userId = proponent?.user_id;
    if (!userId) return null;
    const user = await User.getUserById(userId);
    if (!user || String(user.status || "").toUpperCase() !== "PENDING") return null;

    const tempPassword = generateTempPassword();
    await User.adminResetPassword(userId, tempPassword);
    const activated = await User.setUserStatus(userId, "ACTIVE");
    const mailResult = await sendTempPasswordEmail({
      to: activated.email,
      name: activated.full_name || activated.username,
      username: activated.username,
      tempPassword,
      isNewAccount: true,
    });
    return { activated: true, emailSent: mailResult.sent };
  } catch (error) {
    console.error("Activate pending locator error:", error);
    return null;
  }
}

// Same menu set as Notification.js's EVENT_TYPE_MENU_KEYS.application_status
// — whoever can see one of these queues can open an application's detail.
const APPLICATION_ACCESS_MENU_KEYS = ["applications:new", "applications:renewals", "assessment:queue", "approval:queue"];

/** Whether `role` (any name — Officer, Account Officer, Assessment Officer,
 * or any future custom staff role) has Control Panel sidebar access to at
 * least one application-relevant menu. Checked by permission rather than a
 * hardcoded `role === "officer"` so a custom role isn't silently forbidden
 * from every application, and the built-in Officer role can be renamed
 * without breaking this check. */
async function hasStaffApplicationAccess(role) {
  if (role === "admin") return true;
  const roleId = await Role.getActiveRoleIdByName(role);
  if (!roleId) return false;
  const permissions = await ControlPanelPermission.getSidebarPermissions(roleId);
  return permissions.some(
    (p) => APPLICATION_ACCESS_MENU_KEYS.includes(p.menu_key) && (Number(p.is_enabled) === 1 || p.is_enabled === true)
  );
}

/** Staff (admin, or any role with Control Panel access to an applications
 * menu) can reach any application; a proponent only their own. Returns the
 * application row, or null with `forbidden` set when the caller isn't
 * allowed to see it (vs. not found, which is a plain null). */
async function loadWithAccess(req, applicationId) {
  const application = await Workflow.getApplicationById(applicationId);
  if (!application) return { application: null, forbidden: false };

  const role = String(req.user?.role || "").toLowerCase();
  if (await hasStaffApplicationAccess(role)) {
    // A Level 2 Assessment Officer (no other applications menu) only reaches
    // the applications a Manager assigned to them.
    const level2UserId = await Assessment.getLevel2OnlyUserId(req.user);
    // Exception: their own unsubmitted DRAFT, so they can finish filing it.
    const ownDraft =
      String(application.status || "").toUpperCase() === "DRAFT" && Number(application.created_by) === level2UserId;
    if (level2UserId && !ownDraft && (await Assessment.getAssignedEvaluatorId(applicationId)) !== level2UserId) {
      return { application, forbidden: true };
    }
    // A Level 2 Account Officer only reaches their own locators' applications.
    const aoL2 = await aoLevel2Id(req.user);
    if (aoL2) {
      const prop = await Proponent.getProponentById(application.proponent_id);
      if (Number(prop?.account_officer_id) !== aoL2) return { application, forbidden: true };
    }
    return { application, forbidden: false };
  }

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
    const level2UserId = await Assessment.getLevel2OnlyUserId(req.user);
    if (level2UserId) {
      // Level 2 sees an application only once it's assigned to them — plus
      // their own unsubmitted DRAFTs, so they can finish filing them.
      const assigned = await Assessment.listApplicationIdsAssignedTo(level2UserId);
      const visible = rows.filter(
        (r) =>
          assigned.has(Number(r.id)) ||
          (String(r.status || "").toUpperCase() === "DRAFT" && Number(r.created_by) === level2UserId)
      );
      return res.json({ success: true, data: visible });
    }
    // A Level 2 Account Officer sees only their own locators' applications.
    const aoL2 = await aoLevel2Id(req.user);
    if (aoL2) {
      const mine = new Set(
        (await Proponent.listProponentIdsForAccountOfficer(aoL2)).map(Number)
      );
      return res.json({ success: true, data: rows.filter((r) => mine.has(Number(r.proponent_id))) });
    }
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List applications error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** A submitted renewal goes straight to the locator's own Account Officer
 * (Level 2) for review — no BDO, no assigning step. No-op if it's already
 * assigned or the locator has no Account Officer. */
async function assignRenewalToAccountOfficer(applicationId, actorId) {
  try {
    const app = await Workflow.getApplicationById(applicationId);
    if (!app || !Number(app.is_renewal)) return;
    if (await Assessment.getAssignedEvaluatorId(applicationId)) return;
    const prop = await Proponent.getProponentById(app.proponent_id);
    if (!prop?.account_officer_id) return;
    await Assessment.assignEvaluator(applicationId, { evaluatorId: prop.account_officer_id, actorId });
  } catch (error) {
    console.error("Assign renewal to Account Officer error:", error);
  }
}

/** Permits' "Renew" (one confirmation, no form): files and submits the
 * renewal straight away — same locator, industry type and type of contract
 * as their latest approved application, linked to the permit — then it goes
 * to the locator's Account Officer like any renewal (exports.create does the
 * checks: Account Officer only, own locators for Level 2, one open renewal). */
exports.renewFromPermit = async (req, res) => {
  try {
    const Permit = require("../models/Permit");
    const permit = await Permit.getById(Number(req.params.permitId));
    if (!permit) return res.status(404).json({ success: false, message: "Permit not found" });
    const proponent = await Proponent.getProponentById(permit.proponent_id);
    // The locator uploads the renewal requirements in the portal — an
    // encoded locator needs a login first (Registered Locator → Login).
    if (!proponent?.user_id) {
      return res.status(400).json({
        success: false,
        message: "This locator has no portal login yet. Create it on Registered Locator (Login) first, then renew.",
      });
    }
    // Type and Type of Contract come from the latest approved application;
    // an existing locator encoded by hand has none, so its own encoded
    // Industry / Type of Contract are used instead.
    const latest = await Workflow.getLatestApprovedApplication(permit.proponent_id);
    const applicationType = latest?.application_type || proponent.industry_code || null;
    const contractTypeId = latest ? latest.contract_type_id ?? null : proponent.contract_type_id ?? null;
    if (!applicationType) {
      return res.status(400).json({
        success: false,
        message: "Set this locator's Industry on Registered Locator first — the renewal needs it.",
      });
    }
    req.body = {
      proponent_id: permit.proponent_id,
      application_type: applicationType,
      contract_type_id: contractTypeId,
      is_renewal: 1,
      save_as_draft: false,
      renewed_from_permit_id: permit.id,
    };
    return exports.create(req, res);
  } catch (error) {
    console.error("Renew from permit error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.create = async (req, res) => {
  try {
    const { application_type, is_renewal, save_as_draft, submitted_at, current_officer_id, renewed_from_permit_id, contract_type_id } = req.body || {};
    let { proponent_id } = req.body || {};

    const role = String(req.user?.role || "").toLowerCase();
    if (role === "proponent") {
      // Self-service filing: a proponent may only ever file for their own
      // business — the client-supplied proponent_id (if any) is ignored.
      const proponent = await Proponent.getProponentByUserId(req.user.id);
      if (!proponent) {
        return res.status(403).json({
          success: false,
          message: "Complete your business profile before filing an application.",
        });
      }
      proponent_id = proponent.id;
    }

    if (!Number.isFinite(Number(proponent_id))) {
      return res.status(400).json({ success: false, message: "proponent_id is required" });
    }
    // Renewals are between the Account Officer and the locator: filed by the
    // Account Officer (a Level 2 only for their own locators), never the BDO.
    const renewal = Boolean(Number(is_renewal));
    if (renewal) {
      const department = await departmentOf(req.user);
      if (department !== "ao" && department !== "admin") {
        return res.status(403).json({ success: false, message: "Renewals are filed by the locator's Account Officer." });
      }
      const ownOnly = await aoLevel2Id(req.user);
      if (ownOnly) {
        const prop = await Proponent.getProponentById(Number(proponent_id));
        if (Number(prop?.account_officer_id) !== ownOnly) {
          return res.status(403).json({ success: false, message: "You can only file renewals for your own locators." });
        }
      }
    }
    const normalizedType = String(application_type || "").trim().toUpperCase();
    if (!normalizedType) {
      return res.status(400).json({ success: false, message: "application_type is required" });
    }
    if (!(await Workflow.isValidApplicationType(normalizedType))) {
      const activeCodes = await ApplicationType.listActiveCodes();
      return res.status(400).json({
        success: false,
        message: `Invalid application type. Expected one of: ${activeCodes.join(", ")}.`,
      });
    }

    const row = await Workflow.createApplication({
      proponent_id,
      application_type: normalizedType,
      is_renewal: Number(is_renewal) ? 1 : 0,
      status: save_as_draft ? "DRAFT" : "SUBMITTED",
      submitted_at: submitted_at ?? null,
      current_officer_id,
      created_by: req.user?.id ?? null,
      renewed_from_permit_id: renewed_from_permit_id ?? null,
      contract_type_id,
    });

    // Only a real submission activates a still-pending locator — a draft
    // isn't a commitment yet, so it shouldn't hand out login access.
    const activation = save_as_draft ? null : await activateLocatorIfPending(proponent_id, req.user?.id ?? null);
    if (renewal && !save_as_draft) await assignRenewalToAccountOfficer(row?.id, req.user?.id ?? null);

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: save_as_draft ? "APPLICATION_DRAFT_SAVED" : "APPLICATION_SUBMITTED",
      entityType: "application",
      entityId: row?.id,
      details: {
        application_no: row?.application_no,
        proponent_name: row?.proponent_name,
        application_type: normalizedType,
        is_renewal: Boolean(Number(is_renewal)),
      },
      req,
    });

    return res.status(201).json({
      success: true,
      data: row,
      locatorActivated: activation?.activated || undefined,
      locatorEmailSent: activation ? activation.emailSent : undefined,
    });
  } catch (error) {
    console.error("Create application error:", error);
    return res.status(error.status || 500).json({ success: false, message: publicErrorMessage(error) });
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

    // This is the admin-only raw status escape hatch (requireRole("admin")
    // at the route level) — it bypasses the normal Assessment/Approval
    // gates, so it's worth its own clearly-labeled trail entry distinct from
    // the regular workflow transitions below.
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "APPLICATION_STATUS_FORCED",
      entityType: "application",
      entityId: id,
      details: { application_no: row?.application_no, to_status: String(to_status).trim(), remarks: remarks || undefined },
      req,
    });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update application status error:", error);
    return res.status(400).json({ success: false, message: publicErrorMessage(error) });
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

    // A DRAFT saved earlier (not submitted immediately at filing time) never
    // went through create's own activation call — this is that same "first
    // real submission" moment, just reached via Continue Draft/Resubmit
    // instead. No-ops if the locator's account is already ACTIVE.
    const activation = await activateLocatorIfPending(row.proponent_id, req.user?.id ?? null);
    // A renewal saved as a draft reaches its Account Officer on first submit.
    await assignRenewalToAccountOfficer(row.id, req.user?.id ?? null);

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: row?.status === "RESUBMITTED" ? "APPLICATION_RESUBMITTED" : "APPLICATION_SUBMITTED",
      entityType: "application",
      entityId: id,
      details: { application_no: row?.application_no, proponent_name: row?.proponent_name },
      req,
    });

    return res.json({
      success: true,
      data: row,
      locatorActivated: activation?.activated || undefined,
      locatorEmailSent: activation ? activation.emailSent : undefined,
    });
  } catch (error) {
    console.error("Submit application error:", error);
    return res.status(400).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** Fixes a filing mistake — application_type / is_renewal (through
 * Assessment, see Workflow.TYPE_EDITABLE_STATUSES) and proponent_id
 * (DRAFT-only). Refused once documents are attached and the type/renewal
 * actually changes, or once past Assessment. */
exports.updateDraft = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { application, forbidden } = await loadWithAccess(req, id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const { application_type, is_renewal, proponent_id, contract_type_id } = req.body || {};
    const row = await Workflow.updateDraftApplication(id, {
      application_type,
      is_renewal,
      proponent_id,
      contract_type_id,
      changed_by: req.user?.id ?? null,
    });

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "APPLICATION_UPDATED",
      entityType: "application",
      entityId: id,
      details: {
        application_no: row?.application_no,
        proponent_name: row?.proponent_name,
        changes: diffChanges(application, row, ["application_type", "is_renewal", "proponent_id"]),
      },
      req,
    });

    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update draft application error:", error);
    return res.status(400).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** Delete an unsubmitted (DRAFT) application with no documents attached. */
exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { application, forbidden } = await loadWithAccess(req, id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const result = await Workflow.deleteDraftApplication(id);
    if (!result.deleted) {
      const messages = {
        NOT_DRAFT: "Only draft applications can be deleted.",
        HAS_DOCUMENTS: "Remove the uploaded documents before deleting this draft.",
        NOT_FOUND: "Application not found.",
      };
      const code = result.reason === "NOT_FOUND" ? 404 : 409;
      return res.status(code).json({ success: false, message: messages[result.reason] || "Cannot delete this application." });
    }

    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "APPLICATION_DELETED",
      entityType: "application",
      entityId: id,
      details: { application_no: application?.application_no, proponent_name: application?.proponent_name },
      req,
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Delete application error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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

    const before = await Workflow.getApplicationRequirementById(id);
    if (!before) return res.status(404).json({ success: false, message: "Application requirement not found" });
    // Same Level 1/2 rule as Assessment's own requirement route: a Level 2
    // Officer may only verify/reject on applications assigned to them.
    if (!(await Assessment.isManager(req.user))) {
      if ((await Assessment.getAssignedEvaluatorId(before.application_id)) !== Number(req.user?.id)) {
        return res.status(403).json({ success: false, message: "This application is not assigned to you." });
      }
    }
    const row = await Workflow.updateApplicationRequirementStatus(id, {
      status: String(status).trim(),
      remarks: remarks ?? null,
      updated_by: req.user?.id ?? null,
    });
    if (!row) return res.status(404).json({ success: false, message: "Application requirement not found" });

    const nextStatus = String(status).trim().toUpperCase();
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: nextStatus === "VERIFIED" ? "REQUIREMENT_VERIFIED" : nextStatus === "REJECTED" ? "REQUIREMENT_REJECTED" : "REQUIREMENT_STATUS_CHANGED",
      entityType: "application_requirement",
      entityId: id,
      details: {
        requirement_name: before?.requirement_name || before?.requirement_code,
        remarks: remarks || undefined,
      },
      req,
    });
    return res.json({ success: true, data: row });
  } catch (error) {
    console.error("Update application requirement status error:", error);
    return res.status(error.status || 500).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** Resolves a requirement row plus its parent application's access check in
 * one call — the comment thread and acknowledge endpoints are reached by
 * requirement id, not application id, so they need this extra hop before
 * loadWithAccess's ownership check applies. */
async function loadRequirementWithAccess(req, requirementId) {
  const requirement = await Workflow.getApplicationRequirementById(requirementId);
  if (!requirement) return { requirement: null, application: null, forbidden: false };
  const { application, forbidden } = await loadWithAccess(req, requirement.application_id);
  return { requirement, application, forbidden };
}

exports.listRequirementComments = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { requirement, forbidden } = await loadRequirementWithAccess(req, id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!requirement) return res.status(404).json({ success: false, message: "Application requirement not found" });
    const rows = await Workflow.listRequirementComments(id);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("List requirement comments error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

exports.addRequirementComment = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { message } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: "message is required" });
    }
    const { requirement, forbidden } = await loadRequirementWithAccess(req, id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!requirement) return res.status(404).json({ success: false, message: "Application requirement not found" });

    await Workflow.addRequirementComment({
      applicationRequirementId: id,
      authorId: req.user?.id ?? null,
      authorRole: req.user?.role ?? null,
      message: String(message).trim(),
    });
    const rows = await Workflow.listRequirementComments(id);
    return res.status(201).json({ success: true, data: rows });
  } catch (error) {
    console.error("Add requirement comment error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** Locator-only: staff already know the outcome of their own decision, so
 * there's nothing for them to acknowledge here. */
exports.acknowledgeRequirement = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "proponent") return res.status(403).json({ success: false, message: "Forbidden" });

    const { requirement, forbidden } = await loadRequirementWithAccess(req, id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });
    if (!requirement) return res.status(404).json({ success: false, message: "Application requirement not found" });

    const updated = await Workflow.acknowledgeRequirement(id, { acknowledgedBy: req.user?.id ?? null });
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Acknowledge requirement error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};

/** Runs after multer (upload.single("file")) has already saved the file to
 * disk — req.file holds where it landed and its original name/type/size. */
exports.createDocument = async (req, res) => {
  // multer has already written the file by the time any check below runs, so
  // every rejection must delete it (same as the portal upload handler).
  const discardFile = () => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  };
  try {
    const applicationId = Number(req.body?.application_id);
    if (!Number.isFinite(applicationId)) {
      discardFile();
      return res.status(400).json({ success: false, message: "application_id is required" });
    }
    const { forbidden, application } = await loadWithAccess(req, applicationId);
    if (forbidden || !application) {
      discardFile();
      return forbidden
        ? res.status(403).json({ success: false, message: "Forbidden" })
        : res.status(404).json({ success: false, message: "Application not found" });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "A file is required" });
    }

    // Same guards as the portal upload: the requirement must be on this
    // application's checklist, and a locator can't upload under one that's
    // already VERIFIED.
    const requirementId = Number(req.body?.requirement_id) || null;
    if (requirementId) {
      const reqs = await Workflow.listApplicationRequirements(applicationId);
      const match = reqs.find((r) => Number(r.requirement_id) === requirementId);
      if (!match) {
        discardFile();
        return res.status(400).json({ success: false, message: "That requirement doesn't belong to this application." });
      }
      const isProponent = String(req.user?.role || "").toLowerCase() === "proponent";
      if (isProponent && String(match.status || "").toUpperCase() === "VERIFIED") {
        discardFile();
        return res.status(400).json({ success: false, message: "This requirement is already verified." });
      }
    }

    // Filed under the locator's folder: locators/<Ref No>/<APP-…>/
    const storedPath = await placeApplicationUpload(req.file.path, applicationId);
    req.file.path = storedPath; // so a failed save below cleans up the moved file
    const row = await Workflow.createDocument({
      application_id: applicationId,
      requirement_id: requirementId,
      file_name: req.file.filename,
      original_file_name: req.file.originalname,
      storage_path: relativeStoragePath(storedPath), // relative, like portal uploads — survives moving STORAGE_DIR
      content_type: req.file.mimetype,
      file_size_bytes: req.file.size,
      created_by: req.user?.id ?? null,
    });
    await AuditLog.record({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: "DOCUMENT_UPLOADED",
      entityType: "application",
      entityId: applicationId,
      details: { application_no: application?.application_no, file_name: req.file.originalname },
      req,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    console.error("Create document error:", error);
    discardFile();
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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

    const { application, forbidden } = await loadWithAccess(req, document.application_id);
    if (forbidden) return res.status(403).json({ success: false, message: "Forbidden" });

    const downloadName = document.original_file_name || document.file_name;
    AuditLog.recordFileAccess(req, {
      kind: "DOCUMENT",
      entityType: "application",
      entityId: document.application_id,
      details: { application_no: application?.application_no, file_name: downloadName },
    });
    // Portal uploads store a path relative to STORAGE_ROOT, staff uploads an
    // absolute one; resolveStoredPath handles both (and refuses anything
    // outside the storage root).
    const abs = resolveStoredPath(document.storage_path);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({ success: false, message: "File is no longer available." });
    }
    return res.download(abs, downloadName);
  } catch (error) {
    console.error("Download document error:", error);
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
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
    return res.status(500).json({ success: false, message: publicErrorMessage(error) });
  }
};
