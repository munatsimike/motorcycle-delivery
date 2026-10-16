import type { CustomerDeliveryDetail } from '../customerDeliveryDetail';
import type { CustomerDeliveryRepository } from '../repositories/CustomerDeliveryRepository';

export function loadCustomerDelivery(
  repository: CustomerDeliveryRepository,
  accessToken: string | null,
  deliveryId: string,
): Promise<CustomerDeliveryDetail> {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to view this delivery.'));
  }
  if (!deliveryId.trim()) {
    return Promise.reject(new Error('Delivery details are unavailable.'));
  }
  return repository.getById(accessToken, deliveryId);
}
