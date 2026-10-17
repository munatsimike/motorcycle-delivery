import type { CustomerLocationPort } from '../../riders/domain/customerLocation';

export type PickupPin =
  | { ok: true; latitude: string; longitude: string }
  | { ok: false; error: string };

export type AddressGeocoder = {
  geocode(address: string): Promise<Array<{ latitude: number; longitude: number }>>;
};

const LOCATION_OFF = 'Turn on your device location so this address can be found.';
const LOCATION_DENIED = 'Allow location access so this address can be found.';
const ADDRESS_NOT_FOUND = 'This address could not be found. Enter a more specific address.';

export async function readPickupPin(location: CustomerLocationPort): Promise<PickupPin> {
  let reading = await location.read();
  if (reading.status === 'permission-denied' && reading.canAskAgain) {
    reading = await location.requestPermission();
  }
  if (reading.status === 'services-off') {
    return { ok: false, error: 'Turn on your device location so the rider can find this address.' };
  }
  if (reading.status === 'permission-denied') {
    return { ok: false, error: 'Allow location access so the rider can find this address.' };
  }
  if (reading.status !== 'ready') {
    return { ok: false, error: 'Your location could not be read. Try again.' };
  }
  return {
    ok: true,
    latitude: reading.latitude.toFixed(7),
    longitude: reading.longitude.toFixed(7),
  };
}

export async function readDropoffPin(
  address: string,
  location: CustomerLocationPort,
  geocoder: AddressGeocoder,
): Promise<PickupPin> {
  const blocked = await geocodingBlock(location);
  if (blocked) {
    return { ok: false, error: blocked };
  }
  let matches: Array<{ latitude: number; longitude: number }>;
  try {
    matches = await geocoder.geocode(address.trim());
  } catch {
    return { ok: false, error: ADDRESS_NOT_FOUND };
  }
  const point = matches.find((match) => Number.isFinite(match.latitude) && Number.isFinite(match.longitude));
  if (!point) {
    return { ok: false, error: ADDRESS_NOT_FOUND };
  }
  return {
    ok: true,
    latitude: point.latitude.toFixed(7),
    longitude: point.longitude.toFixed(7),
  };
}

async function geocodingBlock(location: CustomerLocationPort): Promise<string | null> {
  const reading = await location.read();
  if (reading.status === 'services-off') {
    return LOCATION_OFF;
  }
  if (reading.status !== 'permission-denied') {
    return null;
  }
  if (!reading.canAskAgain) {
    return LOCATION_DENIED;
  }
  const asked = await location.requestPermission();
  if (asked.status === 'services-off') {
    return LOCATION_OFF;
  }
  if (asked.status === 'permission-denied') {
    return LOCATION_DENIED;
  }
  return null;
}
