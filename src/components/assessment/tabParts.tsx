import React from 'react';
import { Lock } from 'lucide-react';

// Shared look of the evaluation drawer's profile tabs (Proponent Information,
// Performance Commitment, Stockholders / GIS): white cards with an icon
// header, titled sections, locked read-only values and chips.

type IconType = React.ComponentType<{ size?: number; className?: string }>;

export function Card({
  title,
  icon: Icon,
  actions,
  children,
}: {
  title: string;
  icon?: IconType;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-4 rounded-xl border p-4 shadow-sm"
      style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--surface)' }}
    >
      <div
        className="-mx-4 -mt-4 flex items-center justify-between gap-2 rounded-t-xl border-b px-4 py-2.5"
        style={{ borderColor: 'var(--input-border)', backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)' }}
      >
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
          {Icon ? (
            <span
              className="grid h-6 w-6 place-items-center rounded-md"
              style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 12%, transparent)', color: 'var(--nav-active-bg)' }}
            >
              <Icon size={13} />
            </span>
          ) : null}
          {title}
        </span>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** A titled group inside a card: small icon + label + a hairline. */
export function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: IconType;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex" style={{ color: 'var(--text)' }}>
          <Icon size={13} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text)' }}>
          {title}
        </span>
        <span className="h-px flex-1" style={{ backgroundColor: 'var(--text)' }} />
      </div>
      {children}
    </div>
  );
}

/** Read-only value from the application (Type of Contract, Industry). */
export function LockedValue({ value }: { value: string | null }) {
  return (
    <div
      className="flex h-9 items-center justify-between gap-2 rounded-lg border px-3 text-[12px]"
      style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }}
      title="From the application"
    >
      <span className="truncate">{value || '—'}</span>
      <Lock size={12} className="shrink-0 opacity-60" />
    </div>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
      style={
        tone === 'accent'
          ? { borderColor: 'color-mix(in oklab, var(--nav-active-bg) 30%, transparent)', backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 10%, transparent)', color: 'var(--text)' }
          : { borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }
      }
    >
      {children}
    </span>
  );
}

/** Why the tab is view-only right now (Manager, review submitted…). */
export function ReasonBanner({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] text-secondary"
      style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)' }}
    >
      <Lock size={13} className="shrink-0" />
      {reason}
    </div>
  );
}

/** The header's Save button (shown only with unsaved changes). */
export function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="rounded-md px-3 py-1 text-[11px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
      style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  );
}
