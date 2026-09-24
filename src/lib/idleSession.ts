import { useEffect, useRef } from 'react';

// Must match SESSION_IDLE_TIMEOUT_SECONDS in server/models/Auth.js.
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

// Keep-alive cadence: while the user is active, extend the server session at
// most this often. Background polling/SSE never extend it (server side), so
// only real interaction here keeps a session alive.
const REFRESH_MIN_INTERVAL_MS = 60 * 1000;
const TICK_MS = 15 * 1000;

// Shared across tabs so activity in one tab keeps the others from timing out
// (and signing out the whole session) underneath it.
const LAST_ACTIVITY_KEY = 'ciac:lastActivityAt';

// Written by a tab as it goes away, so the other tabs know to check whether
// the session was signed out (it isn't, if that tab was only reloading).
const TAB_CLOSED_KEY = 'ciac:tabClosedAt';
// Server-side grace before a tab close signs the session out
// (TAB_CLOSE_GRACE_MS in server/models/UserSession.js), plus some slack.
const TAB_CLOSE_CHECK_DELAY_MS = 13 * 1000;

// Per-tab id that survives a reload of the same tab (sessionStorage is
// per-tab), which is how the server tells a reload from a close.
const TAB_ID_KEY = 'ciac:tabId';

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

export type SignOutReason = 'idle' | 'ended';

function readSharedActivity(): number {
  try {
    const n = Number(window.localStorage.getItem(LAST_ACTIVITY_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeSharedActivity(at: number) {
  try {
    window.localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    // storage unavailable — this tab still tracks its own activity
  }
}

function getTabId(): string {
  try {
    const existing = window.sessionStorage.getItem(TAB_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(TAB_ID_KEY, id);
    return id;
  } catch {
    // No sessionStorage: a reload can't be told from a close, so the session
    // ends on reload too.
    return '';
  }
}

/**
 * Session lifetime rules for a signed-in page:
 *  - Idle: signs out after IDLE_TIMEOUT_MS without interaction, and keeps the
 *    server session alive (POST /api/auth/refresh) while the user is active.
 *  - Tab close: closing ANY tab signs the session out in every tab. On
 *    pagehide the tab reports POST /api/auth/tab-closed; the server ends the
 *    session unless the same tab comes back (a reload) within a short grace
 *    period, which this hook's first refresh on load does.
 * `onSignedOut('ended')` fires when the server session turns out to be gone
 * (closed from another tab, revoked, or expired).
 */
export function useIdleSession(opts: {
  enabled: boolean;
  backendUrl: string;
  onSignedOut: (reason: SignOutReason) => void;
}) {
  const { enabled, backendUrl } = opts;
  const onSignedOutRef = useRef(opts.onSignedOut);
  onSignedOutRef.current = opts.onSignedOut;

  useEffect(() => {
    if (!enabled) return;

    const base = String(backendUrl).replace(/\/+$/, '');
    const tabId = getTabId();
    const tabQuery = tabId ? `?tab=${encodeURIComponent(tabId)}` : '';

    let lastActivity = Date.now();
    let lastRefresh = 0;
    let lastMouseMove = 0;
    let signedOut = false;
    let refreshing = false;
    const pendingChecks = new Set<number>();
    writeSharedActivity(lastActivity);

    const latestActivity = () => Math.max(lastActivity, readSharedActivity());

    const signOut = (reason: SignOutReason) => {
      if (signedOut) return;
      signedOut = true;
      onSignedOutRef.current(reason);
    };

    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const res = await fetch(`${base}/api/auth/refresh${tabQuery}`, { method: 'POST', credentials: 'include' });
        if (res.status === 401) return signOut('ended');
        if (res.ok) lastRefresh = Date.now();
      } catch {
        // network blip — retried on the next tick
      } finally {
        refreshing = false;
      }
    };

    const checkStillSignedIn = async () => {
      try {
        const res = await fetch(`${base}/api/auth/check`, { credentials: 'include' });
        const json = await res.json().catch(() => ({} as any));
        if (res.ok && json && json.authenticated === false) signOut('ended');
      } catch {
        // network blip — the next refresh will find out
      }
    };

    const tick = () => {
      if (signedOut) return;
      const now = Date.now();
      const last = latestActivity();
      if (now - last >= IDLE_TIMEOUT_MS) return signOut('idle');
      if (last > lastRefresh && now - lastRefresh >= REFRESH_MIN_INTERVAL_MS) void refresh();
    };

    const onActivity = (e: Event) => {
      if (signedOut) return;
      const now = Date.now();
      if (e.type === 'mousemove') {
        if (now - lastMouseMove < 1000) return;
        lastMouseMove = now;
      }
      // Waking a laptop after a long sleep: the first input must not revive a
      // session that already went idle while the timers were suspended.
      if (now - latestActivity() >= IDLE_TIMEOUT_MS) return signOut('idle');
      lastActivity = now;
      writeSharedActivity(now);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };

    const onPageHide = () => {
      try {
        window.localStorage.setItem(TAB_CLOSED_KEY, String(Date.now()));
      } catch {
        // other tabs will still find out on their next refresh
      }
      // sendBeacon is built to outlive the page that sends it (a keepalive
      // fetch can get cancelled as the page unloads); it carries cookies.
      const url = `${base}/api/auth/tab-closed${tabQuery}`;
      const queued = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url);
      if (!queued) {
        fetch(url, { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
      }
    };

    // Restored from the back/forward cache: pagehide already reported this
    // tab gone, so refresh right away to cancel that (or learn it's over).
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void refresh();
    };

    // Another tab went away: once its grace period is up, see whether that
    // was a close (session over) or just a reload.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TAB_CLOSED_KEY || signedOut) return;
      const id = window.setTimeout(() => {
        pendingChecks.delete(id);
        void checkStillSignedIn();
      }, TAB_CLOSE_CHECK_DELAY_MS);
      pendingChecks.add(id);
    };

    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('storage', onStorage);
    const timer = window.setInterval(tick, TICK_MS);

    // First thing on load: if this tab just reloaded, this cancels the
    // sign-out its pagehide scheduled.
    void refresh();

    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
      pendingChecks.forEach((id) => window.clearTimeout(id));
    };
  }, [enabled, backendUrl]);
}
