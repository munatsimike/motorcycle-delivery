import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../lib/client';
import type { DeliveryDetail } from '../lib/types';
import { DeliveryPage } from './DeliveryPage';

const request = vi.hoisted(() => vi.fn());

vi.mock('../lib/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/client')>('../lib/client');
  return { ...actual, adminApi: { ...actual.adminApi, request } };
});

afterEach(() => {
  cleanup();
  request.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/deliveries/delivery-1']}>
        <Routes>
          <Route path="/deliveries/:deliveryId" element={<DeliveryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function detail(patch: Partial<DeliveryDetail> = {}): DeliveryDetail {
  return {
    deliveryId: 'delivery-1',
    deliveryType: 'PARCEL',
    status: 'ASSIGNED',
    pickupAddress: 'Avondale',
    dropoffAddress: 'CBD',
    price: '5.00',
    currency: 'USD',
    paymentMethod: 'CASH',
    activeAssignment: { id: 'assignment-1', riderProfileId: 'rider-1', motorcycleId: 'bike-1', status: 'ACCEPTED' },
    createdAt: '2026-10-24T09:00:00.000Z',
    updatedAt: '2026-10-24T10:00:00.000Z',
    parcelSize: 'SMALL',
    suggestedPrice: '5.00',
    distanceMeters: 1200,
    pricingVersion: 4,
    payer: 'SENDER',
    serviceClass: null,
    deliverBy: null,
    assignments: [{
      id: 'assignment-1',
      riderProfileId: 'rider-1',
      riderName: 'Tariro Moyo',
      motorcycleId: 'bike-1',
      status: 'ACCEPTED',
      offerExpiresAt: '2026-10-24T10:10:00.000Z',
      respondedAt: '2026-10-24T10:00:00.000Z',
      releaseReason: null,
      releasedAt: null,
      createdAt: '2026-10-24T09:50:00.000Z',
    }],
    statusTimeline: [{
      id: 'event-1',
      previousStatus: null,
      newStatus: 'CREATED',
      actorType: 'CUSTOMER',
      occurredAt: '2026-10-24T09:00:00.000Z',
    }],
    bids: [],
    acceptances: [],
    unmatchedReservations: [],
    ...patch,
  };
}

describe('DeliveryPage', () => {
  it('shows a loading state', () => {
    request.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole('status').textContent).toBe('Loading the delivery');
  });

  it('shows an error state', async () => {
    request.mockRejectedValue(new ApiError('Delivery detail is unavailable', 500));
    renderPage();
    expect(await screen.findByText('Delivery detail is unavailable')).toBeTruthy();
  });

  it('keeps a V1 delivery on the existing record', async () => {
    request.mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByText('Avondale')).toBeTruthy();
    expect(screen.getByText('Status timeline')).toBeTruthy();
    expect(screen.queryByText('Marketplace booking')).toBeNull();
    expect(screen.queryByText('Bids')).toBeNull();
    expect(screen.getByText('Rider Tariro Moyo')).toBeTruthy();
    expect(screen.getByText(/Created/)).toBeTruthy();
  });

  it('shows a Flexible booking, the accepted bid, and a reserved commission', async () => {
    request.mockResolvedValue(detail({
      status: 'RIDER_ASSIGNED',
      price: '9.50',
      suggestedPrice: '8.00',
      paymentMethod: null,
      payer: null,
      serviceClass: 'FLEXIBLE',
      deliverBy: '2026-10-24T16:30:00.000Z',
      bids: [
        {
          id: 'bid-2',
          riderProfileId: 'rider-2',
          riderName: 'Chipo Ncube',
          amount: '11.00',
          currency: 'USD',
          status: 'OPEN',
          closedAt: null,
          createdAt: '2026-10-24T11:02:00.000Z',
          accepted: false,
        },
        {
          id: 'bid-1',
          riderProfileId: 'rider-1',
          riderName: 'Tariro Moyo',
          amount: '9.50',
          currency: 'USD',
          status: 'ACCEPTED',
          closedAt: null,
          createdAt: '2026-10-24T11:00:00.000Z',
          accepted: true,
        },
      ],
      acceptances: [{
        assignmentId: 'assignment-1',
        assignmentStatus: 'ACCEPTED',
        riderProfileId: 'rider-1',
        riderName: 'Tariro Moyo',
        acceptedBidId: 'bid-1',
        acceptedAt: '2026-10-24T11:05:00.000Z',
        bidAmount: '9.50',
        currency: 'USD',
        basisPoints: 1000,
        rateVersion: 3,
        commissionAmount: '0.95',
        reservation: {
          id: 'reservation-1',
          assignmentId: 'assignment-1',
          amount: '0.95',
          currency: 'USD',
          status: 'OPEN',
          createdAt: '2026-10-24T11:05:00.000Z',
          releasedAt: null,
          capturedAt: null,
        },
        commissionState: 'RESERVED',
      }],
      statusTimeline: [
        {
          id: 'event-2',
          previousStatus: 'CREATED',
          newStatus: 'RIDER_ASSIGNED',
          actorType: 'CUSTOMER',
          occurredAt: '2026-10-24T11:05:00.000Z',
        },
      ],
    }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Marketplace booking' })).toBeTruthy();
    expect(screen.getByText('Flexible')).toBeTruthy();
    const booking = screen.getByRole('heading', { name: 'Marketplace booking' }).closest('section');
    expect(booking?.textContent).toContain('USD 8.00');
    expect(booking?.textContent).toContain('Agreed price.');
    expect(booking?.textContent).toContain('USD 9.50');
    const amounts = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(amounts).toContain('USD 9.50');
    expect(amounts.indexOf('USD 11.00')).toBeLessThan(amounts.indexOf('USD 9.50'));
    expect(screen.getAllByText(/Accepted bid/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Reserved at acceptance/)).toBeTruthy();
    expect(screen.getAllByText('Rider assigned').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
  });

  it('shows an empty bid list and does not invent a delivered event', async () => {
    request.mockResolvedValue(detail({
      status: 'DELIVERED',
      serviceClass: 'EXPRESS',
      price: null,
      suggestedPrice: '8.00',
      paymentMethod: null,
      payer: null,
      activeAssignment: null,
      assignments: [],
      bids: [],
      acceptances: [],
      statusTimeline: [],
    }));
    renderPage();
    expect(await screen.findByText('No bids have been submitted.')).toBeTruthy();
    expect(screen.getByText('No bid has been accepted.')).toBeTruthy();
    expect(screen.getByText('No status events.')).toBeTruthy();
    const booking = screen.getByRole('heading', { name: 'Marketplace booking' }).closest('section');
    expect(booking?.textContent).toContain('—');
    expect(screen.getByText('Express')).toBeTruthy();
  });

  it('keeps a closed acceptance visible after the request reopens', async () => {
    request.mockResolvedValue(detail({
      status: 'CREATED',
      serviceClass: 'FLEXIBLE',
      price: null,
      suggestedPrice: '8.00',
      paymentMethod: null,
      payer: null,
      activeAssignment: null,
      bids: [{
        id: 'bid-1',
        riderProfileId: 'rider-1',
        riderName: 'Tariro Moyo',
        amount: '9.50',
        currency: 'USD',
        status: 'ACCEPTED',
        closedAt: '2026-10-24T11:20:00.000Z',
        createdAt: '2026-10-24T11:00:00.000Z',
        accepted: true,
      }],
      acceptances: [{
        assignmentId: 'assignment-1',
        assignmentStatus: 'CANCELLED',
        riderProfileId: 'rider-1',
        riderName: 'Tariro Moyo',
        acceptedBidId: 'bid-1',
        acceptedAt: '2026-10-24T11:05:00.000Z',
        bidAmount: '9.50',
        currency: 'USD',
        basisPoints: 0,
        rateVersion: 3,
        commissionAmount: '0.00',
        reservation: null,
        commissionState: 'NOT_RESERVED',
      }],
    }));
    renderPage();
    expect((await screen.findAllByText(/Accepted bid/)).length).toBeGreaterThan(0);
    expect(screen.getByText('No commission was reserved')).toBeTruthy();
    expect(screen.getByText(/0\.00%/)).toBeTruthy();
    const booking = screen.getByRole('heading', { name: 'Marketplace booking' }).closest('section');
    expect(booking?.textContent).toContain('—');
  });
});
