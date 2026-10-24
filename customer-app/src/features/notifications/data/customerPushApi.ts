import { ApiError, apiDelete, apiPut } from '../../../services/api/apiClient';

export async function registerCustomerPushDevice(accessToken: string, fcmToken: string): Promise<'registered' | 'unavailable'> {
  try {
    const body = await apiPut<unknown>('/customers/me/push-devices', { fcmToken }, { accessToken });
    if (!isRecord(body) || body.registered !== true) {
      throw new Error('Delivery alerts could not be enabled.');
    }
    return 'registered';
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return 'unavailable';
    }
    throw error;
  }
}

export async function removeCustomerPushDevice(accessToken: string, fcmToken: string): Promise<void> {
  await apiDelete<unknown>('/customers/me/push-devices', { fcmToken }, { accessToken });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
