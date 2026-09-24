import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Mail, Moon, Smartphone, Sun } from 'lucide-react';
import { validatePassword } from '../../lib/passwordPolicy';

type Enrollment = { otpauthUrl: string; secret: string; qrDataUrl: string };

type LoginResult = {
  ok: boolean;
  user?: { id: number; username: string; role?: string };
  message?: string;
  mfaRequired?: boolean;
  enrollmentRequired?: boolean;
  enrollment?: Enrollment;
  mustChangePassword?: boolean;
};

type ThemeMode = 'light' | 'dark';

function normalizeBaseUrl(url: string) {
  return String(url || '').replace(/\/+$/, '');
}

async function loginRequest(args: {
  backendUrl: string;
  username: string;
  password: string;
  token?: string;
  newPassword?: string;
}): Promise<LoginResult> {
  const { backendUrl, username, password, token, newPassword } = args;
  const res = await fetch(`${normalizeBaseUrl(backendUrl)}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      username,
      password,
      ...(token ? { token } : {}),
      ...(newPassword ? { newPassword } : {}),
    }),
  });

  const json = await res.json().catch(() => ({} as any));
  if (res.ok && json?.success) {
    const u = json?.user || {};
    return { ok: true, user: { id: Number(u.id || 0), username: String(u.username || username), role: u.role } };
  }

  return {
    ok: false,
    message: String(json?.message || 'Login failed.'),
    mfaRequired: Boolean(json?.mfaRequired),
    enrollmentRequired: Boolean(json?.enrollmentRequired),
    enrollment: json?.enrollment,
    mustChangePassword: Boolean(json?.mustChangePassword),
  };
}

const EMPTY_USER = { id: 0, username: '' };

/** Abstract backdrop for the sign-in panel: concentric arcs (a bridge / radar
 * sweep) from the bottom-right, two flight-path curves, a fading dot grid and
 * soft orange/blue glows. White strokes at low opacity so it works on both
 * the light-mode navy and the dark theme's black. The dark tone drops the
 * colored glows (blue reads off-palette and orange turns muddy on black) for a
 * faint white one, keeping only the orange arc as an accent. Sits at z -1
 * inside the panel's `isolate` stacking context: above the panel background,
 * below the form. */
function SignInPanelBackdrop({ tone }: { tone: 'light' | 'dark' }) {
  const dark = tone === 'dark';
  const arcs = [240, 360, 480, 600, 720, 840, 960];
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden pointer-events-none select-none">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="signin-glow-orange" cx="0" cy="1" r="0.75">
            <stop offset="0" stopColor="#F7931E" stopOpacity="0.28" />
            <stop offset="1" stopColor="#F7931E" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="signin-glow-blue" cx="1" cy="0" r="0.8">
            <stop offset="0" stopColor={dark ? '#ffffff' : '#7C8CFF'} stopOpacity={dark ? 0.07 : 0.32} />
            <stop offset="1" stopColor="#7C8CFF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="signin-path-fade" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <pattern id="signin-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.2" fill="#ffffff" fillOpacity="0.22" />
          </pattern>
          <radialGradient id="signin-dots-fade" cx="0.15" cy="0.12" r="0.55">
            <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <mask id="signin-dots-mask">
            <rect width="800" height="1000" fill="url(#signin-dots-fade)" />
          </mask>
        </defs>

        <rect width="800" height="1000" fill="url(#signin-glow-blue)" />
        {!dark && <rect width="800" height="1000" fill="url(#signin-glow-orange)" />}
        <rect width="800" height="1000" fill="url(#signin-dots)" mask="url(#signin-dots-mask)" />

        {arcs.map((r, i) => (
          <circle
            key={r}
            cx="860"
            cy="1080"
            r={r}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.14 - i * 0.015}
            strokeWidth="1"
          />
        ))}
        {/* One arc picked out in the brand orange. */}
        <circle
          cx="860"
          cy="1080"
          r="480"
          fill="none"
          stroke="#F7931E"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeDasharray="120 2900"
          strokeDashoffset="-2150"
          strokeLinecap="round"
        />

        <path d="M -40 820 C 200 700, 380 420, 860 90" fill="none" stroke="url(#signin-path-fade)" strokeWidth="1.5" />
        <path
          d="M -40 900 C 260 800, 480 560, 860 300"
          fill="none"
          stroke="url(#signin-path-fade)"
          strokeWidth="1.2"
          strokeDasharray="2 10"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function LoginPage(props: {
  backendUrl: string;
  /** Present (and truthy) when the URL is an emailed reset link
   * (/reset-password?token=...) — forces straight into the resetPassword
   * step regardless of any in-progress login attempt. */
  resetToken?: string | null;
  /** Called once a reset link has been consumed (success or "start over"),
   * so App.tsx can drop ?token=... from the URL. */
  onResetHandled: () => void;
  /** Explanation for an automatic sign-out (e.g. idle timeout), shown until
   * the user does something else on this screen. */
  notice?: string | null;
  onLoggedIn: (user: { id: number; username: string; role?: string }) => void;
}) {
  const backend = useMemo(() => normalizeBaseUrl(props.backendUrl), [props.backendUrl]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // "Forgot password?" — request-a-link step, independent of the login
  // attempt state machine above (it never touches username/password).
  const [forgotStep, setForgotStep] = useState<'none' | 'email' | 'sent'>('none');
  const [forgotEmail, setForgotEmail] = useState('');

  // Completing an emailed reset link (props.resetToken present).
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return 'dark';
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'muted' | 'error' | 'success'; text: string }>(() =>
    props.notice ? { type: 'error', text: props.notice } : { type: 'muted', text: '' }
  );

  const step: 'credentials' | 'enroll' | 'mfa' | 'forceChangePassword' | 'forgotEmail' | 'forgotSent' | 'resetPassword' =
    props.resetToken
      ? 'resetPassword'
      : forgotStep === 'email'
        ? 'forgotEmail'
        : forgotStep === 'sent'
          ? 'forgotSent'
          : mustChangePassword
            ? 'forceChangePassword'
            : enrollment
              ? 'enroll'
              : mfaRequired
                ? 'mfa'
                : 'credentials';
  const codeStep = step === 'enroll' || step === 'mfa';
  const newPasswordError = newPassword ? validatePassword(newPassword) : null;
  const canSubmitNewPassword =
    Boolean(newPassword) && !newPasswordError && newPassword === confirmNewPassword;

  const resetPasswordError = resetNewPassword ? validatePassword(resetNewPassword) : null;
  const canSubmitReset =
    Boolean(resetNewPassword) && !resetPasswordError && resetNewPassword === confirmResetPassword;

  React.useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  function resetToCredentials() {
    setMfaRequired(false);
    setEnrollment(null);
    setMustChangePassword(false);
    setNewPassword('');
    setConfirmNewPassword('');
    setCode('');
    setForgotStep('none');
    setForgotEmail('');
    setMessage({ type: 'muted', text: '' });
  }

  /** Leaves the "forgot password" flow entirely, back to the credentials
   * form — including dropping ?token=... from the URL when the visitor
   * arrived via an emailed reset link, so a page refresh doesn't dump them
   * back into resetPassword. */
  function backToSignIn() {
    resetToCredentials();
    if (props.resetToken) props.onResetHandled();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (step === 'forgotEmail') {
      if (!forgotEmail.trim()) return;
      setMessage({ type: 'muted', text: '' });
      setSubmitting(true);
      try {
        const res = await fetch(`${backend}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: forgotEmail.trim() }),
        });
        const json = await res.json().catch(() => ({} as any));
        if (!res.ok || !json?.success) throw new Error(json?.message || 'Something went wrong. Please try again.');
        setForgotStep('sent');
      } catch (err: any) {
        setMessage({ type: 'error', text: err?.message || 'Something went wrong. Please try again.' });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (step === 'resetPassword') {
      if (!canSubmitReset || !props.resetToken) return;
      setMessage({ type: 'muted', text: '' });
      setSubmitting(true);
      try {
        const res = await fetch(`${backend}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token: props.resetToken, newPassword: resetNewPassword }),
        });
        const json = await res.json().catch(() => ({} as any));
        if (!res.ok || !json?.success) throw new Error(json?.message || 'This reset link is invalid or has expired.');
        setResetDone(true);
      } catch (err: any) {
        setMessage({ type: 'error', text: err?.message || 'This reset link is invalid or has expired.' });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (step === 'forceChangePassword' && !canSubmitNewPassword) return;
    setMessage({ type: 'muted', text: '' });
    setSubmitting(true);
    // Captured before state updates below: true only when the user was already
    // being shown the code field or force-change form (i.e. this submit is a
    // retry), so a first-time transition into enroll/mfa/forceChangePassword
    // isn't mistaken for a failed attempt.
    const wasCodeStep = codeStep;
    const wasForceChangeStep = step === 'forceChangePassword';
    try {
      const result = await loginRequest({
        backendUrl: backend,
        username: username.trim(),
        password,
        token: codeStep ? code.replace(/\D/g, '') : undefined,
        newPassword: step === 'forceChangePassword' ? newPassword : undefined,
      });

      if (!result.ok) {
        // The force-change request just replaced this account's real
        // password in the DB with `newPassword` — if it wasn't rejected for
        // a password reason, every request from here on (the TOTP code
        // included) must authenticate with that new password, not the old
        // temp one still sitting in `password` state.
        if (wasForceChangeStep && !result.mustChangePassword) {
          setPassword(newPassword);
        }
        if (result.mustChangePassword) {
          setMustChangePassword(true);
          setMfaRequired(false);
          setEnrollment(null);
          setCode('');
        } else if (result.enrollmentRequired && result.enrollment) {
          setEnrollment(result.enrollment);
          setMfaRequired(false);
          setMustChangePassword(false);
          setCode('');
        } else if (result.mfaRequired) {
          setMfaRequired(true);
          setEnrollment(null);
          setMustChangePassword(false);
          setCode('');
        }
        const isStepPrompt =
          !wasCodeStep && !wasForceChangeStep && (result.enrollmentRequired || result.mfaRequired || result.mustChangePassword);
        setMessage({
          type: isStepPrompt ? 'muted' : 'error',
          text: result.message || 'Login failed.',
        });
        return;
      }

      setMessage({ type: 'success', text: 'Login successful. Redirecting…' });
      props.onLoggedIn(result.user || EMPTY_USER);
    } catch {
      setMessage({ type: 'error', text: 'Login error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  // The brand artwork has black lettering; the dark theme uses a variant with
  // the lettering recolored white (the orange mark is unchanged).
  const brandSrc = theme === 'dark' ? '/images/ciac-brand-white.png' : '/images/ciac-brand.png';

  const messageColor =
    message.type === 'error'
      ? 'var(--errorColor)'
      : message.type === 'success'
        ? 'var(--trend-growth)'
        : 'var(--text-secondary)';

  return (
    <div
      className="min-h-screen flex flex-col xl:flex-row overflow-x-hidden transition-all duration-300"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <button
        onClick={() => setTheme((p) => (p === 'dark' ? 'light' : 'dark'))}
        className="fixed top-3 right-3 sm:top-4 sm:right-4 xl:top-6 xl:right-6 p-2.5 sm:p-3 rounded-full control-btn touch-target z-50 backdrop-blur-md"
        // In light mode this always sits over navy (the mobile header, or the
        // sign-in panel on the split layout), so it goes white-on-navy there.
        style={{
          backgroundColor:
            theme === 'light' ? 'rgba(255, 255, 255, 0.12)' : 'color-mix(in oklab, var(--surface) 78%, transparent)',
          color: theme === 'light' ? '#ffffff' : 'var(--text)',
          border: 'none',
          boxShadow: 'none',
        }}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        type="button"
      >
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div
        className="xl:hidden w-full border-b px-4 sm:px-6 py-4 sm:py-5 pr-16 sm:pr-20"
        // Light mode: same navy as the sign-in panel below it, so the header
        // and form read as one block. Dark background on both themes, so the
        // black-only CIAC logo is always inverted to white here.
        style={
          theme === 'light'
            ? { backgroundColor: '#282974', borderColor: 'rgba(255, 255, 255, 0.12)' }
            : { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }
        }
      >
        <img
          src="/images/ciac-logo-black.png"
          alt="CIAC — Clark International Airport Corporation"
          className="h-10 sm:h-11 w-auto"
          style={{ filter: 'invert(1)' }}
        />
      </div>

      <div
        className="hidden xl:flex xl:w-1/2 relative items-center justify-center p-12 overflow-hidden border-r"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Photo background washed out by a surface-colored fade: heaviest
            behind the headline, thinning toward the bottom so the building
            shows through. Uses --surface so it's a white tint in light mode
            and a dark one in dark mode. */}
        <div
          className="absolute inset-0 bg-cover bg-center pointer-events-none"
          style={{ backgroundImage: "url('/images/leftside-panel-bg.jpg')" }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, color-mix(in oklab, var(--surface) 92%, transparent) 0%, color-mix(in oklab, var(--surface) 82%, transparent) 55%, color-mix(in oklab, var(--surface) 45%, transparent) 100%)',
          }}
        />

        <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[100px]" />
        </div>

        <img
          src="/images/ciac-logo-black.png"
          alt="CIAC — Clark International Airport Corporation"
          className="absolute top-8 left-8 2xl:top-10 2xl:left-10 z-10 h-14 2xl:h-16 w-auto pointer-events-none select-none"
          // Black-only artwork: flip it to white on the dark theme.
          style={theme === 'dark' ? { filter: 'invert(1)' } : undefined}
        />

        <img
          src={brandSrc}
          alt="Clark Aviation Capital"
          className="absolute bottom-8 right-8 2xl:bottom-10 2xl:right-10 z-10 w-[220px] 2xl:w-[260px] opacity-60 pointer-events-none select-none"
        />

        <div className="relative z-10 max-w-xl">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }}>
            <h1 className="mb-8">
              <span
                className="block text-5xl md:text-6xl xl:text-7xl 2xl:text-8xl font-bold leading-[0.9] tracking-tighter"
                // Same navy as the light-mode sign-in panel.
                style={theme === 'light' ? { color: '#282974' } : undefined}
              >
                BRIDGE+
              </span>
              <span className="block mt-5 text-xl xl:text-2xl 2xl:text-3xl font-semibold leading-snug tracking-tight text-secondary">
                Business Registration &amp; Information Digital Gateway for Enterprises Plus
              </span>
            </h1>

            <p className="text-lg text-secondary max-w-md leading-relaxed mb-10">
              Sign in securely to continue to your workspace and dashboard.
            </p>

            <div className="flex items-center gap-8">
              <div className="flex flex-col">
                <span className="text-3xl font-bold">15m</span>
                <span className="text-xs uppercase tracking-widest text-secondary">Idle timeout</span>
              </div>
              <div className="w-px h-10 bg-border" />
              <div className="flex flex-col">
                <span className="text-3xl font-bold">2FA</span>
                <span className="text-xs uppercase tracking-widest text-secondary">Authenticator app</span>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden xl:block">
          <span className="writing-mode-vertical text-[10px] uppercase tracking-[0.4em] text-secondary opacity-50 rotate-180">
            CIAC • LOCATOR &amp; COMPLIANCE PORTAL
          </span>
        </div>
      </div>

      <div
        className="flex-1 flex flex-col items-center justify-center px-4 py-6 sm:px-8 sm:py-8 xl:p-24 relative isolate"
        // Light mode only: navy panel, with the theme tokens re-scoped so text,
        // inputs and the submit button stay legible on the dark background.
        style={
          theme === 'light'
            ? ({
            backgroundColor: '#282974',
            color: '#ffffff',
            '--text': '#ffffff',
            '--foreground': '#ffffff',
            '--text-secondary': 'rgba(255, 255, 255, 0.72)',
            '--input-bg': 'rgba(255, 255, 255, 0.08)',
            '--input-border': 'rgba(255, 255, 255, 0.22)',
            '--nav-active-bg': '#ffffff',
            '--nav-active-text': '#282974',
          } as React.CSSProperties)
            : undefined
        }
      >
        <SignInPanelBackdrop tone={theme} />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-[420px] min-w-0"
        >
          <div className="mb-7 sm:mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2 sm:mb-3">
              {step === 'enroll'
                ? 'Set up two-factor'
                : step === 'forceChangePassword'
                  ? 'Set a new password'
                  : step === 'forgotEmail'
                    ? 'Reset your password'
                    : step === 'forgotSent'
                      ? 'Check your email'
                      : step === 'resetPassword'
                        ? resetDone
                          ? 'Password updated'
                          : 'Set a new password'
                        : 'Sign in'}
            </h2>
            <p className="text-secondary">
              {step === 'enroll'
                ? 'Add this account to your authenticator app to finish signing in.'
                : step === 'forceChangePassword'
                  ? 'Your password was reset by an administrator. Choose a new one to continue.'
                  : step === 'forgotEmail'
                    ? "Enter the email on your account and we'll send you a link to reset your password."
                    : step === 'forgotSent'
                      ? `We've sent a password reset link to ${forgotEmail}. It expires in 30 minutes.`
                      : step === 'resetPassword'
                        ? resetDone
                          ? 'You can now sign in with your new password.'
                          : 'Choose a new password for your account.'
                        : 'Welcome back to your workspace.'}
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5 sm:space-y-6" autoComplete="off">
            {step === 'credentials' || step === 'mfa' || step === 'forceChangePassword' ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="username">
                      Username
                    </label>
                  </div>
                  <input
                    id="username"
                    type="text"
                    placeholder="your.username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setMfaRequired(false);
                    }}
                    className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-base sm:text-sm focus:border-primary transition-all duration-300"
                    required
                    disabled={mfaRequired || mustChangePassword}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="password">
                      Password
                    </label>
                    <button
                      type="button"
                      className="text-xs font-medium text-secondary hover:text-primary transition-colors cursor-pointer"
                      onClick={() => {
                        setForgotEmail(username.includes('@') ? username : '');
                        setMessage({ type: 'muted', text: '' });
                        setForgotStep('email');
                      }}
                    >
                      Forgot?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setMfaRequired(false);
                      }}
                      className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 pr-12 sm:pr-14 text-base sm:text-sm focus:border-primary transition-all duration-300"
                      required
                      disabled={mfaRequired || mustChangePassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      className="absolute right-2.5 sm:right-4 top-1/2 -translate-y-1/2 text-secondary hover:text-primary transition-colors p-2 cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            <AnimatePresence>
              {step === 'enroll' && enrollment ? (
                <motion.div
                  key="enroll"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="space-y-4"
                >
                  <ol className="text-[13px] text-secondary space-y-1.5 list-decimal ml-4">
                    <li>
                      On this phone, tap{' '}
                      <a href={enrollment.otpauthUrl} className="font-semibold underline" style={{ color: 'var(--text)' }}>
                        Add to Authenticator
                      </a>
                      {' '}— or scan the QR from another device.
                    </li>
                    <li>Enter the 6-digit code the app shows below.</li>
                  </ol>

                  <div className="flex flex-col items-center gap-3">
                    <img
                      src={enrollment.qrDataUrl}
                      alt="Authenticator QR code"
                      className="w-40 h-40 rounded-lg bg-white p-2"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(enrollment.secret).then(
                          () => setMessage({ type: 'muted', text: 'Setup key copied.' }),
                          () => setMessage({ type: 'error', text: 'Copy failed.' }),
                        );
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono break-all cursor-pointer"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      title="Copy setup key"
                    >
                      <Copy size={12} className="shrink-0" />
                      {enrollment.secret}
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {codeStep ? (
                <motion.div
                  key="code"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="auth-code">
                      Authenticator code
                    </label>
                    <button
                      type="button"
                      className="text-xs font-medium text-secondary hover:text-primary transition-colors cursor-pointer"
                      onClick={resetToCredentials}
                    >
                      Start over
                    </button>
                  </div>
                  <input
                    id="auth-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-base sm:text-sm tracking-[0.4em] focus:border-primary transition-all duration-300"
                    required
                  />
                  {step === 'mfa' ? (
                    <p className="text-[11px] text-secondary ml-1">
                      {/* Enrollments before the rebrand were issued as "3CORE Portal"
                          (server/lib/totp.js), and authenticator apps keep that label. */}
                      Open your authenticator app and enter the current 6-digit code for CIAC Portal (shown as
                      3CORE Portal if you set up 2FA before the name change).
                    </p>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {step === 'forceChangePassword' ? (
                <motion.div
                  key="force-change-password"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="new-password">
                        New password
                      </label>
                      <button
                        type="button"
                        className="text-xs font-medium text-secondary hover:text-primary transition-colors cursor-pointer"
                        onClick={resetToCredentials}
                      >
                        Start over
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="new-password"
                        type={showNewPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 pr-12 sm:pr-14 text-base sm:text-sm focus:border-primary transition-all duration-300"
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((p) => !p)}
                        className="absolute right-2.5 sm:right-4 top-1/2 -translate-y-1/2 text-secondary hover:text-primary transition-colors p-2 cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
                        aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      >
                        {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <p className="text-[11px] ml-1" style={{ color: newPasswordError ? 'var(--errorColor)' : 'var(--text-secondary)' }}>
                      {newPasswordError || 'At least 8 characters, with a letter and a number.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-secondary ml-1" htmlFor="confirm-new-password">
                      Confirm new password
                    </label>
                    <input
                      id="confirm-new-password"
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-base sm:text-sm focus:border-primary transition-all duration-300"
                      required
                    />
                    {confirmNewPassword && confirmNewPassword !== newPassword ? (
                      <p className="text-[11px] ml-1" style={{ color: 'var(--errorColor)' }}>
                        Passwords don't match.
                      </p>
                    ) : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {step === 'forgotEmail' ? (
                <motion.div
                  key="forgot-email"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="forgot-email">
                      Email
                    </label>
                    <button
                      type="button"
                      className="text-xs font-medium text-secondary hover:text-primary transition-colors cursor-pointer"
                      onClick={backToSignIn}
                    >
                      Back to sign in
                    </button>
                  </div>
                  <input
                    id="forgot-email"
                    type="email"
                    placeholder="you@example.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-base sm:text-sm focus:border-primary transition-all duration-300"
                    required
                    autoFocus
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {step === 'forgotSent' ? (
                <motion.div
                  key="forgot-sent"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex flex-col items-center gap-4 py-2 text-center"
                >
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'color-mix(in oklab, var(--nav-active-bg) 14%, transparent)', color: 'var(--nav-active-bg)' }}
                  >
                    <Mail size={24} />
                  </div>
                  <p className="text-[13px] text-secondary">
                    Didn't get it? Check your spam folder, or{' '}
                    <button
                      type="button"
                      className="font-semibold underline cursor-pointer"
                      style={{ color: 'var(--text)' }}
                      onClick={() => setForgotStep('email')}
                    >
                      try again
                    </button>
                    .
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {step === 'resetPassword' && !resetDone ? (
                <motion.div
                  key="reset-password"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-secondary ml-1" htmlFor="reset-new-password">
                      New password
                    </label>
                    <div className="relative">
                      <input
                        id="reset-new-password"
                        type={showResetPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 pr-12 sm:pr-14 text-base sm:text-sm focus:border-primary transition-all duration-300"
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPassword((p) => !p)}
                        className="absolute right-2.5 sm:right-4 top-1/2 -translate-y-1/2 text-secondary hover:text-primary transition-colors p-2 cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
                        aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                      >
                        {showResetPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <p className="text-[11px] ml-1" style={{ color: resetPasswordError ? 'var(--errorColor)' : 'var(--text-secondary)' }}>
                      {resetPasswordError || 'At least 8 characters, with a letter and a number.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-secondary ml-1" htmlFor="reset-confirm-password">
                      Confirm new password
                    </label>
                    <input
                      id="reset-confirm-password"
                      type={showResetPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={confirmResetPassword}
                      onChange={(e) => setConfirmResetPassword(e.target.value)}
                      className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-base sm:text-sm focus:border-primary transition-all duration-300"
                      required
                    />
                    {confirmResetPassword && confirmResetPassword !== resetNewPassword ? (
                      <p className="text-[11px] ml-1" style={{ color: 'var(--errorColor)' }}>
                        Passwords don't match.
                      </p>
                    ) : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {step === 'resetPassword' && resetDone ? (
                <motion.div
                  key="reset-done"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex flex-col items-center gap-3 py-2 text-center"
                >
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'color-mix(in oklab, #10b981 16%, transparent)', color: '#10b981' }}
                  >
                    <CheckCircle2 size={26} />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {step === 'forgotSent' || (step === 'resetPassword' && resetDone) ? (
              <button
                type="button"
                onClick={backToSignIn}
                className="w-full font-bold py-3.5 sm:py-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-xl min-h-[48px] cursor-pointer"
                style={{
                  backgroundColor: 'var(--nav-active-bg)',
                  color: 'var(--nav-active-text)',
                  boxShadow: '0 10px 30px color-mix(in oklab, var(--nav-active-bg) 30%, transparent)',
                }}
              >
                <ArrowLeft size={18} />
                Back to sign in
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  submitting ||
                  (step === 'forceChangePassword' && !canSubmitNewPassword) ||
                  (step === 'forgotEmail' && !forgotEmail.trim()) ||
                  (step === 'resetPassword' && !canSubmitReset)
                }
                className="w-full font-bold py-3.5 sm:py-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed shadow-xl min-h-[48px]"
                style={{
                  backgroundColor: 'var(--nav-active-bg)',
                  color: 'var(--nav-active-text)',
                  boxShadow: '0 10px 30px color-mix(in oklab, var(--nav-active-bg) 30%, transparent)',
                }}
              >
                {submitting ? (
                  <div
                    className="w-5 h-5 border-2 rounded-full animate-spin"
                    style={{
                      borderColor: 'color-mix(in oklab, var(--nav-active-text) 35%, transparent)',
                      borderTopColor: 'var(--nav-active-text)',
                    }}
                  />
                ) : (
                  <>
                    {step === 'enroll' ? (
                      <>
                        <Smartphone size={18} />
                        Verify &amp; finish setup
                      </>
                    ) : step === 'mfa' ? (
                      <>
                        Verify &amp; continue
                        <ArrowRight size={18} />
                      </>
                    ) : step === 'forceChangePassword' ? (
                      <>
                        <KeyRound size={18} />
                        Set password &amp; continue
                      </>
                    ) : step === 'forgotEmail' ? (
                      <>
                        <Mail size={18} />
                        Send reset link
                      </>
                    ) : step === 'resetPassword' ? (
                      <>
                        <KeyRound size={18} />
                        Reset password
                      </>
                    ) : (
                      <>
                        Continue
                        <ArrowRight size={18} />
                      </>
                    )}
                  </>
                )}
              </button>
            )}

            <div className="min-h-5">
              <span className="text-xs" style={{ color: messageColor }} role="status" aria-live="polite">
                {message.text}
              </span>
            </div>
          </form>

          <p className="mt-8 sm:mt-12 text-center text-[10px] uppercase tracking-[0.2em] text-secondary opacity-60">
            Protected by HTTP-only cookies
          </p>
        </motion.div>

        <div className="w-full mt-8 sm:mt-10 flex justify-center gap-5 sm:gap-8 text-[9px] sm:text-[10px] uppercase tracking-[0.16em] sm:tracking-widest text-secondary opacity-50 xl:hidden">
          <button type="button" className="hover:opacity-80" onClick={() => setMessage({ type: 'muted', text: 'Privacy policy not configured.' })}>
            Privacy
          </button>
          <button type="button" className="hover:opacity-80" onClick={() => setMessage({ type: 'muted', text: 'Terms not configured.' })}>
            Terms
          </button>
          <button type="button" className="hover:opacity-80" onClick={() => setMessage({ type: 'muted', text: 'Support not configured.' })}>
            Support
          </button>
        </div>
      </div>
    </div>
  );
}
