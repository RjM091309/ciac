import React from 'react';
import { Bell, ChevronRight, Moon, Search, Zap } from 'lucide-react';

export function AppHeader({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  return (
    <header className="shrink-0 px-2 sm:px-4 pt-2 sm:pt-3 mb-2">
      <div
        className="min-h-12 sm:min-h-14 rounded-xl sm:rounded-2xl backdrop-blur-xl px-3 sm:px-4 md:px-5 flex items-center justify-between gap-2 sm:gap-3 flex-nowrap"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--surface) 65%, transparent)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
        }}
      >
        {/* Left: hamburger + logo */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            className="h-10 w-10 sm:h-9 sm:w-9 rounded-full flex flex-col items-center justify-center gap-[3px] text-zinc-300 hover:text-white transition-colors shrink-0"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
          </button>

          <div className="bg-white/90 p-1 rounded-lg shadow-sm shadow-white/5 shrink-0">
            <Zap className="text-black" size={14} fill="currentColor" />
          </div>
          <span className="text-xs sm:text-sm font-bold tracking-tight text-white truncate">3Core</span>
        </div>

        {/* Right: search (desktop) + actions + profile */}
        <div className="flex items-center gap-1 sm:gap-2 md:gap-3 flex-shrink-0 min-w-0">
          <div className="relative group hidden sm:block w-full sm:w-44 md:w-56 lg:w-72 max-w-[200px] md:max-w-none">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-zinc-300 transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search..."
              className="h-9 rounded-full pl-9 pr-14 md:pr-16 text-xs w-full focus:outline-none focus:ring-1 focus:ring-zinc-700/60 transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-1 px-2 py-1 bg-zinc-900/60 rounded-full">
              <span className="text-[9px] text-zinc-400 font-bold tracking-tight">Ctrl</span>
              <span className="text-[9px] text-zinc-500 font-bold">K</span>
            </div>
          </div>

          <div
            className="hidden sm:flex items-center gap-1.5 pl-2 pr-2.5 h-9 rounded-full cursor-pointer transition-colors shrink-0"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <img src="https://flagcdn.com/w20/us.png" alt="US" className="w-4 h-2.5 rounded-sm" />
            <span className="text-[11px] font-bold text-white">EN</span>
            <ChevronRight size={12} className="rotate-90 text-zinc-500" />
          </div>

          <button
            aria-label="Theme"
            className="h-10 w-10 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-full text-zinc-300 hover:text-white transition-colors shrink-0"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Moon size={16} />
          </button>

          <button
            aria-label="Notifications"
            className="h-10 w-10 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-full text-zinc-300 hover:text-white transition-colors relative shrink-0"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Bell size={16} />
            <span className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 bg-rose-500 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white shadow-[0_6px_14px_rgba(0,0,0,0.35)]">
              11
            </span>
          </button>

          <div className="h-6 sm:h-9 w-px bg-zinc-800/70 mx-0.5 sm:mx-1 shrink-0 hidden sm:block" aria-hidden />

          <div
            className="h-9 min-w-[36px] flex items-center gap-1.5 sm:gap-2 pl-1 pr-2 sm:pr-2.5 rounded-full cursor-pointer group transition-colors shrink-0"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)',
              }}
            >
              DT
            </div>
            <span className="text-xs font-bold text-white hidden sm:inline truncate max-w-[4rem] md:max-w-none">Demo</span>
            <ChevronRight size={12} className="rotate-90 text-zinc-500 shrink-0 hidden sm:block" />
          </div>
        </div>
      </div>
    </header>
  );
}

