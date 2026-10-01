import React from 'react';
import { createPortal } from 'react-dom';
import { Cookie } from 'lucide-react';

// Required notice before signing in. Agreeing unlocks the login form;
// declining leaves the system for the CIAC public website.
const DECLINE_REDIRECT_URL = 'https://www.ciac.gov.ph';

export function CookieConsent({
  open,
  privacyUrl,
  onAccept,
}: {
  open: boolean;
  privacyUrl?: string | null;
  onAccept: () => void;
}) {
  if (!open) return null;

  const primaryBtn =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer transition-opacity hover:opacity-90';
  const secondaryBtn =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer border transition-colors';

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,.55)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-consent-title"
    >
      <div
        className="w-full max-w-lg rounded-2xl border shadow-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 12%, transparent)' }}
          >
            <Cookie size={18} />
          </span>
          <h2 id="cookie-consent-title" className="text-lg font-bold">
            We use cookies
          </h2>
        </div>

        <p className="text-[13px] leading-relaxed text-secondary">
          This platform utilizes cookies and tracking technologies to optimize browsing functionality, evaluate website
          traffic patterns, and analyze user acquisition sources.
        </p>

        {privacyUrl ? (
          <a
            href={privacyUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-[11px] underline text-secondary hover:opacity-80"
          >
            Read the privacy policy
          </a>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryBtn}
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            onClick={onAccept}
            autoFocus
          >
            I agree
          </button>
          <button
            type="button"
            className={secondaryBtn}
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={() => window.location.assign(DECLINE_REDIRECT_URL)}
          >
            I decline
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
