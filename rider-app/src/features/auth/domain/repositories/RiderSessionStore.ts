import type { AuthSession } from '../auth.types';

export type RiderSessionStore = {
  load(): Promise<AuthSession | null>;
  save(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
};

export type RiderIdentityStore = {
  load(): Promise<string | null>;
  save(fullName: string): Promise<void>;
  clear(): Promise<void>;
};
