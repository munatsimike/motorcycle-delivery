import { createContext, useContext } from 'react';
import type { AppearanceMode, ColorScheme } from './appearance';

type AppearanceValue = {
  mode: AppearanceMode;
  scheme: ColorScheme;
  setMode: (mode: AppearanceMode) => void;
};

export const AppearanceContext = createContext<AppearanceValue>({
  mode: 'system',
  scheme: 'light',
  setMode: () => undefined,
});

export function useAppearance(): AppearanceValue {
  return useContext(AppearanceContext);
}
