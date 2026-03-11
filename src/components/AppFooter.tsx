import React from 'react';

export function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="shrink-0 pb-6 mt-6 text-[11px] text-secondary">
      <div
        className="w-full rounded-2xl px-5 py-3 backdrop-blur-xl"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--surface) 65%, transparent)',
          boxShadow: '0 14px 50px rgba(0,0,0,0.45)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>© {year}</span>
            <span className="text-zinc-700">•</span>
            <span>v1.0.0</span>
          </div>

          <div
            className="h-7 px-3 rounded-full text-[10px] font-bold text-zinc-200 inline-flex items-center"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            }}
          >
            3CORE
          </div>
        </div>
      </div>
    </footer>
  );
}

