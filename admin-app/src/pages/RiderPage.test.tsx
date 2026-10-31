import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RiderDetail, RiderWalletSummary } from '../lib/types';
import { RiderPage } from './RiderPage';

const request = vi.hoisted(() => vi.fn());

vi.mock('../lib/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/client')>('../lib/client');
  return { ...actual, adminApi: { ...actual.adminApi, request } };
});

const RIDER = '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5b';

const profile: RiderDetail = {
  riderProfileId: RIDER,
  fullName: 'Sample rider',
  phone: '+263000000000',
  email: null,
  accountStatus: 'ACTIVE',
  verificationStatus: 'VERIFIED',
  approvalStatus: 'APPROVED',
  availability: 'OFFLINE',
  licenceNumber: null,
  licenceClass: null,
  verifiedAt: null,
  licenceImage: null,
  motorcycles: [],
  createdAt: '2026-10-14T09:00:00.000Z',
  updatedAt: '2026-10-14T09:00:00.000Z',
};

function summary(source: RiderWalletSummary['borrowingLimitSource'], limit = '1.00'): RiderWalletSummary {
  return {
    riderProfileId: RIDER,
    balance: '-0.40',
    borrowingLimit: limit,
    borrowingLimitSource: source,
    reservedFees: '0.30',
    availableCapacity: '0.30',
    currency: 'USD',
  };
}

afterEach(() => {
  cleanup();
  request.mockReset();
});

function renderPage(wallet: RiderWalletSummary) {
  const puts: unknown[] = [];
  request.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    const method = options?.method ?? 'GET';
    if (method === 'GET' && path === `/admin/riders/${RIDER}`) return profile;
    if (method === 'GET' && path === `/admin/riders/${RIDER}/wallet`) return wallet;
    if (method === 'PUT' && path === `/admin/riders/${RIDER}/wallet/negative-limit`) {
      puts.push(options?.body);
      const body = options?.body as { borrowingLimit: string | null };
      if (body.borrowingLimit === null) return summary('DEFAULT', '1.00');
      return { ...wallet, borrowingLimit: body.borrowingLimit, borrowingLimitSource: 'OVERRIDE' as const };
    }
    throw new Error(`Unexpected ${method} ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/riders/${RIDER}`]}>
        <Routes>
          <Route path="/riders/:riderProfileId" element={<RiderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return puts;
}

describe('rider negative wallet limit', () => {
  it('shows the standard limit and does not offer a borrow request', async () => {
    renderPage(summary('DEFAULT'));
    expect(await screen.findByText('Standard limit')).toBeTruthy();
    expect(screen.getByText('USD 1.00')).toBeTruthy();
    expect(screen.getByText('USD -0.40')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use the global default' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: /borrow/i })).toBeNull();
  });

  it('saves a zero account limit without changing the displayed balance', async () => {
    const puts = renderPage(summary('DEFAULT'));
    fireEvent.change(await screen.findByLabelText('Custom limit (USD)'), { target: { value: '0.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review custom limit' }));
    expect(screen.getByText('Set this rider\'s negative wallet limit to USD 0.00. The balance stays USD -0.40.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));
    await waitFor(() => expect(puts).toEqual([{ borrowingLimit: '0.00' }]));
    expect(await screen.findByText('Account-specific limit')).toBeTruthy();
    expect(screen.getByText('USD 0.00')).toBeTruthy();
    expect(screen.getByText('USD -0.40')).toBeTruthy();
    expect(request.mock.calls.some((call) => String(call[0]).includes('top-ups'))).toBe(false);
  });

  it('clears an account limit back to the global default', async () => {
    const puts = renderPage(summary('OVERRIDE', '2.00'));
    fireEvent.click(await screen.findByRole('button', { name: 'Use the global default' }));
    expect(screen.getByText('Use the global default for this rider. The balance stays USD -0.40.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));
    await waitFor(() => expect(puts).toEqual([{ borrowingLimit: null }]));
    expect(await screen.findByText('Standard limit')).toBeTruthy();
    expect(screen.getByText('USD 1.00')).toBeTruthy();
    expect(screen.getByText('USD -0.40')).toBeTruthy();
  });

  it('rejects a negative limit before calling the server', async () => {
    const puts = renderPage(summary('DEFAULT'));
    fireEvent.change(await screen.findByLabelText('Custom limit (USD)'), { target: { value: '-1.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review custom limit' }));
    expect(screen.getByText('Enter the limit in dollars and cents. Zero is allowed.')).toBeTruthy();
    expect(puts).toEqual([]);
  });
});
