import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DashboardSummary } from '../lib/types';
import { OverviewPage } from './OverviewPage';

const request = vi.hoisted(() => vi.fn());

vi.mock('../lib/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/client')>('../lib/client');
  return { ...actual, adminApi: { ...actual.adminApi, request } };
});

const summary: DashboardSummary = {
  deliveries: {
    total: 7,
    active: 2,
    completed: 4,
    cancelled: 1,
    failed: 0,
    byStatus: {
      CREATED: 0,
      SEARCHING: 2,
      NO_RIDER_FOUND: 0,
      ASSIGNED: 0,
      RIDER_ASSIGNED: 0,
      COLLECTING: 0,
      COLLECTED: 0,
      OUT_FOR_DELIVERY: 0,
      ARRIVED_AT_PICKUP: 0,
      PICKED_UP: 0,
      IN_TRANSIT: 0,
      ARRIVED_AT_DROPOFF: 0,
      DELIVERED: 4,
      CANCELLED: 1,
      FAILED: 0,
    },
    last24Hours: 3,
  },
  riders: {
    total: 6,
    pending: 2,
    approved: 3,
    suspended: 1,
    rejected: 0,
    availability: { available: 1, busy: 1, offline: 1 },
  },
  customers: { total: 9, individual: 7, business: 2, last24Hours: 1 },
  motorcycles: { total: 4, pending: 0, verified: 2, rejected: 1, revoked: 0 },
};

afterEach(() => {
  cleanup();
  request.mockReset();
});

const licencePage = {
  data: [],
  pagination: { page: 1, limit: 1, total: 4, totalPages: 4 },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('admin overview', () => {
  it('shows the compact figures and only statuses that have deliveries', async () => {
    request.mockImplementation((path: string) => Promise.resolve(String(path).includes('verificationStatus=PENDING') ? licencePage : summary));
    renderPage();
    expect(screen.getByText('Loading the overview')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Active deliveries/ }).textContent).toContain('2');
    expect(screen.getByRole('link', { name: /Completed/ }).textContent).toContain('4');
    expect(screen.getByRole('link', { name: /^Cancelled/ }).textContent).toContain('1');
    expect(screen.getByRole('link', { name: /Customers/ }).textContent).toContain('9');
    expect(screen.getByLabelText('Recent activity').textContent).toContain('3');
    expect(screen.getByRole('link', { name: /Failed/ }).textContent).toContain('0');
    const approvals = screen.getByRole('link', { name: /Rider approvals/ });
    const licences = screen.getByRole('link', { name: /Licence reviews/ });
    const motorcycles = screen.getByRole('link', { name: /Motorcycle reviews/ });
    expect(approvals.textContent).toContain('2');
    expect(approvals.className).toContain('review-attention');
    expect(approvals.getAttribute('href')).toBe('/riders?approvalStatus=PENDING');
    expect(licences.textContent).toContain('4');
    expect(licences.textContent).not.toContain('Open');
    expect(licences.getAttribute('href')).toBe('/riders?verificationStatus=PENDING');
    expect(motorcycles.textContent).toContain('0');
    expect(motorcycles.className).not.toContain('review-attention');
    expect(screen.queryByText('Action required')).toBeNull();
    const chart = screen.getByRole('heading', { name: 'Deliveries by status' }).closest('section') as HTMLElement;
    expect(chart.textContent).toContain('Searching');
    expect(chart.textContent).toContain('Delivered');
    expect(chart.textContent).not.toContain('Created');
    expect(chart.textContent).not.toContain('Failed');
    const shown = [...chart.querySelectorAll('.bars b')].map((node) => Number(node.textContent));
    expect(shown).toEqual([2, 4, 1]);
    expect(shown.reduce((sum, value) => sum + value, 0)).toBe(summary.deliveries.total);
    expect(Object.values(summary.deliveries.byStatus).reduce((sum, value) => sum + value, 0)).toBe(summary.deliveries.total);
    fireEvent.click(screen.getByRole('button', { name: 'Show all statuses' }));
    expect(chart.textContent).toContain('Created');
    expect(chart.textContent).toContain('Failed');
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(chart.textContent).not.toContain('Created');
    expect(screen.getByText('Available').parentElement?.textContent).toContain('1');
    expect(screen.getByText('Busy').parentElement?.textContent).toContain('1');
    expect(screen.getByText('Offline').parentElement?.textContent).toContain('1');
    expect(screen.getByText('3 approved riders · 2 verified motorcycles')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
  });

  it('shows an error without replacing the status counts', async () => {
    request.mockRejectedValue(new Error('The overview could not be loaded.'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('The overview could not be loaded.');
    expect(screen.queryByRole('heading', { name: 'Deliveries by status' })).toBeNull();
  });
});
