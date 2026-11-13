import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RidersPage } from './RidersPage';

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
  request.mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/riders']}>
        <Routes>
          <Route path="/riders" element={<RidersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('rider phone filter', () => {
  it('shows a validation message instead of requesting an invalid phone', async () => {
    renderPage();
    await screen.findByText('No riders match these filters.');
    fireEvent.change(screen.getByPlaceholderText('+2637…'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Enter a phone number with 7 to 15 digits. An optional leading + is allowed.')).toBeTruthy();
    expect(request.mock.calls.every((call) => !String(call[0]).includes('phone=abc'))).toBe(true);
  });
});
