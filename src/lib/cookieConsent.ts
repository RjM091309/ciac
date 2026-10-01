// One-time cookie / activity-tracking consent shown on the login page before
// anyone can sign in. Stored per browser; bump CONSENT_VERSION when the
// notice's wording changes materially so everyone is asked again.

export const CONSENT_VERSION = 1;
const STORAGE_KEY = 'ciac.cookieConsent';

export type CookieConsent = {
  version: number;
  accepted_at: string;
  // True once a successful login has sent this consent to the server's
  // Audit Log, so it's recorded once rather than on every sign-in.
  recorded?: boolean;
};

export function getCookieConsent(): CookieConsent | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Number(parsed.version) !== CONSENT_VERSION || !parsed.accepted_at) return null;
    return parsed as CookieConsent;
  } catch {
    return null;
  }
}

export function saveCookieConsent(): CookieConsent {
  const consent: CookieConsent = { version: CONSENT_VERSION, accepted_at: new Date().toISOString(), recorded: false };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  } catch {
    // Storage blocked (private mode, policy) — consent still holds for this page load.
  }
  return consent;
}

export function markCookieConsentRecorded() {
  const current = getCookieConsent();
  if (!current || current.recorded) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, recorded: true }));
  } catch {
    // ignore — worst case it's recorded again on the next sign-in
  }
}
