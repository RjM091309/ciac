// Loads the Google Maps JS API (Places library) exactly once, however many
// AddressAutocomplete inputs end up mounted on the page at once.
//
// The script tag uses `loading=async`, Google's current bootstrap mode — but
// `script.onload` only signals the small bootstrap loader itself is ready,
// not that `google.maps.places` (or even `google.maps.importLibrary`, which
// this project's key/loader combination doesn't reliably expose either) is
// actually populated yet; that finishes loading separately, a short beat
// later. Resolving straight off `onload` (the original approach here) raced
// with that: callers hit `google.maps.places` while it was still undefined
// and threw, which the caller's own try/catch silently swallowed as "script
// failed to load" — so Places auto-suggest quietly never worked. Polling
// for `google.maps.places` after `onload` (confirmed live: it does show up,
// just not synchronously with onload) is what actually closes the race,
// without depending on exactly which bootstrap API shape this key/version
// combination ends up serving.
import { loadRuntimeSettings } from './siteSettings';

let loaderPromise: Promise<typeof google> | null = null;

function waitForPlacesLibrary(): Promise<typeof google> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const poll = () => {
      const google = (window as any).google;
      if (google?.maps?.places?.AutocompleteService) {
        resolve(google);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('Timed out waiting for google.maps.places to become available'));
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

/** The key saved in Portal Settings (Integrations tab), else the build-time
 * VITE_GOOGLE_MAPS_API_KEY. Resolves null when neither is set. */
async function resolveApiKey(): Promise<string | null> {
  const runtime = await loadRuntimeSettings();
  if (runtime.google_maps_api_key) return runtime.google_maps_api_key;
  const buildKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  return buildKey || null;
}

/** Resolves with the Maps API, or null when no key is configured (callers
 * then fall back to a plain text field). A key changed in Portal Settings
 * applies from the next page load — the script can only load once. */
export function loadGoogleMaps(): Promise<typeof google | null> {
  if (typeof window !== 'undefined' && (window as any).google?.maps?.places) {
    return Promise.resolve((window as any).google);
  }

  if (!loaderPromise) {
    loaderPromise = resolveApiKey().then((apiKey) => {
      if (!apiKey) {
        loaderPromise = null;
        return null as unknown as typeof google;
      }
      return injectScript(apiKey);
    });
  }
  return loaderPromise.then((g) => g || null);
}

function injectScript(apiKey: string): Promise<typeof google> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-maps-loader]');
    if (existing) {
      existing.addEventListener('load', () => waitForPlacesLibrary().then(resolve, reject));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = 'true';
    script.onload = () => waitForPlacesLibrary().then(resolve, reject);
    script.onerror = () => reject(new Error('Failed to load Google Maps script'));
    document.head.appendChild(script);
  });
}
