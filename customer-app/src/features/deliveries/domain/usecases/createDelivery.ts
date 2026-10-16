import type { PreparedBooking } from '../bookingDraft';
import { canOfferQuotedPrice } from '../deliveryQuote';
import type { CustomerDeliveryDetail } from '../customerDeliveryDetail';
import type { CustomerDeliveryRepository } from '../repositories/CustomerDeliveryRepository';

export function createDelivery(
  repository: CustomerDeliveryRepository,
  accessToken: string | null,
  booking: PreparedBooking,
  offeredPrice: string,
): Promise<CustomerDeliveryDetail> {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to book a delivery.'));
  }
  if (!canOfferQuotedPrice(offeredPrice)) {
    return Promise.reject(new Error('The quoted price cannot be booked.'));
  }
  return repository.create(accessToken, booking, offeredPrice);
}
