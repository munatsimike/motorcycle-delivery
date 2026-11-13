import { File, Paths } from 'expo-file-system';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { darkColors, lightColors, type Palette } from './colors';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

const FILE_NAME = 'appearance-mode.txt';

type AppearanceValue = {
  mode: AppearanceMode;
  scheme: ColorScheme;
  colors: Palette;
  setMode: (mode: AppearanceMode) => void;
};

const AppearanceContext = createContext<AppearanceValue>({
  mode: 'system',
  scheme: 'light',
  colors: lightColors,
  setMode: () => {},
});

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>('system');
  const system = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    readAppearanceMode().then((saved) => {
      if (!cancelled) {
        setModeState(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyNativeScheme(mode);
  }, [mode]);

  const scheme: ColorScheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const colors = scheme === 'dark' ? darkColors : lightColors;
  const value = useMemo<AppearanceValue>(
    () => ({
      mode,
      scheme,
      colors,
      setMode: (next) => {
        setModeState(next);
        void writeAppearanceMode(next);
      },
    }),
    [mode, scheme, colors],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceValue {
  return useContext(AppearanceContext);
}

export function appearanceLabel(mode: AppearanceMode): string {
  if (mode === 'light') {
    return 'Light';
  }
  if (mode === 'dark') {
    return 'Dark';
  }
  return 'System default';
}

function appearanceFile(): File {
  return new File(Paths.document, FILE_NAME);
}

async function readAppearanceMode(): Promise<AppearanceMode> {
  try {
    const file = appearanceFile();
    if (!file.exists) {
      return 'system';
    }
    return parseAppearanceMode(await file.text());
  } catch {
    return 'system';
  }
}

async function writeAppearanceMode(mode: AppearanceMode): Promise<void> {
  try {
    const file = appearanceFile();
    if (!file.exists) {
      file.create();
    }
    file.write(mode);
  } catch {
    // The in-memory selection still applies for this session.
  }
}

function parseAppearanceMode(value: string): AppearanceMode {
  const mode = value.trim();
  if (mode === 'light' || mode === 'dark' || mode === 'system') {
    return mode;
  }
  return 'system';
}

function applyNativeScheme(mode: AppearanceMode) {
  Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
}
