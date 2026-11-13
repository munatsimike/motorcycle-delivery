export type AppearanceMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'riders.customer.appearance';

export function parseAppearanceMode(value: string | null | undefined): AppearanceMode {
  const mode = value?.trim();
  if (mode === 'light' || mode === 'dark' || mode === 'system') return mode;
  return 'system';
}

export function appearanceLabel(mode: AppearanceMode): string {
  if (mode === 'light') return 'Light';
  if (mode === 'dark') return 'Dark';
  return 'System default';
}

export function resolvedScheme(mode: AppearanceMode, system: ColorScheme): ColorScheme {
  return mode === 'system' ? system : mode;
}

export function readStoredAppearance(storage: { getItem(key: string): string | null }): AppearanceMode {
  try {
    return parseAppearanceMode(storage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function writeStoredAppearance(storage: { setItem(key: string, value: string): void }, mode: AppearanceMode): void {
  storage.setItem(APPEARANCE_STORAGE_KEY, mode);
}

export function profileSignOutRequest(): { path: '/'; replace: true; leftAccount: true } {
  return { path: '/', replace: true, leftAccount: true };
}
