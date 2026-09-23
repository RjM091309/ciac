// Global, reusable "app is busy" signal — a single source of truth any
// component can drive without wiring props/context through the tree.
// installFetchLoadingBar() patches window.fetch once so EVERY network call
// (raw fetch, or any of the app's local apiFetch()/api() helpers, since they
// all ultimately call fetch) automatically drives the top progress bar with
// zero changes needed at individual call sites.

type Listener = (active: boolean) => void;

let activeCount = 0;
const listeners = new Set<Listener>();

function emit() {
  const active = activeCount > 0;
  listeners.forEach((listener) => listener(active));
}

/** Manually mark a long-running (non-fetch) operation as in progress —
 * pair with `stopLoading()` in a `finally` block. Most call sites never need
 * this directly since fetch is instrumented automatically. */
export function startLoading() {
  activeCount += 1;
  if (activeCount === 1) emit();
}

export function stopLoading() {
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount === 0) emit();
}

export function subscribeLoading(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let patched = false;

/** Call once at app bootstrap. Idempotent — safe to call more than once
 * (e.g. HMR in dev) since it only wraps the real fetch the first time. */
export function installFetchLoadingBar() {
  if (patched || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  patched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    startLoading();
    try {
      return await originalFetch(...args);
    } finally {
      stopLoading();
    }
  };
}
