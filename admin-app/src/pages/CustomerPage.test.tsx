import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CustomerPage } from './CustomerPage';

const request = vi.hoisted(() => vi.fn());

vi.mock('../lib/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/client')>('../lib/client');
  return { ...actual, adminApi: { ...actual.adminApi, request } };
});

const CUSTOMER = '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5b';

afterEach(() => {
  cleanup();
  request.mockReset();
});

describe('customer delivery history', () => {
  it('shows the profile and a read-only delivery page', async () => {
    request.mockImplementation(async (path: string) => {
      if (path === `/admin/customers/${CUSTOMER}`) {
        return {
          customerAccountId: CUSTOMER,
          name: 'Ada Stores',
          fullName: 'Ada Moyo',
          contactName: 'Ada',
          phone: '+263771000001',
          accountStatus: 'ACTIVE',
          kind: 'BUSINESS',
          address: 'Harare',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-02T00:00:00.000Z',
        };
      }
      return {
        data: [{
          deliveryId: '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5c',
          deliveryType: 'PARCEL',
          status: 'DELIVERED',
          pickupAddress: 'Pickup street',
          dropoffAddress: 'Drop-off street',
          price: '4.00',
          currency: 'USD',
          paymentMethod: 'CASH',
          activeAssignment: null,
          createdAt: '2026-10-03T00:00:00.000Z',
          updatedAt: '2026-10-03T01:00:00.000Z',
        }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/customers/${CUSTOMER}`]}>
          <Routes>
            <Route path="/customers/:customerAccountId" element={<CustomerPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Ada Stores' })).toBeTruthy();
    expect(screen.getAllByText('+263771000001').length).toBeGreaterThan(0);
    expect(screen.getByText('Harare')).toBeTruthy();
    expect(await screen.findByText('Pickup street')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Parcel' })).toHaveProperty('href', expect.stringContaining('/deliveries/018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5c'));
    expect(screen.getByText('Delivery history is read only.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /suspend/i })).toBeNull();
    expect(request.mock.calls.some((call) => String(call[0]).includes('/deliveries?page=1'))).toBe(true);
  });
});
