export type DeviceAddressAccess = {
  ensure(): Promise<'ready' | 'services-off' | 'permission-denied'>;
};

export type AddressGeocoder = {
  geocode(address: string): Promise<Array<{ latitude: number; longitude: number }>>;
};

export type DeviceAddressResult =
  | { status: 'found'; latitude: string; longitude: string }
  | { status: 'none' }
  | { status: 'unavailable'; message: string };

const LOCATION_OFF = 'Turn on your device location so this address can be found.';
const LOCATION_DENIED = 'Allow location access so this address can be found.';
const LOOKUP_FAILED = 'The phone address lookup failed. Try again.';

export async function readDeviceAddressPin(
  address: string,
  access: DeviceAddressAccess,
  geocoder: AddressGeocoder,
): Promise<DeviceAddressResult> {
  const gate = await access.ensure();
  if (gate === 'services-off') {
    return { status: 'unavailable', message: LOCATION_OFF };
  }
  if (gate === 'permission-denied') {
    return { status: 'unavailable', message: LOCATION_DENIED };
  }
  try {
    const matches = await geocoder.geocode(address.trim());
    const point = matches.find((match) => (
      Number.isFinite(match.latitude)
      && Number.isFinite(match.longitude)
      && match.latitude >= -90
      && match.latitude <= 90
      && match.longitude >= -180
      && match.longitude <= 180
    ));
    if (!point) {
      return { status: 'none' };
    }
    return {
      status: 'found',
      latitude: point.latitude.toFixed(7),
      longitude: point.longitude.toFixed(7),
    };
  } catch {
    return { status: 'unavailable', message: LOOKUP_FAILED };
  }
}
