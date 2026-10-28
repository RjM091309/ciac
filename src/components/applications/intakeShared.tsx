import React from 'react';

// Shared by New Proponent and Locator Accounts' form.

export type Intake = {
  id: number;
  business_name: string;
  assigned_to: number;
  assigned_name: string | null;
  created_by_name: string | null;
  created_at: string;
  has_letter: number;
  letter_name: string | null;
  /** Set once filed; listed while that application is still a DRAFT. */
  application_id: number | null;
  application_no: string | null;
  application_status: string | null;
};

export function fmtIntakeDate(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The letter as a PDF-icon link (opens in a new tab). */
export function IntakeLetterLink({ intake, label = 'Letter' }: { intake: Intake; label?: string }) {
  if (!intake.has_letter) return null;
  return (
    <a
      href={`/api/intakes/${intake.id}/letter?view=1`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold hover:underline shrink-0"
      style={{ color: 'var(--text)' }}
      title={intake.letter_name || 'Letter'}
    >
      <img src="/images/pdf.png" alt="" className="w-5 h-5" /> {label}
    </a>
  );
}
