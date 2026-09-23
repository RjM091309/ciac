// Shared with ApplicationsWorkflow.tsx (the "New Application" / "Renewal
// Tracking" queue) and LocatorUsersManagement.tsx (Locator Accounts) — both
// now show an application's requirements-verification progress, and this
// keeps the calculation identical instead of two copies drifting apart.

export type AppRequirementRow = {
  id: number;
  requirement_id: number;
  status: string;
};

export type DocumentRow = {
  id: number;
  requirement_id: number | null;
};

export type ProgressSummary = {
  total: number;
  verified: number;
  pending: number;
  rejected: number;
  missing: number;
  percent: number;
};

function toUpper(v: string | null | undefined) {
  return String(v || '').trim().toUpperCase();
}

export function computeProgress(reqRows: AppRequirementRow[], docRows: DocumentRow[]): ProgressSummary {
  const total = reqRows.length;
  if (!total) return { total: 0, verified: 0, pending: 0, rejected: 0, missing: 0, percent: 0 };

  const hasDocumentByRequirement = new Set<number>(
    docRows.map((d) => Number(d.requirement_id)).filter((n) => Number.isFinite(n))
  );

  let verified = 0;
  let pending = 0;
  let rejected = 0;
  let missing = 0;

  for (const r of reqRows) {
    const status = toUpper(r.status);
    const hasDoc = hasDocumentByRequirement.has(Number(r.requirement_id));
    if (status === 'VERIFIED') verified += 1;
    else if (status === 'REJECTED') rejected += 1;
    else pending += 1;
    if (!hasDoc && status !== 'VERIFIED') missing += 1;
  }

  const percent = Math.round((verified / total) * 100);
  return { total, verified, pending, rejected, missing, percent };
}

/** Fetches requirements + documents for each application id in parallel and
 * reduces them to a progress summary per id — same N-fetch pattern
 * ApplicationsWorkflow.tsx already used, now callable from anywhere. */
export async function loadProgressForApplications(
  appIds: number[],
  apiUrl: (path: string) => string
): Promise<Record<number, ProgressSummary>> {
  if (!appIds.length) return {};
  const chunks = await Promise.all(
    appIds.map(async (id) => {
      const [reqRes, docRes] = await Promise.all([
        fetch(apiUrl(`/api/applications/${id}/requirements`), { credentials: 'include' }),
        fetch(apiUrl(`/api/applications/${id}/documents`), { credentials: 'include' }),
      ]);
      const [reqJson, docJson] = await Promise.all([reqRes.json(), docRes.json()]);
      const reqRows: AppRequirementRow[] = Array.isArray(reqJson?.data) ? reqJson.data : [];
      const docRows: DocumentRow[] = Array.isArray(docJson?.data) ? docJson.data : [];
      return [id, computeProgress(reqRows, docRows)] as const;
    })
  );
  const next: Record<number, ProgressSummary> = {};
  for (const [id, summary] of chunks) next[id] = summary;
  return next;
}
