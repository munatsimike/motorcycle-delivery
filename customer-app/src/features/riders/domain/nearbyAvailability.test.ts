import { describe, expect, it, vi } from 'vitest';
import { needsAvailabilityRequest } from './customerLocation';
import { nearbyActionLabel, nearbyCardContent } from './nearbyCard';
import { resolveNearbyAvailability } from './nearbyAvailability';
import { readNearbyRiderCount } from './nearbyRiderCount';

describe('nearby rider availability', () => {
  it('does not request availability without a usable location', async () => {
    const fetchCount = vi.fn<(latitude: number, longitude: number) => Promise<number>>();
    expect(needsAvailabilityRequest({ status: 'services-off' })).toBe(false);
    expect(needsAvailabilityRequest({ status: 'permission-denied', canAskAgain: false })).toBe(false);
    expect(needsAvailabilityRequest({ status: 'position-unavailable' })).toBe(false);

    await expect(resolveNearbyAvailability({ status: 'services-off' }, fetchCount, () => 'failed')).resolves.toEqual({
      status: 'services-off',
    });
    await expect(resolveNearbyAvailability(
      { status: 'permission-denied', canAskAgain: true },
      fetchCount,
      () => 'failed',
    )).resolves.toEqual({ status: 'permission-denied', canAskAgain: true });
    await expect(resolveNearbyAvailability({ status: 'position-unavailable' }, fetchCount, () => 'failed')).resolves.toEqual({
      status: 'position-unavailable',
    });
    expect(fetchCount).not.toHaveBeenCalled();
  });

  it('keeps zero riders separate from a failed availability check', async () => {
    const fetchCount = vi.fn<(latitude: number, longitude: number) => Promise<number>>()
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error('Network request failed. Check your connection and try again.'));

    await expect(resolveNearbyAvailability(
      { status: 'ready', latitude: -17.82, longitude: 31.05 },
      fetchCount,
      (error) => (error instanceof Error ? error.message : 'failed'),
    )).resolves.toEqual({ status: 'ready', count: 0 });

    await expect(resolveNearbyAvailability(
      { status: 'ready', latitude: -17.82, longitude: 31.05 },
      fetchCount,
      (error) => (error instanceof Error ? error.message : 'failed'),
    )).resolves.toEqual({
      status: 'check-failed',
      message: 'Network request failed. Check your connection and try again.',
    });
    expect(fetchCount).toHaveBeenCalledTimes(2);
  });

  it('uses a distinct message for each location problem', () => {
    expect(nearbyCardContent({ status: 'services-off' })).toMatchObject({
      title: 'Location is turned off',
      action: 'turn-on-location',
    });
    expect(nearbyCardContent({ status: 'permission-denied', canAskAgain: false })).toMatchObject({
      title: 'Location access needed',
      action: 'allow-location',
    });
    expect(nearbyCardContent({ status: 'position-unavailable' })).toMatchObject({
      title: 'Unable to find your location',
      action: 'try-again',
    });
    expect(nearbyCardContent({ status: 'ready', count: 0 })).toMatchObject({
      title: 'Nearby riders',
      message: '0 riders are available near you.',
      action: null,
      icon: 'bike',
    });
    expect(nearbyCardContent({ status: 'check-failed', message: 'Check your connection and try again.' })).toMatchObject({
      title: 'Unable to check rider availability',
      message: 'Check your connection and try again.',
    });
    expect(nearbyCardContent({ status: 'ready', count: 2 })?.message).toBe('2 riders are available near you.');
    expect(nearbyCardContent({ status: 'services-off' })?.message).not.toContain('No riders nearby');
    expect(nearbyActionLabel('turn-on-location')).toBe('Turn On Location');
    expect(nearbyActionLabel('allow-location')).toBe('Allow Location');
    expect(nearbyActionLabel('try-again')).toBe('Try Again');
  });

  it('reads a rider count and rejects a missing count', () => {
    expect(readNearbyRiderCount({ count: 0 })).toBe(0);
    expect(readNearbyRiderCount({ count: 3 })).toBe(3);
    expect(() => readNearbyRiderCount({ count: -1 })).toThrow('Rider availability is unavailable.');
    expect(() => readNearbyRiderCount({})).toThrow('Rider availability is unavailable.');
  });
});
