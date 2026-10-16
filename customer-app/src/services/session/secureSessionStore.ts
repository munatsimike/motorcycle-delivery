import * as SecureStore from 'expo-secure-store';

import type { AuthSession } from '../../features/auth/domain/auth.types';
import type { CustomerSessionStore } from '../../features/auth/domain/repositories/CustomerSessionStore';

const SESSION_KEY = 'riders.customer.session';
const BIOMETRIC_KEY = 'riders.customer.biometric';

export const secureSessionStore: CustomerSessionStore & {
  loadBiometricEnabled(): Promise<boolean>;
  saveBiometricEnabled(enabled: boolean): Promise<void>;
} = {
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

  async loadBiometricEnabled() {
    return (await SecureStore.getItemAsync(BIOMETRIC_KEY)) === '1';
  },

  async saveBiometricEnabled(enabled) {
    if (enabled) {
      await SecureStore.setItemAsync(BIOMETRIC_KEY, '1');
      return;
    }
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
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
