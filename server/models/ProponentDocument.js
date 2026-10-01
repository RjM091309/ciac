const { selectData, insertData, updateData, updateSchema } = require("../config/database");

// Documents uploaded straight onto a locator from the Registered Locator
// panel (Documents tab) — mainly for manually registered locators, which
// have no application for dbo.documents (application-scoped) to hang off.
// requirement_id optionally tags the file with a catalog requirement
// (dbo.requirements) so it reads the same as an application upload.

let schemaReady = null;

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = updateSchema(`
      IF OBJECT_ID('dbo.proponent_documents', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.proponent_documents (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          proponent_id INT NOT NULL,
          requirement_id INT NULL,
          document_name NVARCHAR(255) NULL,
          file_name NVARCHAR(260) NOT NULL,
          original_file_name NVARCHAR(260) NULL,
          storage_path NVARCHAR(1000) NOT NULL,
          content_type NVARCHAR(255) NULL,
          file_size_bytes BIGINT NULL,
          created_by INT NULL,
          created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponent_documents_created_at DEFAULT (SYSUTCDATETIME()),
          CONSTRAINT FK_proponent_documents_proponent FOREIGN KEY (proponent_id)
            REFERENCES dbo.proponents(id) ON DELETE CASCADE
        );
        CREATE INDEX IX_proponent_documents_proponent_id ON dbo.proponent_documents(proponent_id);
      END
    `).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const SELECT = `
  SELECT
    d.id,
    d.proponent_id,
    d.requirement_id,
    COALESCE(r.name, d.document_name) AS document_name,
    r.code AS requirement_code,
    d.file_name,
    d.original_file_name,
    d.storage_path,
    d.content_type,
    d.file_size_bytes,
    d.created_by,
    d.created_at,
    u.full_name AS uploaded_by_name
  FROM dbo.proponent_documents d
  LEFT JOIN dbo.requirements r ON r.id = d.requirement_id
  LEFT JOIN dbo.users u ON u.id = d.created_by
`;

async function listByProponent(proponentId) {
  await ensureSchema();
  return selectData(`${SELECT} WHERE d.proponent_id = @param0 ORDER BY d.id DESC`, [toInt(proponentId)]);
}

async function getById(id) {
  await ensureSchema();
  const rows = await selectData(`${SELECT} WHERE d.id = @param0`, [toInt(id)]);
  return rows?.[0] || null;
}

async function create({ proponent_id, requirement_id, document_name, file_name, original_file_name, storage_path, content_type, file_size_bytes, created_by }) {
  await ensureSchema();
  const rows = await insertData(
    `
    INSERT INTO dbo.proponent_documents
      (proponent_id, requirement_id, document_name, file_name, original_file_name, storage_path, content_type, file_size_bytes, created_by)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, @param2, @param3, @param4, @param5, @param6, @param7, @param8)
    `,
    [
      toInt(proponent_id),
      toInt(requirement_id),
      document_name ? String(document_name).slice(0, 255) : null,
      file_name,
      original_file_name ?? null,
      storage_path,
      content_type ?? null,
      file_size_bytes ?? null,
      toInt(created_by),
    ]
  );
  const id = rows?.recordset?.[0]?.id ?? rows?.[0]?.id;
  return id ? getById(id) : null;
}

async function remove(id) {
  await ensureSchema();
  await updateData(`DELETE FROM dbo.proponent_documents WHERE id = @param0`, [toInt(id)]);
}

/** Active catalog requirements for the Documents checklist, with the same
 * restriction flags application filing uses (ApplicationWorkflow's
 * requirement insert): for_new/for_renewal plus the contract types the
 * requirement is limited to (empty = every type). The tab filters by the
 * locator's Type of Contract. */
async function listRequirementOptions() {
  const rows = await selectData(`
    SELECT r.id, r.code, r.name, r.is_mandatory, r.for_new, r.for_renewal
    FROM dbo.requirements r
    WHERE r.is_active = 1 AND ISNULL(r.is_ad_hoc, 0) = 0
    ORDER BY r.name ASC
  `);
  const types = await selectData(`SELECT requirement_id, contract_type_id FROM dbo.requirement_contract_types`);
  const byReq = new Map();
  for (const t of types) {
    const list = byReq.get(t.requirement_id) || [];
    list.push(Number(t.contract_type_id));
    byReq.set(t.requirement_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    is_mandatory: Boolean(r.is_mandatory),
    for_new: Boolean(r.for_new),
    for_renewal: Boolean(r.for_renewal),
    contract_type_ids: byReq.get(r.id) || [],
  }));
}

module.exports = { ensureSchema, listByProponent, getById, create, remove, listRequirementOptions };
