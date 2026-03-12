import React from 'react';

export function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="shrink-0 mt-6 text-[11px] text-secondary">
      <div
        className="w-full rounded-2xl px-5 py-3 backdrop-blur-xl"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--surface) 85%, transparent)',
          boxShadow:
            '0 3px 10px rgba(0,0,0,0.10), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>© {year}</span>
            <span className="text-secondary">•</span>
            <span>v1.0.0</span>
          </div>

          <div
            className="h-7 px-3 rounded-full text-[10px] font-bold inline-flex items-center shimmer-badge"
            style={{
              backgroundColor: 'var(--badge-bg)',
              color: 'var(--nav-active-text)',
              boxShadow:
                '0 2px 6px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 70%, transparent)',
            }}
          >
            3CORE
          </div>
        </div>
      </div>
    </footer>
  );
}

