import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NotificationsPage } from './NotificationsPage';

const request = vi.hoisted(() => vi.fn());

vi.mock('../lib/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/client')>('../lib/client');
  return { ...actual, adminApi: { ...actual.adminApi, request } };
});

afterEach(() => {
  cleanup();
  request.mockReset();
});

describe('notification monitoring', () => {
  it('filters by status and shows a failed notice that has no stored error', async () => {
    request.mockImplementation(async (path: string) => ({
      data: path.includes('status=FAILED') ? [{
        id: 'notice-1',
        eventType: 'DELIVERED',
        status: 'FAILED',
        attemptCount: 2,
        lastFailure: null,
        deliveryId: '018f5b2a-6c3d-7e4f-8a9b-0c1d2e3f4a5c',
        createdAt: '2026-10-04T12:00:00.000Z',
        lastAttemptAt: null,
        sentAt: null,
        failedAt: '2026-10-04T12:05:00.000Z',
        nextAttemptAt: null,
      }] : [],
      pagination: { page: 1, limit: 20, total: path.includes('status=FAILED') ? 1 : 0, totalPages: 1 },
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/notifications']}>
          <Routes>
            <Route path="/notifications" element={<NotificationsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No notifications match these filters.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'FAILED' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-04' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('No stored error')).toBeTruthy();
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View delivery' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /resend|retry/i })).toBeNull();
    const last = String(request.mock.calls.at(-1)?.[0]);
    expect(last).toContain('status=FAILED');
    expect(last).toContain('from=2026-10-04');
  });
});