import * as SecureStore from 'expo-secure-store';

import {
  createCustomerIdentityPersistence,
  createRecentDeliveryPersistence,
} from '../domain/recentDeliveryPersistence';

const secureStore = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  deleteItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const deliveries = createRecentDeliveryPersistence(secureStore);
const identity = createCustomerIdentityPersistence(secureStore);

export const loadRecentDeliveries = deliveries.load;
export const saveRecentDeliveries = deliveries.save;
export const clearRecentDeliveries = deliveries.clear;

export const loadCustomerIdentity = identity.load;
export const saveCustomerIdentity = identity.save;
export const clearCustomerIdentity = identity.clear;
