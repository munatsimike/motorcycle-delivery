import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DISPATCH_ROUND_RADII_METRES } from './dispatch.constants.js';
import { approximateCustomerMapPoint, countNearbyAvailableRiders, NEARBY_RIDER_FRESH_MS, NEARBY_RIDER_POINT_TTL_MS, NEARBY_RIDER_RADIUS_METRES } from './nearby-riders.query.js';

const RIDER_A = '11111111-1111-4111-8111-111111111111';
const RIDER_B = '22222222-2222-4222-8222-222222222222';
const RIDER_C = '33333333-3333-4333-8333-333333333333';
const RIDER_D = '44444444-4444-4444-8444-444444444444';
const RIDER_E = '55555555-5555-4555-8555-555555555555';
import { NearbyRidersService, readNearbyPoint } from './nearby-riders.service.js';

describe('nearby rider availability', () => {
  it('uses the first dispatch radius and rejects a count without querying for a bad location', async () => {
    expect(NEARBY_RIDER_RADIUS_METRES).toBe(DISPATCH_ROUND_RADII_METRES[0]);
    const db = fakeDb([{ count: 4 }]);
    const service = new NearbyRidersService(db.client as never);

    await expect(service.count({ latitude: '91', longitude: '31' })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.calls).toHaveLength(0);
    expect(readNearbyPoint({ latitude: '-17.8292', longitude: '31.0522' })).toEqual({
      latitude: -17.8292,
      longitude: 31.0522,
    });
  });

  it('returns one marker for every rider who can receive a request', async () => {
    const now = new Date('2026-10-16T12:00:00.000Z');
    const positions = [
      { id: RIDER_A, latitude: -17.8292, longitude: 31.0522 },
      { id: RIDER_B, latitude: -17.83, longitude: 31.053 },
      { id: RIDER_C, latitude: -17.831, longitude: 31.054 },
      { id: RIDER_D, latitude: -17.832, longitude: 31.055 },
      { id: RIDER_E, latitude: -17.833, longitude: 31.056 },
    ];
    const db = fakeDb([], positions);
    const service = new NearbyRidersService(db.client as never);

    const nearby = await service.count({ latitude: '-17.8292', longitude: '31.0522' }, now);
    expect(nearby.count).toBe(5);
    expect(nearby.points.map((point) => point.id)).toEqual([RIDER_A, RIDER_B, RIDER_C, RIDER_D, RIDER_E]);
    expect(new Set(nearby.points.map((point) => point.id)).size).toBe(5);
    expect(nearby.points[0]).toEqual({
      id: RIDER_A,
      latitude: expect.any(Number),
      longitude: expect.any(Number),
      expiresAt: new Date(now.getTime() + NEARBY_RIDER_POINT_TTL_MS).toISOString(),
    });
    expect(nearby.points[0]).not.toHaveProperty('riderProfileId');
    expect(nearby.points[0]).not.toHaveProperty('name');
    expect(Math.abs(nearby.points[0].latitude - -17.8292)).toBeLessThan(0.001);
    expect(Math.abs(nearby.points[0].longitude - 31.0522)).toBeLessThan(0.001);

    const one = fakeDb([], [positions[0]!]);
    expect((await new NearbyRidersService(one.client as never).count({ latitude: '-17.8292', longitude: '31.0522' }, now)).count).toBe(1);
    const none = fakeDb([], []);
    expect((await new NearbyRidersService(none.client as never).count({ latitude: '-17.8292', longitude: '31.0522' }, now)).points).toEqual([]);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain('ST_Y');
    expect(db.calls[0]?.sql).toContain('p."id" AS id');
    expect(db.calls[0]?.sql).toContain('ST_DWithin');
    expect(db.calls[0]?.sql).toContain(`'AVAILABLE'`);
    expect(db.calls[0]?.sql).toContain('receiving_requests" IS TRUE');
    expect(db.calls[0]?.sql).not.toContain(`'ACCEPTED'`);
    expect(db.calls[0]?.sql).toContain('APPROVED');
    expect(db.calls[0]?.sql).toContain('VERIFIED');
    expect(db.calls[0]?.values).toContain(NEARBY_RIDER_RADIUS_METRES);
    expect(db.calls[0]?.values).toContain(-17.8292);
    expect(db.calls[0]?.values).toContain(31.0522);
    expect(db.calls[0]?.values).toContainEqual(new Date(now.getTime() - NEARBY_RIDER_FRESH_MS));
  });

  it('keeps an offer marker approximate and stable inside one 20 m cell', () => {
    const first = approximateCustomerMapPoint(-17.824, 31.05, 4);
    const nudged = approximateCustomerMapPoint(-17.82401, 31.05001, 4);
    const moved = approximateCustomerMapPoint(-17.826, 31.052, 4);
    expect(first).toEqual(nudged);
    expect(first).not.toEqual(moved);
    expect(first).not.toEqual({ latitude: -17.824, longitude: 31.05 });
    expect(Math.abs(first.latitude - -17.824)).toBeLessThan(0.0005);
    expect(Math.abs(first.longitude - 31.05)).toBeLessThan(0.0005);
  });

  it('does not treat a database failure as zero riders', async () => {
    const db = fakeDb();
    db.fail = true;
    await expect(countNearbyAvailableRiders(db.client, {
      latitude: -17.8,
      longitude: 31.05,
      freshAfter: new Date('2026-10-16T11:59:00.000Z'),
    })).rejects.toThrow('database');
  });
});

function fakeDb(
  rows: Array<{ count: number }> = [],
  positions: Array<{ id: string; latitude: number; longitude: number }> = [],
) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const state: { fail: boolean } = { fail: false };
  const client = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(' ');
      calls.push({ sql, values });
      if (state.fail) {
        throw new Error('database');
      }
      return sql.includes('ST_Y') ? positions : rows;
    },
  };
  return {
    calls,
    client: client as never,
    get fail() {
      return state.fail;
    },
    set fail(value: boolean) {
      state.fail = value;
    },
  };
}
