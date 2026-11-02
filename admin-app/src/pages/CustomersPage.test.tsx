import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CustomersPage } from './CustomersPage';

const request = vi.hoisted(() => vi.fn());

vi.mock('../lib/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/client')>('../lib/client');
  return { ...actual, adminApi: { ...actual.adminApi, request } };
});

const customer = {
  customerAccountId: '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5b',
  name: 'Ada Stores',
  fullName: 'Ada Moyo',
  contactName: null,
  phone: '+263771000001',
  accountStatus: 'ACTIVE',
  kind: 'INDIVIDUAL',
  address: 'Harare',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  request.mockReset();
});

function renderPage(path = '/customers') {
  request.mockImplementation(async (requested: string) => {
    const url = new URL(requested, 'http://admin.local');
    return {
      data: url.searchParams.get('page') === '2' ? [] : [customer],
      pagination: { page: Number(url.searchParams.get('page') ?? '1'), limit: 20, total: 1, totalPages: 2 },
    };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/customers" element={<CustomersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('customer search', () => {
  it('sends the search to the server and keeps it on the next page', async () => {
    renderPage();
    expect((await screen.findAllByText('Ada Stores')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Name or phone'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect((await screen.findAllByRole('link', { name: 'Ada Stores' })).length).toBeGreaterThan(0);
    expect(request.mock.calls.some((call) => String(call[0]).includes('q=Ada'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('No customers match this search.');
    const last = String(request.mock.calls.at(-1)?.[0]);
    expect(last).toContain('page=2');
    expect(last).toContain('q=Ada');
  });
});
