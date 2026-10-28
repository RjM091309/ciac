import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

/** Drag-and-drop (or click) box for one PDF; shows the PDF icon once chosen. */
export function PdfDropzone({
  file,
  onFile,
  disabled,
  what = 'the PDF',
}: {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
  /** Names the file in the prompts, e.g. "the signed PDF", "the letter". */
  what?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const take = (f: File | undefined | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      toast.error(`Upload ${what} as a PDF.`);
      return;
    }
    onFile(f);
  };
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={(e) => {
        // Moving onto the text inside the box isn't leaving it.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        'rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center justify-center gap-1.5 text-center transition-colors',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--control-bg)]/40'
      )}
      style={{
        borderColor: over ? 'var(--nav-active-bg)' : 'var(--border)',
        backgroundColor: over ? 'color-mix(in oklab, var(--nav-active-bg) 6%, transparent)' : undefined,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {file ? (
        <>
          <img src="/images/pdf.png" alt="" className="w-10 h-10" />
          <div className="text-[12px] font-semibold break-all" style={{ color: 'var(--text)' }}>
            {file.name}
          </div>
          <div className="text-[11px] text-secondary">
            {(file.size / 1024 / 1024).toFixed(2)} MB ·{' '}
            <button
              type="button"
              className="underline"
              onClick={(e) => {
                e.stopPropagation();
                onFile(null);
              }}
            >
              Remove
            </button>{' '}
            · click or drop to change
          </div>
        </>
      ) : (
        <>
          <Upload size={22} className="text-secondary" />
          <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
            Drop {what} here, or click to choose
          </div>
          <div className="text-[11px] text-secondary">PDF only</div>
        </>
      )}
    </div>
  );
}
