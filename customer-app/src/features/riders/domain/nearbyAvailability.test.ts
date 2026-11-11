import { describe, expect, it, vi } from 'vitest';
import { needsAvailabilityRequest } from './customerLocation';
import { nearbyActionLabel, nearbyCardContent, nearbyHomeCountLabel } from './nearbyCard';
import { resolveNearbyAvailability } from './nearbyAvailability';
import { readNearbyRiderCount } from './nearbyRiderCount';

describe('nearby rider availability', () => {
  it('does not request availability without a usable location', async () => {
    const fetchNearby = vi.fn<(latitude: number, longitude: number) => Promise<{ count: number; points: Array<{ latitude: number; longitude: number; expiresAt: string }> }>>();
    expect(needsAvailabilityRequest({ status: 'services-off' })).toBe(false);
    expect(needsAvailabilityRequest({ status: 'permission-denied', canAskAgain: false })).toBe(false);
    expect(needsAvailabilityRequest({ status: 'position-unavailable' })).toBe(false);

    await expect(resolveNearbyAvailability({ status: 'services-off' }, fetchNearby, () => 'failed')).resolves.toEqual({
      status: 'services-off',
    });
    await expect(resolveNearbyAvailability(
      { status: 'permission-denied', canAskAgain: true },
      fetchNearby,
      () => 'failed',
    )).resolves.toEqual({ status: 'permission-denied', canAskAgain: true });
    await expect(resolveNearbyAvailability({ status: 'position-unavailable' }, fetchNearby, () => 'failed')).resolves.toEqual({
      status: 'position-unavailable',
    });
    expect(fetchNearby).not.toHaveBeenCalled();
  });

  it('keeps zero riders separate from a failed availability check', async () => {
    const fetchNearby = vi.fn<(latitude: number, longitude: number) => Promise<{ count: number; points: Array<{ latitude: number; longitude: number; expiresAt: string }> }>>()
      .mockResolvedValueOnce({ count: 0, points: [] })
      .mockRejectedValueOnce(new Error('Network request failed. Check your connection and try again.'));

    await expect(resolveNearbyAvailability(
      { status: 'ready', latitude: -17.82, longitude: 31.05 },
      fetchNearby,
      (error) => (error instanceof Error ? error.message : 'failed'),
    )).resolves.toEqual({ status: 'ready', count: 0, points: [] });

    await expect(resolveNearbyAvailability(
      { status: 'ready', latitude: -17.82, longitude: 31.05 },
      fetchNearby,
      (error) => (error instanceof Error ? error.message : 'failed'),
    )).resolves.toEqual({
      status: 'check-failed',
      message: 'Network request failed. Check your connection and try again.',
    });
    expect(fetchNearby).toHaveBeenCalledTimes(2);
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
    expect(nearbyCardContent({ status: 'ready', count: 0, points: [] })).toMatchObject({
      title: 'Nearby riders',
      message: '0 riders are available near you.',
      action: null,
      icon: 'bike',
    });
    expect(nearbyCardContent({ status: 'check-failed', message: 'Check your connection and try again.' })).toMatchObject({
      title: 'Unable to check rider availability',
      message: 'Check your connection and try again.',
    });
    expect(nearbyCardContent({ status: 'ready', count: 2, points: [] })?.message).toBe('2 riders are available near you.');
    expect(nearbyHomeCountLabel({ status: 'loading' })).toBe('Checking');
    expect(nearbyHomeCountLabel({ status: 'services-off' })).toBe('Location is off');
    expect(nearbyHomeCountLabel({ status: 'permission-denied', canAskAgain: true })).toBe('Location needed');
    expect(nearbyHomeCountLabel({ status: 'position-unavailable' })).toBe('Location unavailable');
    expect(nearbyHomeCountLabel({ status: 'check-failed', message: 'Check your connection and try again.' })).toBe('Unable to check');
    expect(nearbyHomeCountLabel({ status: 'ready', count: 0, points: [] })).toBe('0 riders nearby');
    expect(nearbyHomeCountLabel({ status: 'ready', count: 1, points: [] })).toBe('1 rider nearby');
    expect(nearbyHomeCountLabel({ status: 'ready', count: 4, points: [] })).toBe('4 riders nearby');
    expect(nearbyCardContent({ status: 'services-off' })?.message).not.toContain('No riders nearby');
    expect(nearbyActionLabel('turn-on-location')).toBe('Turn On Location');
    expect(nearbyActionLabel('allow-location')).toBe('Allow Location');
    expect(nearbyActionLabel('try-again')).toBe('Try Again');
  });

  it('drops expired approximate rider points before rendering them', async () => {
    const expired = new Date(Date.now() - 1_000).toISOString();
    const valid = new Date(Date.now() + 30_000).toISOString();
    const fetchNearby = vi.fn<(latitude: number, longitude: number) => Promise<{ count: number; points: Array<{ latitude: number; longitude: number; expiresAt: string }> }>>()
      .mockResolvedValueOnce({
        count: 2,
        points: [
          { latitude: -17.82, longitude: 31.05, expiresAt: expired },
          { latitude: -17.821, longitude: 31.051, expiresAt: valid },
        ],
      });

    await expect(resolveNearbyAvailability(
      { status: 'ready', latitude: -17.82, longitude: 31.05 },
      fetchNearby,
      () => 'failed',
    )).resolves.toEqual({ status: 'ready', count: 1, points: [{ latitude: -17.821, longitude: 31.051, expiresAt: valid }] });
  });

  it('reads a rider count and rejects a missing count', () => {
    expect(readNearbyRiderCount({ count: 0 })).toBe(0);
    expect(readNearbyRiderCount({ count: 3 })).toBe(3);
    expect(() => readNearbyRiderCount({ count: -1 })).toThrow('Rider availability is unavailable.');
    expect(() => readNearbyRiderCount({})).toThrow('Rider availability is unavailable.');
  });
});
