import { describe, expect, it } from 'vitest';
import { RiderClass } from '../generated/prisma/client.js';
import { averageRating, riderClassFromStats } from './rider-class.js';

describe('rider class', () => {
  it('keeps unrated and under-threshold riders in Silver', () => {
    expect(riderClassFromStats(0, 0, 0)).toBe(RiderClass.SILVER);
    expect(averageRating(0, 0)).toBeNull();
    expect(riderClassFromStats(80, 9, 45)).toBe(RiderClass.SILVER);
    expect(riderClassFromStats(200, 9, 45)).toBe(RiderClass.SILVER);
    expect(riderClassFromStats(200, 10, 44)).toBe(RiderClass.SILVER);
  });

  it('promotes Gold and Platinum only with enough genuine ratings', () => {
    expect(riderClassFromStats(80, 10, 45)).toBe(RiderClass.GOLD);
    expect(riderClassFromStats(80, 10, 49)).toBe(RiderClass.GOLD);
    expect(riderClassFromStats(200, 10, 46)).toBe(RiderClass.GOLD);
    expect(riderClassFromStats(200, 10, 48)).toBe(RiderClass.PLATINUM);
    expect(averageRating(10, 45)).toBe(4.5);
    expect(averageRating(10, 48)).toBe(4.8);
  });
});
