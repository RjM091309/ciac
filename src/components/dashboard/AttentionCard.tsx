import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { cn } from '../../lib/utils';

export type AttentionCardItem = {
  // Absent/'application' = a queued application; 'permit'/'contract' are
  // expiring/expired compliance records — application_id is then that
  // record's own id (permit, when permit_id is absent) or the application it
  // belongs to (contract).
  kind?: 'application' | 'permit' | 'contract';
  application_id: number;
  permit_id?: number;
  application_no: string;
  proponent_name: string | null;
  status: string;
  is_renewal?: boolean;
  is_expired?: boolean;
  days_waiting: number;
};

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

function targetFor(item: AttentionCardItem) {
  if (item.kind === 'permit') return `/compliance/permits?permitId=${item.permit_id ?? item.application_id}`;
  if (item.kind === 'contract') return `/approval?applicationId=${item.application_id}`;
  return `/applications/${item.is_renewal ? 'renewals' : 'new'}?applicationId=${item.application_id}`;
}

/** "Needs Attention" widget, shared by the Officer and Admin dashboards so
 * the two never visually drift apart. A locator-facing summary of whichever
 * applications/permits/contracts are waiting on the viewer — kept
 * deliberately plain (no per-row icons/colors) so it reads as a quiet list
 * to scan, not another set of status badges to parse. */
export function AttentionCard({
  items,
  navigate,
  title = 'Needs Attention',
  description = 'Applications, permits, and contracts waiting on you.',
}: {
  items: AttentionCardItem[];
  navigate?: Navigate;
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="glass-card p-0 !border-transparent overflow-hidden h-full flex flex-col"
      style={{ backgroundColor: 'var(--surface)' }}
    >
      <div className="p-4 sm:p-5 shrink-0">
        <div className="flex items-center gap-2">
          <AlertTriangle size={17} style={{ color: '#f59e0b' }} />
          <h4 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>
            {title}
          </h4>
        </div>
        <p className="mt-1 text-[12px] text-secondary">{description}</p>
      </div>
      <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />

      <div className="p-3 sm:p-4 flex-1 min-h-0 flex flex-col">
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<AlertTriangle size={32} className="opacity-40" />}
              title="Nothing needs attention"
              description="Nothing is currently waiting on you."
            />
          </div>
        ) : (
          // Stretches to match whatever height the grid gives this card
          // (e.g. matching the Calendar card beside it) and only scrolls
          // once real content overflows that. `justify-between` is what
          // actually fills that height with few rows — it spreads the gaps
          // between them to reach the bottom instead of leaving everything
          // packed at the top with dead space below; once there are enough
          // rows to overflow, it has no effect and this just scrolls
          // normally. Custom "sidebar-scroll" class: the scrollbar itself
          // stays invisible until hovered, same as the sidebar's own scroll
          // area.
          <div className="sidebar-scroll flex flex-col justify-between gap-2 flex-1 min-h-0 overflow-y-auto pr-0.5">
            {items.map((item) => {
              const target = targetFor(item);
              return (
                <div
                  key={`${item.kind || 'application'}-${item.application_id}`}
                  role={navigate ? 'button' : undefined}
                  tabIndex={navigate ? 0 : undefined}
                  onClick={navigate ? () => navigate(target) : undefined}
                  onKeyDown={
                    navigate
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(target);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-xl px-4 py-3 shrink-0 transition-colors',
                    navigate && 'cursor-pointer hover:brightness-95'
                  )}
                  style={{ backgroundColor: 'var(--control-bg)' }}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold truncate leading-tight" style={{ color: 'var(--text)' }}>
                      {item.application_no}
                    </p>
                    <p className="mt-0.5 text-[11px] truncate leading-tight" style={{ color: '#3b82f6' }}>
                      {item.proponent_name || 'Unknown'}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] font-semibold text-secondary">{item.days_waiting}d</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
