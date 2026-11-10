/**
 * Audit Log entries for actions on one application requirement (status,
 * remarks, comment, the locator's acknowledgement) — shared by the
 * Applications and Evaluation Queue controllers. Looks up the application,
 * locator and requirement name so the entry reads on its own.
 *
 * Never throws: a failed lookup still records the action with the id.
 */
const { selectData } = require("../config/database");
const AuditLog = require("../models/AuditLog");

async function requirementContext(applicationRequirementId) {
  try {
    const rows = await selectData(
      `SELECT TOP (1) ar.application_id, a.application_no, r.name AS requirement_name,
              p.business_name, p.ref_no
       FROM dbo.application_requirements ar
       LEFT JOIN dbo.requirements r ON r.id = ar.requirement_id
       LEFT JOIN dbo.applications a ON a.id = ar.application_id
       LEFT JOIN dbo.proponents p ON p.id = a.proponent_id
       WHERE ar.id = @param0`,
      [Number(applicationRequirementId)]
    );
    return rows[0] || {};
  } catch (error) {
    console.error("Requirement audit lookup error:", error);
    return {};
  }
}

async function recordRequirementAudit(req, applicationRequirementId, action, details = {}) {
  const ctx = await requirementContext(applicationRequirementId);
  await AuditLog.record({
    actorId: req.user?.id,
    actorUsername: req.user?.username,
    action,
    entityType: "application_requirement",
    entityId: Number(applicationRequirementId),
    details: {
      application_id: ctx.application_id ?? null,
      application_no: ctx.application_no ?? null,
      requirement_name: ctx.requirement_name ?? null,
      business_name: ctx.business_name ?? null,
      ref_no: ctx.ref_no ?? null,
      ...details,
    },
    req,
  });
}

module.exports = { recordRequirementAudit };
