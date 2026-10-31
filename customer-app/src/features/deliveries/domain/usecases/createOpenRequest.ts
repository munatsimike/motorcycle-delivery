import type { PreparedBooking } from '../bookingDraft';
import { customerOfferForBooking } from '../deliveryQuote';
import type { OpenBidRequest } from '../openBidRequest';
import type { CustomerDeliveryRepository } from '../repositories/CustomerDeliveryRepository';

export function createOpenRequest(
  repository: CustomerDeliveryRepository,
  accessToken: string | null,
  booking: PreparedBooking,
  offeredPrice: string,
): Promise<OpenBidRequest> {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to book a delivery.'));
  }
  if (!booking.serviceClass) {
    return Promise.reject(new Error('Choose Urgent or Flexible'));
  }
  const offer = customerOfferForBooking(offeredPrice);
  if (!('offeredPrice' in offer) || offer.offeredPrice !== offeredPrice) {
    return Promise.reject(new Error('Enter an offer from $0.01 to $1,000.00.'));
  }
  return repository.createOpenRequest(accessToken, booking, offer.offeredPrice);
}
