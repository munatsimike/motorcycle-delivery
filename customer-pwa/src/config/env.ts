export function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
}

export function mapsBrowserKey(): string {
  const value = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  return typeof value === 'string' ? value.trim() : '';
}
