import * as SecureStore from 'expo-secure-store';

import { createAcceptanceKeys } from '../domain/acceptanceKeys';

export const acceptanceKeys = createAcceptanceKeys({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
});

export function createAcceptanceKey(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) {
    return `customer-accept-${generated}`;
  }
  return `customer-accept-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
