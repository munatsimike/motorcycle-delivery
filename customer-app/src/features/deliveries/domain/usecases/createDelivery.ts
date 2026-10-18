import type { PreparedBooking } from '../bookingDraft';
import { customerOfferForBooking } from '../deliveryQuote';
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
  const offer = customerOfferForBooking(offeredPrice);
  if (!('offeredPrice' in offer) || offer.offeredPrice !== offeredPrice) {
    return Promise.reject(new Error('Enter an offer from $0.01 to $1,000.00.'));
  }
  return repository.create(accessToken, booking, offer.offeredPrice);
}
