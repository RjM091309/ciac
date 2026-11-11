// A locator's DTI Certificate of Business Name Registration (sole
// proprietorship), from wherever it was filed — shown (and opened) on the
// Registration card when the locator is registered with DTI:
//   - locator: on the locator's Documents tab — under the DTI requirement, or
//     named as one ("CAFE JKLM - DTI CERTIFICATE"; the BRIDGE import);
//   - application: filed with an application under the DTI requirement.
// "Latest" = the newest upload.
const { selectData } = require("../config/database");

// "DTI CERTIFICATE", "DTI REGISTRATION", "BUSINESS NAME REGISTRATION" — not
// just any mention of DTI (e.g. "EMAIL RE SEC DTI").
const DTI_NAME = /DTI\s*(CERT|REG|BN)|BUSINESS\s+NAME\s+(REG|CERT)|CERTIFICATE\s+OF\s+BUSINESS\s+NAME/i;
const time = (d) => (d ? new Date(d).getTime() || 0 : 0);

async function candidates(proponentId) {
  const pid = Number(proponentId);
  const dtiReq = `SELECT id FROM dbo.requirements WHERE UPPER(LTRIM(RTRIM(code))) = 'DTI'`;
  const [locator, application] = await Promise.all([
    selectData(
      `SELECT id, document_name, original_file_name, file_name, storage_path, content_type, created_at AS at, requirement_id
       FROM dbo.proponent_documents
       WHERE proponent_id = @param0
         AND (requirement_id IN (${dtiReq}) OR document_name LIKE '%DTI%' OR original_file_name LIKE '%DTI%'
              OR document_name LIKE '%BUSINESS NAME%' OR original_file_name LIKE '%BUSINESS NAME%')`,
      [pid]
    ).catch(() => []),
    selectData(
      `SELECT d.id, d.original_file_name, d.file_name, d.storage_path, d.content_type, d.created_at AS at
       FROM dbo.documents d JOIN dbo.applications a ON a.id = d.application_id
       WHERE a.proponent_id = @param0 AND d.requirement_id IN (${dtiReq})`,
      [pid]
    ).catch(() => []),
  ]);
  return [
    ...locator
      .filter((d) => d.requirement_id || DTI_NAME.test(d.document_name || "") || DTI_NAME.test(d.original_file_name || ""))
      .map((d) => ({ ...d, source: "locator", label: d.document_name || d.original_file_name || "DTI Certificate" })),
    ...application.map((d) => ({ ...d, source: "application", label: d.original_file_name || d.file_name || "DTI Certificate" })),
  ];
}

/** The latest DTI certificate with its stored file, or null. */
async function latestDtiDocument(proponentId) {
  const list = await candidates(proponentId);
  if (!list.length) return null;
  list.sort((a, b) => time(b.at) - time(a.at) || b.id - a.id);
  return list[0];
}

/** What the card shows (no storage path). */
async function latestDtiSummary(proponentId) {
  const d = await latestDtiDocument(proponentId);
  if (!d) return null;
  return {
    source: d.source,
    label: d.label,
    original_file_name: d.original_file_name || d.file_name || null,
    content_type: d.content_type || null,
    uploaded_at: d.at || null,
  };
}

module.exports = { latestDtiDocument, latestDtiSummary };
