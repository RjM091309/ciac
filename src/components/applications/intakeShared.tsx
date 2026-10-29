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

/** CIAC's username convention for companies (B-04): the first 2 words of the
 * business name spelled out, then the first letter of each remaining word —
 * "Global Square Plaza Philippines Corporation" → "globalsquareppc".
 * Parenthesised notes ("(1ST RENEWAL)") and punctuation are dropped, and
 * accented letters lose the accent ("PEÑAFRANCIA" → "penafrancia"). Only a
 * suggestion: usernames stay unrestricted. */
export function suggestUsername(businessName: string): string {
  const words = businessName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, '').toLowerCase())
    .filter(Boolean);
  return words.slice(0, 2).join('') + words.slice(2).map((w) => w[0]).join('');
}

/** "Suggested: globalsquareppc · Use" under an empty Username field. */
export function UsernameSuggestion({
  businessName,
  username,
  onUse,
}: {
  businessName: string;
  username: string;
  onUse: (value: string) => void;
}) {
  const suggestion = suggestUsername(businessName);
  if (!suggestion || username.trim()) return null;
  return (
    <p className="text-[10px] font-medium text-secondary">
      Suggested: <span className="font-mono">{suggestion}</span> ·{' '}
      <button type="button" className="font-semibold underline cursor-pointer" style={{ color: 'var(--text)' }} onClick={() => onUse(suggestion)}>
        Use
      </button>
    </p>
  );
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
