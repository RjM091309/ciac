/*
  002 — Type of Contract (File Maintenance)

  Idempotent: safe to run any number of times. Run it against the target database in
  SSMS (F5) or with:
      sqlcmd -S <server> -d <database> -i server\sql\002_type_of_contract.sql

  What it does
    1. dbo.type_of_contract table   (id, name + the standard audit columns; name is unique)
    2. deletes the retired legacy BRIDGE dbTOC names (clearing references first), then
       seeds the 5 current types (matched by name)
    3. contracts.contract_type_id + FK -> type_of_contract(id), when dbo.contracts exists

  The backend also does this by itself on boot (TypeOfContract.ensureSchema), so running this
  script is OPTIONAL — kept for manual / one-off deploys.
*/

-- 1. type_of_contract ------------------------------------------------------------------
IF OBJECT_ID('dbo.type_of_contract', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.type_of_contract (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    created_by INT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_type_of_contract_created_at DEFAULT (SYSUTCDATETIME()),
    updated_by INT NULL,
    updated_at DATETIME2(3) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_type_of_contract_is_active DEFAULT (1)
  );

  CREATE UNIQUE INDEX UX_type_of_contract_name ON dbo.type_of_contract(name);
END
GO

-- 2a. remove the retired legacy names -------------------------------------------
IF OBJECT_ID('tempdb..#retired_toc') IS NOT NULL DROP TABLE #retired_toc;
SELECT id INTO #retired_toc
FROM dbo.type_of_contract
WHERE name IN (
  N'LEASE AGREEMENT',
  N'SHORT-TERM LEASE AGREEMENT',
  N'SUPPLEMENTAL LEASE AGREEMENT',
  N'APPROVAL OF SUBLEASE AGREEMENT',
  N'CONFIRMATION OF SUBLEASE AGREEMENT',
  N'MEMORANDUM OF AGREEMENT'
);
IF COL_LENGTH('dbo.contracts', 'contract_type_id') IS NOT NULL
  EXEC(N'UPDATE dbo.contracts SET contract_type_id = NULL WHERE contract_type_id IN (SELECT id FROM #retired_toc)');
IF COL_LENGTH('dbo.proponents', 'contract_type_id') IS NOT NULL
  EXEC(N'UPDATE dbo.proponents SET contract_type_id = NULL WHERE contract_type_id IN (SELECT id FROM #retired_toc)');
IF COL_LENGTH('dbo.applications', 'contract_type_id') IS NOT NULL
  EXEC(N'UPDATE dbo.applications SET contract_type_id = NULL WHERE contract_type_id IN (SELECT id FROM #retired_toc)');
IF OBJECT_ID('dbo.requirement_contract_types', 'U') IS NOT NULL
  EXEC(N'DELETE FROM dbo.requirement_contract_types WHERE contract_type_id IN (SELECT id FROM #retired_toc)');
DELETE FROM dbo.type_of_contract WHERE id IN (SELECT id FROM #retired_toc);
DROP TABLE #retired_toc;
GO

-- 2b. seed ----------------------------------------------------------------------
INSERT INTO dbo.type_of_contract (name)
SELECT v.name
FROM (VALUES
  (N'Direct Lease'),
  (N'Short Term Lease'),
  (N'Sublease'),
  (N'Memorandum of Understanding (MOU)'),
  (N'Memorandum of Agreement (MOA)')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM dbo.type_of_contract x WHERE x.name = v.name);
GO

-- 3. contracts.contract_type_id -> type_of_contract(id) (only if dbo.contracts exists) --
IF OBJECT_ID('dbo.contracts', 'U') IS NOT NULL AND COL_LENGTH('dbo.contracts', 'contract_type_id') IS NULL
  ALTER TABLE dbo.contracts ADD contract_type_id INT NULL;
GO

IF OBJECT_ID('dbo.contracts', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.contracts', 'contract_type_id') IS NOT NULL
   AND OBJECT_ID('dbo.FK_contracts_type_of_contract', 'F') IS NULL
  ALTER TABLE dbo.contracts ADD CONSTRAINT FK_contracts_type_of_contract
    FOREIGN KEY (contract_type_id) REFERENCES dbo.type_of_contract(id);
GO

-- Verify -----------------------------------------------------------------------
SELECT id, name, is_active FROM dbo.type_of_contract ORDER BY name;
GO
