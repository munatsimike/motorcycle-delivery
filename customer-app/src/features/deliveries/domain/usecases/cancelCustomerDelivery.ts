import type { CustomerDeliveryRepository } from '../repositories/CustomerDeliveryRepository';

export function cancelCustomerDelivery(
  repository: CustomerDeliveryRepository,
  accessToken: string | null,
  deliveryId: string,
): Promise<void> {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to delete this delivery.'));
  }
  if (!deliveryId.trim()) {
    return Promise.reject(new Error('This delivery could not be deleted.'));
  }
  return repository.cancel(accessToken, deliveryId);
}
