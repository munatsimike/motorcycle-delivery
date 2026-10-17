import { ApiError } from '../../auth/domain/apiError';
import type { RiderSessionGate } from '../../auth/domain/sessionGate';
import { riderReadiness, type RiderAvailability, type RiderOnboarding } from '../../onboarding/domain/riderOnboarding';
import type { AvailabilityResponse } from './availabilityResponse';
import type { GpsFix } from './gpsFix';
import type { LocationAccess } from './locationStatus';
import { canGoOffline, canGoOnline } from './sharingPolicy';

export type AvailabilityRepository = {
  online(accessToken: string): Promise<AvailabilityResponse>;
  offline(accessToken: string): Promise<AvailabilityResponse>;
};

export type LocationPreparation =
  | { access: 'granted'; fix: GpsFix }
  | { access: Exclude<LocationAccess, 'granted'>; fix: null };

export type LocationPreparer = {
  prepare(): Promise<LocationPreparation>;
};

export type AvailabilitySharing = {
  uploadNow(fix: GpsFix): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type AvailabilityCommandResult =
  | { status: 'online' }
  | { status: 'offline'; availability: RiderAvailability; message: string }
  | { status: 'blocked'; message: string }
  | { status: 'location'; access: Exclude<LocationAccess, 'granted'>; message: string }
  | { status: 'refused'; message: string }
  | { status: 'unconfirmed'; message: string };

const LOCATION_SHARE_FAILED = 'Your location could not be shared. Check your connection and try again.';
export const OFFLINE_UNCONFIRMED = 'Going offline could not be confirmed. You may still appear available until your location expires.';

export async function goOnline(
  onboarding: RiderOnboarding,
  gate: RiderSessionGate,
  availability: AvailabilityRepository,
  location: LocationPreparer,
  sharing: AvailabilitySharing,
): Promise<AvailabilityCommandResult> {
  if (!canGoOnline(onboarding)) {
    return { status: 'blocked', message: riderReadiness(onboarding).message };
  }
  const prepared = await location.prepare();
  if (prepared.access !== 'granted') {
    return {
      status: 'location',
      access: prepared.access,
      message: locationFailureMessage(prepared.access),
    };
  }
  let online: AvailabilityResponse;
  try {
    online = await gate.authorized((accessToken) => availability.online(accessToken));
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { status: 'refused', message: error.message };
    }
    throw error;
  }
  if (online.availability !== 'AVAILABLE') {
    return {
      status: 'offline',
      availability: online.availability,
      message: online.message ?? riderReadiness({ ...onboarding, availability: online.availability }).message,
    };
  }
  try {
    await sharing.uploadNow(prepared.fix);
    await sharing.start();
  } catch {
    return rollBack(gate, availability);
  }
  return { status: 'online' };
}

export async function goOffline(
  onboarding: RiderOnboarding,
  gate: RiderSessionGate,
  availability: AvailabilityRepository,
  sharing: AvailabilitySharing,
): Promise<AvailabilityCommandResult> {
  if (!canGoOffline(onboarding)) {
    return { status: 'blocked', message: riderReadiness(onboarding).message };
  }
  await sharing.stop();
  try {
    const offline = await gate.authorized((accessToken) => availability.offline(accessToken));
    return {
      status: 'offline',
      availability: offline.availability,
      message: offline.message ?? '',
    };
  } catch (error) {
    if (error instanceof ApiError && error.message.trim()) {
      return { status: 'unconfirmed', message: `${error.message} ${OFFLINE_UNCONFIRMED}` };
    }
    return { status: 'unconfirmed', message: OFFLINE_UNCONFIRMED };
  }
}

async function rollBack(
  gate: RiderSessionGate,
  availability: AvailabilityRepository,
): Promise<AvailabilityCommandResult> {
  try {
    const offline = await gate.authorized((accessToken) => availability.offline(accessToken));
    if (offline.availability !== 'OFFLINE') {
      return {
        status: 'unconfirmed',
        message: offline.message ?? `${LOCATION_SHARE_FAILED} ${OFFLINE_UNCONFIRMED}`,
      };
    }
    return {
      status: 'offline',
      availability: 'OFFLINE',
      message: LOCATION_SHARE_FAILED,
    };
  } catch {
    return {
      status: 'unconfirmed',
      message: `${LOCATION_SHARE_FAILED} ${OFFLINE_UNCONFIRMED}`,
    };
  }
}

function locationFailureMessage(access: Exclude<LocationAccess, 'granted'>): string {
  if (access === 'services-off') {
    return 'Turn on your device location before you go online.';
  }
  if (access === 'position-unavailable') {
    return 'Riders could not read a location from this phone. Try again when GPS is available.';
  }
  return 'Allow Riders to use your location while you are online so customers nearby can find you.';
}
