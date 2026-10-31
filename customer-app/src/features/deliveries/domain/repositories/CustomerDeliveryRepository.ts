import type { PreparedBooking } from '../bookingDraft';
import type { CustomerDeliveryDetail } from '../customerDeliveryDetail';
import type { CustomerDeliveryPage } from '../customerDeliveryList';
import type { DeliveryQuote } from '../deliveryQuote';
import type { BidAcceptance, CustomerBid } from '../customerBids';
import type { OpenBidRequest } from '../openBidRequest';

export type CustomerDeliveryRepository = {
  quote(accessToken: string, booking: PreparedBooking): Promise<DeliveryQuote>;
  create(accessToken: string, booking: PreparedBooking, offeredPrice: string): Promise<CustomerDeliveryDetail>;
  createOpenRequest(accessToken: string, booking: PreparedBooking, offeredPrice: string): Promise<OpenBidRequest>;
  getById(accessToken: string, deliveryId: string): Promise<CustomerDeliveryDetail>;
  list(accessToken: string, path: string): Promise<CustomerDeliveryPage>;
  listBids(accessToken: string, deliveryId: string): Promise<CustomerBid[]>;
  acceptBid(accessToken: string, deliveryId: string, bidId: string, idempotencyKey: string): Promise<BidAcceptance>;
  search(accessToken: string, deliveryId: string): Promise<void>;
  adjustOffer(accessToken: string, deliveryId: string, offeredPrice: string): Promise<{ customerOffer: string }>;
  cancel(accessToken: string, deliveryId: string): Promise<void>;
};
