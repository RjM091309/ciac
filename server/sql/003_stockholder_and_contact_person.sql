/*
  003 — Stockholder + Contact Person (child tables of dbo.proponents)

  Idempotent: safe to run any number of times, on a database that already has
  dbo.proponents. Run it in SSMS (F5) or with:
      sqlcmd -S <server> -d <database> -i server\sql\003_stockholder_and_contact_person.sql

  Tables only — no File Maintenance page, no API, no data. They exist so a locator's
  stockholders (legacy dbStockHolder) and contact people (legacy dbContactPerson) have
  a proper FK home.

  The backend also creates both by itself on boot (Stockholder/ContactPerson
  ensureSchema), so running this script is OPTIONAL — kept for manual deploys.
*/

-- 1. stockholder ---------------------------------------------------------------
IF OBJECT_ID('dbo.stockholder', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.stockholder (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    proponent_id INT NOT NULL,
    name NVARCHAR(200) NOT NULL,
    nationality NVARCHAR(100) NULL,
    subscribed DECIMAL(19,4) NOT NULL CONSTRAINT DF_stockholder_subscribed DEFAULT (0),
    paid DECIMAL(19,4) NOT NULL CONSTRAINT DF_stockholder_paid DEFAULT (0),
    ownership DECIMAL(19,4) NOT NULL CONSTRAINT DF_stockholder_ownership DEFAULT (0),
    created_by INT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_stockholder_created_at DEFAULT (SYSUTCDATETIME()),
    updated_by INT NULL,
    updated_at DATETIME2(3) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_stockholder_is_active DEFAULT (1),
    CONSTRAINT FK_stockholder_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id)
  );

  CREATE INDEX IX_stockholder_proponent ON dbo.stockholder(proponent_id);
END
GO

-- 2. contact_person ------------------------------------------------------------
IF OBJECT_ID('dbo.contact_person', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.contact_person (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    proponent_id INT NOT NULL,
    name NVARCHAR(100) NOT NULL,
    designation NVARCHAR(100) NULL,
    contact_no NVARCHAR(50) NULL,
    email NVARCHAR(255) NULL,
    created_by INT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_contact_person_created_at DEFAULT (SYSUTCDATETIME()),
    updated_by INT NULL,
    updated_at DATETIME2(3) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_contact_person_is_active DEFAULT (1),
    CONSTRAINT FK_contact_person_proponent FOREIGN KEY (proponent_id) REFERENCES dbo.proponents(id)
  );

  CREATE INDEX IX_contact_person_proponent ON dbo.contact_person(proponent_id);
END
GO

-- Verify -----------------------------------------------------------------------
SELECT t.name AS [table], (SELECT COUNT(*) FROM sys.foreign_keys f WHERE f.parent_object_id = t.object_id) AS foreign_keys
FROM sys.tables t WHERE t.name IN ('stockholder', 'contact_person');
GO
