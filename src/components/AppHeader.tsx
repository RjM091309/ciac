import React from 'react';
import { Bell, ChevronRight, Moon, Search, Zap } from 'lucide-react';

export function AppHeader({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  return (
    <header className="shrink-0 px-4 pt-3 mb-2">
      <div
        className="min-h-14 rounded-2xl backdrop-blur-xl px-4 sm:px-5 flex items-center justify-between gap-3 flex-wrap md:flex-nowrap"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--surface) 65%, transparent)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
        }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            className="h-9 w-9 rounded-full flex flex-col items-center justify-center gap-[3px] text-zinc-300 hover:text-white transition-colors"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
            <span className="w-3.5 h-0.5 rounded-full bg-current" />
          </button>

          <div className="bg-white/90 p-1 rounded-lg shadow-sm shadow-white/5">
            <Zap className="text-black" size={14} fill="currentColor" />
          </div>
          <span className="text-sm font-bold tracking-tight text-white">3Core</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          <div className="relative group hidden sm:block w-full sm:w-56 md:w-72">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-zinc-300 transition-colors"
              size={14}
            />
            <input
              type="text"
              placeholder="Search..."
              className="h-9 rounded-full pl-9 pr-16 text-xs w-full focus:outline-none focus:ring-1 focus:ring-zinc-700/60 transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 bg-zinc-900/60 rounded-full">
              <span className="text-[9px] text-zinc-400 font-bold tracking-tight">Ctrl</span>
              <span className="text-[9px] text-zinc-500 font-bold">K</span>
            </div>
          </div>

          <div
            className="hidden sm:flex items-center gap-1.5 pl-2 pr-2.5 h-9 rounded-full cursor-pointer transition-colors"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <img src="https://flagcdn.com/w20/us.png" alt="US" className="w-4 h-2.5 rounded-sm" />
            <span className="text-[11px] font-bold text-white">EN</span>
            <ChevronRight size={12} className="rotate-90 text-zinc-500" />
          </div>

          <button
            className="h-9 w-9 inline-flex items-center justify-center rounded-full text-zinc-300 hover:text-white transition-colors"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Moon size={16} />
          </button>

          <button
            className="h-9 w-9 inline-flex items-center justify-center rounded-full text-zinc-300 hover:text-white transition-colors relative"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Bell size={16} />
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-rose-500 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white shadow-[0_6px_14px_rgba(0,0,0,0.35)]">
              11
            </span>
          </button>

          <div className="h-9 w-px bg-zinc-800/70 mx-1" />

          <div
            className="h-9 flex items-center gap-2 pl-1 pr-2.5 rounded-full cursor-pointer group transition-colors"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 55%, transparent)',
              }}
            >
              DT
            </div>
            <span className="text-xs font-bold text-white">Demo</span>
            <ChevronRight size={12} className="rotate-90 text-zinc-500" />
          </div>
        </div>
      </div>
    </header>
  );
}

