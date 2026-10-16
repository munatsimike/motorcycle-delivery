export type DeviceLocation =
  | { status: 'services-off' }
  | { status: 'permission-denied'; canAskAgain: boolean }
  | { status: 'position-unavailable' }
  | { status: 'ready'; latitude: number; longitude: number };

export type CustomerLocationPort = {
  read(): Promise<DeviceLocation>;
  requestPermission(): Promise<DeviceLocation>;
  openLocationSettings(): Promise<void>;
  openAppSettings(): Promise<void>;
};

export function needsAvailabilityRequest(
  location: DeviceLocation,
): location is { status: 'ready'; latitude: number; longitude: number } {
  return location.status === 'ready'
    && Number.isFinite(location.latitude)
    && Number.isFinite(location.longitude);
}
