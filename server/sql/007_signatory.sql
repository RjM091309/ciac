/*
  007 — Signatory (child table of dbo.proponents)

  Idempotent: safe to run any number of times, on a database that already has
  dbo.proponents. Run it in SSMS (F5) or with:
      sqlcmd -S <server> -d <database> -i server\sql\007_signatory.sql

  Table only — no File Maintenance page, no API, no data. It exists so a locator's
  signatories (legacy dbSignatory) have a proper FK home.

  The backend also creates it by itself on boot (Signatory.ensureSchema), so running this
  script is OPTIONAL — kept for manual deploys.
*/

-- 1. signatory -----------------------------------------------------------------
IF OBJECT_ID('dbo.signatory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.signatory (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    proponent_id INT NOT NULL,
    name NVARCHAR(100) NOT NULL,
    designation NVARCHAR(100) NULL,
    contact_no NVARCHAR(50) NULL,
    email NVARCHAR(255) NULL,
    created_by INT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_signatory_created_at DEFAULT (SYSUTCDATETIME()),
    updated_by INT NULL,
    updated_at DATETIME2(3) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_signatory_is_active DEFAULT (1),
    CONSTRAINT FK_signatory_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id)
  );

  CREATE INDEX IX_signatory_proponent ON dbo.signatory(proponent_id);
END
GO

-- Verify ----------------------------------------------------------------------
SELECT t.name AS [table], (SELECT COUNT(*) FROM sys.foreign_keys f WHERE f.parent_object_id = t.object_id) AS foreign_keys
FROM sys.tables t WHERE t.name = 'signatory';
GO
