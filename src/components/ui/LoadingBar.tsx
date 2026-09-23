import { useEffect, useRef, useState } from 'react';
import { subscribeLoading } from '../../lib/loadingBar';

/** Thin progress bar pinned to the very top of the viewport, above the
 * header — mount once, near the app's root layout. Reflects `loadingBar`'s
 * global active-request count, so any fetch anywhere in the app (including
 * ones that take a while to succeed) keeps the user aware something's
 * happening instead of the page looking frozen with no feedback. */
export function LoadingBar() {
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const tickRef = useRef<number | null>(null);
  const hideRef = useRef<number | null>(null);

  useEffect(() => subscribeLoading(setActive), []);

  useEffect(() => {
    if (active) {
      if (hideRef.current !== null) {
        window.clearTimeout(hideRef.current);
        hideRef.current = null;
      }
      setVisible(true);
      setProgress((p) => (p <= 0 ? 8 : p));
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      // Eases toward (never reaches) 90% while the request is in flight —
      // classic nprogress-style feel: fast start, slows down the longer it
      // takes, so a slow request still visibly keeps crawling forward
      // instead of sitting still and looking stuck.
      tickRef.current = window.setInterval(() => {
        setProgress((p) => (p >= 90 ? p : p + (90 - p) * 0.08));
      }, 200);
    } else {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      setProgress(100);
      hideRef.current = window.setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 300);
    }
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, [active]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] h-[3px] pointer-events-none" aria-hidden="true">
      <div
        className="h-full"
        style={{
          width: `${progress}%`,
          transition: `width ${progress >= 100 ? 200 : 300}ms ease-out, opacity 200ms ease-out`,
          backgroundColor: 'var(--nav-active-bg)',
          boxShadow: '0 0 8px var(--nav-active-bg)',
          opacity: progress >= 100 ? 0 : 1,
        }}
      />
    </div>
  );
}
