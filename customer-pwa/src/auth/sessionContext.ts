import { createContext, useContext } from 'react';
import type { AuthSession } from './contracts';

export type SessionStatus = 'loading' | 'signed-in' | 'signed-out';

export type SessionContextValue = {
  status: SessionStatus;
  session: AuthSession | null;
  saveSession: (session: AuthSession) => void;
  signOut: () => Promise<void>;
  accessToken: () => Promise<string | null>;
};

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('Session is unavailable.');
  }
  return value;
}
