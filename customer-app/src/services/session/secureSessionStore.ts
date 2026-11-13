import * as SecureStore from 'expo-secure-store';

import type { AuthSession } from '../../features/auth/domain/auth.types';
import type { CustomerSessionStore } from '../../features/auth/domain/repositories/CustomerSessionStore';

const SESSION_KEY = 'riders.customer.session';
const SESSION_PRESENT_KEY = 'riders.customer.session.present';
const GATED_KEY = 'riders.customer.session.gated';
const GATED_FLAG = 'riders.customer.session.gated.flag';
const BIOMETRIC_KEY = 'riders.customer.biometric';
const DECLINED_KEY = 'riders.customer.biometric.declined';

export const secureSessionStore: CustomerSessionStore & {
  hasSession(): Promise<boolean>;
} = {
  async hasSession() {
    const session = await this.load();
    return session !== null;
  },

  async load() {
    const migrated = await readLegacyGatedSession();
    if (migrated) {
      await writePlain(migrated);
    }
    return readPlain();
  },

  async save(session) {
    await writePlain(session);
  },

  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(SESSION_PRESENT_KEY);
    await forgetLegacyBiometricStorage();
  },
};

async function readLegacyGatedSession(): Promise<AuthSession | null> {
  if (!(await readFlag(GATED_FLAG))) {
    return null;
  }
  let session: AuthSession | null = null;
  try {
    const raw = await SecureStore.getItemAsync(GATED_KEY);
    session = raw ? parseSession(raw) : null;
  } catch {
    session = null;
  }
  await forgetLegacyBiometricStorage();
  return session;
}

async function writePlain(session: AuthSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  await SecureStore.setItemAsync(SESSION_PRESENT_KEY, '1');
  await forgetLegacyBiometricStorage();
}

async function readPlain(): Promise<AuthSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) {
    return null;
  }
  const session = parseSession(raw);
  if (!session) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(SESSION_PRESENT_KEY);
    return null;
  }
  return session;
}

async function forgetLegacyBiometricStorage() {
  await Promise.all([
    SecureStore.deleteItemAsync(GATED_KEY),
    SecureStore.deleteItemAsync(GATED_FLAG),
    SecureStore.deleteItemAsync(BIOMETRIC_KEY),
    SecureStore.deleteItemAsync(DECLINED_KEY),
  ].map((removal) => removal.catch(() => undefined)));
}

async function readFlag(key: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(key)) === '1';
  } catch {
    return false;
  }
}

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
