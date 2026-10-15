import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Cookie, Lock, ShieldCheck } from 'lucide-react';
import { DEFAULT_SITE_SETTINGS, useSiteSettings } from '../../lib/siteSettings';

// Required notice before signing in. Agreeing unlocks the login form;
// declining leaves the system for the page set in Portal Settings → Security
// → Cookie notice (the CIAC public website by default). All its text comes
// from there too. "Change my preferences" explains what each kind of
// cookie/tracking is for; all are required, so it can't switch any off.

// Descriptions come from Portal Settings (cookie_notice.pref_*); titles and
// button labels are fixed.
const CATEGORIES = [
  { icon: Lock, title: 'Strictly necessary cookies', key: 'pref_necessary' },
  { icon: ShieldCheck, title: 'Activity & IP address logging (Audit Log)', key: 'pref_audit' },
  { icon: Cookie, title: 'Display preferences', key: 'pref_display' },
] as const;

export function CookieConsent({
  open,
  privacyUrl,
  onAccept,
}: {
  open: boolean;
  privacyUrl?: string | null;
  onAccept: () => void;
}) {
  const notice = useSiteSettings().cookie_notice;
  const [showDetails, setShowDetails] = useState(false);
  if (!open) return null;
  const fallback = DEFAULT_SITE_SETTINGS.cookie_notice;
  const declineUrl = notice.decline_url || fallback.decline_url;

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
            {notice.title || fallback.title}
          </h2>
        </div>

        {showDetails ? (
          <div className="flex flex-col gap-2.5">
            {CATEGORIES.map(({ icon: Icon, title, key }) => (
              <div key={title} className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <Icon size={15} />
                    {title}
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ color: '#059669', backgroundColor: 'rgba(16,185,129,.14)' }}
                  >
                    Always on
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">{notice[key] || fallback[key]}</p>
              </div>
            ))}
            <p className="text-[11px] text-secondary">
              All three are needed for the system to work, so they can't be switched off individually.
            </p>
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-secondary">{notice.message || fallback.message}</p>
        )}

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
            onClick={() => window.location.assign(declineUrl)}
          >
            I decline
          </button>
          <button
            type="button"
            className={secondaryBtn}
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? 'Back' : 'Change my preferences'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
