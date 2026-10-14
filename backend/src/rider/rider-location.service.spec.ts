import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { readGps } from './rider-location.js';
import { RiderLocationService } from './rider-location.service.js';

const RIDER = { userId: 'user-1', riderProfileId: 'profile-1' };
const NOW = new Date('2026-10-14T12:00:00.000Z');

describe('rider location updates', () => {
  it('accepts the latitude and longitude limits', () => {
    expect(readGps({ latitude: -90, longitude: -180 })).toEqual({
      latitude: '-90.0000000',
      longitude: '-180.0000000',
    });
    expect(readGps({ latitude: '90', longitude: '180' })).toEqual({
      latitude: '90.0000000',
      longitude: '180.0000000',
    });
  });

  it('rejects a coordinate outside the valid range', () => {
    expect(() => readGps({ latitude: 90.0000001, longitude: 0 })).toThrow(BadRequestException);
    expect(() => readGps({ latitude: 0, longitude: -180.0000001 })).toThrow(BadRequestException);
    expect(() => readGps({ latitude: null, longitude: 0 })).toThrow(BadRequestException);
    expect(() => readGps(null)).toThrow(BadRequestException);
  });

  it('stores the authenticated rider point with parameterized geography SQL', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const service = new RiderLocationService({
      async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        calls.push({ sql: strings.join(' '), values });
        return 1;
      },
    } as unknown as PrismaService);

    await expect(service.update(RIDER, { riderProfileId: 'other', latitude: 91, longitude: 0 }, NOW))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);

    const response = await service.update(RIDER, { latitude: -17.8, longitude: 31.05 }, NOW);
    expect(response).toEqual({ updatedAt: NOW.toISOString() });
    expect(calls[0]?.sql).toContain('ST_SetSRID');
    expect(calls[0]?.sql).toContain('ST_MakePoint');
    expect(calls[0]?.sql).toContain('::geography');
    expect(calls[0]?.sql).not.toContain('other');
    expect(calls[0]?.values[0]).toBe('profile-1');
    expect(calls[0]?.values[3]).toBeCloseTo(31.05);
    expect(calls[0]?.values[4]).toBeCloseTo(-17.8);
  });
});
