import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AppSelect } from './AppSelect';

type DataTableControlsProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  showingFrom: number;
  showingTo: number;
  visiblePageNumbers: number[];

  pageSize: number;
  pageSizeOptions: number[];
  onPageSizeChange: (value: number) => void;

  onPageChange: (page: number) => void;

  loading?: boolean;
};

export function DataTableControls({
  page,
  totalPages,
  totalItems,
  showingFrom,
  showingTo,
  visiblePageNumbers,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  onPageChange,
  loading = false,
}: DataTableControlsProps) {
  const pageSizeSelectOptions = pageSizeOptions.map((n) => ({
    value: String(n),
    label: String(n),
  }));

  if (totalItems === 0) return null;

  return (
    <div
      className="mt-3 px-2 py-2 rounded-xl border flex flex-col md:flex-row md:items-center md:justify-between gap-2"
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 45%, transparent)' }}
    >
      <div className="flex items-center gap-2 text-[11px] text-secondary">
        <span>Show</span>
        <div className="w-20">
          <AppSelect
            options={pageSizeSelectOptions}
            value={String(pageSize)}
            onChange={(value) => onPageSizeChange(Number(value))}
            isClearable={false}
            isDisabled={loading}
            compact
          />
        </div>
        <span>entries</span>
      </div>

      <div className="flex items-center gap-3 self-end md:self-auto">
        <div className="text-[11px] text-secondary whitespace-nowrap">
          Showing {showingFrom} to {showingTo} of {totalItems} entries
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={cn(
              'h-7 w-7 inline-flex items-center justify-center rounded-md text-secondary',
              page <= 1 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--surface-hover)]'
            )}
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
          </button>

          {visiblePageNumbers.map((p) => (
            <button
              key={p}
              type="button"
              className={cn(
                'h-7 min-w-7 px-2 inline-flex items-center justify-center rounded-md text-[11px] font-semibold',
                p === page ? 'text-white cursor-default' : 'text-secondary cursor-pointer hover:bg-[var(--surface-hover)]'
              )}
              style={p === page ? { backgroundColor: 'var(--nav-active-bg)' } : undefined}
              onClick={() => onPageChange(p)}
              disabled={p === page}
              aria-label={`Page ${p}`}
            >
              {p}
            </button>
          ))}

          <button
            type="button"
            className={cn(
              'h-7 w-7 inline-flex items-center justify-center rounded-md text-secondary',
              page >= totalPages ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--surface-hover)]'
            )}
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

