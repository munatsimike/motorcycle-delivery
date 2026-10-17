import * as SecureStore from 'expo-secure-store';

const SHARING_FLAG_KEY = 'riders.rider.location-sharing';

export const locationSharingFlag = {
  async load(): Promise<boolean> {
    const value = await SecureStore.getItemAsync(SHARING_FLAG_KEY);
    return value === '1';
  },

  async save(enabled: boolean): Promise<void> {
    if (enabled) {
      await SecureStore.setItemAsync(SHARING_FLAG_KEY, '1');
      return;
    }
    await SecureStore.deleteItemAsync(SHARING_FLAG_KEY);
  },
};
