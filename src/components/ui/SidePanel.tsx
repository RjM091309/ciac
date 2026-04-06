import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

type SidePanelProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  widthClassName?: string;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  children: React.ReactNode;
};

export function SidePanel({
  open,
  title,
  subtitle,
  saving = false,
  saveDisabled = false,
  saveLabel = 'Save',
  widthClassName = 'max-w-[44rem]',
  onClose,
  onSave,
  children,
}: SidePanelProps) {
  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[60]">
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          />
          <div className="absolute inset-y-0 right-0 flex w-full justify-end p-0 sm:p-0">
            <motion.div
              className={`h-full w-full ${widthClassName} border-l p-4 sm:p-5 flex flex-col`}
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
              initial={{ x: 64, opacity: 0.98 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 64, opacity: 0.98 }}
              transition={{ duration: 0.24, ease: [0.22, 0.8, 0.35, 1] }}
            >
              <div className="flex items-start justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--input-border)' }}>
                <div>
                  <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                    {title}
                  </div>
                  {subtitle ? <div className="text-xs text-secondary mt-0.5">{subtitle}</div> : null}
                </div>
                <button
                  className={`rounded-lg px-2 py-1 text-xs border ${
                    saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                  onClick={onClose}
                  disabled={saving}
                >
                  Close
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4">{children}</div>

              <div className="border-t pt-3 flex items-center justify-end gap-2" style={{ borderColor: 'var(--input-border)' }}>
                <button
                  className={`rounded-lg px-3 py-2 text-sm font-semibold border ${
                    saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                  onClick={onClose}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    saving || saveDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                  style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                  onClick={onSave}
                  disabled={saving || saveDisabled}
                >
                  {saving ? 'Saving…' : saveLabel}
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
