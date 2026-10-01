import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Cookie, Lock, ShieldCheck } from 'lucide-react';

// Required notice before signing in: the system uses cookies to keep the
// session secure, and records what each user encodes/changes together with
// their IP address and browser (Audit Log). Both are needed for the system to
// work, so declining means not signing in — the notice comes back until
// accepted.

type View = 'notice' | 'details' | 'declined';

const CATEGORIES = [
  {
    icon: Lock,
    title: 'Strictly necessary cookies',
    body: 'Keep you signed in and protect each request (HTTP-only session cookie and security tokens). Without them the system cannot work.',
  },
  {
    icon: ShieldCheck,
    title: 'Activity & IP address logging (Audit Log)',
    body: 'Every sign-in and every record you encode, update, approve or delete is logged with your username, IP address, browser and time — for accountability and security reviews.',
  },
  {
    icon: Cookie,
    title: 'Display preferences',
    body: 'Remembers things like light/dark theme and table filters on this device. Stored only in your browser.',
  },
];

export function CookieConsent({
  open,
  privacyUrl,
  onAccept,
}: {
  open: boolean;
  privacyUrl?: string | null;
  onAccept: () => void;
}) {
  const [view, setView] = useState<View>('notice');
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
            {view === 'declined' ? 'Consent required' : 'We use cookies'}
          </h2>
        </div>

        {view === 'notice' ? (
          <p className="text-[13px] leading-relaxed text-secondary">
            We use cookies and tracking technologies to improve your browsing experience on our web application site, to
            analyze our website traffic and to understand where our visitors are coming from.
          </p>
        ) : null}

        {view === 'details' ? (
          <div className="flex flex-col gap-2.5">
            {CATEGORIES.map(({ icon: Icon, title, body }) => (
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
                <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">{body}</p>
              </div>
            ))}
            <p className="text-[11px] text-secondary">
              All three are needed for the system to work, so they can't be switched off individually.
            </p>
          </div>
        ) : null}

        {view === 'declined' ? (
          <p className="text-[13px] leading-relaxed text-secondary">
            Signing in requires agreeing to cookies and activity/IP logging — every action in the system is recorded
            for accountability. If you'd rather not, you can close this page. You can review the notice again
            anytime.
          </p>
        ) : null}

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
          {view === 'declined' ? (
            <button
              type="button"
              className={primaryBtn}
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
              onClick={() => setView('notice')}
            >
              Review the notice again
            </button>
          ) : (
            <>
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
                onClick={() => setView('declined')}
              >
                I decline
              </button>
              {view === 'notice' ? (
                <button
                  type="button"
                  className={secondaryBtn}
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  onClick={() => setView('details')}
                >
                  Change my preferences
                </button>
              ) : (
                <button
                  type="button"
                  className={secondaryBtn}
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  onClick={() => setView('notice')}
                >
                  Back
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
