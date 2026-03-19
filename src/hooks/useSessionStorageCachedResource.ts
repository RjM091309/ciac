import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SessionCacheEnvelope<T> = {
  ts: number;
  data: T;
};

function readSessionCache<T>(key: string, ttlMs: number): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCacheEnvelope<T>;
    if (!parsed?.ts || !Number.isFinite(parsed.ts)) return null;
    if (Date.now() - parsed.ts > ttlMs) return null;
    return (parsed?.data ?? null) as T | null;
  } catch {
    return null;
  }
}

function writeSessionCache<T>(key: string, data: T) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data } satisfies SessionCacheEnvelope<T>));
  } catch {
    // ignore cache write failures (private mode, quota, etc.)
  }
}

export function useSessionStorageCachedResource<T>(opts: {
  cacheKey: string;
  ttlMs: number;
  fetcher: () => Promise<T>;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}) {
  const { cacheKey, ttlMs, fetcher, enabled = true, onError } = opts;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const initialCached = useMemo(() => readSessionCache<T>(cacheKey, ttlMs), [cacheKey, ttlMs]);

  const [data, setData] = useState<T | null>(initialCached);
  const [isLoading, setIsLoading] = useState<boolean>(initialCached === null);
  const [isRevalidating, setIsRevalidating] = useState<boolean>(initialCached !== null);

  const refresh = useCallback(
    async (options?: { showLoading?: boolean }) => {
      if (!enabled) return;

      const cachedNow = readSessionCache<T>(cacheKey, ttlMs);
      const hasCache = cachedNow !== null;
      const shouldShowLoading = Boolean(options?.showLoading) || !hasCache;

      setIsLoading(shouldShowLoading);
      setIsRevalidating(!shouldShowLoading);

      try {
        const next = await fetcherRef.current();
        setData(next);
        writeSessionCache(cacheKey, next);
      } catch (e) {
        onErrorRef.current?.(e);
      } finally {
        setIsLoading(false);
        setIsRevalidating(false);
      }
    },
    [cacheKey, ttlMs, enabled]
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const cachedNow = readSessionCache<T>(cacheKey, ttlMs);
    setData(cachedNow);
    setIsLoading(cachedNow === null);
    setIsRevalidating(cachedNow !== null);

    void (async () => {
      try {
        const next = await fetcherRef.current();
        if (cancelled) return;
        setData(next);
        writeSessionCache(cacheKey, next);
      } catch (e) {
        if (cancelled) return;
        onErrorRef.current?.(e);
      } finally {
        if (cancelled) return;
        setIsLoading(false);
        setIsRevalidating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, ttlMs, enabled]);

  return { data, setData, isLoading, isRevalidating, refresh } as const;
}

