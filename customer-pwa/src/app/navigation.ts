export const TAB_PATHS = ['/home', '/deliveries', '/profile'] as const;

const AUTH_PATHS = new Set(['/', '/sign-in', '/create-account']);

export function showsTabBar(pathname: string): boolean {
  return TAB_PATHS.some((path) => path === pathname);
}

export function isProtectedPath(pathname: string): boolean {
  const path = pathname.split('?')[0]?.split('#')[0] ?? '';
  return path === '/home'
    || path === '/book'
    || path === '/profile'
    || path === '/deliveries'
    || path.startsWith('/deliveries/');
}

export function signedOutDestination(pathname: string): '/sign-in' | null {
  return isProtectedPath(pathname) ? '/sign-in' : null;
}

export function signedInDestination(pathname: string): '/home' | null {
  const path = pathname.split('?')[0]?.split('#')[0] ?? '';
  return AUTH_PATHS.has(path) ? '/home' : null;
}

export function visibleTree(status: 'loading' | 'signed-in' | 'signed-out'): 'session-check' | 'signed-in' | 'signed-out' {
  if (status === 'loading') {
    return 'session-check';
  }
  return status;
}
