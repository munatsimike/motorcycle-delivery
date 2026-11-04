import type { AcceptanceKeys } from '../acceptanceKeys';
import { acceptanceFromAssignedDelivery, keepsAcceptanceKey, type BidAcceptance } from '../customerBids';
import type { CustomerDeliveryRepository } from '../repositories/CustomerDeliveryRepository';

export async function acceptCustomerBid(
  repository: CustomerDeliveryRepository,
  keys: AcceptanceKeys,
  accessToken: string | null,
  deliveryId: string,
  bidId: string,
  createKey: () => string,
  selectedRiderName = '',
): Promise<BidAcceptance> {
  if (!accessToken) {
    throw new Error('Sign in again.');
  }
  const key = await keys.keyFor(deliveryId, bidId, createKey);
  try {
    const accepted = await repository.acceptBid(accessToken, deliveryId, bidId, key);
    if (accepted.status !== 'RIDER_ASSIGNED' || accepted.deliveryId !== deliveryId || accepted.bidId !== bidId) {
      throw new Error('This offer could not be accepted.');
    }
    await keys.clear(deliveryId, bidId);
    return accepted;
  } catch (error) {
    if (!keepsAcceptanceKey(error)) {
      throw error;
    }
    try {
      const latest = await repository.getById(accessToken, deliveryId);
      const recovered = acceptanceFromAssignedDelivery(latest, { bidId, riderName: selectedRiderName });
      if (recovered) {
        await keys.clear(deliveryId, bidId);
        return recovered;
      }
    } catch {
      // Keep the original timeout or network error for a retry with the same key.
    }
    throw error;
  }
}
