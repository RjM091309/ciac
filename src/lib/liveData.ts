import { useEffect, useRef } from 'react';

/**
 * Live refresh for open screens. The header's notification stream (SSE)
 * announces "something changed for you" here every time a notification
 * arrives; queues, lists, dashboards and open drawers re-fetch quietly
 * (no loading screen). They also re-fetch when the user comes back to the tab.
 */
export const LIVE_DATA_EVENT = 'ciac:live-data';

export function announceLiveData() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LIVE_DATA_EVENT));
}

/** Calls `reload` on a live-data signal or when the tab becomes visible
 * again — at most once every `minGapMs`; a burst of signals (several
 * notifications at once) collapses into one re-fetch. */
export function useLiveRefresh(reload: () => unknown, { minGapMs = 1500 }: { minGapMs?: number } = {}) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    let last = 0;
    let timer: number | null = null;
    const run = () => {
      if (timer !== null) return;
      const wait = Math.max(0, last + minGapMs - Date.now());
      timer = window.setTimeout(() => {
        timer = null;
        last = Date.now();
        try {
          void reloadRef.current();
        } catch {
          /* a failed background refresh keeps what's on screen */
        }
      }, wait);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    window.addEventListener(LIVE_DATA_EVENT, run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(LIVE_DATA_EVENT, run);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [minGapMs]);
}
