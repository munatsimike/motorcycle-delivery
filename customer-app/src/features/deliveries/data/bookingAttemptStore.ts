import * as SecureStore from 'expo-secure-store';

import { createBookingAttempts } from '../domain/bookingAttempt';

export const bookingAttempts = createBookingAttempts({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
});

export function createBookingKey(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) {
    return `customer-create-${generated}`;
  }
  return `customer-create-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
