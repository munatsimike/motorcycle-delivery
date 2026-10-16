import { apiGet, apiPost } from '../../../services/api/apiClient';
import { createBody, quoteBody, type PreparedBooking } from '../domain/bookingDraft';
import { readCustomerDeliveryDetail, type CustomerDeliveryDetail } from '../domain/customerDeliveryDetail';
import { readCustomerDeliveryPage, type CustomerDeliveryPage } from '../domain/customerDeliveryList';
import { readDeliveryQuote, type DeliveryQuote } from '../domain/deliveryQuote';
import type { CustomerDeliveryRepository } from '../domain/repositories/CustomerDeliveryRepository';

export class CustomerDeliveryApiRepository implements CustomerDeliveryRepository {
  async quote(accessToken: string, booking: PreparedBooking): Promise<DeliveryQuote> {
    const body = await apiPost<unknown>('/customers/me/deliveries/quote', quoteBody(booking), { accessToken });
    return readDeliveryQuote(body);
  }

  async create(accessToken: string, booking: PreparedBooking, offeredPrice: string): Promise<CustomerDeliveryDetail> {
    const body = await apiPost<unknown>('/customers/me/deliveries', createBody(booking, offeredPrice), { accessToken });
    return readCustomerDeliveryDetail(body);
  }

  async getById(accessToken: string, deliveryId: string): Promise<CustomerDeliveryDetail> {
    const body = await apiGet<unknown>(`/customers/me/deliveries/${encodeURIComponent(deliveryId)}`, { accessToken });
    return readCustomerDeliveryDetail(body);
  }

  async list(accessToken: string, path: string): Promise<CustomerDeliveryPage> {
    const body = await apiGet<unknown>(path, { accessToken });
    return readCustomerDeliveryPage(body);
  }

  async search(accessToken: string, deliveryId: string): Promise<void> {
    await apiPost<unknown>(
      `/customers/me/deliveries/${encodeURIComponent(deliveryId)}/search`,
      {},
      { accessToken },
    );
  }
}

export const customerDeliveryRepository = new CustomerDeliveryApiRepository();
