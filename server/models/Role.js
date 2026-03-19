const { selectData, updateSchema } = require("../config/database");

async function listRoles() {
  return await selectData("SELECT * FROM roles WHERE is_active = 1 ORDER BY name ASC");
}

async function ensureSchema() {
  // roles
  await updateSchema(`
    IF OBJECT_ID('dbo.roles', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.roles (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        description NVARCHAR(255) NULL,
        is_active BIT NOT NULL CONSTRAINT DF_roles_is_active DEFAULT (1)
      );

      CREATE UNIQUE INDEX UX_roles_name ON dbo.roles(name);
    END
  `);
}

module.exports = {
  listRoles,
  ensureSchema,
};

