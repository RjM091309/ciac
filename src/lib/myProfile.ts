import { useEffect, useSyncExternalStore } from 'react';

// The signed-in user's own account (GET /api/profile), shared by everything
// that shows it — the header's account pill, the mobile menu's account card
// and the My Profile panel — so a new photo or name shows up in all of them
// the moment it's saved, without each one refetching.

export type MyProfile = {
  id: number;
  username: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  totp_enabled: number;
  avatar_version: string | null;
  created_at: string | null;
  is_admin: boolean;
  previous_login: { at: string; ip_address: string | null } | null;
};

let current: MyProfile | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setMyProfile(next: MyProfile | null) {
  current = next;
  emit();
}

export function patchMyProfile(patch: Partial<MyProfile>) {
  if (!current) return;
  current = { ...current, ...patch };
  emit();
}

export function loadMyProfile(force = false): Promise<void> {
  if (inflight) return inflight;
  if (current && !force) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch('/api/profile', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success && json.data) setMyProfile(json.data as MyProfile);
    } catch {
      /* keep whatever we had */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The shared profile, fetched on first use. `enabled: false` skips the fetch
 * (e.g. while a sheet is closed) but still returns anything already loaded. */
export function useMyProfile(enabled = true): MyProfile | null {
  const profile = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => {
    if (enabled) void loadMyProfile();
  }, [enabled]);
  return profile;
}

export function avatarUrl(version: string | null | undefined): string | null {
  return version ? `/api/profile/avatar?v=${encodeURIComponent(version)}` : null;
}

export function initialsOf(name: string | null | undefined): string {
  const clean = String(name || '').replace(/[^a-zA-Z0-9]/g, ' ').trim();
  if (!clean) return '';
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
}
