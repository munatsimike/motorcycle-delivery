import type { PreparedBooking } from '../bookingDraft';
import type { DeliveryQuote } from '../deliveryQuote';
import type { CustomerDeliveryRepository } from '../repositories/CustomerDeliveryRepository';

export function quoteDelivery(
  repository: CustomerDeliveryRepository,
  accessToken: string | null,
  booking: PreparedBooking,
): Promise<DeliveryQuote> {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to book a delivery.'));
  }
  return repository.quote(accessToken, booking);
}
