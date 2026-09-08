import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Copy, Eye, EyeOff, Moon, ShieldCheck, Smartphone, Sun } from 'lucide-react';

type Enrollment = { otpauthUrl: string; secret: string; qrDataUrl: string };

type LoginResult = {
  ok: boolean;
  user?: { id: number; username: string; role?: string };
  message?: string;
  mfaRequired?: boolean;
  enrollmentRequired?: boolean;
  enrollment?: Enrollment;
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
}): Promise<LoginResult> {
  const { backendUrl, username, password, token } = args;
  const res = await fetch(`${normalizeBaseUrl(backendUrl)}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      username,
      password,
      ...(token ? { token } : {}),
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
  };
}

const EMPTY_USER = { id: 0, username: '' };

export function LoginPage(props: { backendUrl: string; onLoggedIn: (user: { id: number; username: string; role?: string }) => void }) {
  const backend = useMemo(() => normalizeBaseUrl(props.backendUrl), [props.backendUrl]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return 'dark';
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'muted' | 'error' | 'success'; text: string }>({
    type: 'muted',
    text: '',
  });

  const step: 'credentials' | 'enroll' | 'mfa' = enrollment ? 'enroll' : mfaRequired ? 'mfa' : 'credentials';
  const codeStep = step === 'enroll' || step === 'mfa';

  React.useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  function resetToCredentials() {
    setMfaRequired(false);
    setEnrollment(null);
    setCode('');
    setMessage({ type: 'muted', text: '' });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage({ type: 'muted', text: '' });
    setSubmitting(true);
    try {
      const result = await loginRequest({
        backendUrl: backend,
        username: username.trim(),
        password,
        token: codeStep ? code.replace(/\D/g, '') : undefined,
      });

      if (!result.ok) {
        if (result.enrollmentRequired && result.enrollment) {
          setEnrollment(result.enrollment);
          setMfaRequired(false);
          setCode('');
        } else if (result.mfaRequired) {
          setMfaRequired(true);
          setEnrollment(null);
          setCode('');
        }
        setMessage({ type: 'error', text: result.message || 'Login failed.' });
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
        style={{
          backgroundColor: 'color-mix(in oklab, var(--surface) 78%, transparent)',
          color: 'var(--text)',
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
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: 'var(--nav-active-bg)',
              color: 'var(--nav-active-text)',
            }}
          >
            <ShieldCheck size={18} />
          </div>
          <span className="text-sm sm:text-base font-bold tracking-tight uppercase">3core Portal</span>
        </div>
      </div>

      <div
        className="hidden xl:flex xl:w-1/2 relative items-center justify-center p-12 overflow-hidden border-r"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[100px]" />
        </div>

        <div className="relative z-10 max-w-xl">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }}>
            <div className="flex items-center gap-3 mb-12">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  backgroundColor: 'var(--nav-active-bg)',
                  color: 'var(--nav-active-text)',
                }}
              >
                <ShieldCheck size={24} />
              </div>
              <span className="text-xl font-bold tracking-tighter uppercase">3core Portal</span>
            </div>

            <h1 className="text-4xl md:text-5xl xl:text-6xl 2xl:text-7xl font-bold leading-[0.9] tracking-tighter mb-8">
              LOCATOR <br />
              <span className="text-secondary">COMPLIANCE</span> <br />
              SYSTEM.
            </h1>

            <p className="text-lg text-secondary max-w-md leading-relaxed mb-10">
              Sign in securely to continue to your workspace and dashboard.
            </p>

            <div className="flex items-center gap-8">
              <div className="flex flex-col">
                <span className="text-3xl font-bold">24h</span>
                <span className="text-xs uppercase tracking-widest text-secondary">Session</span>
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
            3core • LOCATOR &amp; COMPLIANCE PORTAL
          </span>
        </div>
      </div>

      <div className="flex-1 grid place-items-center px-4 py-6 sm:px-8 sm:py-8 xl:p-24 relative">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-[420px] min-w-0 self-center"
        >
          <div className="mb-7 sm:mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2 sm:mb-3">
              {step === 'enroll' ? 'Set up two-factor' : 'Sign in'}
            </h2>
            <p className="text-secondary">
              {step === 'enroll'
                ? 'Add this account to your authenticator app to finish signing in.'
                : 'Welcome back to your workspace.'}
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5 sm:space-y-6" autoComplete="off">
            {step !== 'enroll' ? (
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
                    className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-sm focus:border-primary transition-all duration-300"
                    required
                    disabled={mfaRequired}
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
                      onClick={() => setMessage({ type: 'muted', text: 'Please contact the administrator.' })}
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
                      className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 pr-12 sm:pr-14 text-sm focus:border-primary transition-all duration-300"
                      required
                      disabled={mfaRequired}
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
                    className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-sm tracking-[0.4em] focus:border-primary transition-all duration-300"
                    required
                  />
                  {step === 'mfa' ? (
                    <p className="text-[11px] text-secondary ml-1">
                      Open your authenticator app and enter the current 6-digit code for 3CORE Portal.
                    </p>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <button
              type="submit"
              disabled={submitting}
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
                  ) : (
                    <>
                      Continue
                      <ArrowRight size={18} />
                    </>
                  )}
                </>
              )}
            </button>

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

        <div className="absolute bottom-4 sm:bottom-8 left-0 w-full flex justify-center gap-5 sm:gap-8 text-[9px] sm:text-[10px] uppercase tracking-[0.16em] sm:tracking-widest text-secondary opacity-50 xl:hidden">
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
