import type { AuthSession } from '../auth.types';

export interface CustomerSessionStore {
  load(): Promise<AuthSession | null>;
  save(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
}
