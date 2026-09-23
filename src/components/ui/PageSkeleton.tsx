import { useEffect, useState } from 'react';
import { Skeleton, TableSkeleton } from './Skeleton';

function PageSkeletonShape() {
  return (
    <div className="h-full w-full min-h-[400px] p-1">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-6 w-64 mb-2" />
      <Skeleton className="h-3.5 w-96 max-w-full mb-6" />
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <TableSkeleton columns={5} rows={6} />
      </div>
    </div>
  );
}

/** Route-level Suspense fallback (a lazy-loaded page's JS chunk still
 * downloading) — most page chunks load near-instantly (cached after the
 * first visit, or just fast on a decent connection), immediately followed
 * by that page's OWN skeleton while ITS data loads. Rendering this
 * unconditionally made both skeletons flash back-to-back with different
 * shapes, reading as a glitch rather than one continuous loading state. A
 * short delay skips this one entirely for fast chunk loads — the page's own
 * skeleton picks up right where this would have been — and only shows it for
 * a genuinely slow chunk download (e.g. a cold cache on a slow connection),
 * where the alternative would be a blank screen. */
export function PageSkeleton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShow(true), 220);
    return () => window.clearTimeout(timer);
  }, []);
  if (!show) return null;
  return <PageSkeletonShape />;
}
