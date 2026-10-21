import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, adminApi, onSignedOut, type LogoutResult } from './lib/client';

type AuthValue = {
  ready: boolean;
  signedIn: boolean;
  signIn: (email: string, password: string) => Promise<string>;
  verify: (challengeId: string, code: string) => Promise<void>;
  logout: () => Promise<LogoutResult>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => onSignedOut(() => setSignedIn(false)), []);

  useEffect(() => {
    let live = true;
    if (!adminApi.hasRefreshToken()) {
      setReady(true);
      return;
    }
    adminApi.restore().then((ok) => {
      if (!live) {
        return;
      }
      setSignedIn(ok);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo<AuthValue>(() => ({
    ready,
    signedIn,
    async signIn(email, password) {
      const pending = await adminApi.request<{ challengeId: string }>('/auth/admin/login', {
        method: 'POST',
        body: { email, password },
      });
      if (!pending.challengeId) {
        throw new ApiError('The verification email could not be started.', 500);
      }
      return pending.challengeId;
    },
    async verify(challengeId, code) {
      const tokens = await adminApi.request<{ accessToken: string; refreshToken: string; accessTokenExpiresAt: string; refreshTokenExpiresAt: string }>(
        '/auth/admin/login/verify',
        { method: 'POST', body: { challengeId, code } },
      );
      adminApi.adopt(tokens);
      setSignedIn(true);
    },
    async logout() {
      const result = await adminApi.logout();
      setSignedIn(false);
      return result;
    },
  }), [ready, signedIn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('Auth is unavailable');
  }
  return value;
}
