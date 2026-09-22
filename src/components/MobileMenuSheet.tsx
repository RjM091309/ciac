import React from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { ChevronRight, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { roleDisplayName } from '../lib/roleDisplay';

type IconType = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/** Same /api/auth/check lookup AppHeader uses for its account chip. */
function useCurrentUser(backendUrl: string, enabled: boolean) {
  const [user, setUser] = React.useState<{ username: string; role: string } | null>(null);
  React.useEffect(() => {
    if (!enabled || user) return;
    let cancelled = false;
    const base = String(backendUrl || '').replace(/\/+$/, '');
    (async () => {
      try {
        let res = await fetch(`${base}/api/auth/check`, { credentials: 'include' });
        if (!res.ok) res = await fetch('/api/auth/check', { credentials: 'include' });
        const json = await res.json().catch(() => ({} as any));
        if (!cancelled && json?.authenticated && json?.user) {
          setUser({ username: String(json.user.username || ''), role: String(json.user.role || '') });
        }
      } catch {
        /* leave as null */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, enabled, user]);
  return user;
}

/**
 * Mobile "More" menu: a bottom sheet over the whole screen (bottom nav
 * included). Profile card on top, then the sidebar's `variant="sheet"`
 * content. Swipe the handle down, tap the backdrop or press Esc to dismiss.
 */
export function MobileMenuSheet({
  open,
  onClose,
  backendUrl,
  onOpenSettings,
  children,
}: {
  open: boolean;
  onClose: () => void;
  backendUrl: string;
  onOpenSettings: () => void;
  children: React.ReactNode;
}) {
  const dragControls = useDragControls();
  const user = useCurrentUser(backendUrl, open);
  const name = user?.username || '';
  const role = user?.role ? roleDisplayName(user.role).toLowerCase() : '';
  const initials = name
    ? name.replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
    : '';

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[55] flex flex-col justify-end">
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,.55)' }}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="relative flex flex-col rounded-t-3xl border-t max-h-[88%]"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border-subtle)',
              boxShadow: '0 -12px 32px rgba(0,0,0,0.3)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 500) onClose();
            }}
          >
            {/* Drag handle — the only drag target, so the list below still scrolls normally. */}
            <div
              className="shrink-0 pt-2 pb-3 cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="mx-auto h-1.5 w-10 rounded-full" style={{ backgroundColor: 'var(--border-subtle)' }} />
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 custom-scrollbar"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
            >
              <div className="flex items-center gap-3 rounded-2xl px-3 py-3" style={{ backgroundColor: 'var(--control-bg)' }}>
                <div
                  className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}
                >
                  {initials || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate" style={{ color: 'var(--text)' }}>
                    {name || '—'}
                  </div>
                  {role ? <div className="text-[11px] text-secondary capitalize truncate">{role}</div> : null}
                </div>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  aria-label="Account settings"
                  className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  style={{ backgroundColor: 'var(--surface)' }}
                >
                  <Settings size={16} />
                </button>
              </div>

              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

export function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <p className="px-1 mb-2 text-[10px] font-bold text-secondary uppercase tracking-widest">{title}</p>
      {children}
    </section>
  );
}

export function SheetTileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2.5">{children}</div>;
}

/** Icon tile for a top-level destination. */
export function SheetTile({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: IconType;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="flex flex-col items-center justify-center gap-2 rounded-2xl px-1.5 py-4 cursor-pointer transition-colors"
      style={{
        backgroundColor: active ? 'var(--nav-active-bg)' : 'var(--control-bg)',
        color: active ? 'var(--nav-active-text)' : 'var(--text)',
      }}
    >
      <Icon size={20} strokeWidth={2} />
      <span className="text-[11px] font-semibold leading-tight text-center line-clamp-2">{label}</span>
    </button>
  );
}

/** Full-width list row — accordion parents, their children, and account actions. */
export function SheetRow({
  icon: Icon,
  label,
  active,
  onClick,
  expandable,
  expanded,
  chevron,
  nested,
  danger,
}: {
  icon?: IconType;
  label: string;
  active?: boolean;
  onClick: () => void;
  expandable?: boolean;
  expanded?: boolean;
  /** Trailing chevron on a plain (non-accordion) row. */
  chevron?: boolean;
  nested?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expandable ? expanded : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'w-full flex items-center gap-3 rounded-xl text-left cursor-pointer transition-colors',
        nested ? 'pl-11 pr-3 py-2 text-[12px]' : 'px-3 py-3 text-[13px] font-semibold',
      )}
      style={{
        backgroundColor: active ? 'var(--nav-active-bg)' : undefined,
        color: danger ? '#ef4444' : active ? 'var(--nav-active-text)' : nested ? 'var(--text-muted)' : 'var(--text)',
      }}
    >
      {Icon ? <Icon size={18} className="shrink-0" /> : null}
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {expandable || chevron ? (
        <ChevronRight size={16} className={cn('shrink-0 opacity-70 transition-transform', expanded && 'rotate-90')} />
      ) : null}
    </button>
  );
}

export function SheetRowGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-1 flex flex-col gap-0.5" style={{ backgroundColor: 'var(--control-bg)' }}>
      {children}
    </div>
  );
}
