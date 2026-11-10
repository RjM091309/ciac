// A locator's latest GIS (General Information Sheet), from wherever it was
// filed — shown (and opened) on the Stockholders tab's GIS card:
//   - compliance: uploaded on the Compliance page (item GIS);
//   - locator: on the locator's Documents tab — under the GIS requirement, or
//     named as one ("GIS 2025", "CONQUEST - GIS 2021"; the BRIDGE import);
//   - application: filed with an application under the GIS requirement.
// "Latest" = the year in its name ("GIS 2024"), else the year it was
// uploaded; then the upload date.
const { selectData } = require("../config/database");

const GIS_NAME = /(^|[^A-Z])GIS([^A-Z]|$)|GENERAL INFORMATION SHEET/i;
const yearIn = (s) => {
  const m = String(s || "").match(/\b(19[5-9]\d|20\d\d)\b/g);
  return m ? Math.max(...m.map(Number)) : null;
};
const time = (d) => (d ? new Date(d).getTime() || 0 : 0);

async function candidates(proponentId) {
  const pid = Number(proponentId);
  const gisReq = `SELECT id FROM dbo.requirements WHERE UPPER(LTRIM(RTRIM(code))) = 'GIS'`;
  const [compliance, locator, application] = await Promise.all([
    selectData(
      `SELECT id, original_file_name, file_name, storage_path, content_type, status, validity_to, uploaded_at AS at
       FROM dbo.locator_compliance_documents WHERE proponent_id = @param0 AND item_code = 'GIS'`,
      [pid]
    ).catch(() => []),
    selectData(
      `SELECT id, document_name, original_file_name, file_name, storage_path, content_type, created_at AS at, requirement_id
       FROM dbo.proponent_documents
       WHERE proponent_id = @param0
         AND (requirement_id IN (${gisReq}) OR document_name LIKE '%GIS%' OR document_name LIKE '%GENERAL INFORMATION%'
              OR original_file_name LIKE '%GIS%')`,
      [pid]
    ).catch(() => []),
    selectData(
      `SELECT d.id, d.original_file_name, d.file_name, d.storage_path, d.content_type, d.created_at AS at
       FROM dbo.documents d JOIN dbo.applications a ON a.id = d.application_id
       WHERE a.proponent_id = @param0 AND d.requirement_id IN (${gisReq})`,
      [pid]
    ).catch(() => []),
  ]);
  return [
    ...compliance.map((d) => ({ ...d, source: "compliance", label: d.original_file_name || d.file_name || "GIS" })),
    ...locator
      .filter((d) => d.requirement_id || GIS_NAME.test(d.document_name || "") || GIS_NAME.test(d.original_file_name || ""))
      .map((d) => ({ ...d, source: "locator", label: d.document_name || d.original_file_name || "GIS" })),
    ...application.map((d) => ({ ...d, source: "application", label: d.original_file_name || d.file_name || "GIS" })),
  ];
}

/** The latest GIS with its stored file, or null. */
async function latestGisDocument(proponentId) {
  const list = await candidates(proponentId);
  if (!list.length) return null;
  const key = (d) => yearIn(d.label) ?? yearIn(d.original_file_name) ?? (d.at ? new Date(d.at).getFullYear() : 0);
  list.sort((a, b) => key(b) - key(a) || time(b.at) - time(a.at) || b.id - a.id);
  return { ...list[0], year: key(list[0]) || null };
}

/** What the GIS card shows (no storage path). */
async function latestGisSummary(proponentId) {
  const d = await latestGisDocument(proponentId);
  if (!d) return null;
  return {
    source: d.source,
    label: d.label,
    original_file_name: d.original_file_name || d.file_name || null,
    year: d.year,
    status: d.source === "compliance" ? d.status || null : null,
    validity_to: d.validity_to || null,
    uploaded_at: d.at || null,
  };
}

module.exports = { latestGisDocument, latestGisSummary };
