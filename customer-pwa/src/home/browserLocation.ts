import { locationFromGeolocationError, type DeviceLocation } from './nearby';

export const LOCATION_TIMEOUT_MS = 12_000;

export function readBrowserLocation(maximumAge: number): Promise<DeviceLocation> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ status: 'position-unavailable' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          resolve({ status: 'position-unavailable' });
          return;
        }
        resolve({ status: 'ready', latitude, longitude });
      },
      (error) => {
        resolve(locationFromGeolocationError(error));
      },
      {
        enableHighAccuracy: false,
        timeout: LOCATION_TIMEOUT_MS,
        maximumAge,
      },
    );
  });
}
