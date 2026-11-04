import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiPost = vi.fn();
const apiGet = vi.fn();

vi.mock('../../../services/api/apiClient', () => ({
  ACCEPTANCE_TIMEOUT_MS: 35_000,
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
}));

import { CustomerDeliveryApiRepository } from './CustomerDeliveryApiRepository';

describe('customer delivery API timeouts', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiGet.mockReset();
  });

  it('applies a 35 second timeout only to bid acceptance', async () => {
    apiPost.mockResolvedValue({
      deliveryId: 'delivery-1',
      bidId: 'bid-1',
      status: 'RIDER_ASSIGNED',
      acceptedBidAmount: '9.00',
      replayed: false,
    });
    const repository = new CustomerDeliveryApiRepository();
    await repository.acceptBid('token', 'delivery-1', 'bid-1', 'idem-1');
    expect(apiPost).toHaveBeenCalledWith(
      '/customers/me/deliveries/delivery-1/bids/bid-1/acceptance',
      {},
      expect.objectContaining({
        accessToken: 'token',
        headers: { 'Idempotency-Key': 'idem-1' },
        timeoutMs: 35_000,
      }),
    );

    apiPost.mockResolvedValue({ id: 'delivery-1' });
    await repository.search('token', 'delivery-1');
    const searchOptions = apiPost.mock.calls.at(-1)?.[2] as { timeoutMs?: number };
    expect(searchOptions.timeoutMs).toBeUndefined();
  });
});
