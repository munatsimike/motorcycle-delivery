import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/client';
import { when } from '../lib/labels';
import type { ClassTariff, Page, PricingAudit, V2CommissionAudit, V2CommissionRate } from '../lib/types';
import { SettingsPage } from './SettingsPage';

const request = vi.hoisted(() => vi.fn());

vi.mock('../lib/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/client')>('../lib/client');
  return { ...actual, adminApi: { ...actual.adminApi, request } };
});

type Call = { path: string; body?: unknown };

const wallet = { configVersion: 1, currency: 'USD', welcomeBonus: '0.00', defaultBorrowingLimit: '0.00', platformFee: '0.00' };
const v1 = { pricingVersion: 4, currency: 'USD', baseFee: '2.00', pricePerKilometre: '1.00', minimumTripMetres: 0, maximumTripMetres: 100_000 };
const commission = { model: 'ON_COMPLETION' as const, policyVersion: 2 };
const emptyAudits: Page<PricingAudit> = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
const emptyV2Audits: Page<V2CommissionAudit> = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

const world = {
  express: null as ClassTariff | null,
  flexible: null as ClassTariff | null,
  expressError: null as Error | null,
  auditError: null as Error | null,
  failPublish: null as string | null,
  publishGate: null as Promise<void> | null,
  posts: [] as Call[],
  puts: [] as unknown[],
  v2Posts: [] as unknown[],
  audits: emptyAudits,
  pageTwo: emptyAudits,
  v2Rate: { configured: false } as V2CommissionRate,
  v2Audits: emptyV2Audits,
};

beforeEach(() => {
  world.express = null;
  world.flexible = null;
  world.expressError = null;
  world.auditError = null;
  world.failPublish = null;
  world.publishGate = null;
  world.posts = [];
  world.puts = [];
  world.v2Posts = [];
  world.audits = emptyAudits;
  world.pageTwo = emptyAudits;
  world.v2Rate = { configured: false };
  world.v2Audits = emptyV2Audits;
  request.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    const method = options?.method ?? 'GET';
    if (method === 'PUT' && path === '/admin/delivery-pricing') {
      world.puts.push(options?.body);
      return { ...v1, pricingVersion: 5 };
    }
    if (method === 'POST' && path.includes('/windows/')) {
      world.posts.push({ path, body: options?.body });
      if (world.failPublish) {
        throw new ApiError(world.failPublish, 400);
      }
      const next = path.includes('FLEXIBLE') ? world.flexible : world.express;
      return next;
    }
    if (method === 'POST' && path.startsWith('/admin/delivery-pricing/classes/')) {
      world.posts.push({ path, body: options?.body });
      if (world.publishGate) {
        await world.publishGate;
      }
      if (world.failPublish) {
        throw new ApiError(world.failPublish, 400);
      }
      if (path.endsWith('/FLEXIBLE')) {
        return world.flexible;
      }
      return world.express;
    }
    if (method === 'POST' && path === '/admin/v2-commission-rate') {
      world.v2Posts.push(options?.body);
      return {
        configured: true,
        basisPoints: 0,
        percentage: '0',
        rateVersion: 1,
        createdById: 'admin-1',
        createdAt: '2026-10-24T07:00:00.000Z',
      };
    }
    if (path === '/admin/wallet-config') return wallet;
    if (path === '/admin/delivery-pricing') return v1;
    if (path === '/admin/commission-policy') return commission;
    if (path === '/admin/v2-commission-rate') return world.v2Rate;
    if (path.startsWith('/admin/v2-commission-rate/audits')) return world.v2Audits;
    if (path.startsWith('/admin/delivery-pricing/audits')) {
      if (world.auditError) throw world.auditError;
      const page = new URL(path, 'http://local').searchParams.get('page');
      return page === '2' ? world.pageTwo : world.audits;
    }
    if (path === '/admin/delivery-pricing/classes/EXPRESS') {
      if (world.expressError) throw world.expressError;
      return world.express;
    }
    if (path === '/admin/delivery-pricing/classes/FLEXIBLE') return world.flexible;
    throw new Error(`Unexpected ${method} ${path}`);
  });
});

afterEach(() => {
  cleanup();
});

describe('admin pricing settings', () => {
  it('keeps the V1 pricing editor on its existing contract', async () => {
    await renderReady();
    const panel = screen.getByRole('tabpanel', { name: 'V1 Legacy' });
    expect(within(panel).queryByLabelText('Pricing model')).toBeNull();
    fireEvent.change(within(panel).getByLabelText('Base fee'), { target: { value: '3.50' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Review pricing' }));
    expect(screen.getByRole('dialog').textContent).toContain('Base fee USD 3.50');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(world.puts).toEqual([{
      currency: 'USD',
      baseFee: '3.50',
      pricePerKilometre: '1.00',
      minimumTripMetres: 0,
      maximumTripMetres: 100_000,
    }]));
    expect(world.posts).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Commission policy' })).toBeTruthy();
  });

  it('keeps Express and Flexible drafts apart', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    const express = await screen.findByRole('tabpanel', { name: 'Express' });
    expect(express.textContent).toContain('Express pricing has not been published');
    fireEvent.change(within(express).getByLabelText('Pricing model'), { target: { value: 'FIXED' } });
    fireEvent.change(within(express).getByLabelText('Base fee'), { target: { value: '9.00' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Flexible' }));
    const flexible = await screen.findByRole('tabpanel', { name: 'Flexible' });
    expect(flexible.textContent).toContain('Flexible pricing has not been published');
    expect(within(flexible).queryByDisplayValue('9.00')).toBeNull();
    expect(within(flexible).queryByLabelText('Base fee')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    expect((within(await screen.findByRole('tabpanel', { name: 'Express' })).getByLabelText('Base fee') as HTMLInputElement).value).toBe('9.00');
  });

  it('shows an empty class without invented prices', async () => {
    world.expressError = new ApiError('Express pricing is not available', 404);
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Express' });
    expect(panel.textContent).toContain('No price is filled in for you.');
    expect(panel.textContent).not.toContain('Express pricing is not available');
    expect(panel.textContent).not.toContain('0.00');
    expect((within(panel).getByLabelText('Pricing model') as HTMLSelectElement).value).toBe('');
  });

  it('shows only the money fields for the selected model', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Express' });
    const model = within(panel).getByLabelText('Pricing model');
    fireEvent.change(model, { target: { value: 'FIXED' } });
    expect(within(panel).getByLabelText('Base fee')).toBeTruthy();
    expect(within(panel).queryByLabelText('Price per kilometre')).toBeNull();
    fireEvent.change(model, { target: { value: 'PER_KILOMETRE' } });
    expect(within(panel).queryByLabelText('Base fee')).toBeNull();
    expect(within(panel).getByLabelText('Price per kilometre')).toBeTruthy();
    fireEvent.change(model, { target: { value: 'BASE_PLUS_PER_KILOMETRE' } });
    expect(within(panel).getByLabelText('Base fee')).toBeTruthy();
    expect(within(panel).getByLabelText('Price per kilometre')).toBeTruthy();
    fireEvent.change(model, { target: { value: 'DISTANCE_TIERS' } });
    expect(within(panel).queryByLabelText('Base fee')).toBeNull();
    expect(within(panel).queryByLabelText('Price per kilometre')).toBeNull();
    expect(panel.textContent).toContain('own slice');
    expect(within(panel).getByRole('button', { name: 'Add tier' })).toBeTruthy();
  });

  it('edits distance tiers without repairing an invalid order', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Flexible' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Flexible' });
    fireEvent.change(within(panel).getByLabelText('Pricing model'), { target: { value: 'DISTANCE_TIERS' } });
    fireEvent.change(within(panel).getByLabelText('Minimum trip metres'), { target: { value: '0' } });
    fireEvent.change(within(panel).getByLabelText('Maximum trip metres'), { target: { value: '5000' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add tier' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Add tier' }));
    const first = within(panel).getByRole('region', { name: 'Tier 1' });
    const second = within(panel).getByRole('region', { name: 'Tier 2' });
    fireEvent.change(within(first).getByLabelText('Upper boundary in metres'), { target: { value: '1000' } });
    fireEvent.change(within(first).getByLabelText('Rate per kilometre'), { target: { value: '1.00' } });
    fireEvent.change(within(second).getByLabelText('Upper boundary in metres'), { target: { value: '5000' } });
    fireEvent.change(within(second).getByLabelText('Rate per kilometre'), { target: { value: '2.00' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Move tier earlier' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Review and publish' }));
    expect(panel.textContent).toContain('Tier boundaries must increase');
    expect((within(panel).getByRole('region', { name: 'Tier 1' }).querySelector('input') as HTMLInputElement).value).toBe('5000');
    expect((within(panel).getByRole('region', { name: 'Tier 2' }).querySelector('input') as HTMLInputElement).value).toBe('1000');
    fireEvent.click(within(panel).getByRole('region', { name: 'Tier 2' }).querySelector('button') as HTMLButtonElement);
    world.flexible = classTariff('FLEXIBLE', 2);
    fireEvent.click(within(panel).getByRole('button', { name: 'Review and publish' }));
    expect(screen.getByRole('dialog').textContent).toContain('USD 1.00');
    expect(screen.getByRole('dialog').textContent).toContain('USD 2.00');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0]).toEqual({
      path: '/admin/delivery-pricing/classes/FLEXIBLE',
      body: {
        pricingModel: 'DISTANCE_TIERS',
        currency: 'USD',
        minimumTripMetres: 0,
        maximumTripMetres: 5000,
        tiers: [
          { position: 1, upToMetres: 1000, amount: '1.00' },
          { position: 2, upToMetres: 5000, amount: '2.00' },
        ],
        windows: [],
      },
    });
    expect(world.puts).toEqual([]);
  });

  it('warns about overlapping windows and explains midnight windows', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Express' });
    selectFixed(panel);
    fireEvent.click(within(panel).getByRole('button', { name: 'Add window' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Add window' }));
    fillWindow(within(panel).getByRole('region', { name: 'Window 1' }), '08:00', '10:00');
    fillWindow(within(panel).getByRole('region', { name: 'Window 2' }), '09:00', '11:00');
    expect(panel.textContent).toContain('Night takes priority over Peak');
    expect(panel.textContent).toContain('stay as entered');
    expect((within(panel).getByRole('region', { name: 'Window 1' }).querySelector('input[placeholder="HH:MM"]') as HTMLInputElement).value).toBe('08:00');
    expect((within(panel).getByRole('region', { name: 'Window 2' }).querySelector('input[placeholder="HH:MM"]') as HTMLInputElement).value).toBe('09:00');
    fillWindow(within(panel).getByRole('region', { name: 'Window 2' }), '22:00', '02:00');
    expect(panel.textContent).toContain('This window crosses midnight');
  });

  it('publishes the confirmed Express request and refreshes the tariff', async () => {
    world.express = classTariff('EXPRESS', 3);
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Express' });
    selectFixed(panel);
    fireEvent.change(within(panel).getByLabelText('Base fee'), { target: { value: '3.50' } });
    fireEvent.change(within(panel).getByLabelText('Minimum trip metres'), { target: { value: '0' } });
    fireEvent.change(within(panel).getByLabelText('Maximum trip metres'), { target: { value: '10000' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add window' }));
    const window = within(panel).getByRole('region', { name: 'Window 1' });
    fireEvent.change(within(window).getByLabelText('Window'), { target: { value: 'NIGHT' } });
    fireEvent.click(within(window).getByRole('checkbox', { name: 'Monday' }));
    fillWindow(window, '22:00', '02:00', '-5');
    fireEvent.click(within(panel).getByRole('button', { name: 'Review and publish' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Model: Fixed');
    expect(dialog.textContent).toContain('Base fee USD 3.50');
    expect(dialog.textContent).toContain('crosses midnight');
    expect(dialog.textContent).toContain('-5%');
    world.express = classTariff('EXPRESS', 3);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(world.posts).toHaveLength(1));
    expect(world.posts[0]).toEqual({
      path: '/admin/delivery-pricing/classes/EXPRESS',
      body: {
        pricingModel: 'FIXED',
        currency: 'USD',
        baseFee: '3.50',
        minimumTripMetres: 0,
        maximumTripMetres: 10000,
        windows: [{
          kind: 'NIGHT',
          enabled: true,
          daysOfWeek: [1],
          startsAt: '22:00',
          endsAt: '02:00',
          adjustmentBasisPoints: -500,
        }],
      },
    });
    expect(await screen.findByText('Published Express version 3.')).toBeTruthy();
    expect(world.puts).toEqual([]);
  });

  it('keeps the entered tariff when publication fails', async () => {
    world.failPublish = 'Suggested price is negative';
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Express' });
    selectFixed(panel);
    fireEvent.change(within(panel).getByLabelText('Base fee'), { target: { value: '4.25' } });
    fireEvent.change(within(panel).getByLabelText('Minimum trip metres'), { target: { value: '0' } });
    fireEvent.change(within(panel).getByLabelText('Maximum trip metres'), { target: { value: '1000' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Review and publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Suggested price is negative')).toBeTruthy();
    expect((within(panel).getByLabelText('Base fee') as HTMLInputElement).value).toBe('4.25');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((within(panel).getByLabelText('Base fee') as HTMLInputElement).value).toBe('4.25');
  });

  it('sends one publish request when confirm is clicked twice', async () => {
    let release = () => {};
    world.publishGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    world.express = classTariff('EXPRESS', 2);
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Express' });
    selectFixed(panel);
    fireEvent.change(within(panel).getByLabelText('Minimum trip metres'), { target: { value: '0' } });
    fireEvent.change(within(panel).getByLabelText('Maximum trip metres'), { target: { value: '1000' } });
    fireEvent.change(within(panel).getByLabelText('Base fee'), { target: { value: '1.00' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Review and publish' }));
    const publish = within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' });
    fireEvent.click(publish);
    fireEvent.click(publish);
    await waitFor(() => expect(world.posts).toHaveLength(1));
    release();
    await waitFor(() => expect(screen.getByText('Published Express version 2.')).toBeTruthy());
    expect(world.posts).toHaveLength(1);
  });

  it('toggles a published window through the next version and uses the new id', async () => {
    world.express = classTariff('EXPRESS', 1, {
      windows: [windowRow('window-1', true)],
    });
    await renderReady();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Express' });
    expect(panel.querySelector('[data-window-id="window-1"]')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Enabled' }));
    expect(screen.getByRole('dialog').textContent).toContain('new Express tariff version');
    expect(screen.getByRole('dialog').textContent).toContain('previous version stays unchanged');
    world.express = classTariff('EXPRESS', 2, { windows: [windowRow('window-2', false)] });
    fireEvent.click(screen.getByRole('button', { name: 'Publish window' }));
    await waitFor(() => expect(panel.querySelector('[data-window-id="window-2"]')).toBeTruthy());
    expect(world.posts[0]).toEqual({
      path: '/admin/delivery-pricing/classes/EXPRESS/windows/window-1',
      body: { enabled: false },
    });
    expect(panel.querySelector('[data-window-id="window-1"]')).toBeNull();
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Enabled' }));
    world.express = classTariff('EXPRESS', 3, { windows: [windowRow('window-3', true)] });
    fireEvent.click(screen.getByRole('button', { name: 'Publish window' }));
    await waitFor(() => expect(world.posts[1]?.path).toBe('/admin/delivery-pricing/classes/EXPRESS/windows/window-2'));
    expect(world.posts[1]?.body).toEqual({ enabled: true });
  });

  it('pages pricing audits without assigning a service class', async () => {
    const createdAt = '2026-01-05T10:00:00.000Z';
    world.audits = {
      data: [{ id: 'audit-1', actorId: 'admin-1', previousVersion: null, nextVersion: 1, createdAt }],
      pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
    };
    world.pageTwo = {
      data: [{ id: 'audit-2', actorId: 'admin-2', previousVersion: 1, nextVersion: 2, createdAt }],
      pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
    };
    await renderReady();
    expect(screen.getByText('admin-1')).toBeTruthy();
    expect(screen.getByText('None')).toBeTruthy();
    expect(screen.getByText(when(createdAt))).toBeTruthy();
    expect(screen.getByText(/does not name a service class/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('admin-2')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('/admin/delivery-pricing/audits?page=2&limit=20');
  });

  it('shows authorization and API errors with retry', async () => {
    world.expressError = new ApiError('Admin access is required', 403);
    world.auditError = new ApiError('The request could not be completed.', 500);
    await renderReady();
    expect(screen.getByText('The request could not be completed.')).toBeTruthy();
    world.auditError = null;
    fireEvent.click(within(screen.getByRole('heading', { name: 'Pricing history' }).closest('section') as HTMLElement).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No pricing changes have been published.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Express' }));
    expect(await screen.findByText('Admin access is required')).toBeTruthy();
    world.expressError = null;
    fireEvent.click(within(screen.getByRole('tabpanel', { name: 'Express' })).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Express pricing has not been published/)).toBeTruthy();
  });

  it('shows an unpublished V2 percentage separately from a published 0%', async () => {
    await renderReady();
    const section = v2Section();
    expect(section.textContent).toContain('No V2 commission percentage has been published.');
    expect(within(section).queryByText(/Version/)).toBeNull();
    world.v2Rate = {
      configured: true,
      basisPoints: 0,
      percentage: '0',
      rateVersion: 3,
      createdById: 'admin-1',
      createdAt: '2026-10-24T07:00:00.000Z',
    };
    cleanup();
    await renderReady();
    const published = v2Section();
    expect(published.textContent).toContain('0% · Version 3');
    expect(published.textContent).not.toContain('No V2 commission percentage has been published.');
    expect((within(published).getByLabelText('Percentage') as HTMLInputElement).value).toBe('0');
  });

  it('asks for confirmation before publishing 100% and rejects an invalid percentage', async () => {
    await renderReady();
    const section = v2Section();
    fireEvent.change(within(section).getByLabelText('Percentage'), { target: { value: '101' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Review V2 commission' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(world.v2Posts).toEqual([]);
    expect(screen.getByText('Enter a commission percentage from 0 to 100, with at most two decimal places.')).toBeTruthy();
    fireEvent.change(within(section).getByLabelText('Percentage'), { target: { value: '100' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Review V2 commission' }));
    expect(screen.getByRole('dialog').textContent).toContain('V2 commission 100% for Express and Flexible deliveries.');
    expect(world.v2Posts).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(world.v2Posts).toEqual([{ percentage: '100' }]));
    expect(screen.getByRole('heading', { name: 'Commission policy' })).toBeTruthy();
  });

  it('shows V2 commission audit history', async () => {
    world.v2Audits = {
      data: [{
        id: 'audit-1',
        actorId: 'admin-9',
        previousVersion: null,
        nextVersion: 1,
        previousBasisPoints: null,
        nextBasisPoints: 1000,
        previousPercentage: null,
        nextPercentage: '10',
        createdAt: '2026-10-24T07:00:00.000Z',
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    await renderReady();
    const history = screen.getByRole('heading', { name: 'V2 commission history' }).closest('section') as HTMLElement;
    expect(history.textContent).toContain('admin-9');
    expect(history.textContent).toContain('None');
    expect(history.textContent).toContain('10% · version 1');
  });
});

function v2Section() {
  return screen.getByRole('heading', { name: 'V2 commission percentage' }).closest('section') as HTMLElement;
}

async function renderReady() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
  const legacy = await screen.findByRole('tabpanel', { name: 'V1 Legacy' });
  await within(legacy).findByLabelText('Base fee');
}

function selectFixed(panel: HTMLElement) {
  fireEvent.change(within(panel).getByLabelText('Pricing model'), { target: { value: 'FIXED' } });
}

function fillWindow(region: HTMLElement, startsAt: string, endsAt: string, percent = '0') {
  const times = within(region).getAllByPlaceholderText('HH:MM');
  fireEvent.change(times[0] as HTMLInputElement, { target: { value: startsAt } });
  fireEvent.change(times[1] as HTMLInputElement, { target: { value: endsAt } });
  fireEvent.change(within(region).getByLabelText('Price adjustment (%)'), { target: { value: percent } });
  const monday = within(region).getByRole('checkbox', { name: 'Monday' }) as HTMLInputElement;
  if (!monday.checked) {
    fireEvent.click(monday);
  }
}

function classTariff(serviceClass: 'EXPRESS' | 'FLEXIBLE', pricingVersion: number, patch: Partial<ClassTariff> = {}): ClassTariff {
  return {
    serviceClass,
    pricingVersion,
    pricingModel: 'FIXED',
    currency: 'USD',
    baseFee: '1.00',
    pricePerKilometre: '0.00',
    minimumTripMetres: 0,
    maximumTripMetres: 10000,
    isActive: true,
    tiers: [],
    windows: [],
    ...patch,
  };
}

function windowRow(id: string, enabled: boolean): ClassTariff['windows'][number] {
  return {
    id,
    kind: 'NIGHT',
    enabled,
    daysOfWeek: [1],
    startsAt: '22:00',
    endsAt: '02:00',
    adjustmentBasisPoints: 0,
    createdAt: '2026-01-05T10:00:00.000Z',
  };
}
