import React from 'react';
import { Bell, ChevronRight, Moon, Search, SunMedium, Zap } from 'lucide-react';

export function AppHeader({
  onToggleSidebar,
  theme,
  onToggleTheme,
}: {
  onToggleSidebar: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  return (
    <header className="shrink-0 px-2 sm:px-4 pt-2 sm:pt-3 mb-2">
      <div
        className="min-h-12 sm:min-h-14 rounded-xl sm:rounded-2xl backdrop-blur-xl px-3 sm:px-4 md:px-5 flex items-center justify-between gap-2 sm:gap-3 flex-nowrap"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--surface) 65%, transparent)',
          boxShadow:
            '0 10px 24px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 65%, transparent)',
        }}
      >
        {/* Left: hamburger + logo */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            className="h-10 w-10 sm:h-9 sm:w-9 rounded-full flex flex-col items-center justify-center gap-[3px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
          </button>

          <div
            className="p-1 rounded-lg shadow-sm shrink-0"
            style={{
              backgroundImage: 'var(--greeting-gradient)',
              boxShadow: '0 0 0 1px color-mix(in oklab, var(--border-subtle) 75%, transparent)',
            }}
          >
            <Zap className="text-[var(--foreground)]" size={14} fill="currentColor" />
          </div>
          <span className="text-xs sm:text-sm font-bold tracking-tight text-[var(--text)] truncate">
            3Core
          </span>
        </div>

        {/* Right: search (desktop) + actions + profile */}
        <div className="flex items-center gap-1 sm:gap-2 md:gap-3 flex-shrink-0 min-w-0">
          <div className="relative group hidden sm:block w-full sm:w-44 md:w-56 lg:w-72 max-w-[200px] md:max-w-none">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search..."
              className="h-9 rounded-full pl-9 pr-14 md:pr-16 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 px-2 py-1 rounded-full"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--surface-hover) 80%, transparent)',
              }}
            >
              <span className="text-[9px] text-[var(--text-muted)] font-bold tracking-tight">
                Ctrl
              </span>
              <span className="text-[9px] text-[var(--text-muted)] font-bold">K</span>
            </div>
          </div>

          <div
            className="hidden sm:flex items-center gap-1.5 pl-2 pr-2.5 h-9 rounded-full cursor-pointer transition-colors shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <img src="https://flagcdn.com/w20/us.png" alt="US" className="w-4 h-2.5 rounded-sm" />
            <span className="text-[11px] font-bold">EN</span>
            <ChevronRight size={12} className="rotate-90 opacity-70" />
          </div>

          <button
            aria-label="Theme"
            onClick={onToggleTheme}
            className="h-10 w-10 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            {theme === 'dark' ? <SunMedium size={16} /> : <Moon size={16} />}
          </button>

          <button
            aria-label="Notifications"
            className="h-10 w-10 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] transition-colors relative shrink-0"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <Bell size={16} />
            <span className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 bg-rose-500 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white shadow-[0_6px_14px_rgba(0,0,0,0.35)]">
              11
            </span>
          </button>

          <div
            className="h-6 sm:h-9 w-px mx-0.5 sm:mx-1 shrink-0 hidden sm:block"
            aria-hidden
            style={{ backgroundColor: 'var(--border-subtle)' }}
          />

          <div
            className="h-9 min-w-[36px] flex items-center gap-1.5 sm:gap-2 pl-1 pr-2 sm:pr-2.5 rounded-full cursor-pointer group transition-colors shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-[var(--foreground)]"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)',
              }}
            >
              DT
            </div>
            <span className="text-xs font-bold hidden sm:inline truncate max-w-[4rem] md:max-w-none">
              Demo
            </span>
            <ChevronRight size={12} className="rotate-90 opacity-70 shrink-0 hidden sm:block" />
          </div>
        </div>
      </div>
    </header>
  );
}

