import { describe, expect, it } from 'vitest';
import type { RoadRoute } from './geoapify.js';
import {
  PICKUP_APPROACH_MAX_AGE_MS,
  approachCell,
  createPickupApproachCache,
  pickupApproachKey,
} from './pickup-approach.js';

const query = {
  riderProfileId: 'rider-1',
  riderLatitude: -17.8012,
  riderLongitude: 31.1094,
  pickupLatitude: -17.8292,
  pickupLongitude: 31.0522,
};

function road(seconds: number | null = 420): RoadRoute {
  return {
    metres: 2400,
    seconds,
    line: [[31.1094, -17.8012], [31.08, -17.81], [31.0522, -17.8292]],
  };
}

describe('pickup approach cache', () => {
  it('reuses one route while the rider stays in the same cell', async () => {
    let calls = 0;
    const cache = createPickupApproachCache(async () => {
      calls += 1;
      return road();
    }, () => 1_000);
    const first = await cache.lookup(query);
    const second = await cache.lookup({ ...query, riderLatitude: query.riderLatitude + 0.0004 });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(first).toMatchObject({ metres: 2400, seconds: 420 });
    expect(first?.line[0]).toEqual({ longitude: 31.1094, latitude: -17.8012 });
  });

  it('requests a new route when the rider leaves the cell or the result expires', async () => {
    let calls = 0;
    let now = 5_000;
    const cache = createPickupApproachCache(async () => {
      calls += 1;
      return road(180);
    }, () => now);
    await cache.lookup(query);
    await cache.lookup({ ...query, riderLatitude: query.riderLatitude + 0.002 });
    expect(calls).toBe(2);
    now += PICKUP_APPROACH_MAX_AGE_MS;
    await cache.lookup(query);
    expect(calls).toBe(3);
    expect(pickupApproachKey(query)).not.toBe(pickupApproachKey({
      ...query,
      riderLatitude: query.riderLatitude + 0.002,
    }));
    expect(approachCell(query.riderLatitude)).not.toBe(approachCell(query.riderLatitude + 0.002));
  });

  it('does not invent a route when travel time is missing or routing fails', async () => {
    let calls = 0;
    let now = 10_000;
    const missing = createPickupApproachCache(async () => {
      calls += 1;
      return road(null);
    }, () => now);
    expect(await missing.lookup(query)).toBeNull();
    expect(await missing.lookup(query)).toBeNull();
    expect(calls).toBe(1);

    const failing = createPickupApproachCache(async () => {
      throw new Error('offline');
    }, () => now);
    expect(await failing.lookup(query)).toBeNull();
    expect(await failing.lookup({ ...query, pickupLatitude: -17.9 })).toBeNull();
  });
});
