import React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--border)] dark:bg-[var(--border)]', className)}
      {...props}
    />
  );
}

// Pre-configured skeleton layout for tables
export function TableSkeleton({
  columns = 4,
  rows = 5,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn('w-full overflow-hidden', className)}>
      <table className="min-w-full text-left text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="px-3 py-2.5">
                <Skeleton className="h-3 w-20 rounded" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rIndex) => (
            <tr key={rIndex} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {Array.from({ length: columns }).map((_, cIndex) => (
                <td key={cIndex} className="px-3 py-3.5">
                  <Skeleton className="h-4 w-[70%] rounded" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
