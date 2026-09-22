import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { toast } from 'sonner';

type ChangePasswordModalProps = {
  open: boolean;
  onClose: () => void;
};

function PasswordField({
  label,
  value,
  onChange,
  autoFocus,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  /** Shown under the field once the visitor has actually typed something —
   * surfacing "required"/"must match" before the first keystroke would just
   * read as the form yelling at someone who hasn't done anything yet. */
  error?: string | null;
}) {
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const showError = touched && error;
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-secondary">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          autoFocus={autoFocus}
          autoComplete={label === 'Current Password' ? 'current-password' : 'new-password'}
          className="app-input pr-9"
          style={{ borderColor: showError ? '#ef4444' : undefined }}
        />
        <button
          type="button"
          onClick={() => setShow((prev) => !prev)}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-[var(--text)] cursor-pointer"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {showError ? <p className="text-[10px] font-medium" style={{ color: '#ef4444' }}>{error}</p> : null}
    </label>
  );
}

function RequirementRow({ met, label }: { met: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-[10px]" style={{ color: met ? '#10b981' : 'var(--text-muted)' }}>
      {met ? <Check size={11} className="shrink-0" /> : <X size={11} className="shrink-0 opacity-50" />}
      {label}
    </li>
  );
}

export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const hasMinLength = newPassword.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const strengthOk = hasMinLength && hasLetter && hasNumber;
  const sameAsCurrent = Boolean(newPassword) && Boolean(currentPassword) && newPassword === currentPassword;
  const confirmMismatch = Boolean(confirmPassword) && confirmPassword !== newPassword;

  const currentPasswordError = null; // resolved server-side (we don't know the real one client-side)
  const newPasswordError = useMemo(() => {
    if (!newPassword) return 'New password is required.';
    if (!strengthOk) return 'Does not meet the requirements below.';
    if (sameAsCurrent) return 'Must be different from your current password.';
    return null;
  }, [newPassword, strengthOk, sameAsCurrent]);
  const confirmPasswordError = useMemo(() => {
    if (!confirmPassword) return 'Please confirm your new password.';
    if (confirmMismatch) return 'Does not match the new password.';
    return null;
  }, [confirmPassword, confirmMismatch]);

  const canSubmit =
    Boolean(currentPassword) && strengthOk && !sameAsCurrent && Boolean(confirmPassword) && !confirmMismatch;

  function reset() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }

  function handleClose() {
    if (saving) return;
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to change password');
      toast.success('Password updated.');
      reset();
      onClose();
    } catch (error: any) {
      // Server-side failures land here — wrong current password, a stale
      // session, etc. — things the form above genuinely can't know in advance.
      toast.error(error?.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center px-3">
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={handleClose}
          />
          <motion.div
            className="w-full max-w-sm rounded-2xl border p-4 sm:p-5 relative z-10"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              Change Password
            </h3>
            <p className="text-[11px] text-secondary mt-1">
              Use at least 8 characters, with a mix of letters and numbers.
            </p>

            <form className="mt-4 space-y-3" onSubmit={handleSubmit} noValidate>
              <PasswordField
                label="Current Password"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoFocus
                error={!currentPassword ? 'Current password is required.' : currentPasswordError}
              />

              <div>
                <PasswordField label="New Password" value={newPassword} onChange={setNewPassword} error={newPasswordError} />
                <ul className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
                  <RequirementRow met={hasMinLength} label="8+ characters" />
                  <RequirementRow met={hasLetter} label="Contains a letter" />
                  <RequirementRow met={hasNumber} label="Contains a number" />
                  <RequirementRow met={Boolean(newPassword) && !sameAsCurrent} label="Different from current" />
                </ul>
              </div>

              <PasswordField
                label="Confirm New Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                error={confirmPasswordError}
              />

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className={`rounded-lg px-3 py-2 text-sm font-semibold border ${
                    saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[var(--hover-bg)]'
                  }`}
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                  onClick={handleClose}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    saving || !canSubmit ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-90'
                  }`}
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  disabled={saving || !canSubmit}
                >
                  {saving ? 'Saving…' : 'Save Password'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
