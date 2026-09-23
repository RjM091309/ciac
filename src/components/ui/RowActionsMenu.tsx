import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { cn } from '../../lib/utils';

export type RowActionItem = {
  key: string;
  label: string;
  icon?: React.ComponentType<{ size?: number }>;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type RowAction = RowActionItem | null | false | undefined;

const MENU_ITEM_HEIGHT = 36;
const MENU_PADDING = 8;
const MENU_WIDTH = 190;
const VIEWPORT_MARGIN = 8;

/** Reusable "..." row-actions menu — collapses a row of icon buttons (Edit,
 * Reset password, Deactivate, ...) into one trigger + dropdown, for any
 * table that needs per-row actions. Pass `null`/`false` entries for actions
 * the caller wants hidden (e.g. a permission check) — they're filtered out
 * before rendering.
 *
 * Portaled to document.body with `position: fixed` (not `absolute` inside
 * the row) — a table wrapper is almost always `overflow-x-auto`, which both
 * clips an absolutely-positioned dropdown near the table's edge AND forces a
 * scrollbar to appear to make room for it. Position is computed from the
 * trigger's own screen rect and flips to open upward when there isn't
 * enough room below (e.g. the last few rows of a table). */
export function RowActionsMenu({
  actions,
  ariaLabel = 'Actions',
}: {
  actions: RowAction[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = actions.filter((a): a is RowActionItem => Boolean(a));

  const computePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = visible.length * MENU_ITEM_HEIGHT + MENU_PADDING;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + VIEWPORT_MARGIN && rect.top > menuHeight + VIEWPORT_MARGIN;
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN);
    const top = openUp ? rect.top - 4 : rect.bottom + 4;
    setPos({ top, left, openUp });
  };

  useLayoutEffect(() => {
    if (open) computePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // Closes instead of tracking scroll/resize — the trigger row can move
    // out from under a stale fixed-position menu otherwise (capture:true
    // catches scroll on the table's own inner container, not just window).
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-secondary hover:text-[var(--text)] cursor-pointer"
      >
        <MoreVertical size={16} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[150] rounded-lg border py-1 shadow-lg"
              style={{
                top: pos.openUp ? undefined : pos.top,
                bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                width: MENU_WIDTH,
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              {visible.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    type="button"
                    role="menuitem"
                    disabled={a.disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      a.onClick();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] whitespace-nowrap',
                      a.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--control-bg)]'
                    )}
                    style={{ color: a.danger ? '#ef4444' : 'var(--text)' }}
                  >
                    {Icon ? <Icon size={14} /> : null}
                    {a.label}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
