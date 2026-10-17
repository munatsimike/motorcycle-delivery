import * as SecureStore from 'expo-secure-store';

import type { AuthSession } from '../../features/auth/domain/auth.types';
import type { RiderIdentityStore, RiderSessionStore } from '../../features/auth/domain/repositories/RiderSessionStore';

const SESSION_KEY = 'riders.rider.session';
const IDENTITY_KEY = 'riders.rider.identity';

export const secureSessionStore: RiderSessionStore = {
  async load() {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const session = parseSession(raw);
    if (!session) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
    return session;
  },

  async save(session) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },

  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};

export const secureIdentityStore: RiderIdentityStore = {
  async load() {
    const name = await SecureStore.getItemAsync(IDENTITY_KEY);
    return name && name.trim() ? name : null;
  },

  async save(fullName) {
    await SecureStore.setItemAsync(IDENTITY_KEY, fullName);
  },

  async clear() {
    await SecureStore.deleteItemAsync(IDENTITY_KEY);
  },
};

function parseSession(raw: string): AuthSession | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const accessToken = text(parsed.accessToken);
    const refreshToken = text(parsed.refreshToken);
    const accessTokenExpiresAt = text(parsed.accessTokenExpiresAt);
    const refreshTokenExpiresAt = text(parsed.refreshTokenExpiresAt);
    if (!accessToken || !refreshToken || !accessTokenExpiresAt || !refreshTokenExpiresAt) {
      return null;
    }
    return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt };
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
