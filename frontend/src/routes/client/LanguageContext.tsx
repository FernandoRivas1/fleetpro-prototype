import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Lang } from './strings';

const STORAGE_KEY = 'fleetpro:language';

const LanguageCtx = createContext<{ lang: Lang; setLang: (lang: Lang) => void } | null>(null);

function readStored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'es' ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

/** A tablet's language choice is a device setting, like its pairing —
 * persisted per-device, not per-customer. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — worst case, the choice doesn't survive a reload
    }
  };

  return <LanguageCtx.Provider value={{ lang, setLang }}>{children}</LanguageCtx.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageCtx);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
