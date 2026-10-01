import React, { useEffect, useState } from 'react';
import { AlertTriangle, Info, Wrench, X } from 'lucide-react';
import { bannerHeading, loadSiteSettings, useSiteSettings } from '../lib/siteSettings';

// Announcement banner (Portal Settings → Announcements) across the top of
// every signed-in page, plus a reminder for administrators while maintenance
// mode is on. Everyone else is signed out during maintenance, so only admins
// ever see that one.

const DISMISS_KEY = 'ciac:bannerDismissed';
// Scheduled banners start/stop on the server's clock; re-check now and then
// so one doesn't wait for the next save to appear or go away.
const RECHECK_MS = 5 * 60 * 1000;

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

const TONES = {
  info: { border: 'var(--border-subtle)', bg: 'var(--control-bg)', icon: 'var(--text-muted)', Icon: Info },
  warning: { border: 'rgba(245,158,11,.4)', bg: 'rgba(245,158,11,.10)', icon: '#f59e0b', Icon: AlertTriangle },
  critical: { border: 'rgba(239,68,68,.45)', bg: 'rgba(239,68,68,.10)', icon: '#ef4444', Icon: AlertTriangle },
} as const;

export function SiteBanner({ isAdmin }: { isAdmin: boolean }) {
  const site = useSiteSettings();
  // Dismissal lasts for this browser tab session, and only for this exact
  // message — a new or edited announcement shows again.
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void loadSiteSettings();
    }, RECHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const banner = site.banner;
  // Dismissal is tied to this exact heading + message: editing either shows it again.
  const bannerKey = banner ? `${bannerHeading(banner)}\n${banner.message}` : '';
  const expired = Boolean(banner?.ends_at && new Date(banner.ends_at).getTime() <= now);
  const showBanner = Boolean(banner && !expired && dismissed !== bannerKey);
  const showMaintenance = isAdmin && site.maintenance.enabled;
  if (!showBanner && !showMaintenance) return null;

  return (
    <div className="mb-3 space-y-2">
      {showMaintenance ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] leading-snug"
          style={{ borderColor: TONES.warning.border, backgroundColor: TONES.warning.bg, color: 'var(--text)' }}
        >
          <Wrench size={14} className="mt-px shrink-0" style={{ color: TONES.warning.icon }} />
          <span className="min-w-0 break-words">
            <b>Maintenance mode is on.</b> Only administrators can sign in. Turn it off in Portal Settings → Announcements.
          </span>
        </div>
      ) : null}
      {showBanner && banner ? (
        (() => {
          const tone = TONES[banner.level] || TONES.info;
          const Icon = tone.Icon;
          return (
            <div
              role={banner.level === 'info' ? 'status' : 'alert'}
              className="flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] leading-snug"
              style={{ borderColor: tone.border, backgroundColor: tone.bg, color: 'var(--text)' }}
            >
              <Icon size={14} className="mt-px shrink-0" style={{ color: tone.icon }} />
              <span className="min-w-0 flex-1 break-words">
                <b>{bannerHeading(banner)}</b> {banner.message}
              </span>
              <button
                type="button"
                aria-label="Dismiss announcement"
                className="-m-1 p-1 rounded-md shrink-0 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                onClick={() => {
                  setDismissed(bannerKey);
                  try {
                    window.sessionStorage.setItem(DISMISS_KEY, bannerKey);
                  } catch {
                    // storage unavailable — dismissed for this page view only
                  }
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
