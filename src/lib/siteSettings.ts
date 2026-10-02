import { useSyncExternalStore } from 'react';

// Portal Settings as the whole app sees them: the portal's names, images,
// security rules and announcements, from GET /api/site-settings/public
// (server/lib/siteSettings.js). Loaded once before the first screen renders
// (App.tsx), refreshed when an admin saves (the 'site-settings' event on the
// notification stream, see AppHeader.tsx), and read everywhere through
// useSiteSettings() or the plain getters below. DEFAULTS mirror the server's
// built-in defaults, so the app still renders the same as before if the
// request fails.

export type LogoAsset = {
  url: string | null;
  dark_url: string | null;
  builtin: string | null;
  builtin_dark: string | null;
  invert: boolean;
};

export type PublicSiteSettings = {
  branding: {
    portal_name: string;
    portal_tagline: string;
    login_subtitle: string;
    tab_title: string;
    org_short_name: string;
    org_name: string;
    footer_text: string;
    support_email: string;
    support_phone: string;
    privacy_url: string;
    terms_url: string;
    header_logo_invert: boolean;
    login_logo_invert: boolean;
    partner_logo_invert: boolean;
  };
  assets: {
    header_logo: LogoAsset;
    login_logo: LogoAsset;
    partner_logo: LogoAsset;
    login_background: { url: string | null; builtin: string };
    favicon: { url: string | null; type: string };
  };
  /** authenticator_name: the label new 2FA setups get in the authenticator app. */
  security: { idle_timeout_minutes: number; password_min_length: number; authenticator_name: string };
  /** The notice shown before the first sign-in (Portal Settings → Security). */
  cookie_notice: { title: string; message: string; accept_label: string; decline_label: string; decline_url: string };
  banner: { title: string; message: string; level: 'info' | 'warning' | 'critical'; ends_at: string | null } | null;
  maintenance: { enabled: boolean; message: string };
};

export const DEFAULT_SITE_SETTINGS: PublicSiteSettings = {
  branding: {
    portal_name: 'BRIDGE+',
    portal_tagline: 'Business Registration & Information Digital Gateway for Enterprises Plus',
    login_subtitle: 'Sign in securely to continue to your workspace and dashboard.',
    tab_title: 'CIAC',
    org_short_name: 'CIAC',
    org_name: 'Clark International Airport Corporation',
    footer_text: 'All rights reserved.',
    support_email: '',
    support_phone: '',
    privacy_url: '',
    terms_url: '',
    header_logo_invert: true,
    login_logo_invert: true,
    partner_logo_invert: false,
  },
  assets: {
    header_logo: { url: null, dark_url: null, builtin: '/images/ciac-logo-only.png', builtin_dark: null, invert: true },
    login_logo: { url: null, dark_url: null, builtin: '/images/ciac-logo-black.png', builtin_dark: null, invert: true },
    partner_logo: {
      url: null,
      dark_url: null,
      builtin: '/images/ciac-brand.png',
      builtin_dark: '/images/ciac-brand-white.png',
      invert: false,
    },
    login_background: { url: null, builtin: '/images/leftside-panel-bg.jpg' },
    favicon: { url: null, type: 'image/png' },
  },
  security: { idle_timeout_minutes: 15, password_min_length: 12, authenticator_name: 'CIAC Portal' },
  cookie_notice: {
    title: 'We use cookies',
    message:
      'This platform utilizes cookies and tracking technologies to optimize browsing functionality, evaluate website traffic patterns, and analyze user acquisition sources.',
    accept_label: 'I agree',
    decline_label: 'I decline',
    decline_url: 'https://www.ciac.gov.ph',
  },
  banner: null,
  maintenance: { enabled: false, message: 'The portal is undergoing scheduled maintenance. Please try again later.' },
};

let current: PublicSiteSettings = DEFAULT_SITE_SETTINGS;
const listeners = new Set<() => void>();

function merge(data: any): PublicSiteSettings {
  const d = DEFAULT_SITE_SETTINGS;
  return {
    branding: { ...d.branding, ...(data?.branding || {}) },
    assets: {
      header_logo: { ...d.assets.header_logo, ...(data?.assets?.header_logo || {}) },
      login_logo: { ...d.assets.login_logo, ...(data?.assets?.login_logo || {}) },
      partner_logo: { ...d.assets.partner_logo, ...(data?.assets?.partner_logo || {}) },
      login_background: { ...d.assets.login_background, ...(data?.assets?.login_background || {}) },
      favicon: { ...d.assets.favicon, ...(data?.assets?.favicon || {}) },
    },
    security: { ...d.security, ...(data?.security || {}) },
    cookie_notice: { ...d.cookie_notice, ...(data?.cookie_notice || {}) },
    banner: data?.banner && typeof data.banner.message === 'string' ? data.banner : null,
    maintenance: { ...d.maintenance, ...(data?.maintenance || {}) },
  };
}

function setSettings(next: PublicSiteSettings) {
  current = next;
  applyDocumentBranding(next);
  listeners.forEach((l) => l());
}

let requestsStarted = 0;
let newestApplied = 0;

/** Fetches the public settings. Requests can overlap (a save, the live
 * update event, the periodic re-check); only a response newer than the last
 * one applied is used, so an older request finishing late can't bring back
 * values from before a save. Resolves with whatever is current if the
 * request fails or takes over `timeoutMs`, so a slow API never holds up the
 * first screen. */
export function loadSiteSettings(timeoutMs = 4000): Promise<PublicSiteSettings> {
  const seq = ++requestsStarted;
  const request = fetch('/api/site-settings/public', { credentials: 'include', cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      if (json?.success && json.data && seq > newestApplied) {
        newestApplied = seq;
        setSettings(merge(json.data));
      }
      return current;
    })
    .catch(() => current);
  return Promise.race([request, new Promise<PublicSiteSettings>((resolve) => setTimeout(() => resolve(current), timeoutMs))]);
}

export function getSiteSettings(): PublicSiteSettings {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller whenever the settings change. */
export function useSiteSettings(): PublicSiteSettings {
  return useSyncExternalStore(subscribe, getSiteSettings, getSiteSettings);
}

/* -------------------------------- images -------------------------------- */

/** Which image to show for a logo and whether to colour-invert it. Dark
 * mode: an uploaded dark version as-is; else the light version, inverted only
 * when "Invert in dark mode" is on (off = the image suits both, e.g. a colour
 * logo); with nothing uploaded, the built-in artwork behaves as it always has. */
export function resolveLogo(asset: LogoAsset, dark: boolean): { src: string | null; invert: boolean } {
  if (!dark) return { src: asset.url || asset.builtin, invert: false };
  if (asset.dark_url) return { src: asset.dark_url, invert: false };
  if (asset.url) return { src: asset.url, invert: asset.invert };
  if (asset.builtin_dark) return { src: asset.builtin_dark, invert: false };
  return { src: asset.builtin, invert: asset.invert };
}

/* ------------------------------- document ------------------------------- */

/** Points matching <link>s at `href`, or back at index.html's own value when
 * `href` is null (the uploaded favicon was removed). */
function setLinkHref(selector: string, href: string | null, type?: string) {
  document.querySelectorAll<HTMLLinkElement>(selector).forEach((link) => {
    if (!link.dataset.defaultHref) {
      link.dataset.defaultHref = link.getAttribute('href') || '';
      link.dataset.defaultType = link.getAttribute('type') || '';
    }
    const next = href ?? link.dataset.defaultHref;
    const nextType = href ? type : link.dataset.defaultType;
    if (link.getAttribute('href') !== next) link.setAttribute('href', next);
    if (nextType) link.setAttribute('type', nextType);
    else link.removeAttribute('type');
  });
}

/** Browser tab title, favicon, home-screen name and manifest. */
function applyDocumentBranding(s: PublicSiteSettings) {
  if (typeof document === 'undefined') return;
  document.title = s.branding.tab_title || DEFAULT_SITE_SETTINGS.branding.tab_title;
  const fav = s.assets.favicon;
  setLinkHref('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]', fav.url, fav.type);
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', s.branding.portal_name);
  document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]').forEach((link) => {
    link.setAttribute('href', '/api/site-settings/manifest.webmanifest');
  });
}

/* ------------------------------- runtime -------------------------------- */

let runtimePromise: Promise<{ google_maps_api_key: string | null }> | null = null;

/** Signed-in-only values (GET /api/site-settings/runtime), fetched once per
 * page load. The Google Maps loader uses the key from here, falling back to
 * the build-time VITE_GOOGLE_MAPS_API_KEY when none is saved. */
export function loadRuntimeSettings(): Promise<{ google_maps_api_key: string | null }> {
  if (!runtimePromise) {
    runtimePromise = fetch('/api/site-settings/runtime', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => ({ google_maps_api_key: json?.data?.google_maps_api_key || null }))
      .catch(() => ({ google_maps_api_key: null }));
    // A failed/unauthenticated fetch shouldn't stick for the whole page life.
    runtimePromise.then((r) => {
      if (!r.google_maps_api_key) runtimePromise = null;
    });
  }
  return runtimePromise;
}

/* -------------------------------- helpers ------------------------------- */

/** "15 minutes" / "1 minute". */
export function formatMinutes(n: number): string {
  return `${n} minute${n === 1 ? '' : 's'}`;
}

/** Heading shown above an announcement: the admin's "Banner title", else
 * one that fits the banner style. */
export function bannerHeading(banner: { title?: string; level: string }): string {
  const title = String(banner.title || '').trim();
  if (title) return title;
  return banner.level === 'critical' ? 'Important' : banner.level === 'warning' ? 'Heads up' : 'Announcement';
}

/** "CIAC Portal". */
export function portalLabel(s: PublicSiteSettings = current): string {
  return `${s.branding.org_short_name} Portal`;
}
