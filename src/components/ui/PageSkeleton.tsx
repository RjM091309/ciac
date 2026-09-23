import { Skeleton, TableSkeleton } from './Skeleton';

/** Generic full-page placeholder for the route-level Suspense fallback (a
 * lazy-loaded page's JS chunk still downloading) — kept skeleton-shaped like
 * every page's own data-loading state, instead of a bare spinner floating in
 * empty space, so the two loading moments (code, then data) read as one
 * continuous, consistent experience rather than a jarring hand-off. */
export function PageSkeleton() {
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
