import * as Location from 'expo-location';

import type { AddressGeocoder } from '../domain/pickupLocation';

export const expoAddressGeocoder: AddressGeocoder = {
  async geocode(address) {
    const matches = await Location.geocodeAsync(address);
    return matches.map((match) => ({
      latitude: match.latitude,
      longitude: match.longitude,
    }));
  },
};
