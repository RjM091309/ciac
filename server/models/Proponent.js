const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.proponents', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.proponents (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NULL,
        business_name NVARCHAR(255) NOT NULL,
        registration_no NVARCHAR(100) NULL,
        tin NVARCHAR(50) NULL,
        address NVARCHAR(500) NULL,
        contact_no NVARCHAR(100) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_proponents_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at DATETIME2(3) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_proponents_is_active DEFAULT (1),
        CONSTRAINT FK_proponents_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
      );

      CREATE INDEX IX_proponents_user_id ON dbo.proponents(user_id);
      CREATE INDEX IX_proponents_business_name ON dbo.proponents(business_name);
    END
  `);
}

async function listProponents() {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT
      p.id,
      p.user_id,
      p.business_name,
      p.registration_no,
      p.tin,
      p.address,
      p.contact_no,
      p.created_by,
      p.updated_by,
      p.created_at,
      p.updated_at,
      p.is_active
    FROM dbo.proponents p
    ORDER BY p.id DESC
    `
  );

  return rows.map((p) => ({
    id: p.id,
    user_id: p.user_id ?? null,
    business_name: p.business_name,
    registration_no: p.registration_no ?? null,
    tin: p.tin ?? null,
    address: p.address ?? null,
    contact_no: p.contact_no ?? null,
    created_by: p.created_by ?? null,
    updated_by: p.updated_by ?? null,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
    is_active: p.is_active,
  }));
}

async function getProponentById(id) {
  await ensureSchema();
  const rows = await selectData(
    `
    SELECT TOP (1)
      p.id,
      p.user_id,
      p.business_name,
      p.registration_no,
      p.tin,
      p.address,
      p.contact_no,
      p.created_by,
      p.updated_by,
      p.created_at,
      p.updated_at,
      p.is_active
    FROM dbo.proponents p
    WHERE p.id = @param0
    `,
    [id]
  );

  const p = rows?.[0] || null;
  if (!p) return null;
  return {
    id: p.id,
    user_id: p.user_id ?? null,
    business_name: p.business_name,
    registration_no: p.registration_no ?? null,
    tin: p.tin ?? null,
    address: p.address ?? null,
    contact_no: p.contact_no ?? null,
    created_by: p.created_by ?? null,
    updated_by: p.updated_by ?? null,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
    is_active: p.is_active,
  };
}

async function createProponent({
  user_id,
  business_name,
  registration_no,
  tin,
  address,
  contact_no,
  created_by,
  is_active = 1,
}) {
  await ensureSchema();
  const active = is_active ? 1 : 0;
  const userId = toInt(user_id);
  const createdBy = toInt(created_by);

  const result = await insertData(
    `
    INSERT INTO dbo.proponents
      (user_id,business_name,registration_no,tin,address,contact_no,created_by,updated_by,created_at,updated_at,is_active)
    OUTPUT INSERTED.id
    VALUES
      (@param0,@param1,@param2,@param3,@param4,@param5,@param6,NULL,GETDATE(),NULL,@param7)
    `,
    [userId, business_name, registration_no, tin, address, contact_no, createdBy, active]
  );

  const newId = result?.recordset?.[0]?.id;
  return await getProponentById(newId);
}

async function updateProponent(
  id,
  { user_id, business_name, registration_no, tin, address, contact_no, updated_by, is_active }
) {
  await ensureSchema();
  const sets = [];
  const params = [];
  const pushSet = (sqlFrag, value) => {
    sets.push(sqlFrag.replace("?", `@param${params.length}`));
    params.push(value);
  };

  if (user_id !== undefined) pushSet("user_id = ?", toInt(user_id));
  if (business_name !== undefined) pushSet("business_name = ?", business_name);
  if (registration_no !== undefined) pushSet("registration_no = ?", registration_no);
  if (tin !== undefined) pushSet("tin = ?", tin);
  if (address !== undefined) pushSet("address = ?", address);
  if (contact_no !== undefined) pushSet("contact_no = ?", contact_no);
  if (is_active !== undefined) pushSet("is_active = ?", is_active ? 1 : 0);

  const updatedBy = toInt(updated_by);
  if (updatedBy !== null) pushSet("updated_by = ?", updatedBy);

  if (sets.length) {
    const query = `
      UPDATE dbo.proponents
      SET ${sets.join(", ")}, updated_at = GETDATE()
      WHERE id = @param${params.length}
    `;
    params.push(id);
    await updateData(query, params);
  }

  return await getProponentById(id);
}

async function deactivateProponent(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.proponents
    SET is_active = 0,
        updated_at = GETDATE(),
        updated_by = @param1
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return await getProponentById(id);
}

async function reactivateProponent(id, updated_by) {
  await ensureSchema();
  const updatedBy = toInt(updated_by);
  await updateData(
    `
    UPDATE dbo.proponents
    SET is_active = 1,
        updated_at = GETDATE(),
        updated_by = @param1
    WHERE id = @param0
    `,
    [id, updatedBy]
  );
  return await getProponentById(id);
}

module.exports = {
  ensureSchema,
  listProponents,
  getProponentById,
  createProponent,
  updateProponent,
  deactivateProponent,
  reactivateProponent,
};

