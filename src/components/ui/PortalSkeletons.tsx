import React from 'react';
import { Skeleton, TableSkeleton } from './Skeleton';

// Loading placeholders shaped like the page that's coming (used instead of a
// spinner): the layout appears at once and fills in, so nothing jumps.

const card = 'rounded-2xl p-4 sm:p-5';
const cardStyle: React.CSSProperties = { backgroundColor: 'var(--surface)', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' };

/** A titled list: table on tablet/desktop, stacked cards on phones. */
export function ListSkeleton({ columns = 6, rows = 4 }: { columns?: number; rows?: number }) {
  return (
    <div className={card} style={cardStyle} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-40 mb-4" />
      <div className="hidden sm:block">
        <TableSkeleton columns={columns} rows={rows} />
      </div>
      <div className="sm:hidden space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex justify-between gap-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-4 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One application: header, tabs, and a few content rows. */
export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className={card} style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="flex gap-4 mt-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-20" />
          ))}
        </div>
      </div>
      <div className={card} style={cardStyle}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Dashboard: banner and one list. No stat cards — which widgets a role
 * shows isn't known until the data arrives (Control Panel), and a row of
 * placeholder cards that then vanishes looks like a glitch. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-5" aria-busy="true" aria-label="Loading">
      <div className={card} style={cardStyle}>
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-56 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
      </div>
      <ListSkeleton columns={6} rows={2} />
    </div>
  );
}

/** A form of labelled fields (business profile). */
export function FormSkeleton({ fields = 8 }: { fields?: number }) {
  return (
    <div className={card} style={cardStyle} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-44 mb-5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A timeline (activity history). */
export function TimelineSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={card} style={cardStyle} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-36 mb-5" />
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A few message bubbles (requirement thread). */
export function ThreadSkeleton() {
  return (
    <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading">
      {[60, 75, 50].map((w, i) => (
        <div key={i} className={i % 2 ? 'flex justify-end' : 'flex'}>
          <Skeleton className="h-10 rounded-2xl" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}
