import * as SecureStore from 'expo-secure-store';

import {
  type PushRegistration,
  type PushRegistrationStore,
} from '../domain/customerPushRegistration';

const KEY = 'customer_fcm_registration';

export const pushRegistrationStore: PushRegistrationStore = {
  async load() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRegistration(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },
  async save(registration) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(registration));
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};

function isRegistration(value: unknown): value is PushRegistration {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { customerId?: unknown; token?: unknown };
  return typeof record.customerId === 'string'
    && record.customerId.trim().length > 0
    && typeof record.token === 'string'
    && record.token.trim().length > 0;
}
