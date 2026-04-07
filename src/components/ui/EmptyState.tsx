import React from 'react';
import { FileQuestion, FolderOpen } from 'lucide-react';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon = <FolderOpen size={40} className="opacity-40" />,
  title = 'No records found',
  description = "We couldn't find anything to show here.",
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center animate-in fade-in zoom-in-95 duration-300',
        className
      )}
    >
      <div
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: 'var(--selected-bg)', color: 'var(--text-muted)' }}
      >
        {icon}
      </div>
      <h3 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
        {title}
      </h3>
      <p className="mt-1.5 text-xs max-w-[280px]" style={{ color: 'var(--text-secondary)' }}>
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
