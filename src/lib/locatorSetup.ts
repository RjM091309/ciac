// Shared with App.tsx's "Skip for now" flow on the first-login business
// profile wizard (LocatorProfileSetup) — a per-browser dismissal, keyed by
// user id, checked before deciding whether to show the wizard again.
const SKIP_PREFIX = 'ciac.locatorSetupSkipped.';

export function locatorSetupSkipKey(userId: number) {
  return `${SKIP_PREFIX}${userId}`;
}

/** Used when a locator who skipped setup hits a wall that actually needs a
 * business profile (e.g. filing an application) — clears the dismissal so
 * App.tsx's gate shows the wizard again on reload, instead of leaving them
 * stuck on a dead-end "contact the administrator" error for something they
 * can now fix themselves. */
export function clearLocatorSetupSkipAndReload() {
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(SKIP_PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // localStorage unavailable — reload still gets them back to the gate,
    // which will just show the wizard again anyway since no skip was recorded.
  }
  window.location.reload();
}
