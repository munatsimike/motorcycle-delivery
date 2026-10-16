import type { CustomerDeliveryDetail } from '../customerDeliveryDetail';
import type { CustomerDeliveryPage } from '../customerDeliveryList';
import type { DeliveryQuote } from '../deliveryQuote';
import type { PreparedBooking } from '../bookingDraft';

export type CustomerDeliveryRepository = {
  quote(accessToken: string, booking: PreparedBooking): Promise<DeliveryQuote>;
  create(accessToken: string, booking: PreparedBooking, offeredPrice: string): Promise<CustomerDeliveryDetail>;
  getById(accessToken: string, deliveryId: string): Promise<CustomerDeliveryDetail>;
  list(accessToken: string, path: string): Promise<CustomerDeliveryPage>;
  search(accessToken: string, deliveryId: string): Promise<void>;
};
