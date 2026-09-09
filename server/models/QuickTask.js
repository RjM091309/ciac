const { selectData, insertData, updateData, updateSchema } = require("../config/database");

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// A personal, per-user to-do list on the dashboard (DBM-06). Deliberately
// separate from `applications` — these are ad-hoc reminders a staff member
// jots down for themselves, not part of the application workflow.
async function ensureSchema() {
  await updateSchema(`
    IF OBJECT_ID('dbo.quick_tasks', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.quick_tasks (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        title NVARCHAR(300) NOT NULL,
        is_done BIT NOT NULL CONSTRAINT DF_quick_tasks_is_done DEFAULT (0),
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_quick_tasks_created_at DEFAULT (SYSUTCDATETIME()),
        completed_at DATETIME2(3) NULL
      );
      CREATE INDEX IX_quick_tasks_user_id ON dbo.quick_tasks(user_id);
    END
  `);
}

async function listForUser(userId) {
  await ensureSchema();
  return await selectData(
    `
    SELECT id, user_id, title, is_done, created_at, completed_at
    FROM dbo.quick_tasks
    WHERE user_id = @param0
    ORDER BY is_done ASC, created_at DESC
    `,
    [userId]
  );
}

async function create(userId, title) {
  await ensureSchema();
  const result = await insertData(
    `
    INSERT INTO dbo.quick_tasks (user_id, title, is_done, created_at)
    OUTPUT INSERTED.id
    VALUES (@param0, @param1, 0, SYSUTCDATETIME())
    `,
    [toInt(userId), String(title || "").trim()]
  );
  const id = result?.recordset?.[0]?.id;
  const rows = await selectData(`SELECT id, user_id, title, is_done, created_at, completed_at FROM dbo.quick_tasks WHERE id = @param0`, [id]);
  return rows?.[0] || null;
}

async function setDone(id, userId, isDone) {
  await ensureSchema();
  await updateData(
    `
    UPDATE dbo.quick_tasks
    SET is_done = @param2, completed_at = CASE WHEN @param2 = 1 THEN SYSUTCDATETIME() ELSE NULL END
    WHERE id = @param0 AND user_id = @param1
    `,
    [id, toInt(userId), isDone ? 1 : 0]
  );
  const rows = await selectData(`SELECT id, user_id, title, is_done, created_at, completed_at FROM dbo.quick_tasks WHERE id = @param0`, [id]);
  return rows?.[0] || null;
}

async function remove(id, userId) {
  await ensureSchema();
  await updateData(`DELETE FROM dbo.quick_tasks WHERE id = @param0 AND user_id = @param1`, [id, toInt(userId)]);
}

module.exports = { ensureSchema, listForUser, create, setDone, remove };
