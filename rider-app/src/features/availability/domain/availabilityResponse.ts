import type { RiderAvailability } from '../../onboarding/domain/riderOnboarding';

export type AvailabilityResponse = {
  availability: RiderAvailability;
  message: string | null;
};

export function readAvailabilityResponse(value: unknown): AvailabilityResponse {
  if (!isRecord(value)) {
    throw new Error('Availability could not be updated.');
  }
  const availability = value.availability;
  if (availability !== 'OFFLINE' && availability !== 'AVAILABLE' && availability !== 'BUSY') {
    throw new Error('Availability could not be updated.');
  }
  const message = value.message;
  if (message !== undefined && message !== null && typeof message !== 'string') {
    throw new Error('Availability could not be updated.');
  }
  return {
    availability,
    message: typeof message === 'string' && message.trim() ? message : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
