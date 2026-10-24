import type { AcceptanceKeys } from '../acceptanceKeys';
import type { BidAcceptance } from '../customerBids';
import type { CustomerDeliveryRepository } from '../repositories/CustomerDeliveryRepository';

export async function acceptCustomerBid(
  repository: CustomerDeliveryRepository,
  keys: AcceptanceKeys,
  accessToken: string | null,
  deliveryId: string,
  bidId: string,
  createKey: () => string,
): Promise<BidAcceptance> {
  if (!accessToken) {
    throw new Error('Sign in again.');
  }
  const key = await keys.keyFor(deliveryId, bidId, createKey);
  const accepted = await repository.acceptBid(accessToken, deliveryId, bidId, key);
  if (accepted.status !== 'RIDER_ASSIGNED' || accepted.deliveryId !== deliveryId || accepted.bidId !== bidId) {
    throw new Error('This bid could not be accepted.');
  }
  await keys.clear(deliveryId, bidId);
  return accepted;
}
