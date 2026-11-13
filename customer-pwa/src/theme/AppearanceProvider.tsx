import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  readStoredAppearance,
  resolvedScheme,
  writeStoredAppearance,
  type AppearanceMode,
  type ColorScheme,
} from './appearance';
import { AppearanceContext } from './appearanceContext';

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>(() => readStoredAppearance(localStorage));
  const [system, setSystem] = useState<ColorScheme>(() => systemScheme());
  const scheme = resolvedScheme(mode, system);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setSystem(query.matches ? 'dark' : 'light');
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    document.documentElement.style.colorScheme = scheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', scheme === 'dark' ? '#101614' : '#169B62');
  }, [scheme]);

  const value = useMemo(() => ({
    mode,
    scheme,
    setMode: (next: AppearanceMode) => {
      setModeState(next);
      try {
        writeStoredAppearance(localStorage, next);
      } catch {
        // The selected theme still applies for this visit.
      }
    },
  }), [mode, scheme]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

function systemScheme(): ColorScheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
