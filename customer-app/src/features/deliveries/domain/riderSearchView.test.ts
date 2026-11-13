import { describe, expect, it } from 'vitest';

import { riderSearchView } from './riderSearchView';

describe('riderSearchView', () => {
  it('keeps a historical search on the delivery details view', () => {
    expect(riderSearchView({
      hasDelivery: true,
      isLoading: false,
      status: 'SEARCHING',
      error: null,
    })).toBe('details');
  });

  it('shows rider assigned when a rider accepts', () => {
    expect(riderSearchView({
      hasDelivery: true,
      isLoading: false,
      status: 'ASSIGNED',
      error: null,
    })).toBe('assigned');
  });

  it('shows no rider found without pretending the search is still running', () => {
    expect(riderSearchView({
      hasDelivery: true,
      isLoading: false,
      status: 'NO_RIDER_FOUND',
      error: null,
    })).toBe('no-rider');
  });

  it('stops the search animation when the connection fails', () => {
    expect(riderSearchView({
      hasDelivery: true,
      isLoading: false,
      status: 'SEARCHING',
      error: 'Network request failed. Check your connection and try again.',
    })).toBe('offline');
    expect(riderSearchView({
      hasDelivery: false,
      isLoading: false,
      status: null,
      error: 'The request timed out. Check your connection and try again.',
    })).toBe('offline');
    expect(riderSearchView({
      hasDelivery: false,
      isLoading: false,
      status: null,
      error: 'Authentication failed',
    })).toBe('details');
  });
});
