import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, FileText, X } from 'lucide-react';

/**
 * Opens a stored file (PDF or image) right on the page, in a pop-up — e.g. the
 * locator's DTI certificate or GIS on the Registration card. `url` serves the
 * file inline (?view=1); without it the same URL downloads.
 */
export function FilePreviewModal({
  open,
  url,
  title,
  subtitle,
  onClose,
}: {
  open: boolean;
  url: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const viewUrl = `${url}${url.includes('?') ? '&' : '?'}view=1`;
  const border = { borderColor: 'var(--input-border)' };

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,.55)' }} onClick={onClose} />
      <div
        className="relative z-10 flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={border}>
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={16} className="shrink-0" style={{ color: 'var(--text)' }} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold" style={{ color: 'var(--text)' }}>
                {title}
              </div>
              {subtitle ? <div className="truncate text-[11px] text-secondary">{subtitle}</div> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-[var(--selected-bg)]"
              style={{ ...border, color: 'var(--text)' }}
              title="Open in a new tab"
            >
              <ExternalLink size={12} /> New tab
            </a>
            <a
              href={url}
              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-[var(--selected-bg)]"
              style={{ ...border, color: 'var(--text)' }}
              title="Download"
            >
              <Download size={12} /> Download
            </a>
            <button type="button" className="ml-1 rounded-lg p-1.5 text-secondary hover:bg-[var(--hover-bg)]" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        <iframe title={title} src={viewUrl} className="min-h-0 w-full flex-1 border-0" style={{ backgroundColor: 'var(--control-bg)' }} />
      </div>
    </div>,
    document.body,
  );
}
