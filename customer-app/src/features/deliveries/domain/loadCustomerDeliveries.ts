import type { CustomerDeliveryPage } from './customerDeliveryList';
import { customerDeliveryListPath } from './customerDeliveryList';
import type { DeliveryStatus } from './deliveryStatus';
import type { CustomerDeliveryRepository } from './repositories/CustomerDeliveryRepository';

export function loadCustomerDeliveries(
  repository: CustomerDeliveryRepository,
  accessToken: string | null,
  page: number,
  statuses?: readonly DeliveryStatus[],
): Promise<CustomerDeliveryPage> {
  if (!accessToken) {
    return Promise.reject(new Error('Deliveries are unavailable.'));
  }
  return repository.list(accessToken, customerDeliveryListPath(page, statuses));
}
