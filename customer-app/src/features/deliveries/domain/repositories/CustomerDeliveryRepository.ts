import type { PreparedBooking } from '../bookingDraft';
import type { CustomerDeliveryDetail } from '../customerDeliveryDetail';
import type { CustomerDeliveryPage } from '../customerDeliveryList';
import type { DeliveryQuote } from '../deliveryQuote';
import type { BidAcceptance, CustomerBid } from '../customerBids';
import type { OpenBidRequest } from '../openBidRequest';

export type CustomerDeliveryRepository = {
  quote(accessToken: string, booking: PreparedBooking): Promise<DeliveryQuote>;
  create(accessToken: string, booking: PreparedBooking, offeredPrice: string): Promise<CustomerDeliveryDetail>;
  createOpenRequest(accessToken: string, booking: PreparedBooking, offeredPrice: string, idempotencyKey: string): Promise<OpenBidRequest>;
  getById(accessToken: string, deliveryId: string): Promise<CustomerDeliveryDetail>;
  list(accessToken: string, path: string): Promise<CustomerDeliveryPage>;
  listBids(accessToken: string, deliveryId: string): Promise<CustomerBid[]>;
  acceptBid(accessToken: string, deliveryId: string, bidId: string, idempotencyKey: string): Promise<BidAcceptance>;
  dismissBid(accessToken: string, deliveryId: string, bidId: string): Promise<void>;
  rateDelivery(accessToken: string, deliveryId: string, stars: number): Promise<{ stars: number }>;
  search(accessToken: string, deliveryId: string): Promise<void>;
  adjustOffer(accessToken: string, deliveryId: string, offeredPrice: string): Promise<{ customerOffer: string }>;
  cancel(accessToken: string, deliveryId: string): Promise<void>;
};
