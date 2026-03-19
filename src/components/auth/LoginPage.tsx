import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Eye, EyeOff, Moon, ShieldCheck, Sun } from 'lucide-react';

type LoginResult =
  | { ok: true; user: { id: number; username: string; role?: string } }
  | { ok: false; message: string };

type LoginTab = 'password' | 'otp';
type ThemeMode = 'light' | 'dark';

function normalizeBaseUrl(url: string) {
  return String(url || '').replace(/\/+$/, '');
}

async function loginRequest(args: {
  backendUrl: string;
  username: string;
  password: string;
}): Promise<LoginResult> {
  const { backendUrl, username, password } = args;
  const res = await fetch(`${normalizeBaseUrl(backendUrl)}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      username,
      password,
    }),
  });

  const json = await res.json().catch(() => ({} as any));
  if (res.ok && json?.success) {
    const u = json?.user || {};
    return { ok: true, user: { id: Number(u.id || 0), username: String(u.username || username), role: u.role } };
  }

  return { ok: false, message: String(json?.message || 'Login failed.') };
}

export function LoginPage(props: { backendUrl: string; onLoggedIn: (user: { id: number; username: string; role?: string }) => void }) {
  const backend = useMemo(() => normalizeBaseUrl(props.backendUrl), [props.backendUrl]);

  const [tab, setTab] = useState<LoginTab>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpTarget, setOtpTarget] = useState('');
  const [otp, setOtp] = useState('');
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

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage({ type: 'muted', text: '' });
    setSubmitting(true);
    try {
      if (tab === 'otp') {
        if (!otpTarget.trim()) {
          setMessage({ type: 'error', text: 'Email or mobile is required.' });
          return;
        }
        setMessage({ type: 'error', text: 'OTP login is not wired to the server yet.' });
        return;
      }
      const result = await loginRequest({ backendUrl: backend, username: username.trim(), password });
      if (!result.ok) {
        setMessage({ type: 'error', text: ('message' in result ? result.message : 'Login failed.') as string });
        return;
      }
      setMessage({ type: 'success', text: 'Login successful. Redirecting…' });
      props.onLoggedIn(result.user);
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
          <span className="text-sm sm:text-base font-bold tracking-tight uppercase">CIAC Portal</span>
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
              <span className="text-xl font-bold tracking-tighter uppercase">CIAC Portal</span>
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
                <span className="text-3xl font-bold">JWT</span>
                <span className="text-xs uppercase tracking-widest text-secondary">HTTP-only cookie</span>
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

      <div className="flex-1 grid place-items-center px-4 py-6 sm:px-8 sm:py-8 xl:p-24 relative">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-[420px] min-w-0 self-center"
        >
          <div className="mb-7 sm:mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2 sm:mb-3">Sign in</h2>
            <p className="text-secondary">Welcome back to your workspace.</p>
          
          </div>

          <div className="mb-5 sm:mb-6">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => {
                  setTab('password');
                  setMessage({ type: 'muted', text: '' });
                }}
                className="relative rounded-lg px-2.5 sm:px-3 py-2.5 text-[12px] sm:text-[14px] leading-tight font-semibold tracking-tight transition-colors cursor-pointer min-h-[44px]"
                style={{
                  color: tab === 'password' ? 'var(--text)' : 'var(--text-secondary)',
                }}
              >
                Password Login
                <span
                  className="pointer-events-none absolute left-2 right-2 -bottom-[1px] h-[2px] rounded-full transition-opacity"
                  style={{
                    opacity: tab === 'password' ? 1 : 0,
                    backgroundColor: 'var(--text)',
                  }}
                />
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('otp');
                  setPassword('');
                  setShowPassword(false);
                  setUsername('');
                  setMessage({ type: 'muted', text: '' });
                }}
                className="relative rounded-lg px-2.5 sm:px-3 py-2.5 text-[12px] sm:text-[14px] leading-tight font-semibold tracking-tight transition-colors cursor-pointer min-h-[44px]"
                style={{
                  color: tab === 'otp' ? 'var(--text)' : 'var(--text-secondary)',
                }}
              >
                Verification Code Login
                <span
                  className="pointer-events-none absolute left-2 right-2 -bottom-[1px] h-[2px] rounded-full transition-opacity"
                  style={{
                    opacity: tab === 'otp' ? 1 : 0,
                    backgroundColor: 'var(--text)',
                  }}
                />
              </button>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-5 sm:space-y-6" autoComplete="off">
            <AnimatePresence mode="wait">
              {tab === 'password' ? (
                <motion.div
                  key="tab-password"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="space-y-2"
                >
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
                      onChange={(e) => setUsername(e.target.value)}
                      className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-sm focus:border-primary transition-all duration-300"
                      required
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
                        onChange={(e) => setPassword(e.target.value)}
                        className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 pr-12 sm:pr-14 text-sm focus:border-primary transition-all duration-300"
                        required
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
                </motion.div>
              ) : (
                <motion.div
                  key="tab-otp"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="space-y-2"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="otp-target">
                        Email or Mobile
                      </label>
                    </div>
                    <input
                      id="otp-target"
                      type="text"
                      placeholder="name@ciac.gov.ph or +63..."
                      value={otpTarget}
                      onChange={(e) => setOtpTarget(e.target.value)}
                      className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-sm focus:border-primary transition-all duration-300"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="otp">
                        One-time password
                      </label>
                      <button
                        type="button"
                        className="text-xs font-medium text-secondary hover:text-primary transition-colors cursor-pointer"
                        onClick={() => {
                          if (!otpTarget.trim()) {
                            setMessage({ type: 'error', text: 'Enter email or mobile first.' });
                            return;
                          }
                          setMessage({ type: 'muted', text: 'OTP request endpoint not implemented yet.' });
                        }}
                      >
                        Send code
                      </button>
                    </div>
                    <input
                      id="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="input-field w-full px-4 sm:px-5 py-3.5 sm:py-4 text-sm focus:border-primary transition-all duration-300"
                      required
                    />
                  </div>
                </motion.div>
              )}
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
                  Continue
                  <ArrowRight size={18} />
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

