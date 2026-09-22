/*
  006 — Land Use (File Maintenance)

  Idempotent: safe to run any number of times. Run it against the target database in
  SSMS (F5) or with:
      sqlcmd -S <server> -d <database> -i server\sql\006_land_use.sql

  What it does
    1. dbo.land_use table   (id, name + the standard audit columns; name is unique)
    No seed data: the legacy dbLandUse only holds two placeholder rows ("TESTING",
    "ADAFS"), so the list is filled in from File Maintenance > Land Use instead.
  The backend also does this by itself on boot (LandUse.ensureSchema), so running this
  script is OPTIONAL — kept for manual / one-off deploys.
*/

-- 1. land_use ------------------------------------------------------------------
IF OBJECT_ID('dbo.land_use', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.land_use (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    created_by INT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_land_use_created_at DEFAULT (SYSUTCDATETIME()),
    updated_by INT NULL,
    updated_at DATETIME2(3) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_land_use_is_active DEFAULT (1)
  );

  CREATE UNIQUE INDEX UX_land_use_name ON dbo.land_use(name);
END
GO

-- Verify -----------------------------------------------------------------------
SELECT id, name, is_active FROM dbo.land_use ORDER BY name;
GO
