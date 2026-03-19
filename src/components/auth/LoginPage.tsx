import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Eye, EyeOff, Moon, ShieldCheck, Sun } from 'lucide-react';

type LoginResult =
  | { ok: true; user: { id: number; username: string; role?: string } }
  | { ok: false; message: string };

type LoginTab = 'password' | 'otp';

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
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'muted' | 'error' | 'success'; text: string }>({
    type: 'muted',
    text: '',
  });

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

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
    <div className="min-h-screen flex flex-col lg:flex-row bg-background text-foreground overflow-hidden">
      <button
        onClick={() => setIsDarkMode((p) => !p)}
        className="fixed top-6 right-6 p-3 rounded-full control-btn touch-target z-50 backdrop-blur-md bg-surface/50"
        aria-label="Toggle theme"
        type="button"
      >
        {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div className="hidden lg:flex lg:w-1/2 relative bg-surface items-center justify-center p-12 overflow-hidden border-r border-border">
        <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[100px]" />
        </div>

        <div className="relative z-10 max-w-xl">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }}>
            <div className="flex items-center gap-3 mb-12">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                <ShieldCheck className="text-background" size={24} />
              </div>
              <span className="text-xl font-bold tracking-tighter uppercase">CIAC Portal</span>
            </div>

            <h1 className="text-6xl xl:text-7xl font-bold leading-[0.9] tracking-tighter mb-8">
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

      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 lg:p-24 relative">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-[420px]"
        >
          <div className="mb-10">
            <h2 className="text-4xl font-bold tracking-tight mb-3">Sign in</h2>
            <p className="text-secondary">Welcome back to your workspace.</p>
          
          </div>

          <div className="mb-6">
            <div className="control-btn p-1 rounded-xl flex">
              <button
                type="button"
                onClick={() => {
                  setTab('password');
                  setMessage({ type: 'muted', text: '' });
                }}
                className={[
                  'flex-1 rounded-lg py-2 text-[11px] font-bold uppercase tracking-widest transition-all',
                  tab === 'password' ? 'bg-primary text-background' : 'text-secondary hover:text-primary',
                ].join(' ')}
              >
                Password
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
                className={[
                  'flex-1 rounded-lg py-2 text-[11px] font-bold uppercase tracking-widest transition-all',
                  tab === 'otp' ? 'bg-primary text-background' : 'text-secondary hover:text-primary',
                ].join(' ')}
              >
                OTP
              </button>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-6" autoComplete="off">
            {tab === 'password' ? (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-secondary ml-1" htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  placeholder="your.username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field w-full px-5 py-4 text-sm focus:border-primary transition-all duration-300"
                  required
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-secondary ml-1" htmlFor="otp-target">
                  Email or Mobile
                </label>
                <input
                  id="otp-target"
                  type="text"
                  placeholder="name@ciac.gov.ph or +63..."
                  value={otpTarget}
                  onChange={(e) => setOtpTarget(e.target.value)}
                  className="input-field w-full px-5 py-4 text-sm focus:border-primary transition-all duration-300"
                  required
                />
              </div>
            )}

            {tab === 'password' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="password">
                    Password
                  </label>
                  <button
                    type="button"
                    className="text-xs font-medium text-secondary hover:text-primary transition-colors"
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
                    className="input-field w-full px-5 py-4 pr-14 text-sm focus:border-primary transition-all duration-300"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary hover:text-primary transition-colors p-2"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            {tab === 'otp' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-xs font-bold uppercase tracking-widest text-secondary" htmlFor="otp">
                    One-time password
                  </label>
                  <button
                    type="button"
                    className="text-xs font-medium text-secondary hover:text-primary transition-colors"
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
                  className="input-field w-full px-5 py-4 text-sm focus:border-primary transition-all duration-300"
                  required
                />
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary text-background font-bold py-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed shadow-xl shadow-primary/10"
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
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

          <p className="mt-12 text-center text-[10px] uppercase tracking-[0.2em] text-secondary opacity-60">
            Protected by HTTP-only cookies
          </p>
        </motion.div>

        <div className="absolute bottom-8 left-0 w-full flex justify-center gap-8 text-[10px] uppercase tracking-widest text-secondary opacity-50 lg:hidden">
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

