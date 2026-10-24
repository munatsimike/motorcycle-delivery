import type { PreparedBooking } from '../bookingDraft';
import type { OpenBidRequest } from '../openBidRequest';
import type { CustomerDeliveryRepository } from '../repositories/CustomerDeliveryRepository';

export function createOpenRequest(
  repository: CustomerDeliveryRepository,
  accessToken: string | null,
  booking: PreparedBooking,
): Promise<OpenBidRequest> {
  if (!accessToken) {
    return Promise.reject(new Error('Sign in to book a delivery.'));
  }
  if (!booking.serviceClass || !booking.deliverBy) {
    return Promise.reject(new Error('Choose Express or Flexible'));
  }
  return repository.createOpenRequest(accessToken, booking);
}
