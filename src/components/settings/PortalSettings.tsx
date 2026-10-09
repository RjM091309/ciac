import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ImageUp, Info, Loader2, Lock, Mail, Pencil, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { AppSelect } from '../ui/AppSelect';
import { ConfirmModal } from '../ui/ConfirmModal';
import { NoAutofillPasswordInput } from '../ui/NoAutofillPasswordInput';
import { DatePicker } from '../ui/DatePicker';
import { bannerHeading, loadSiteSettings, resolveLogo, type LogoAsset } from '../../lib/siteSettings';

// Portal Settings (settings:portal, administrators only). Everything an admin
// can change about the portal itself without a developer. The server is the
// authority on what exists and what's allowed (server/lib/siteSettings.js):
// this page renders the fields it returns, sends only what changed, and shows
// the server's validation messages as-is.

type SectionKey = 'branding' | 'email' | 'integrations' | 'security' | 'renewals' | 'announcements';

type FieldMeta = {
  label: string;
  type: 'text' | 'email' | 'url' | 'hostname' | 'int' | 'bool' | 'enum' | 'secret' | 'datetime';
  source: 'saved' | 'default';
  default: unknown;
  /** What "Reset" gives (the built-in default). */
  reset_value: unknown;
  value: unknown;
  min?: number;
  max?: number;
  options?: string[];
  required?: boolean;
  /** Long text: edited in a textarea, still saved as one paragraph. */
  multiline?: boolean;
  is_set?: boolean;
  unreadable?: boolean;
  hint?: string;
};

type SectionData = {
  label: string;
  sensitive: boolean;
  version: string | null;
  updated_at: string | null;
  updated_by: string | null;
  fields: Record<string, FieldMeta>;
};

type AssetMeta = {
  label: string;
  url: string | null;
  builtin: string | null;
  types: string[];
  max_bytes: number;
  updated_at: string | null;
  updated_by: string | null;
};

type AdminData = {
  sections: Record<SectionKey, SectionData>;
  assets: Record<string, AssetMeta>;
  mail_configured: boolean;
};

/** Edited values per section. For a secret: absent = keep, string = new
 * value, null = clear. For anything else: null = back to the default. */
type Drafts = Partial<Record<SectionKey, Record<string, unknown>>>;

const TABS: { key: SectionKey; caption: string; title: string; short: string }[] = [
  { key: 'branding', caption: 'Look & feel', title: 'Branding', short: 'Brand' },
  { key: 'email', caption: 'Outgoing mail', title: 'Email', short: 'Email' },
  { key: 'integrations', caption: 'Services', title: 'Integrations', short: 'APIs' },
  { key: 'security', caption: 'Sign-in', title: 'Security', short: 'Security' },
  { key: 'renewals', caption: 'Expiry', title: 'Renewals', short: 'Renewals' },
  { key: 'announcements', caption: 'Notices', title: 'Announcements', short: 'Notices' },
];

const EMPTY_MEANS_DEFAULT = new Set([
  'maintenance_message',
  'totp_issuer',
  'mail_from_address',
  'mail_from_name',
  'mail_reply_to',
  'banner_title',
]);

/** "Default: X." — without doubling a full stop the default already ends with. */
function defaultHint(label: string): string {
  return ` Default: ${label}${/[.!?]$/.test(label) ? '' : '.'}`;
}

const ENUM_LABELS: Record<string, string> = {
  auto: 'Automatic (STARTTLS when offered)',
  starttls: 'STARTTLS (required)',
  ssl: 'SSL/TLS (usually port 465)',
  info: 'Information',
  warning: 'Warning',
  critical: 'Critical',
};

const FIELD_HELP: Record<string, string> = {
  portal_name: 'Shown in the header, on the login page and in the footer.',
  tab_title: 'The name on the browser tab.',
  totp_issuer:
    'The name new two-factor setups get in the authenticator app. Leave empty to use the name shown in grey. Phones that already set up 2FA keep their old label.',
  org_short_name: 'Used in emails, notices and the authenticator app, e.g. "CIAC Portal".',
  org_name: 'Shown in the footer copyright line.',
  support_email: 'Shown on the login page (Support) and at the end of every email.',
  support_phone: 'Shown with the support email.',
  privacy_url: 'The login page "Privacy" link. Must start with https://.',
  terms_url: 'The login page "Terms" link. Must start with https://.',
  cookie_title: 'Heading of the cookie notice shown before the first sign-in.',
  cookie_message: 'Shown as one paragraph; line breaks are turned into spaces.',
  cookie_accept_label: 'Agreeing unlocks the sign-in form.',
  cookie_decline_label: 'Declining leaves the portal for the page below.',
  cookie_decline_url: 'Where someone who declines is sent. Must start with https://.',
  smtp_host: 'For example smtp.office365.com or smtp.gmail.com.',
  smtp_port: 'Usually 587 (STARTTLS) or 465 (SSL/TLS).',
  smtp_pass: 'Stored encrypted and never shown again. Re-enter it when you change the server or username.',
  mail_from_address: 'Leave empty to send from the SMTP username (shown in grey).',
  mail_from_name: 'Leave empty to use the portal name (shown in grey).',
  mail_reply_to: 'Where replies go. Leave empty to use the from address (shown in grey).',
  google_maps_api_key:
    'Used for address suggestions. Stored encrypted. Restrict this key to your domain (HTTP referrer) in Google Cloud Console. A new key applies the next time each page is opened.',
  login_max_attempts: 'Wrong passwords or authenticator codes in a row before the account is locked.',
  login_lockout_minutes: 'How long a locked account stays locked.',
  idle_timeout_minutes: 'Signed out after this long without activity. Shown on the login page too.',
  password_min_length: 'Applies whenever a password is set or changed. Existing passwords keep working.',
  password_expiry_days:
    'After this many days, users must set a new password at their next sign-in. 0 = passwords never expire. Existing passwords count from when this was introduced.',
  allow_2fa_opt_out:
    'Off: two-factor authentication is required for everyone — "Turn off" disappears from My Profile, and anyone who had turned it off sets it up again at their next sign-in.',
  audit_retention_years: 'Older audit log entries are deleted once a day. 0 = keep forever. Each clean-up is itself logged.',
  expiring_window_months:
    'A contract shows as Expiring on Renewal Tracking and the dashboards this many months before it ends — and the first renewal reminder goes out then.',
  reminders_enabled: 'Emails the locator (with an in-app notice to them and their Account Officer) when their contract enters the expiring window.',
  reminder_interval_months: 'Follow-up reminders after the first one, until the renewal is filed.',
  stop_after_expiry_months: 'No more reminders this many months after the contract has expired. 0 = stop on the expiry date.',
  cc_account_officer: "Adds the locator's Account Officer as CC on the reminder email.",
  banner_title:
    'Optional. Shown in bold above the announcement. Leave empty to use the heading shown in grey, which follows the banner style.',
  banner_message: 'Shown at the top of every page and on the login page.',
  banner_starts_at: 'Optional, in your time zone.',
  banner_ends_at: 'Optional, in your time zone.',
  maintenance_message: 'Shown on the login page and as the reply when someone tries to sign in. Leave empty to use the message shown in grey.',
};

const BRANDING_GROUPS: { title: string; hint: string; fields: string[] }[] = [
  {
    title: 'Names',
    hint: 'How the portal introduces itself',
    fields: ['portal_name', 'portal_tagline', 'login_subtitle', 'tab_title', 'totp_issuer'],
  },
  {
    title: 'Organization & contact',
    hint: 'Footer, emails and the login page links',
    fields: ['org_short_name', 'org_name', 'footer_text', 'support_email', 'support_phone', 'privacy_url', 'terms_url'],
  },
];

const LOGO_SLOTS: { slot: 'header_logo' | 'login_logo' | 'partner_logo'; invertField: string; where: string }[] = [
  { slot: 'header_logo', invertField: 'header_logo_invert', where: 'Top bar of every page' },
  { slot: 'login_logo', invertField: 'login_logo_invert', where: 'Login page, top left' },
  { slot: 'partner_logo', invertField: 'partner_logo_invert', where: 'Login page, bottom corner' },
];

/* -------------------------------- helpers ------------------------------- */

async function api<T = any>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: T & { message?: string } }> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const json = await res.json().catch(() => ({} as any));
  return { ok: res.ok && json?.success !== false, status: res.status, json };
}

/* ------------------------------ date + time ------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, '0');

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "HH:MM" every 15 minutes, plus 23:59 so "until end of day" is one pick. */
const TIME_SLOTS: string[] = [
  ...Array.from({ length: 96 }, (_, i) => `${pad2(Math.floor(i / 4))}:${pad2((i % 4) * 15)}`),
  '23:59',
];

function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A saved ISO time as the viewer's local date + "HH:MM". */
function splitIso(iso: unknown): { date: Date | null; time: string } {
  if (!iso || typeof iso !== 'string') return { date: null, time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: null, time: '' };
  return { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}

function joinIso(date: Date, time: string): string {
  const [h, m] = time.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).toISOString();
}

/** Date + time in the app's own controls: the shared DatePicker for the day
 * and an AppSelect for the time (the app has no time picker of its own).
 * Value is an ISO string, or '' for "not set"; times are the viewer's local
 * time. Picking a date first fills `defaultTime`. */
function DateTimeField({
  value,
  onChange,
  defaultTime,
  minDate,
  placeholder = 'Pick a date',
}: {
  value: unknown;
  onChange: (iso: string) => void;
  defaultTime: string;
  minDate?: Date;
  /** What an empty field means (e.g. "Right away"). */
  placeholder?: string;
}) {
  const { date, time } = splitIso(value);
  // A saved time off the 15-minute grid (e.g. 10:53) stays selectable as-is.
  const slots = time && !TIME_SLOTS.includes(time) ? [...TIME_SLOTS, time].sort() : TIME_SLOTS;
  return (
    <div className="flex gap-2">
      <div className="flex-1 min-w-0">
        <DatePicker
          mode="single"
          bordered
          fullWidth
          placeholder={placeholder}
          minDate={minDate}
          value={date}
          onChange={(next: Date | null) => onChange(next ? joinIso(next, time || defaultTime) : '')}
        />
      </div>
      <div className="w-[8.5rem] shrink-0">
        <AppSelect
          isClearable={false}
          isDisabled={!date}
          placeholder="Time"
          value={time}
          options={slots.map((t) => ({ value: t, label: timeLabel(t) }))}
          onChange={(t) => {
            if (date && t) onChange(joinIso(date, t));
          }}
        />
      </div>
    </div>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MB` : `${Math.round(n / 1024)} KB`;
}

const EXT_BY_TYPE: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP', 'image/x-icon': 'ICO' };

/** The value a field would have after this draft: draft, else saved. A
 * null draft on a non-secret means "back to the default". */
function effectiveValue(meta: FieldMeta, draft: Record<string, unknown> | undefined, name: string): unknown {
  if (!draft || !(name in draft)) return meta.value;
  const v = draft[name];
  if (meta.type === 'secret') return v;
  return v === null ? meta.reset_value : v;
}

/** True when the draft for `name` would actually change what's saved. */
function isChanged(meta: FieldMeta, draft: Record<string, unknown> | undefined, name: string): boolean {
  if (!draft || !(name in draft)) return false;
  const v = draft[name];
  if (meta.type === 'secret') return v === null || (typeof v === 'string' && v !== '');
  if (v === null) return meta.source === 'saved';
  return !valuesEqual(v, meta.value);
}

function valuesEqual(a: unknown, b: unknown) {
  return (a ?? '') === (b ?? '');
}

/* ------------------------------- controls ------------------------------- */

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative box-border flex h-7 w-[3.25rem] shrink-0 items-center overflow-hidden rounded-full px-0.5 transition-[background-color,opacity] duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--nav-active-bg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        backgroundColor: checked ? 'var(--nav-active-bg)' : 'rgba(148, 163, 184, 0.28)',
        boxShadow: checked ? '0 0 0 1px rgba(255,255,255,0.12) inset' : '0 0 0 1px var(--border-subtle) inset',
      }}
    >
      <Check
        className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 transition-opacity"
        strokeWidth={3}
        style={{ color: 'var(--nav-active-text, #fff)', opacity: checked ? 0.95 : 0 }}
      />
      <span
        className="pointer-events-none relative z-[1] h-6 w-6 shrink-0 rounded-full bg-white shadow-md transition-transform duration-200"
        style={{ transform: checked ? 'translateX(1.5rem)' : 'translateX(0)', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
      />
    </button>
  );
}

function Notice({ tone, children }: { tone: 'info' | 'warning'; children: React.ReactNode }) {
  const Icon = tone === 'warning' ? AlertTriangle : Info;
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'note'}
      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug"
      style={{
        borderColor: tone === 'warning' ? 'rgba(245,158,11,.35)' : 'var(--border-subtle)',
        backgroundColor: tone === 'warning' ? 'rgba(245,158,11,.08)' : 'var(--control-bg)',
        color: 'var(--text)',
      }}
    >
      <Icon size={13} className="mt-px shrink-0" style={{ color: tone === 'warning' ? '#f59e0b' : 'var(--text-muted)' }} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function GroupHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{title}</div>
      {hint ? <div className="text-[12px] text-secondary">{hint}</div> : null}
    </div>
  );
}

function SourceBadge({ meta }: { meta: FieldMeta }) {
  if (meta.source === 'saved') return null;
  return (
    <span
      className="rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }}
      title="Not set here yet — the built-in default applies"
    >
      Default
    </span>
  );
}

/** One setting: label, control, help text and a Reset link. */
/** A stored secret (API key, SMTP password). Once saved it shows as locked
 * with its masked hint, so it's obvious a value is there; typing a new one
 * takes a deliberate Replace. The value itself is never sent back. */
function SecretControl({
  id,
  name,
  meta,
  draft,
  onChange,
}: {
  id: string;
  name: string;
  meta: FieldMeta;
  draft: Record<string, unknown> | undefined;
  onChange: (name: string, value: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  // A save (or reload) brings back new metadata — back to the locked view.
  useEffect(() => setEditing(false), [meta.is_set, meta.hint, meta.source]);

  const cleared = Boolean(draft && name in draft && draft[name] === null);
  const saved = Boolean(meta.is_set && meta.source === 'saved');
  const btn =
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border cursor-pointer hover:bg-[var(--hover-bg)] shrink-0';
  const btnStyle = { borderColor: 'var(--border-subtle)', color: 'var(--text)' };

  if (saved && !editing) {
    return (
      <div className="flex flex-col sm:flex-row gap-2">
        <div
          id={id}
          className="app-input flex-1 min-w-0 flex items-center gap-2 cursor-not-allowed"
          style={{ opacity: cleared ? 0.6 : 1, backgroundColor: 'var(--hover-bg)' }}
          aria-disabled="true"
        >
          {cleared ? (
            <span className="text-secondary">Will be cleared on save</span>
          ) : (
            <>
              <Lock size={13} className="shrink-0 text-secondary" />
              <span className="font-mono tracking-wider truncate" style={{ color: 'var(--text)' }}>
                {/* hint is "…" + the last 4 characters (maskKey on the server) */}
                ••••••••••••{meta.hint ? meta.hint.replace(/^…/, '') : ''}
              </span>
              <span
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0"
                style={{ backgroundColor: 'color-mix(in oklab, #10b981 15%, transparent)', color: '#10b981' }}
              >
                <Check size={10} />
                Saved
              </span>
            </>
          )}
        </div>
        {cleared ? (
          <button type="button" className={btn} style={btnStyle} onClick={() => onChange(name, undefined)}>
            Undo clear
          </button>
        ) : (
          <button type="button" className={btn} style={btnStyle} onClick={() => setEditing(true)}>
            <Pencil size={12} />
            Replace
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <NoAutofillPasswordInput
        id={id}
        className="app-input flex-1 min-w-0"
        maxLength={meta.max}
        autoFocus={editing}
        placeholder={saved ? 'Enter the new value — the saved one stays until you save' : 'Not set — enter a value'}
        value={typeof draft?.[name] === 'string' ? String(draft?.[name]) : ''}
        onChange={(e) => onChange(name, e.target.value === '' ? undefined : e.target.value)}
      />
      {saved ? (
        <>
          <button
            type="button"
            className={btn}
            style={btnStyle}
            onClick={() => {
              onChange(name, undefined);
              setEditing(false);
            }}
          >
            <X size={12} />
            Cancel
          </button>
          {/* Rarely needed (e.g. turning address suggestions off, or an SMTP
              server without a password), so it lives here, not on the locked view. */}
          <button
            type="button"
            className={btn}
            style={{ borderColor: 'var(--border-subtle)', color: '#ef4444' }}
            onClick={() => {
              onChange(name, null);
              setEditing(false);
            }}
          >
            <Trash2 size={12} />
            Remove saved
          </button>
        </>
      ) : null}
    </div>
  );
}

function FieldRow({
  name,
  meta,
  draft,
  onChange,
  error,
  notice,
  placeholder,
}: {
  name: string;
  meta: FieldMeta;
  draft: Record<string, unknown> | undefined;
  onChange: (name: string, value: unknown) => void;
  /** A problem that blocks saving, shown in red under the field. */
  error?: string | null;
  /** Something worth knowing that doesn't block saving, shown in amber. */
  notice?: string | null;
  /** Grey text in an empty box: what empty means (a value the app uses, or "Not set"). */
  placeholder?: string;
}) {
  const id = `ps-${name}`;
  const value = effectiveValue(meta, draft, name);
  const changed = isChanged(meta, draft, name);
  const resetAction: 'undo' | 'reset' | null =
    meta.type === 'secret'
      ? null
      : changed
        ? 'undo'
        : meta.source === 'saved' &&
            !valuesEqual(meta.value, meta.reset_value) &&
            // Empty already means the default here, so there's nothing to reset.
            !(EMPTY_MEANS_DEFAULT.has(name) && valuesEqual(meta.value, ''))
          ? 'reset'
          : null;
  const help = FIELD_HELP[name];

  let control: React.ReactNode;
  switch (meta.type) {
    case 'bool':
      control = <Toggle checked={Boolean(value)} onChange={(v) => onChange(name, v)} label={meta.label} />;
      break;
    case 'enum':
      control = (
        <AppSelect
          isClearable={false}
          value={String(value ?? '')}
          options={(meta.options || []).map((o) => ({ value: o, label: ENUM_LABELS[o] || o }))}
          onChange={(v) => onChange(name, v)}
        />
      );
      break;
    case 'int':
      control = (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          autoComplete="off"
          className="app-input"
          min={meta.min}
          max={meta.max}
          step={1}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(name, e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
      break;
    case 'datetime':
      control = (
        <DateTimeField
          value={value}
          onChange={(iso) => onChange(name, iso)}
          // "Show from" starts at the beginning of the day, "Show until" runs to its end.
          defaultTime={name.endsWith('_ends_at') ? '23:59' : '00:00'}
          // An end in the past would hide the banner at once — grey out earlier days.
          minDate={name.endsWith('_ends_at') ? startOfToday() : undefined}
          placeholder={placeholder}
        />
      );
      break;
    case 'secret':
      control = <SecretControl id={id} name={name} meta={meta} draft={draft} onChange={onChange} />;
      break;
    default:
      control = meta.multiline ? (
        <textarea
          id={id}
          rows={4}
          className="app-input"
          style={{ height: 'auto', resize: 'vertical' }}
          maxLength={meta.max}
          placeholder={placeholder}
          value={value === null || value === undefined ? '' : String(value)}
          // The server refuses line breaks in settings, so keep it one paragraph.
          onChange={(e) => onChange(name, e.target.value.replace(/[\r\n]+/g, ' '))}
        />
      ) : (
        <input
          id={id}
          type={meta.type === 'email' ? 'email' : meta.type === 'url' ? 'url' : 'text'}
          autoComplete="off"
          className="app-input"
          maxLength={meta.max}
          placeholder={placeholder}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(name, e.target.value)}
        />
      );
  }

  const inline = meta.type === 'bool';
  return (
    <div className={inline ? 'flex items-start justify-between gap-3 py-1' : 'space-y-1'}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor={inline || meta.type === 'enum' || meta.type === 'datetime' ? undefined : id} className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
            {meta.label}
            {meta.required ? <span className="text-secondary"> *</span> : null}
          </label>
          <SourceBadge meta={meta} />
          {changed ? <span aria-label="Changed" title="Changed, not saved yet" className="h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
        </div>
        {inline && help ? <p className="text-[10px] text-secondary mt-0.5">{help}</p> : null}
      </div>
      {inline ? control : <div>{control}</div>}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-[10px] font-medium leading-snug" style={{ color: '#ef4444' }}>
          <AlertTriangle size={11} className="mt-px shrink-0" />
          <span>{error}</span>
        </p>
      ) : notice ? (
        <p role="note" className="flex items-start gap-1.5 text-[10px] leading-snug" style={{ color: '#d97706' }}>
          <AlertTriangle size={11} className="mt-px shrink-0" />
          <span>{notice}</span>
        </p>
      ) : null}
      {!inline ? (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
          <p className="text-[10px] text-secondary min-w-0">
            {meta.unreadable ? (
              <span style={{ color: '#f59e0b' }}>The saved value can't be read (the server's encryption key changed). Enter it again. </span>
            ) : null}
            {help}
            {meta.type === 'int' && meta.min !== undefined ? ` Allowed: ${meta.min}–${meta.max}.` : ''}
            {meta.type !== 'secret' &&
            meta.type !== 'bool' &&
            meta.reset_value !== '' &&
            meta.reset_value !== null &&
            meta.reset_value !== undefined &&
            !EMPTY_MEANS_DEFAULT.has(name) &&
            !valuesEqual(value, meta.reset_value)
              ? defaultHint(ENUM_LABELS[String(meta.reset_value)] || String(meta.reset_value))
              : ''}
          </p>
          {resetAction ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-secondary hover:text-[var(--text)] cursor-pointer shrink-0"
              onClick={() => onChange(name, resetAction === 'undo' ? undefined : null)}
            >
              <RotateCcw size={10} />
              {resetAction === 'undo' ? 'Undo' : 'Reset to default'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Logo on a light and a dark background, exactly as the portal will show it. */
function LogoPreview({ asset }: { asset: LogoAsset }) {
  const light = resolveLogo(asset, false);
  const dark = resolveLogo(asset, true);
  const box = (bg: string, r: { src: string | null; invert: boolean }, label: string) => (
    <div className="flex-1 min-w-0 rounded-lg border p-2" style={{ backgroundColor: bg, borderColor: 'var(--border-subtle)' }}>
      <div className="h-12 flex items-center justify-center">
        {r.src ? (
          <img
            src={r.src}
            alt={`${label} preview`}
            className="max-h-12 max-w-full object-contain"
            style={r.invert ? { filter: 'invert(1)' } : undefined}
          />
        ) : (
          <span className="text-[10px]" style={{ color: bg === '#ffffff' ? '#71717a' : '#a1a1aa' }}>
            None
          </span>
        )}
      </div>
      <div className="mt-1 text-center text-[9px] uppercase tracking-widest" style={{ color: bg === '#ffffff' ? '#71717a' : '#a1a1aa' }}>
        {label}
      </div>
    </div>
  );
  return (
    <div className="flex gap-2">
      {box('#ffffff', light, 'Light mode')}
      {box('#151515', dark, 'Dark mode')}
    </div>
  );
}

type ImageGuide = {
  /** Shown in the card. */
  ratio: string;
  example: string;
  note: string;
  /** Width ÷ height that displays well. */
  range: [number, number];
  min: { w?: number; h?: number };
};

const IMAGE_GUIDES: Record<string, ImageGuide> = {
  // 28px tall in the top bar, at most 88px wide on phones (128px on desktop).
  header_logo: {
    ratio: 'Square to 3:1',
    example: '300×100 or 200×200',
    note: 'Shown 28px tall in the top bar. A transparent PNG or WebP works best.',
    range: [0.8, 3.2],
    min: { h: 84 },
  },
  // 44–64px tall on the login page, with room to spread sideways.
  login_logo: {
    ratio: 'About 3:1 (2:1 to 4:1)',
    example: '900×300',
    note: 'Shown 44–64px tall on the login page. A transparent PNG or WebP works best.',
    range: [1.5, 5],
    min: { h: 192 },
  },
  // Fixed 170–260px wide in the login page corner; the height follows.
  partner_logo: {
    ratio: 'About 16:9 (3:2 to 3:1)',
    example: '1280×720',
    note: 'Shown 170–260px wide in the login page corner. A transparent PNG or WebP works best.',
    range: [1.2, 3.5],
    min: { w: 780 },
  },
  // Cropped to fill the panel: close to square on desktop, tall on phones.
  login_background: {
    ratio: 'Landscape, 4:3 to 16:9',
    example: '1920×1080',
    note: 'Cropped to fill the panel (taller on phones), so keep the main subject near the centre.',
    range: [1, 2],
    min: { w: 1600 },
  },
  favicon: {
    ratio: 'Square (1:1)',
    example: '512×512',
    note: 'Browser tab and home-screen icon. An ICO file also works.',
    range: [0.95, 1.05],
    min: { w: 192, h: 192 },
  },
};

/** Dark-mode versions follow their logo's guidance. */
function guideFor(slot: string): ImageGuide | undefined {
  return IMAGE_GUIDES[slot.replace(/_dark$/, '')];
}

/** "3:1", "1:1", "1:2.5". */
function formatRatio(w: number, h: number): string {
  const r = w / h;
  const round = (n: number) => String(Math.round(n * 10) / 10);
  return r >= 1 ? `${round(r)}:1` : `1:${round(1 / r)}`;
}

/** The uploaded image's real pixel size, read by the browser. */
function useImageSize(url: string | null) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setSize(null);
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth && img.naturalHeight) setSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return size;
}

/** What to tell the admin when an upload is outside the guidance, or null. */
function guideWarnings(size: { w: number; h: number }, guide: ImageGuide, slot: string): string[] {
  const out: string[] = [];
  const r = size.w / size.h;
  const base = slot.replace(/_dark$/, '');
  if (base === 'favicon' && (r < guide.range[0] || r > guide.range[1])) {
    out.push('Not square — browsers may squash it or add empty space.');
  } else if (base === 'login_background' && r < guide.range[0]) {
    out.push('Portrait — on wide screens much of the top and bottom will be cropped.');
  } else if (r > guide.range[1]) {
    out.push('Wider than recommended — it will be shown smaller to fit.');
  } else if (r < guide.range[0]) {
    out.push('Narrower than recommended — it may look small or leave empty space.');
  }
  if ((guide.min.w && size.w < guide.min.w) || (guide.min.h && size.h < guide.min.h)) {
    const need = [guide.min.w ? `${guide.min.w}px wide` : '', guide.min.h ? `${guide.min.h}px tall` : ''].filter(Boolean).join(' and ');
    out.push(`Lower resolution than recommended (at least ${need}) — it may look blurry on sharp screens.`);
  }
  return out;
}

/** "Recommended: …" line shown in each image card. */
function ImageGuideNote({ slot }: { slot: string }) {
  const guide = guideFor(slot);
  if (!guide) return null;
  const min = [guide.min.w ? `${guide.min.w}px wide` : '', guide.min.h ? `${guide.min.h}px tall` : ''].filter(Boolean).join(' and ');
  return (
    <div className="text-[10px] text-secondary">
      <span className="font-semibold" style={{ color: 'var(--text)' }}>
        Recommended: {guide.ratio}
      </span>{' '}
      (e.g. {guide.example}{min ? `, at least ${min}` : ''}). {guide.note}
    </div>
  );
}

function ImageSlot({
  slot,
  meta,
  busy,
  locked,
  onUpload,
  onRemove,
  compact,
}: {
  slot: string;
  meta: AssetMeta;
  /** This slot's own upload/removal is running (spinner). */
  busy: boolean;
  /** Any save or upload is running — no new one starts until it's done. */
  locked?: boolean;
  onUpload: (slot: string, file: File) => void;
  onRemove: (slot: string) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = meta.types.join(',');
  const allowed = meta.types.map((t) => EXT_BY_TYPE[t] || t).join(', ');
  const size = useImageSize(meta.url);
  const guide = guideFor(slot);
  const warnings = size && guide ? guideWarnings(size, guide, slot) : [];
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUpload(slot, file);
          }}
        />
        <button
          type="button"
          disabled={busy || locked}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border cursor-pointer hover:bg-[var(--hover-bg)] disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ImageUp size={13} />}
          {meta.url ? 'Replace' : compact ? 'Upload' : `Upload ${meta.label.toLowerCase()}`}
        </button>
        {meta.url ? (
          <button
            type="button"
            disabled={busy || locked}
            onClick={() => onRemove(slot)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border cursor-pointer hover:bg-[var(--hover-bg)] disabled:opacity-60"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
          >
            <Trash2 size={13} />
            Remove
          </button>
        ) : null}
        <span className="text-[10px] text-secondary">
          {allowed}, up to {formatBytes(meta.max_bytes)}
          {meta.url && meta.updated_by ? ` · uploaded by ${meta.updated_by} ${formatWhen(meta.updated_at)}` : ''}
          {meta.url && size ? ` · ${size.w}×${size.h} (${formatRatio(size.w, size.h)})` : ''}
        </span>
      </div>
      {warnings.length ? (
        <div role="note" className="flex items-start gap-1.5 text-[10px] leading-snug" style={{ color: '#d97706' }}>
          <AlertTriangle size={11} className="mt-px shrink-0" />
          <span>{warnings.join(' ')}</span>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export function PortalSettings() {
  const [activeTab, setActiveTab] = useState<SectionKey>('branding');
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [saving, setSaving] = useState(false);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [removeSlot, setRemoveSlot] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [reauth, setReauth] = useState<{ section: SectionKey; error: string | null } | null>(null);
  const [password, setPassword] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    const { ok, json } = await api<{ data: AdminData }>('/api/site-settings').catch(() => ({ ok: false, status: 0, json: {} as any }));
    if (ok && json?.data) setData(json.data);
    else {
      setLoadFailed(true);
      toast.error(json?.message || 'Failed to load portal settings');
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  /** Draft changes that differ from what's saved, per section. */
  const changesFor = (section: SectionKey): Record<string, unknown> => {
    const sec = data?.sections[section];
    const draft = drafts[section];
    if (!sec || !draft) return {};
    const out: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(draft)) {
      const meta = sec.fields[name];
      if (meta && isChanged(meta, draft, name)) out[name] = v;
    }
    return out;
  };
  const dirtyTabs = useMemo(() => {
    const set = new Set<SectionKey>();
    for (const t of TABS) if (Object.keys(changesFor(t.key)).length) set.add(t.key);
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, data]);
  const dirty = dirtyTabs.size > 0;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function setField(section: SectionKey, name: string, value: unknown) {
    const meta = data?.sections[section]?.fields[name];
    // Typed or toggled back to what's saved: no edit left to keep.
    const backToSaved = meta && meta.type !== 'secret' && value !== null && value !== undefined && valuesEqual(value, meta.value);
    setDrafts((prev) => {
      const next = { ...(prev[section] || {}) };
      if (value === undefined || backToSaved) delete next[name];
      else next[name] = value;
      return { ...prev, [section]: next };
    });
  }

  function discard(section: SectionKey) {
    setDrafts((prev) => ({ ...prev, [section]: {} }));
  }

  function needsPassword(section: SectionKey, changes: Record<string, unknown>) {
    const sec = data?.sections[section];
    if (!sec) return false;
    if (sec.sensitive) return true;
    return section === 'announcements' && changes.maintenance_enabled === true && !sec.fields.maintenance_enabled?.value;
  }

  async function save(section: SectionKey, currentPassword?: string) {
    const sec = data?.sections[section];
    const changes = changesFor(section);
    if (!sec || !Object.keys(changes).length) return;
    if (needsPassword(section, changes) && !currentPassword) {
      setPassword('');
      setReauth({ section, error: null });
      return;
    }
    setSaving(true);
    const { ok, status, json } = await api<{ data: AdminData }>(`/api/site-settings/${section}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: changes, version: sec.version, ...(currentPassword ? { current_password: currentPassword } : {}) }),
    }).catch(() => ({ ok: false, status: 0, json: { message: 'Network error. Please try again.' } as any }));
    setSaving(false);

    if (ok && json?.data) {
      setData(json.data);
      setDrafts((prev) => {
        const rest = { ...(prev[section] || {}) };
        for (const [k, v] of Object.entries(changes)) if (rest[k] === v) delete rest[k];
        return { ...prev, [section]: rest };
      });
      setReauth(null);
      setPassword('');
      toast.success(`${sec.label} settings saved`);
      void loadSiteSettings(); // this tab's own header/footer, right away
      return;
    }
    const message = json?.message || 'Failed to save settings';
    if ((json as any)?.reauthRequired) {
      setReauth({ section, error: currentPassword ? message : null });
      if (!currentPassword) setPassword('');
      return;
    }
    if (reauth || currentPassword) {
      setReauth(null);
      setPassword('');
    }
    if (status === 409) {
      toast.error(message, { action: { label: 'Reload', onClick: () => void load() } });
      return;
    }
    toast.error(message);
  }

  async function upload(slot: string, file: File) {
    const meta = data?.assets[slot];
    if (!meta) return;
    if (file.size > meta.max_bytes) {
      toast.error(`${meta.label} must be ${formatBytes(meta.max_bytes)} or smaller.`);
      return;
    }
    setBusySlot(slot);
    const body = new FormData();
    body.append('file', file);
    const { ok, json } = await api<{ data: AdminData }>(`/api/site-settings/assets/${slot}`, { method: 'POST', body }).catch(() => ({
      ok: false,
      status: 0,
      json: { message: 'Upload failed. Please try again.' } as any,
    }));
    setBusySlot(null);
    if (ok && json?.data) {
      setData(json.data);
      toast.success(`${meta.label} updated`);
      void loadSiteSettings();
    } else toast.error(json?.message || 'Upload failed');
  }

  async function remove(slot: string) {
    const meta = data?.assets[slot];
    setBusySlot(slot);
    const { ok, json } = await api<{ data: AdminData }>(`/api/site-settings/assets/${slot}`, { method: 'DELETE' }).catch(() => ({
      ok: false,
      status: 0,
      json: {} as any,
    }));
    setBusySlot(null);
    setRemoveSlot(null);
    if (ok && json?.data) {
      setData(json.data);
      toast.success(`${meta?.label || 'Image'} removed — the built-in image is back`);
      void loadSiteSettings();
    } else toast.error(json?.message || 'Could not remove the image');
  }

  async function sendTest() {
    const draft = drafts.email || {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) if (v !== null && v !== undefined) values[k] = v;
    setTesting(true);
    const { ok, json } = await api('/api/site-settings/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }).catch(() => ({ ok: false, status: 0, json: { message: 'Network error. Please try again.' } as any }));
    setTesting(false);
    if (ok) toast.success(json?.message || 'Test email sent');
    else toast.error(json?.message || 'The test email could not be sent');
  }

  /** Field problems the server would refuse (errors, which block Save) or
   * that the admin should know about (notices). Same rules as
   * prepareSectionUpdate() in server/lib/siteSettings.js. */
  const issues = useMemo(() => {
    const errors: Partial<Record<SectionKey, Record<string, string>>> = {};
    const notices: Partial<Record<SectionKey, Record<string, string>>> = {};
    const ann = data?.sections.announcements;
    if (ann) {
      const d = drafts.announcements;
      const endsMeta = ann.fields.banner_ends_at;
      const startsMeta = ann.fields.banner_starts_at;
      const ends = effectiveValue(endsMeta, d, 'banner_ends_at');
      const starts = effectiveValue(startsMeta, d, 'banner_starts_at');
      const endsAt = ends ? new Date(String(ends)).getTime() : NaN;
      const startsAt = starts ? new Date(String(starts)).getTime() : NaN;
      const endsChanged = isChanged(endsMeta, d, 'banner_ends_at');
      if (endsChanged && endsAt <= now) {
        errors.announcements = {
          banner_ends_at: '"Show until" is already in the past — pick a later date and time, or leave it empty.',
        };
      } else if (endsAt <= startsAt && (endsChanged || isChanged(startsMeta, d, 'banner_starts_at'))) {
        errors.announcements = { banner_ends_at: '"Show until" must be after "Show from".' };
      } else if (!endsChanged && endsAt <= now) {
        notices.announcements = {
          banner_ends_at: "This end time has passed, so the banner isn't showing. Pick a later one or clear it to show it again.",
        };
      }
    }
    return { errors, notices };
  }, [data, drafts, now]);

  /* -------------------------------- render ------------------------------ */

  const section = data?.sections[activeTab];
  const draft = drafts[activeTab];
  /** Current value of another field, including unsaved edits. */
  const liveValue = (sec: SectionKey, name: string): string => {
    const meta = data?.sections[sec]?.fields[name];
    const v = meta ? effectiveValue(meta, drafts[sec], name) : '';
    return v === null || v === undefined ? '' : String(v).trim();
  };

  /** What an empty field means. A value the app falls back to (in grey, so it
   * reads as "this is what's used"), "Not set" where nothing is configured,
   * or "None — …" where empty hides something. Required, number and dropdown
   * fields get none: they're never empty, or can't be saved empty. */
  const placeholderFor = (name: string): string | undefined => {
    const portal = `${liveValue('branding', 'org_short_name') || 'CIAC'} Portal`;
    switch (name) {
      case 'portal_tagline':
        return 'None — no tagline on the login page';
      case 'login_subtitle':
        return 'None — no message on the login page';
      case 'footer_text':
        return 'None — just the copyright line';
      case 'totp_issuer':
      case 'mail_from_name':
        return portal;
      case 'mail_from_address':
        return liveValue('email', 'smtp_user') || 'Not set';
      case 'mail_reply_to':
        return liveValue('email', 'mail_from_address') || liveValue('email', 'smtp_user') || 'Not set';
      case 'banner_title':
        return bannerHeading({ title: '', level: liveValue('announcements', 'banner_level') || 'info' });
      case 'maintenance_message':
        return String(data?.sections.announcements.fields.maintenance_message.reset_value ?? '');
      case 'banner_starts_at':
        return 'Right away';
      case 'banner_ends_at':
        return 'Until turned off';
      case 'support_email':
      case 'support_phone':
      case 'privacy_url':
      case 'terms_url':
      case 'smtp_host':
      case 'smtp_user':
      case 'banner_message':
        return 'Not set';
      default:
        return undefined;
    }
  };

  const renderField = (name: string, sec: SectionKey = activeTab) => {
    const meta = data?.sections[sec]?.fields[name];
    if (!meta) return null;
    return (
      <FieldRow
        key={name}
        name={name}
        meta={meta}
        draft={drafts[sec]}
        onChange={(n, v) => setField(sec, n, v)}
        error={issues.errors[sec]?.[name]}
        notice={issues.notices[sec]?.[name]}
        placeholder={placeholderFor(name)}
      />
    );
  };

  function logoAssetFor(slot: 'header_logo' | 'login_logo' | 'partner_logo', invertField: string): LogoAsset {
    const light = data!.assets[slot];
    const dark = data!.assets[`${slot}_dark`];
    const invertMeta = data!.sections.branding.fields[invertField];
    return {
      url: light?.url || null,
      dark_url: dark?.url || null,
      builtin: light?.builtin || null,
      builtin_dark: dark?.builtin || null,
      invert: Boolean(effectiveValue(invertMeta, drafts.branding, invertField)),
    };
  }

  function renderBranding() {
    return (
      <div className="space-y-6">
        {BRANDING_GROUPS.map((g) => (
          <section key={g.title}>
            <GroupHeader title={g.title} hint={g.hint} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">{g.fields.map((f) => renderField(f))}</div>
          </section>
        ))}

        <section>
          <GroupHeader title="Images" hint="Uploads apply right away. PNG, JPG or WebP — SVG isn't accepted for security reasons." />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {LOGO_SLOTS.map(({ slot, invertField, where }) => {
              const light = data!.assets[slot];
              const dark = data!.assets[`${slot}_dark`];
              const invertMeta = data!.sections.branding.fields[invertField];
              const hasDarkUpload = Boolean(dark?.url);
              return (
                <div key={slot} className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                      {light.label}
                    </div>
                    <div className="text-[10px] text-secondary">{where}</div>
                  </div>
                  <ImageGuideNote slot={slot} />
                  <LogoPreview asset={logoAssetFor(slot, invertField)} />
                  <ImageSlot slot={slot} meta={light} busy={busySlot === slot} locked={busy} onUpload={upload} onRemove={setRemoveSlot} />
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                      Dark mode version <span className="font-normal text-secondary">(optional)</span>
                    </div>
                    <ImageSlot
                      slot={`${slot}_dark`}
                      meta={dark}
                      busy={busySlot === `${slot}_dark`}
                      locked={busy}
                      onUpload={upload}
                      onRemove={setRemoveSlot}
                      compact
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
                        Invert in dark mode
                        {isChanged(invertMeta, drafts.branding, invertField) ? (
                          <span title="Changed, not saved yet" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        ) : null}
                      </div>
                      <p className="text-[10px] text-secondary">
                        {hasDarkUpload
                          ? 'Not used while a dark mode version is uploaded.'
                          : !light.url && dark?.builtin
                            ? 'The built-in logo has its own dark version, so this only applies once you upload your own.'
                            : 'On for single-colour (e.g. black) artwork. Off to show the image as-is in both modes, e.g. a colour logo. Saved with the Save button.'}
                      </p>
                    </div>
                    <Toggle
                      checked={Boolean(effectiveValue(invertMeta, drafts.branding, invertField))}
                      onChange={(v) => setField('branding', invertField, v)}
                      label={`Invert ${light.label.toLowerCase()} in dark mode`}
                      disabled={hasDarkUpload}
                    />
                  </div>
                </div>
              );
            })}

            {(['login_background', 'favicon'] as const).map((slot) => {
              const meta = data!.assets[slot];
              const src = meta.url || meta.builtin;
              return (
                <div key={slot} className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                      {meta.label}
                    </div>
                    <div className="text-[10px] text-secondary">
                      {slot === 'favicon' ? 'Browser tab and home-screen icon' : 'Behind the login panel'}
                    </div>
                  </div>
                  <ImageGuideNote slot={slot} />
                  <div
                    className="rounded-lg border flex items-center justify-center overflow-hidden"
                    style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)', height: slot === 'favicon' ? 72 : 120 }}
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={`${meta.label} preview`}
                        className={slot === 'favicon' ? 'h-12 w-12 object-contain' : 'h-full w-full object-cover'}
                      />
                    ) : null}
                  </div>
                  <ImageSlot slot={slot} meta={meta} busy={busySlot === slot} locked={busy} onUpload={upload} onRemove={setRemoveSlot} />
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  function renderEmail() {
    return (
      <div className="space-y-6">
        {!data!.mail_configured ? (
          <Notice tone="warning">
            Outgoing email isn't set up yet — password resets and account emails are only written to the server log. Fill in the SMTP server
            and username below.
          </Notice>
        ) : null}
        <section>
          <GroupHeader title="SMTP server" hint="The mail server the portal sends through" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
            {['smtp_host', 'smtp_port', 'smtp_security', 'smtp_user', 'smtp_pass'].map((f) => renderField(f))}
          </div>
        </section>
        <section>
          <GroupHeader title="Sender" hint="What recipients see" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
            {['mail_from_address', 'mail_from_name', 'mail_reply_to'].map((f) => renderField(f))}
          </div>
        </section>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0 flex-1 text-[11px] text-secondary">
            Sends a test message to <b style={{ color: 'var(--text)' }}>your own email address</b> using the values above, including changes you
            haven't saved — so you can check them before saving.
          </div>
          <button
            type="button"
            disabled={testing}
            onClick={() => void sendTest()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border cursor-pointer hover:bg-[var(--hover-bg)] disabled:opacity-60 shrink-0"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
          >
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            Send test email
          </button>
        </div>
      </div>
    );
  }

  function renderIntegrations() {
    return (
      <div className="space-y-4">
        <GroupHeader title="Google Maps" hint="Address suggestions on locator forms" />
        <div className="max-w-2xl">{renderField('google_maps_api_key')}</div>
        <Notice tone="info">
          Google Maps keys are visible to the browser by design. What protects the key is the restriction set in Google Cloud Console:
          limit it to this portal's web address (HTTP referrers) and to the Maps JavaScript and Places APIs.
        </Notice>
      </div>
    );
  }

  function renderSecurity() {
    return (
      <div className="space-y-4">
        <Notice tone="info">
          These apply across the portal right away: the login page, sign-out timers and password rules everywhere update on their own. A
          shorter idle timeout applies to each person from their next activity.
        </Notice>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
          {['login_max_attempts', 'login_lockout_minutes', 'idle_timeout_minutes', 'password_min_length', 'password_expiry_days', 'audit_retention_years'].map((f) =>
            renderField(f)
          )}
        </div>
        {renderField('allow_2fa_opt_out')}
        <div className="border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <GroupHeader title="Cookie notice" hint="Shown once per browser, before the first sign-in" />
        </div>
        {/* Text on the left, buttons and where Decline goes on the right. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
          <div className="space-y-4">{['cookie_title', 'cookie_message'].map((f) => renderField(f))}</div>
          <div className="space-y-4">{['cookie_accept_label', 'cookie_decline_label', 'cookie_decline_url'].map((f) => renderField(f))}</div>
        </div>
      </div>
    );
  }

  function renderRenewals() {
    return (
      <div className="space-y-4">
        <Notice tone="info">
          Applies right away: Renewal Tracking, the dashboards and the next reminder run (twice a day) use these values.
        </Notice>
        <section className="space-y-4">
          <GroupHeader title="Expiring" hint="When a locator's contract counts as due for renewal" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">{renderField('expiring_window_months')}</div>
        </section>
        <section className="space-y-4">
          <GroupHeader title="Reminder emails" hint="Sent to the locator until their renewal is filed" />
          {renderField('reminders_enabled')}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
            {renderField('reminder_interval_months')}
            {renderField('stop_after_expiry_months')}
          </div>
          {renderField('cc_account_officer')}
        </section>
      </div>
    );
  }

  function renderAnnouncements() {
    const maintenanceOn = Boolean(effectiveValue(section!.fields.maintenance_enabled, draft, 'maintenance_enabled'));
    const maintenanceSaved = Boolean(section!.fields.maintenance_enabled.value);
    return (
      <div className="space-y-6">
        <section className="space-y-4">
          <GroupHeader title="Announcement banner" hint="A message across the top of every page and on the login page" />
          {renderField('banner_enabled')}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
            <div className="md:col-span-2">{renderField('banner_title')}</div>
            <div className="md:col-span-2">{renderField('banner_message')}</div>
            {renderField('banner_level')}
            <div className="hidden md:block" />
            {renderField('banner_starts_at')}
            {renderField('banner_ends_at')}
          </div>
        </section>
        <section className="space-y-4">
          <GroupHeader title="Maintenance mode" hint="Close the portal to everyone except administrators" />
          {renderField('maintenance_enabled')}
          {maintenanceOn && !maintenanceSaved ? (
            <Notice tone="warning">
              Saving this signs out every non-administrator right away (staff and locators), and only administrators can sign in until you turn
              it off. You'll be asked for your password.
            </Notice>
          ) : null}
          {maintenanceSaved ? <Notice tone="warning">Maintenance mode is on. Only administrators can sign in.</Notice> : null}
          <div className="max-w-2xl">{renderField('maintenance_message')}</div>
        </section>
      </div>
    );
  }

  const busy = saving || busySlot !== null;
  const tabDirty = dirtyTabs.has(activeTab);
  const tabHasErrors = Object.keys(issues.errors[activeTab] || {}).length > 0;
  const changeCount = Object.keys(changesFor(activeTab)).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="mt-3">
        <div
          role="tablist"
          aria-label="Portal Settings tabs"
          className="flex rounded-xl border p-1 gap-0.5"
          style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--control-bg)' }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              className="relative flex-1 min-w-0 rounded-lg px-1.5 sm:px-3 py-2 flex flex-col gap-0.5 text-center lg:text-left transition-colors cursor-pointer"
              style={
                activeTab === t.key
                  ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
                  : { backgroundColor: 'transparent', color: 'var(--text)' }
              }
              onClick={() => setActiveTab(t.key)}
            >
              <span className="hidden lg:block text-[10px] font-semibold uppercase tracking-widest opacity-80">{t.caption}</span>
              <span className="inline-flex items-center justify-center lg:justify-start gap-1.5 text-[11px] sm:text-sm font-bold leading-tight tracking-tight min-w-0">
                <span className="md:hidden truncate">{t.short}</span>
                <span className="hidden md:inline truncate">{t.title}</span>
                {dirtyTabs.has(t.key) ? (
                  <span
                    aria-label="Unsaved changes"
                    title="Unsaved changes"
                    className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-400"
                  />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 sm:p-5 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        {loading && !data ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-6 w-48 rounded-lg" />
            <Skeleton className="h-[260px] w-full rounded-xl" />
          </div>
        ) : loadFailed || !data || !section ? (
          <EmptyState title="Portal settings unavailable" description="They couldn't be loaded. Check your connection and reload the page." />
        ) : (
          <div className="min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-5">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-secondary uppercase tracking-widest">{section.label}</div>
                <div className="text-[12px] text-secondary">
                  {section.updated_by
                    ? `Last changed by ${section.updated_by} · ${formatWhen(section.updated_at)}`
                    : 'Not changed from the defaults yet'}
                  {section.sensitive ? ' · Saving asks for your password' : ''}
                </div>
              </div>
            </div>

            {activeTab === 'branding'
              ? renderBranding()
              : activeTab === 'email'
                ? renderEmail()
                : activeTab === 'integrations'
                  ? renderIntegrations()
                  : activeTab === 'security'
                    ? renderSecurity()
                    : activeTab === 'renewals'
                      ? renderRenewals()
                      : renderAnnouncements()}

            {/* Sticky so Save stays reachable on long tabs and small screens. On
                phones it stops above the bottom nav on its own: <main>'s
                bottom padding reserves that space and sticky respects it. */}
            <div
              className="sticky z-10 -mx-3 sm:-mx-5 mt-6 px-3 sm:px-5 py-3 border-t flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)', bottom: 0 }}
            >
              <span className="text-[11px] text-secondary">
                {tabHasErrors
                  ? 'Fix the highlighted field before saving'
                  : tabDirty
                    ? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'}`
                    : 'No unsaved changes'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!tabDirty || busy}
                  onClick={() => discard(activeTab)}
                  className="flex-1 sm:flex-none rounded-lg px-3 py-2 text-sm font-semibold border cursor-pointer hover:bg-[var(--hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={!tabDirty || busy || tabHasErrors}
                  onClick={() => void save(activeTab)}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  <span className="sm:hidden">Save</span>
                  <span className="hidden sm:inline">Save {section.label.toLowerCase()}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={Boolean(reauth)}
        title="Confirm it's you"
        description={
          reauth?.section === 'announcements'
            ? 'Turning on maintenance mode signs everyone else out. Enter your password to continue.'
            : 'These settings affect sign-in, email or integrations for everyone. Enter your password to save them.'
        }
        confirmText="Save"
        loading={saving}
        confirmDisabled={!password}
        onCancel={() => {
          if (saving) return;
          setReauth(null);
          setPassword('');
        }}
        onConfirm={() => {
          if (reauth && password) void save(reauth.section, password);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reauth && password && !saving) void save(reauth.section, password);
          }}
          className="pt-1 space-y-1"
        >
          <NoAutofillPasswordInput
            autoFocus
            className="app-input"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Your password"
          />
          {reauth?.error ? (
            <p className="text-[11px]" style={{ color: '#ef4444' }}>
              {reauth.error}
            </p>
          ) : null}
        </form>
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(removeSlot)}
        title="Remove this image?"
        description={`The ${data && removeSlot ? data.assets[removeSlot]?.label.toLowerCase() : 'image'} goes back to the built-in one for everyone.`}
        confirmText="Remove"
        danger
        loading={Boolean(busySlot)}
        onCancel={() => setRemoveSlot(null)}
        onConfirm={() => {
          if (removeSlot) void remove(removeSlot);
        }}
      />
    </div>
  );
}
