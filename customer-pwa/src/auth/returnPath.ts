const STORAGE_KEY = 'riders.customer.return';

type PathStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('://')) {
    return null;
  }
  const path = value.split('?')[0]?.split('#')[0] ?? '';
  if (path === '/home' || path === '/book' || path === '/profile' || path === '/deliveries' || path.startsWith('/deliveries/')) {
    return path;
  }
  return null;
}

export function rememberReturnPath(value: unknown, storage: PathStore = localStorage): void {
  const path = safeReturnPath(value);
  if (!path) {
    storage.removeItem(STORAGE_KEY);
    return;
  }
  storage.setItem(STORAGE_KEY, path);
}

export function readReturnPath(storage: PathStore = localStorage): string | null {
  try {
    return safeReturnPath(storage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearReturnPath(storage: PathStore = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // The next signed-in visit falls back to Home.
  }
}
