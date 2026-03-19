import React, { createContext, useContext, useMemo, useState } from 'react';

type GlobalDateContextValue = {
  range: [Date | null, Date | null];
  setRange: (range: [Date | null, Date | null]) => void;
};

const GlobalDateContext = createContext<GlobalDateContextValue | null>(null);

export function GlobalDateProvider({ children }: { children: React.ReactNode }) {
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);

  const value = useMemo<GlobalDateContextValue>(() => ({ range, setRange }), [range]);

  return <GlobalDateContext.Provider value={value}>{children}</GlobalDateContext.Provider>;
}

export function useGlobalDate() {
  const ctx = useContext(GlobalDateContext);
  if (!ctx) throw new Error('useGlobalDate must be used within GlobalDateProvider');
  return ctx;
}

