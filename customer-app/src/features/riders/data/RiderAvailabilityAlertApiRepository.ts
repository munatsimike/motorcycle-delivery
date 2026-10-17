import { apiDelete, apiGet, apiPost } from '../../../services/api/apiClient';
import {
  readCreateRiderAlertResult,
  readRiderAlert,
  type CreateRiderAlertResult,
  type RiderAlertRecord,
} from '../domain/riderAvailabilityAlert';

export type CreateRiderAlertInput = {
  latitude: number;
  longitude: number;
  expoPushToken: string;
};

export class RiderAvailabilityAlertApiRepository {
  async current(accessToken: string): Promise<RiderAlertRecord | null> {
    const body = await apiGet<unknown>('/customers/me/rider-availability-alert', { accessToken });
    return readRiderAlert(body);
  }

  async create(accessToken: string, input: CreateRiderAlertInput): Promise<CreateRiderAlertResult> {
    const body = await apiPost<unknown>('/customers/me/rider-availability-alert', input, { accessToken });
    return readCreateRiderAlertResult(body);
  }

  async cancel(accessToken: string): Promise<void> {
    await apiDelete<unknown>('/customers/me/rider-availability-alert', { accessToken });
  }
}

export const riderAvailabilityAlertRepository = new RiderAvailabilityAlertApiRepository();
