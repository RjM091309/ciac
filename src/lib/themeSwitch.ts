import { flushSync } from 'react-dom';

/**
 * Switch light/dark in one go. Without this, every element fades on its own
 * transition (the global 180ms one, plus 150–200ms on buttons/sidebar, none on
 * some cards), so the page changes colour piece by piece instead of at once.
 *
 * - View Transitions (Chrome/Edge/Safari 18+): one cross-fade of the whole
 *   screen from the old colours to the new.
 * - Otherwise: transitions are switched off for the swap, so it's instant.
 * - Reduced motion: instant.
 *
 * `apply` must update the theme state; it runs inside flushSync so the
 * `dark` class (set in a layout effect) is on the page before the new
 * snapshot is taken.
 */
export function switchTheme(apply: () => void) {
  if (typeof document === 'undefined') {
    apply();
    return;
  }
  const root = document.documentElement;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('theme-switching');
  const done = () => {
    // Two frames so the new colours are painted before transitions come back.
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!reduceMotion && typeof doc.startViewTransition === 'function') {
    const vt = doc.startViewTransition(() => flushSync(apply));
    vt.finished.then(done, done);
    return;
  }
  flushSync(apply);
  done();
}
