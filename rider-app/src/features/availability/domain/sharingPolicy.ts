import type { RiderAvailability, RiderOnboarding } from '../../onboarding/domain/riderOnboarding';

export const AVAILABILITY_RECONCILE_INTERVAL_MS = 20_000;

export const RIDER_LOCATION_TASK = 'riders.rider.location';

// Customer tracking reads delivery status and does not use rider coordinates.
// Nearby riders and dispatch only consider AVAILABLE riders with a fresh point.
// Acceptance checks that point while the rider is still AVAILABLE. BUSY riders
// are excluded from those queries, so sharing stops until the server says AVAILABLE.
export function shouldShareLocation(availability: RiderAvailability): boolean {
  return availability === 'AVAILABLE';
}

export function canGoOnline(onboarding: RiderOnboarding): boolean {
  return onboarding.approvalStatus === 'APPROVED'
    && onboarding.licenceVerificationStatus === 'VERIFIED'
    && onboarding.activeVerifiedMotorcycle
    && onboarding.availability === 'OFFLINE';
}

export function canGoOffline(onboarding: RiderOnboarding): boolean {
  return onboarding.availability === 'AVAILABLE';
}

export type SharingStep = 'stop' | 'keep' | 'resume' | 'wait-for-foreground';

export function sharingStep(input: {
  server: RiderAvailability;
  sharing: boolean;
  appForeground: boolean;
}): SharingStep {
  if (!shouldShareLocation(input.server)) {
    return 'stop';
  }
  if (input.sharing) {
    return 'keep';
  }
  if (!input.appForeground) {
    return 'wait-for-foreground';
  }
  return 'resume';
}
