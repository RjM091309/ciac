/*
  001 — Departments + Account Officers (File Maintenance)

  Idempotent: safe to run any number of times, on any database that already has
  the CIAC base schema (dbo.users, dbo.roles, dbo.user_roles). Run it against the
  target database — local `bridge`, or the VPS one — in SSMS (F5) or with:
      sqlcmd -S <server> -d <database> -i server\sql\001_departments_and_account_officers.sql

  What it does
    1. dbo.department table                (File Maintenance > Account Officers > Department)
    2. dbo.users.department_id + FK
    3. the 18 departments from the legacy BRIDGE dbDepartment (matched by code)
    4. the four legacy account officers -> ACCOUNT OFFICER role + Marketing Dept

  The backend does all four by itself on every boot (app.js: Role/User/Department
  ensureSchema + AccountOfficer.applyLegacyOfficerDefaults), so running this script is
  OPTIONAL — it is kept for manual / one-off deploys and is equivalent.
*/

-- 1. departments ---------------------------------------------------------------
IF OBJECT_ID('dbo.department', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.department (
    id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    code NVARCHAR(50) NOT NULL,
    name NVARCHAR(255) NOT NULL,
    created_by INT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_department_created_at DEFAULT (SYSUTCDATETIME()),
    updated_by INT NULL,
    updated_at DATETIME2(3) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_department_is_active DEFAULT (1)
  );

  CREATE UNIQUE INDEX UX_department_code ON dbo.department(code);
END
GO

-- 2. users.department_id (column and FK in separate batches on purpose) --------
IF COL_LENGTH('dbo.users', 'department_id') IS NULL
  ALTER TABLE dbo.users ADD department_id INT NULL;
GO

IF OBJECT_ID('dbo.FK_users_department', 'F') IS NULL
  ALTER TABLE dbo.users ADD CONSTRAINT FK_users_department FOREIGN KEY (department_id) REFERENCES dbo.department(id);
GO

-- 3. departments seed (legacy dbDepartment) ------------------------------------
INSERT INTO dbo.department (code, name)
SELECT v.code, v.name
FROM (VALUES
  (N'MD',   N'MARKETING DEPARTMENT'),
  (N'MISD', N'MANAGEMENT INFORMATION SYSTEM DEPARTMENT'),
  (N'PD',   N'PROPERTY DEPARTMENT'),
  (N'NBVU', N'NEW BUSINESS VENTURE UNIT'),
  (N'OP',   N'OFFICE OF THE PRESIDENT AND CEO'),
  (N'RMD',  N'RECORDS MANAGEMENT DEPARTMENT'),
  (N'AD',   N'ADMINISTRATIVE DEPARTMENT'),
  (N'BAC',  N'BIDS AND AWARDS COMMITTEE SECRETARIAT OFFICE'),
  (N'BD',   N'BOARD OF DIRECTORS'),
  (N'CCO',  N'CORPORATE COMMUNICATION OFFICE'),
  (N'HRD',  N'HUMAN RESOURCES DEPARTMENT'),
  (N'IAD',  N'INTERNAL AUDIT DEPARTMENT'),
  (N'LSG',  N'LEGAL SERVICES DEPARTMENT'),
  (N'SCMD', N'STRATEGY AND CORPORATE MANAGEMENT DEPARTMENT'),
  (N'SD',   N'SECURITY DEPARTMENT'),
  (N'TD',   N'TREASURY DEPARTMENT'),
  (N'ED',   N'ENGINEERING DEPARTMENT'),
  (N'FD',   N'FINANCE DEPARTMENT')
) AS v(code, name)
WHERE NOT EXISTS (SELECT 1 FROM dbo.department d WHERE d.code = v.code);
GO

-- 4. legacy account officers -> role + department -------------------------------
-- These are the "(Legacy Import)" users created by server/scripts/migrate-legacy-locators.js
-- / backfill-legacy-profile-fields.js. Only touches rows that still lack a role /
-- department, so it never overwrites something an admin set by hand.
DECLARE @roleId INT = (SELECT TOP (1) id FROM dbo.roles WHERE UPPER(name) = 'ACCOUNT OFFICER' AND is_active = 1);

DECLARE @officers TABLE (full_name NVARCHAR(255) COLLATE DATABASE_DEFAULT, dept_code NVARCHAR(50) COLLATE DATABASE_DEFAULT);
INSERT INTO @officers (full_name, dept_code) VALUES
  (N'TJ GALVEZ (Legacy Import)',         N'MD'),
  (N'JANE PINEDA (Legacy Import)',       N'MD'),
  (N'MIRIAM PAMINDANAN (Legacy Import)', N'MD'),
  (N'LYN SANCHEZ (Legacy Import)',       N'MD');

IF @roleId IS NOT NULL
  INSERT INTO dbo.user_roles (user_id, role_id)
  SELECT u.id, @roleId
  FROM dbo.users u
  INNER JOIN @officers o ON o.full_name = u.full_name COLLATE DATABASE_DEFAULT
  WHERE NOT EXISTS (SELECT 1 FROM dbo.user_roles ur WHERE ur.user_id = u.id);

UPDATE u
SET u.department_id = d.id
FROM dbo.users u
INNER JOIN @officers o ON o.full_name = u.full_name COLLATE DATABASE_DEFAULT
INNER JOIN dbo.department d ON d.code = o.dept_code
WHERE u.department_id IS NULL;
GO

-- Verify -----------------------------------------------------------------------
SELECT COUNT(*) AS departments, SUM(CAST(is_active AS INT)) AS active FROM dbo.department;
SELECT u.id, u.username, u.full_name, d.code AS department
FROM dbo.users u INNER JOIN dbo.department d ON d.id = u.department_id
ORDER BY u.full_name;
GO
