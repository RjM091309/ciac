import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  ChevronRight,
  ClipboardList,
  FileCheck,
  FileSignature,
  FileText,
  Moon,
  Search,
  ShieldCheck,
  SunMedium,
  Zap,
} from 'lucide-react';
import { useGlobalDate } from '../state/GlobalDateContext';
import { DatePicker } from './ui/DatePicker';
import {
  countUnread,
  filterNotificationsForUser,
  filterNotificationsByState,
  getNotificationCounts,
  NotificationFilter,
  NotificationItem,
  Role,
} from '../lib/notifications';
import {
  fetchNotificationsList,
  formatNotificationTime,
  getNotificationCategoryLabel,
  markAllNotificationsReadRequest,
  markNotificationReadRequest,
} from '../lib/notificationClient';
import { NOTIFICATIONS_REFRESH_EVENT, requestNotificationsRefresh } from '../lib/notificationRefresh';

function getNotificationTypeMeta(item: NotificationItem) {
  switch (item.category) {
    case 'requirement':
      return {
        Icon: ClipboardList,
        label: getNotificationCategoryLabel(item.eventType || item.category),
        color: '#f59e0b',
        iconBg: 'rgba(245,158,11,0.16)',
        chipBg: 'rgba(245,158,11,0.12)',
        border: 'rgba(245,158,11,0.24)',
        unreadBg: 'rgba(245,158,11,0.08)',
      };
    case 'document':
      return {
        Icon: FileText,
        label: getNotificationCategoryLabel(item.eventType || item.category),
        color: '#06b6d4',
        iconBg: 'rgba(6,182,212,0.16)',
        chipBg: 'rgba(6,182,212,0.12)',
        border: 'rgba(6,182,212,0.24)',
        unreadBg: 'rgba(6,182,212,0.08)',
      };
    case 'inspection':
      return {
        Icon: Search,
        label: getNotificationCategoryLabel(item.eventType || item.category),
        color: '#8b5cf6',
        iconBg: 'rgba(139,92,246,0.16)',
        chipBg: 'rgba(139,92,246,0.12)',
        border: 'rgba(139,92,246,0.24)',
        unreadBg: 'rgba(139,92,246,0.08)',
      };
    case 'compliance':
      return {
        Icon: ShieldCheck,
        label: getNotificationCategoryLabel(item.eventType || item.category),
        color: '#10b981',
        iconBg: 'rgba(16,185,129,0.16)',
        chipBg: 'rgba(16,185,129,0.12)',
        border: 'rgba(16,185,129,0.24)',
        unreadBg: 'rgba(16,185,129,0.08)',
      };
    case 'assessment':
      return {
        Icon: FileCheck,
        label: getNotificationCategoryLabel(item.eventType || item.category),
        color: '#f97316',
        iconBg: 'rgba(249,115,22,0.16)',
        chipBg: 'rgba(249,115,22,0.12)',
        border: 'rgba(249,115,22,0.24)',
        unreadBg: 'rgba(249,115,22,0.08)',
      };
    case 'contract':
      return {
        Icon: FileSignature,
        label: getNotificationCategoryLabel(item.eventType || item.category),
        color: '#e11d48',
        iconBg: 'rgba(225,29,72,0.16)',
        chipBg: 'rgba(225,29,72,0.12)',
        border: 'rgba(225,29,72,0.24)',
        unreadBg: 'rgba(225,29,72,0.08)',
      };
    case 'application_status':
    default:
      return {
        Icon: Zap,
        label: getNotificationCategoryLabel(item.eventType || item.category),
        color: '#6366f1',
        iconBg: 'rgba(99,102,241,0.16)',
        chipBg: 'rgba(99,102,241,0.12)',
        border: 'rgba(99,102,241,0.24)',
        unreadBg: 'rgba(99,102,241,0.08)',
      };
  }
}

export function AppHeader({
  onToggleSidebar,
  theme,
  onToggleTheme,
  userRole,
  userId,
  backendUrl,
  navigate,
}: {
  onToggleSidebar: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  userRole: Role;
  userId?: number | null;
  backendUrl: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}) {
  const { range, setRange } = useGlobalDate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>('all');
  const notificationWrapRef = useRef<HTMLDivElement | null>(null);
  const latestLoadIdRef = useRef(0);

  const visibleNotifications = useMemo(
    () => filterNotificationsForUser(notifications, { role: userRole, userId }),
    [notifications, userRole, userId]
  );
  const notificationCounts = useMemo(() => getNotificationCounts(visibleNotifications), [visibleNotifications]);
  const displayedNotifications = useMemo(
    () => filterNotificationsByState(visibleNotifications, notificationFilter),
    [visibleNotifications, notificationFilter]
  );
  const unreadCount = useMemo(() => countUnread(visibleNotifications), [visibleNotifications]);

  const loadNotifications = useCallback(async () => {
    const loadId = ++latestLoadIdRef.current;
    const nextNotifications = await fetchNotificationsList({
      backendUrl,
      userRole,
      userId,
      limit: 50,
    });
    if (loadId !== latestLoadIdRef.current) return;
    setNotifications(nextNotifications);
  }, [backendUrl, userRole, userId]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    if (!notificationOpen) return;
    loadNotifications();
  }, [notificationOpen, loadNotifications]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadNotifications();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/notifications/stream', { withCredentials: true });
    const onNotification = () => {
      requestNotificationsRefresh();
    };
    source.addEventListener('notification', onNotification);
    source.addEventListener('connected', onNotification);
    return () => {
      source.removeEventListener('notification', onNotification);
      source.removeEventListener('connected', onNotification);
      source.close();
    };
  }, []);

  useEffect(() => {
    function onNotificationsRefresh() {
      loadNotifications();
    }

    function onWindowFocus() {
      loadNotifications();
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        loadNotifications();
      }
    }

    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, onNotificationsRefresh);
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, onNotificationsRefresh);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadNotifications]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!notificationWrapRef.current) return;
      if (!notificationWrapRef.current.contains(event.target as Node)) {
        setNotificationOpen(false);
      }
    }
    function onEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') setNotificationOpen(false);
    }
    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  function markOneAsRead(id: string) {
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
    markNotificationReadRequest(backendUrl, id)
      .finally(() => {
        requestNotificationsRefresh();
      })
      .catch(() => {
        // no-op (optimistic UI)
      });
  }

  function markAllAsRead() {
    if (visibleNotifications.length === 0) return;
    setNotifications((prev) =>
      prev.map((item) => {
        const isVisibleForCurrentUser = filterNotificationsForUser([item], {
          role: userRole,
          userId,
        }).length > 0;
        return isVisibleForCurrentUser ? { ...item, isRead: true } : item;
      })
    );
    markAllNotificationsReadRequest(backendUrl)
      .finally(() => {
        requestNotificationsRefresh();
      })
      .catch(() => {
        // no-op (optimistic UI)
      });
  }

  function handleNotificationClick(item: NotificationItem) {
    if (!item.targetPath || !item.applicationId) return;
    if (!item.isRead) markOneAsRead(item.id);
    navigate(
      `${item.targetPath}?applicationId=${item.applicationId}&notificationId=${encodeURIComponent(item.id)}&focus=${Date.now()}`
    );
    setNotificationOpen(false);
  }

  return (
    <header className="relative z-40 shrink-0 px-2 sm:px-3 md:px-4 pt-2 sm:pt-2.5 md:pt-3 mb-2 safe-top">
      <div
        className="min-h-11 sm:min-h-12 md:min-h-14 rounded-2xl backdrop-blur-xl px-2.5 sm:px-3 md:px-5 flex items-center justify-between gap-1.5 sm:gap-2 md:gap-3 flex-nowrap"
        style={{
          backgroundColor: 'color-mix(in oklab, var(--surface) 65%, transparent)',
          boxShadow:
            '0 10px 24px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in oklab, var(--border-subtle) 65%, transparent)',
        }}
      >
        {/* Left: hamburger + logo */}
        <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 min-w-0 shrink">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle sidebar"
            className="h-9 w-9 sm:h-9 sm:w-9 rounded-full flex flex-col items-center justify-center gap-[3px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
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
          <span className="text-[11px] sm:text-sm font-bold tracking-tight text-[var(--text)] truncate max-w-[4.25rem] sm:max-w-none">
            3Core
          </span>
        </div>

        {/* Right: search (desktop) + actions + profile */}
        <div className="flex items-center gap-1 sm:gap-2 md:gap-2.5 flex-shrink min-w-0">
          <div className="relative group hidden sm:block w-full sm:w-36 md:w-44 lg:w-64 xl:w-72 max-w-[170px] lg:max-w-none">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--text)] transition-colors pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Search..."
              className="h-9 rounded-full pl-9 pr-10 lg:pr-16 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] transition-all"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 70%, transparent)',
              }}
            />
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 px-2 py-1 rounded-full"
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

          <div className="block xl:hidden shrink-0">
            <DatePicker value={range} onChange={setRange} compact showPresets />
          </div>

          <div className="hidden xl:block shrink-0 max-w-[190px] lg:max-w-none">
            <DatePicker value={range} onChange={setRange} showPresets />
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
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
            className="h-9 w-9 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0 cursor-pointer"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
            }}
          >
            {theme === 'dark' ? <SunMedium size={16} /> : <Moon size={16} />}
          </button>

          <div className="relative shrink-0" ref={notificationWrapRef}>
            <button
              aria-label="Notifications"
              aria-expanded={notificationOpen}
              onClick={() => setNotificationOpen((prev) => !prev)}
              className="h-9 w-9 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)] transition-colors relative shrink-0 cursor-pointer"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--control-bg) 88%, transparent)',
              }}
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 bg-rose-500 rounded-full flex items-center justify-center text-[9px] font-extrabold text-white shadow-[0_6px_14px_rgba(0,0,0,0.35)]">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {notificationOpen && (
              <div
                className="absolute right-0 mt-2 w-[min(92vw,22rem)] rounded-2xl border z-[120] overflow-hidden"
                style={{
                  backgroundColor: theme === 'dark' ? '#0f1115' : '#ffffff',
                  borderColor: 'var(--border-subtle)',
                  boxShadow: '0 12px 34px rgba(0,0,0,0.24)',
                  backdropFilter: 'none',
                  opacity: 1,
                }}
              >
                <div
                  className="flex items-center justify-between px-3 py-2.5 border-b"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <span className="text-xs font-bold text-[var(--text)]">Notifications</span>
                  <button
                    type="button"
                    onClick={markAllAsRead}
                    className="text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    Mark all as read
                  </button>
                </div>
                <div
                  className="grid grid-cols-3 gap-1 px-2 py-2 border-b"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  {([
                    { id: 'all', label: 'All', count: notificationCounts.all },
                    { id: 'unread', label: 'Unread', count: notificationCounts.unread },
                    { id: 'read', label: 'Read', count: notificationCounts.read },
                  ] as const).map((tab) => {
                    const isActive = notificationFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setNotificationFilter(tab.id)}
                        className="rounded-full px-2.5 py-1.5 text-[10px] font-semibold cursor-pointer transition-colors"
                        style={{
                          backgroundColor: isActive
                            ? 'var(--nav-active-bg)'
                            : 'color-mix(in oklab, var(--control-bg) 82%, transparent)',
                          color: isActive ? 'var(--nav-active-text)' : 'var(--text-muted)',
                        }}
                      >
                        {tab.label} ({tab.count})
                      </button>
                    );
                  })}
                </div>
                <div className="max-h-80 overflow-y-auto p-2 custom-scrollbar">
                  {displayedNotifications.length === 0 ? (
                    <div className="px-3 py-10 text-center text-[11px] text-[var(--text-muted)]">
                      {notificationFilter === 'all'
                        ? 'No notifications for this account.'
                        : `No ${notificationFilter} notifications.`}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {displayedNotifications.map((item) => {
                        const typeMeta = getNotificationTypeMeta(item);
                        return (
                          <div
                            key={item.id}
                            className="rounded-xl border px-2.5 py-2"
                            onClick={() => handleNotificationClick(item)}
                            style={{
                              borderColor: item.isRead ? 'var(--border-subtle)' : typeMeta.border,
                              backgroundColor: item.isRead
                                ? 'color-mix(in oklab, var(--control-bg) 55%, transparent)'
                                : typeMeta.unreadBg,
                              cursor: item.targetPath ? 'pointer' : 'default',
                            }}
                          >
                            <div className="flex items-start gap-2.5">
                              <div
                                className="mt-0.5 h-8 w-8 rounded-xl border shrink-0 inline-flex items-center justify-center"
                                style={{
                                  backgroundColor: typeMeta.iconBg,
                                  borderColor: typeMeta.border,
                                  color: typeMeta.color,
                                }}
                              >
                                <typeMeta.Icon size={15} />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-bold text-[var(--text)] truncate">
                                      {item.title}
                                    </div>

                                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                                      <span
                                        className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                                        style={{
                                          color: typeMeta.color,
                                          backgroundColor: typeMeta.chipBg,
                                          borderColor: typeMeta.border,
                                        }}
                                      >
                                        {typeMeta.label}
                                      </span>

                                      {item.applicationNumber ? (
                                        <span className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                                          {item.applicationNumber}
                                        </span>
                                      ) : null}
                                    </div>

                                    <div className="text-[10px] text-[var(--text-muted)] mt-1">
                                      {item.message}
                                    </div>
                                    <div className="text-[9px] text-[var(--text-muted)] mt-1">
                                      {formatNotificationTime(item.createdAt)}
                                    </div>
                                  </div>

                                  {!item.isRead && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        markOneAsRead(item.id);
                                      }}
                                      className="text-[9px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] whitespace-nowrap cursor-pointer"
                                    >
                                      Mark read
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div
            className="h-6 sm:h-9 w-px mx-0.5 sm:mx-1 shrink-0 hidden sm:block"
            aria-hidden
            style={{ backgroundColor: 'var(--border-subtle)' }}
          />

          <div
            className="h-9 min-w-[32px] flex items-center gap-1.5 sm:gap-2 pl-1 pr-1.5 sm:pr-2.5 rounded-full cursor-pointer group transition-colors shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]"
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
            
            </div>
            <span className="text-xs font-bold hidden sm:inline truncate max-w-[3.75rem] md:max-w-[5rem] lg:max-w-none">
              3CORE
            </span>
            <ChevronRight size={12} className="rotate-90 opacity-70 shrink-0 hidden sm:block" />
          </div>
        </div>
      </div>
    </header>
  );
}

