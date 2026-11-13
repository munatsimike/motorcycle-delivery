export const NAVIGATION_FALLBACK_DENYLIST = [/^\/auth\//, /^\/admin\//, /^\/customers\//] as const;

export function navigationUsesAppShell(pathname: string): boolean {
  return !NAVIGATION_FALLBACK_DENYLIST.some((pattern) => pattern.test(pathname));
}
