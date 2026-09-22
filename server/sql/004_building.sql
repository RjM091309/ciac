/*
  004 — Building (File Maintenance)

  Idempotent: safe to run any number of times. Run it against the target database in
  SSMS (F5) or with:
      sqlcmd -S <server> -d <database> -i server\sql\004_building.sql

  What it does
    1. dbo.building table   (id, name + the standard audit columns; name is unique)
    No seed data: the legacy dbBuilding only holds two placeholder rows ("BUILDING 1",
    "TESTINGS"), so the list is filled in from File Maintenance > Building instead.
  The backend also does this by itself on boot (Building.ensureSchema), so running this
  script is OPTIONAL — kept for manual / one-off deploys.
*/

-- 1. building ------------------------------------------------------------------
IF OBJECT_ID('dbo.building', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.building (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    created_by INT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_building_created_at DEFAULT (SYSUTCDATETIME()),
    updated_by INT NULL,
    updated_at DATETIME2(3) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_building_is_active DEFAULT (1)
  );

  CREATE UNIQUE INDEX UX_building_name ON dbo.building(name);
END
GO

-- Verify -----------------------------------------------------------------------
SELECT id, name, is_active FROM dbo.building ORDER BY name;
GO
