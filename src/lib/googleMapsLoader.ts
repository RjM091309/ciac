// Loads the Google Maps JS API (Places library) exactly once, however many
// AddressAutocomplete inputs end up mounted on the page at once.
let loaderPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> | null {
  const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) return null;

  if (typeof window !== 'undefined' && (window as any).google?.maps?.places) {
    return Promise.resolve((window as any).google);
  }

  if (!loaderPromise) {
    loaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-maps-loader]');
      if (existing) {
        existing.addEventListener('load', () => resolve((window as any).google));
        existing.addEventListener('error', reject);
        return;
      }
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
      script.async = true;
      script.defer = true;
      script.dataset.googleMapsLoader = 'true';
      script.onload = () => resolve((window as any).google);
      script.onerror = () => reject(new Error('Failed to load Google Maps script'));
      document.head.appendChild(script);
    });
  }
  return loaderPromise;
}
