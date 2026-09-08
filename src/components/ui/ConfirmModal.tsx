import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

type ConfirmModalProps = {
  open: boolean;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title = 'Please confirm',
  description = 'Are you sure you want to continue?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-3">
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={!loading ? onCancel : undefined}
          />
          <motion.div
            className="w-full max-w-md rounded-2xl border p-4 sm:p-5 relative z-10"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="space-y-2">
              <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                {title}
              </h3>
              <p className="text-xs text-secondary">{description}</p>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className={`rounded-lg px-3 py-2 text-sm font-semibold border ${
                  loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[var(--hover-bg)]'
                }`}
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                onClick={onCancel}
                disabled={loading}
              >
                {cancelText}
              </button>
              <button
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-90'
                }`}
                style={{
                  backgroundColor: danger ? '#dc2626' : 'var(--nav-active-bg)',
                  color: '#ffffff',
                }}
                onClick={onConfirm}
                disabled={loading}
              >
                {loading ? 'Processing…' : confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
