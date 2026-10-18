import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { AuthSession } from '../../features/auth/domain/auth.types';
import type { CustomerSessionStore } from '../../features/auth/domain/repositories/CustomerSessionStore';
import { BiometricPromptCancelled, credentialFailure, rotationWrite } from './credentialAccess';

const SESSION_KEY = 'riders.customer.session';
const SESSION_PRESENT_KEY = 'riders.customer.session.present';
const GATED_KEY = 'riders.customer.session.gated';
const GATED_FLAG = 'riders.customer.session.gated.flag';
const BIOMETRIC_KEY = 'riders.customer.biometric';
const DECLINED_KEY = 'riders.customer.biometric.declined';

const gatedOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Unlock Riders',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'riders.customer.session.gated',
};

export const secureSessionStore: CustomerSessionStore & {
  hasSession(): Promise<boolean>;
  isProtected(): Promise<boolean>;
  protect(session: AuthSession): Promise<void>;
  release(session: AuthSession): Promise<void>;
  loadBiometricEnabled(): Promise<boolean>;
  loadBiometricDeclined(): Promise<boolean>;
  saveBiometricEnabled(enabled: boolean): Promise<void>;
  declineBiometricOffer(): Promise<void>;
} = {
  async hasSession() {
    if ((await readFlag(GATED_FLAG)) || (await readFlag(SESSION_PRESENT_KEY))) {
      return true;
    }
    const legacy = await SecureStore.getItemAsync(SESSION_KEY);
    if (!legacy) {
      return false;
    }
    await SecureStore.setItemAsync(SESSION_PRESENT_KEY, '1');
    return true;
  },

  async isProtected() {
    return readFlag(GATED_FLAG);
  },

  async load() {
    if (await readFlag(GATED_FLAG)) {
      return readProtected();
    }
    return readPlain();
  },

  async save(session) {
    if (await readFlag(GATED_FLAG)) {
      await writeProtected(JSON.stringify(session));
      return;
    }
    await writePlain(session);
  },

  async protect(session) {
    await writeProtected(JSON.stringify(session));
    await SecureStore.setItemAsync(BIOMETRIC_KEY, '1');
    await SecureStore.deleteItemAsync(DECLINED_KEY);
  },

  async release(session) {
    await writePlain(session);
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
  },

  async clear() {
    await deleteProtected();
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(SESSION_PRESENT_KEY);
    await SecureStore.deleteItemAsync(GATED_FLAG);
    await SecureStore.deleteItemAsync(DECLINED_KEY);
  },

  async loadBiometricEnabled() {
    return readFlag(BIOMETRIC_KEY);
  },

  async loadBiometricDeclined() {
    return readFlag(DECLINED_KEY);
  },

  async saveBiometricEnabled(enabled) {
    if (enabled) {
      await SecureStore.setItemAsync(BIOMETRIC_KEY, '1');
      await SecureStore.deleteItemAsync(DECLINED_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
  },

  async declineBiometricOffer() {
    await SecureStore.setItemAsync(DECLINED_KEY, '1');
  },
};

export function osBiometricProtectionAvailable(): boolean {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

async function readProtected(): Promise<AuthSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(GATED_KEY, gatedOptions);
    if (!raw) {
      await secureSessionStore.clear();
      await secureSessionStore.saveBiometricEnabled(false);
      return null;
    }
    const session = parseSession(raw);
    if (!session) {
      await secureSessionStore.clear();
      await secureSessionStore.saveBiometricEnabled(false);
      return null;
    }
    return session;
  } catch (error: unknown) {
    const failure = credentialFailure(error);
    if (failure === 'invalidated') {
      await secureSessionStore.clear();
      await secureSessionStore.saveBiometricEnabled(false);
      return null;
    }
    if (failure === 'cancelled') {
      throw new BiometricPromptCancelled();
    }
    throw error;
  }
}

async function writeProtected(value: string) {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  if (rotationWrite(platform) === 'recreate') {
    await deleteProtected();
  }
  await SecureStore.setItemAsync(GATED_KEY, value, gatedOptions);
  await SecureStore.deleteItemAsync(SESSION_KEY);
  await SecureStore.setItemAsync(GATED_FLAG, '1');
  await SecureStore.setItemAsync(SESSION_PRESENT_KEY, '1');
}

async function writePlain(session: AuthSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  await SecureStore.setItemAsync(SESSION_PRESENT_KEY, '1');
  await deleteProtected();
  await SecureStore.deleteItemAsync(GATED_FLAG);
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

async function deleteProtected() {
  try {
    await SecureStore.deleteItemAsync(GATED_KEY, gatedOptions);
  } catch {
    // The preference flags are still removed so a failed prompt cannot restore the session.
  }
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
