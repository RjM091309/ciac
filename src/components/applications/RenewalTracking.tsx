import React from 'react';
import { AssessmentEvaluation } from '../assessment/AssessmentEvaluation';

// Renewal Queue (Account Officer). A renewal is between the Account Officer
// and the locator — no BDO: Renew on Renewal Tracking (Permits) files it for
// the locator's own Level 2 Account Officer, who reviews the documents; Level 1
// approves it ("For Approval"). Same review screen as the BDO's Evaluation
// Queue, scoped to renewals.

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

export function RenewalTracking({ locationSearch = '', navigate }: { locationSearch?: string; navigate: Navigate }) {
  return (
    <AssessmentEvaluation track="renewal" basePath="/applications/renewals" locationSearch={locationSearch} navigate={navigate} />
  );
}
