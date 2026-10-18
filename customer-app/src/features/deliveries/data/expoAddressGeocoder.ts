import * as Location from 'expo-location';

import type { AddressGeocoder, DeviceAddressAccess } from '../domain/deviceAddress';

export const expoDeviceAddressAccess: DeviceAddressAccess = {
  async ensure() {
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      return 'services-off';
    }
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === Location.PermissionStatus.GRANTED) {
      return 'ready';
    }
    if (!current.canAskAgain) {
      return 'permission-denied';
    }
    const asked = await Location.requestForegroundPermissionsAsync();
    return asked.status === Location.PermissionStatus.GRANTED ? 'ready' : 'permission-denied';
  },
};

export const expoAddressGeocoder: AddressGeocoder = {
  async geocode(address) {
    const matches = await Location.geocodeAsync(address);
    return matches.map((match) => ({
      latitude: match.latitude,
      longitude: match.longitude,
    }));
  },
};
