import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, KeyRound, Pencil, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';
import { UserAvatar } from '../ui/UserAvatar';
import { Skeleton } from '../ui/Skeleton';
import { loadMyProfile, patchMyProfile, setMyProfile, useMyProfile, type MyProfile } from '../../lib/myProfile';
import { roleDisplayName } from '../../lib/roleDisplay';
import { PhotoEditorModal } from './PhotoEditorModal';

// My Profile (staff): the signed-in user's own account. Opened from the
// header's account menu and the mobile menu's account card (AppLayout).
// Only Personal information goes through the panel's Save button — photo,
// two-factor and password actions apply as soon as they're confirmed.

type Enrollment = { otpauthUrl: string; secret: string; qrDataUrl: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone is PH mobile only: the field shows a fixed "+63" and the user types
// the 10 digits after it, grouped as "912 345 6789" while typing. Saved as
// "+639123456789" (no spaces), the same shape as existing rows.
const LOCAL_PHONE_RE = /^9\d{9}$/;

/** Stored phone ("+639…", "639…", "09…", or spaced) → its 10 local digits. */
function toLocalDigits(stored: string | null | undefined) {
  let d = String(stored || '').replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

function formatLocalPhone(digits: string) {
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean).join(' ');
}

async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: 'include', ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const err = new Error(json?.message || 'Something went wrong') as Error & { field?: string };
    err.field = json?.field;
    throw err;
  }
  return json;
}

function postJson(path: string, body?: unknown, method = 'POST') {
  return apiJson(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return withTime
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TONE_STYLE = {
  good: { backgroundColor: 'rgba(34,197,94,.14)', color: 'rgb(34,197,94)' },
  neutral: { backgroundColor: 'rgba(148,163,184,.14)', color: 'rgb(148,163,184)' },
} as const;

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2.5">
      <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{children}</div>
      {action}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border p-3 sm:p-4 ${className}`}
      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, var(--surface) 94%, white 6%)' }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">{label}</div>
      {children}
      {error ? (
        <p className="text-[10px] font-medium" style={{ color: '#ef4444' }}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-[10px] text-secondary">{hint}</p>
      ) : null}
    </div>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
  tone = 'default',
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  type?: 'button' | 'submit';
}) {
  const style =
    tone === 'primary'
      ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', borderColor: 'transparent' }
      : tone === 'danger'
        ? { borderColor: 'var(--border-subtle)', color: '#ef4444' }
        : { borderColor: 'var(--border-subtle)', color: 'var(--text)' };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex shrink-0 whitespace-nowrap items-center justify-center gap-1.5 rounded-lg border px-3 py-2 sm:py-1.5 text-[12px] sm:text-[11px] font-semibold cursor-pointer transition-colors hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
      style={style}
    >
      {children}
    </button>
  );
}

function CodeInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      maxLength={6}
      placeholder="123456"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className="app-input flex-1 min-w-0 max-w-[11rem] tracking-[0.25em] sm:tracking-[0.4em] font-mono"
    />
  );
}

// --- Phone ---

/** Fixed "+63" plus the 10 local digits, re-grouped as the user types. The
 * caret stays after the same digit it was after, so editing mid-number
 * doesn't throw it to the end when the spaces move. */
function PhoneInput({ digits, onChange }: { digits: string; onChange: (digits: string) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const caretDigits = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    const n = caretDigits.current;
    if (!el || n === null || document.activeElement !== el) return;
    caretDigits.current = null;
    const text = el.value;
    let pos = 0;
    for (let seen = 0; pos < text.length && seen < n; pos += 1) if (/\d/.test(text[pos])) seen += 1;
    el.setSelectionRange(pos, pos);
  }, [digits]);

  return (
    <div className="flex items-stretch">
      <span
        className="inline-flex items-center rounded-l-lg border border-r-0 px-3 text-sm font-medium select-none"
        style={{ borderColor: 'var(--input-border)', backgroundColor: 'var(--control-bg)', color: 'var(--text-muted)' }}
      >
        +63
      </span>
      <input
        ref={ref}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        className="app-input !rounded-l-none flex-1 min-w-0"
        placeholder="912 345 6789"
        value={formatLocalPhone(digits)}
        onChange={(e) => {
          const raw = e.target.value;
          const caret = e.target.selectionStart ?? raw.length;
          // Pasting a full number ("+63 912…", "0912…") keeps just the local part.
          let next = raw.replace(/\D/g, '');
          if (next.length > 10) next = toLocalDigits(next);
          caretDigits.current = raw.slice(0, caret).replace(/\D/g, '').length;
          onChange(next.slice(0, 10));
        }}
      />
    </div>
  );
}

// --- Photo + account details ---

function IdentityHeader({ profile }: { profile: MyProfile }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const displayName = profile.full_name || profile.username;
  const role = profile.role ? roleDisplayName(profile.role) : null;

  return (
    <div className="space-y-5">
      {/* Centered at every width; the pencil opens the photo editor
          (upload, reposition/zoom, remove). */}
      <div className="flex flex-col items-center text-center gap-3 pt-1">
        <div className="relative">
          <UserAvatar
            version={profile.avatar_version}
            name={displayName}
            className="h-24 w-24 sm:h-28 sm:w-28 text-2xl sm:text-3xl font-bold"
            style={{ backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            aria-label="Edit profile photo"
            title="Edit profile photo"
            className="absolute bottom-0 right-0 h-8 w-8 rounded-full flex items-center justify-center border-2 cursor-pointer transition-transform hover:scale-105"
            style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', borderColor: 'var(--surface)' }}
          >
            <Pencil size={13} />
          </button>
        </div>
        <div className="min-w-0 max-w-full">
          <div className="text-base sm:text-lg font-bold truncate" style={{ color: 'var(--text)' }}>
            {displayName}
          </div>
          <div className="text-xs text-secondary truncate">@{profile.username}</div>
        </div>
      </div>

      {/* Account details — read-only identity facts, so they sit with the
          photo and name rather than among the editable fields. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl px-3.5 py-3" style={{ backgroundColor: 'var(--control-bg)' }}>
        {[
          { term: 'Username', value: profile.username },
          { term: 'Role', value: role || '—' },
          { term: 'Member since', value: formatDate(profile.created_at) },
          {
            term: 'Previous sign-in',
            value: profile.previous_login ? formatDate(profile.previous_login.at, true) : 'None recorded',
          },
        ].map((d) => (
          <div key={d.term} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-secondary">{d.term}</dt>
            <dd className="text-[12px] font-medium truncate mt-0.5" style={{ color: 'var(--text)' }} title={String(d.value)}>
              {d.value}
            </dd>
          </div>
        ))}
      </dl>

      <PhotoEditorModal open={editorOpen} profile={profile} onClose={() => setEditorOpen(false)} />
    </div>
  );
}

// --- Two-factor ---

type TotpStep =
  | { kind: 'idle' }
  | { kind: 'verify'; intent: 'move' | 'disable' }
  | { kind: 'enroll'; enrollment: Enrollment; replacing: boolean };

function TwoFactorCard({ profile }: { profile: MyProfile }) {
  const enabled = profile.totp_enabled === 1;
  const [step, setStep] = useState<TotpStep>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep({ kind: 'idle' });
    setCode('');
  }

  async function start(currentCode?: string) {
    setBusy(true);
    try {
      const json = await postJson('/api/profile/totp/setup', currentCode ? { code: currentCode } : {});
      setStep({ kind: 'enroll', enrollment: json.data.enrollment, replacing: Boolean(json.data.replacing) });
      setCode('');
    } catch (err: any) {
      toast.error(err?.message || 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await postJson('/api/profile/totp/confirm', { code });
      const replacing = step.kind === 'enroll' && step.replacing;
      patchMyProfile({ totp_enabled: 1 });
      reset();
      toast.success(replacing ? 'Authenticator moved to your new phone.' : 'Two-factor authentication is on.');
    } catch (err: any) {
      toast.error(err?.message || 'That code did not match.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnroll() {
    reset();
    postJson('/api/profile/totp/cancel').catch(() => {});
  }

  async function submitVerify() {
    if (step.kind !== 'verify') return;
    if (step.intent === 'move') return start(code);
    setBusy(true);
    try {
      await postJson('/api/profile/totp/disable', { code });
      patchMyProfile({ totp_enabled: 0 });
      reset();
      toast.success('Two-factor authentication is off.');
    } catch (err: any) {
      toast.error(err?.message || 'Could not turn off two-factor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={TONE_STYLE.good}>
            <Smartphone size={14} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              Two-factor authentication
            </div>
            <p className="text-[11px] text-secondary mt-0.5">
              {enabled
                ? 'A 6-digit code from your authenticator app is required at every sign-in.'
                : profile.is_admin
                  ? 'Optional for administrators. Turn it on to require a code from your phone at sign-in.'
                  : "Required for your role. You'll be asked to set it up at your next sign-in, or set it up now."}
            </p>
          </div>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={enabled ? TONE_STYLE.good : TONE_STYLE.neutral}
        >
          {enabled ? <ShieldCheck size={11} /> : <ShieldOff size={11} />}
          {enabled ? 'On' : 'Off'}
        </span>
      </div>

      {step.kind === 'idle' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {enabled ? (
            <>
              <SmallButton onClick={() => setStep({ kind: 'verify', intent: 'move' })}>
                <Smartphone size={13} />
                Move to a new phone
              </SmallButton>
              {profile.is_admin ? (
                <SmallButton tone="danger" onClick={() => setStep({ kind: 'verify', intent: 'disable' })}>
                  <ShieldOff size={13} />
                  Turn off
                </SmallButton>
              ) : null}
            </>
          ) : (
            <SmallButton tone="primary" onClick={() => start()} disabled={busy}>
              <ShieldCheck size={13} />
              {busy ? 'Starting…' : profile.is_admin ? 'Turn on' : 'Set up now'}
            </SmallButton>
          )}
          {enabled && !profile.is_admin ? (
            <p className="w-full text-[10px] text-secondary">Two-factor can't be turned off for your role.</p>
          ) : null}
        </div>
      ) : null}

      {step.kind === 'verify' ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) void submitVerify();
          }}
        >
          <p className="text-[11px] text-secondary">
            {step.intent === 'move'
              ? 'First, enter the current code from the authenticator app you use now.'
              : 'Enter the current code from your authenticator app to turn two-factor off.'}
          </p>
          {/* Code and both buttons share one row — the input shrinks on narrow screens. */}
          <div className="flex items-center gap-2">
            <CodeInput value={code} onChange={setCode} autoFocus />
            <SmallButton type="submit" tone={step.intent === 'disable' ? 'danger' : 'primary'} disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : step.intent === 'move' ? 'Continue' : 'Turn off'}
            </SmallButton>
            <SmallButton onClick={reset} disabled={busy}>
              Cancel
            </SmallButton>
          </div>
        </form>
      ) : null}

      {step.kind === 'enroll' ? (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) void confirm();
          }}
        >
          <ol className="text-[11px] text-secondary space-y-1 list-decimal ml-4">
            <li>
              Scan this QR code with your authenticator app — or on this phone, tap{' '}
              <a href={step.enrollment.otpauthUrl} className="font-semibold underline" style={{ color: 'var(--text)' }}>
                Add to Authenticator
              </a>
              .
            </li>
            <li>Enter the 6-digit code the app shows.</li>
            {step.replacing ? <li>Your old authenticator keeps working until you confirm.</li> : null}
          </ol>
          <div className="flex flex-col items-center gap-2">
            <img src={step.enrollment.qrDataUrl} alt="Authenticator QR code" className="w-40 h-40 rounded-lg bg-white p-2" />
            <button
              type="button"
              onClick={() =>
                navigator.clipboard?.writeText(step.enrollment.secret).then(
                  () => toast.success('Setup key copied.'),
                  () => toast.error('Copy failed.')
                )
              }
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono break-all cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
              title="Copy setup key"
            >
              <Copy size={12} className="shrink-0" />
              {step.enrollment.secret}
            </button>
          </div>
          <div className="flex items-center justify-center gap-2">
            <CodeInput value={code} onChange={setCode} autoFocus />
            <SmallButton type="submit" tone="primary" disabled={busy || code.length !== 6}>
              {busy ? 'Confirming…' : 'Confirm'}
            </SmallButton>
            <SmallButton onClick={cancelEnroll} disabled={busy}>
              Cancel
            </SmallButton>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

// --- Panel ---

type Form = { full_name: string; email: string; phone: string; currentPassword: string };

export function MyProfilePanel({
  open,
  onClose,
  onChangePassword,
}: {
  open: boolean;
  onClose: () => void;
  onChangePassword: () => void;
}) {
  const profile = useMyProfile(open);
  const [form, setForm] = useState<Form>({ full_name: '', email: '', phone: '', currentPassword: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);

  // Fresh data every time the panel opens (2FA or email may have been changed
  // by an admin since), and the form reset to what's saved.
  useEffect(() => {
    if (open) void loadMyProfile(true);
  }, [open]);

  const loaded = profile !== null;
  useEffect(() => {
    if (!open || !profile) return;
    setForm({ full_name: profile.full_name || '', email: profile.email || '', phone: toLocalDigits(profile.phone), currentPassword: '' });
    setErrors({});
    // Only when the panel opens or a different account loads — not on every
    // profile patch (e.g. a photo upload), which would wipe unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, profile?.id]);

  const emailChanged = useMemo(
    () => !!profile && form.email.trim().toLowerCase() !== String(profile.email || '').toLowerCase(),
    [form.email, profile]
  );
  const dirty =
    !!profile &&
    (form.full_name.trim() !== (profile.full_name || '') || emailChanged || form.phone !== toLocalDigits(profile.phone));

  const validation = useMemo(() => {
    const v: Partial<Record<keyof Form, string>> = {};
    if (!form.full_name.trim()) v.full_name = 'Full name is required.';
    if (!form.email.trim()) v.email = 'Email is required.';
    else if (!EMAIL_RE.test(form.email.trim())) v.email = 'Enter a valid email address.';
    if (form.phone && !LOCAL_PHONE_RE.test(form.phone)) v.phone = 'Enter a 10-digit mobile number starting with 9.';
    if (emailChanged && !form.currentPassword) v.currentPassword = 'Required to change your email.';
    return v;
  }, [form, emailChanged]);

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: undefined }));
  };

  async function save() {
    if (!profile || !dirty || Object.keys(validation).length) return;
    setSaving(true);
    try {
      const json = await postJson(
        '/api/profile',
        {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: form.phone ? `+63${form.phone}` : '',
          ...(emailChanged ? { currentPassword: form.currentPassword } : {}),
        },
        'PUT'
      );
      setMyProfile({ ...profile, ...json.data });
      setForm((p) => ({ ...p, currentPassword: '' }));
      toast.success(emailChanged ? 'Profile saved. A notice was sent to your old and new email.' : 'Profile saved.');
    } catch (err: any) {
      if (err?.field && err.field in form) setErrors((p) => ({ ...p, [err.field]: err.message }));
      else toast.error(err?.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  }

  // Validation messages appear only after the field is edited (errors from
  // the server always show), so an untouched form doesn't open covered in red.
  const shown = (key: keyof Form) => {
    if (errors[key]) return errors[key];
    if (!profile) return null;
    const edited =
      key === 'currentPassword'
        ? form.currentPassword.length > 0
        : key === 'phone'
          ? // A saved number that isn't a PH mobile (e.g. a landline entered by
            // an admin) blocks Save, so say why right away.
            form.phone !== toLocalDigits(profile.phone) || (!!form.phone && !LOCAL_PHONE_RE.test(form.phone))
          : form[key].trim() !== String((profile as any)[key] || '');
    return edited ? validation[key] || null : null;
  };

  return (
    <SidePanel
      open={open}
      title="My Profile"
      subtitle="Your photo, contact details and sign-in security"
      widthClassName="max-w-[34rem]"
      saving={saving}
      saveDisabled={!dirty || Object.keys(validation).length > 0}
      saveLabel="Save changes"
      footerNote="Photo and security changes apply right away."
      onClose={onClose}
      onSave={save}
    >
      {!profile ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-24 w-24 sm:h-28 sm:w-28 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <IdentityHeader profile={profile} />

          <section>
            <SectionTitle>Personal information</SectionTitle>
            <form
              className="grid grid-cols-1 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Field label="Full name" error={shown('full_name')}>
                <input className="app-input" value={form.full_name} onChange={set('full_name')} autoComplete="name" />
              </Field>
              <Field
                label="Email"
                error={shown('email')}
                hint="Used for sign-in, password resets and account notices."
              >
                <input type="email" className="app-input" value={form.email} onChange={set('email')} autoComplete="email" />
              </Field>
              {emailChanged ? (
                <Field
                  label="Current password"
                  error={shown('currentPassword')}
                  hint="Required to change your email. Both your old and new address will be notified."
                >
                  <input
                    type="password"
                    className="app-input"
                    value={form.currentPassword}
                    onChange={set('currentPassword')}
                    autoComplete="current-password"
                  />
                </Field>
              ) : null}
              <Field label="Mobile number" error={shown('phone')} hint="Optional. Philippine mobile number, e.g. 912 345 6789.">
                <PhoneInput
                  digits={form.phone}
                  onChange={(digits) => {
                    setForm((p) => ({ ...p, phone: digits }));
                    setErrors((p) => ({ ...p, phone: undefined }));
                  }}
                />
              </Field>
              {/* Enter-to-save; the visible Save lives in the panel footer. */}
              <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
            </form>
          </section>

          <section>
            <SectionTitle>Security</SectionTitle>
            <div className="space-y-3">
              <TwoFactorCard profile={profile} />
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(245,158,11,0.16)', color: '#f59e0b' }}>
                      <KeyRound size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                        Password
                      </div>
                      <p className="text-[11px] text-secondary mt-0.5">Change the password you sign in with.</p>
                    </div>
                  </div>
                  <SmallButton onClick={onChangePassword}>Change</SmallButton>
                </div>
              </Card>
            </div>
          </section>
        </div>
      )}
    </SidePanel>
  );
}
