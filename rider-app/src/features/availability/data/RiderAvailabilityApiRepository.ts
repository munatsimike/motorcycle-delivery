import { apiPost, apiPut } from '../../../services/api/apiClient';
import type { AvailabilityRepository } from '../domain/availabilityCommands';
import { readAvailabilityResponse } from '../domain/availabilityResponse';
import type { GpsFix } from '../domain/gpsFix';

export class RiderAvailabilityApiRepository implements AvailabilityRepository {
  online(accessToken: string) {
    return apiPost<unknown>('/riders/me/availability/online', {}, { accessToken }).then(readAvailabilityResponse);
  }

  offline(accessToken: string) {
    return apiPost<unknown>('/riders/me/availability/offline', {}, { accessToken }).then(readAvailabilityResponse);
  }

  uploadLocation(accessToken: string, fix: GpsFix): Promise<void> {
    return apiPut<unknown>('/riders/me/location', {
      latitude: fix.latitude,
      longitude: fix.longitude,
    }, { accessToken }).then(() => undefined);
  }
}

export const riderAvailabilityRepository = new RiderAvailabilityApiRepository();
