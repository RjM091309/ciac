import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Building2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

type FormState = {
  business_name: string;
  registration_no: string;
  tin: string;
  address: string;
  contact_no: string;
};

const EMPTY_FORM: FormState = {
  business_name: '',
  registration_no: '',
  tin: '',
  address: '',
  contact_no: '',
};

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-widest text-secondary">
        {label}
        {required ? <span style={{ color: 'var(--errorColor)' }}> *</span> : null}
      </label>
      {children}
    </div>
  );
}

/**
 * First-login wizard for a real Locator whose account has no linked business
 * profile yet — an officer/admin only creates the login account, never the
 * business record, so the locator declares it themselves here before the
 * portal (Dashboard, My Applications, etc.) unlocks. Full-screen, no
 * sidebar — same "can't proceed until this is done" framing as LoginPage's
 * MFA/force-password-change steps, just for this one extra thing.
 */
export function LocatorProfileSetup({ onComplete, onSkip }: { onComplete: () => void; onSkip: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(form.business_name.trim()) && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/proponents/me/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          business_name: form.business_name.trim(),
          registration_no: form.registration_no.trim() || null,
          tin: form.tin.trim() || null,
          address: form.address.trim() || null,
          contact_no: form.contact_no.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to save your business profile.');
      toast.success('Business profile saved — welcome to the portal.');
      onComplete();
    } catch (err: any) {
      setError(err?.message || 'Failed to save your business profile.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-xl"
      >
        <div
          className="rounded-2xl border p-6 sm:p-8"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
            >
              <ShieldCheck size={20} />
            </div>
            <span className="text-sm font-bold tracking-tight uppercase text-secondary">3core Portal Setup</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">One more step</h1>
          <p className="text-secondary mb-6">
            Tell us about your business — this becomes your locator profile, and it's what 3CORE uses to track your
            applications, contracts, and permits. Your dashboard opens as soon as this is saved.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Business name" required>
              <input
                autoFocus
                value={form.business_name}
                onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))}
                className="w-full rounded-md px-3 py-2.5 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                placeholder="e.g. SkyPort Logistics Inc."
                required
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Registration No.">
                <input
                  value={form.registration_no}
                  onChange={(e) => setForm((p) => ({ ...p, registration_no: e.target.value }))}
                  className="w-full rounded-md px-3 py-2.5 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                  style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                  placeholder="SEC / DTI registration no."
                />
              </Field>
              <Field label="TIN">
                <input
                  value={form.tin}
                  onChange={(e) => setForm((p) => ({ ...p, tin: e.target.value }))}
                  className="w-full rounded-md px-3 py-2.5 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                  style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                  placeholder="Tax identification number"
                />
              </Field>
            </div>

            <Field label="Business address">
              <input
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                className="w-full rounded-md px-3 py-2.5 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                placeholder="Street, city, province"
              />
            </Field>

            <Field label="Contact number">
              <input
                value={form.contact_no}
                onChange={(e) => setForm((p) => ({ ...p, contact_no: e.target.value }))}
                className="w-full rounded-md px-3 py-2.5 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
                style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
                placeholder="09XX XXX XXXX"
              />
            </Field>

            {error && (
              <p className="text-xs" style={{ color: 'var(--errorColor)' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full font-bold py-3.5 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-xl"
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
                  <Building2 size={18} />
                  Save &amp; continue to dashboard
                  <ArrowRight size={18} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onSkip}
              className="w-full text-center text-xs font-medium text-secondary hover:text-[var(--text)] transition-colors cursor-pointer py-1"
            >
              Skip for now — I'll fill this in later
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
