import { describe, expect, it } from 'vitest';
import { CommissionCalculationError, commissionCents, snapshotCommission } from './commission-calculator.js';

describe('commissionCents', () => {
  it('rounds half away from zero', () => {
    expect(commissionCents(1, 5_000)).toBe(1);
    expect(commissionCents(1, 4_999)).toBe(0);
    expect(commissionCents(3, 5_000)).toBe(2);
    expect(commissionCents(100, 50)).toBe(1);
    expect(commissionCents(100, 49)).toBe(0);
    expect(commissionCents(10_001, 1)).toBe(1);
  });

  it('supports 0% and 100%', () => {
    expect(commissionCents(12_345, 0)).toBe(0);
    expect(commissionCents(0, 0)).toBe(0);
    expect(commissionCents(12_345, 10_000)).toBe(12_345);
    expect(commissionCents(1, 10_000)).toBe(1);
  });

  it('uses the accepted bid and ignores a suggested price', () => {
    const suggestedPriceCents = 50_000;
    expect(commissionCents(1_500, 1_000)).toBe(150);
    expect(suggestedPriceCents).toBe(50_000);
  });

  it('calculates a very small bid without floating point', () => {
    expect(commissionCents(1, 1)).toBe(0);
    expect(commissionCents(1, 5_001)).toBe(1);
    expect(source()).toContain('BigInt');
    expect(source()).not.toContain('Math.');
  });

  it.each([
    [-1, 1_000],
    [1.5, 1_000],
    [Number.NaN, 1_000],
    [Number.POSITIVE_INFINITY, 1_000],
    [100, -1],
    [100, 10_001],
    [100, 1.5],
    [Number.MAX_SAFE_INTEGER + 2, 1_000],
  ])('rejects bid %s and basis points %s', (bidCents, basisPoints) => {
    expect(() => commissionCents(bidCents, basisPoints)).toThrow(CommissionCalculationError);
  });

  it('rejects a commission that cannot fit in a safe integer', () => {
    const bidCents = Number.MAX_SAFE_INTEGER;
    expect(commissionCents(bidCents, 10_000)).toBe(bidCents);
    expect(source()).toContain('Commission amount is too large');
  });
});

describe('snapshotCommission', () => {
  it('freezes the accepted bid, rate version, and calculated amount together', () => {
    const snapshot = snapshotCommission({ acceptedBidCents: 1_000, basisPoints: 1_000, rateVersion: 3 });
    expect(snapshot).toEqual({
      acceptedBidCents: 1_000,
      basisPoints: 1_000,
      rateVersion: 3,
      commissionCents: 100,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('keeps an accepted snapshot when a later rate is published', () => {
    const accepted = snapshotCommission({ acceptedBidCents: 2_000, basisPoints: 1_000, rateVersion: 1 });
    const later = snapshotCommission({ acceptedBidCents: 2_000, basisPoints: 2_500, rateVersion: 2 });
    expect(accepted).toEqual({
      acceptedBidCents: 2_000,
      basisPoints: 1_000,
      rateVersion: 1,
      commissionCents: 200,
    });
    expect(later).toEqual({
      acceptedBidCents: 2_000,
      basisPoints: 2_500,
      rateVersion: 2,
      commissionCents: 500,
    });
  });

  it('snapshots 0% as zero commission and 100% as the whole bid', () => {
    expect(snapshotCommission({ acceptedBidCents: 80, basisPoints: 0, rateVersion: 4 }).commissionCents).toBe(0);
    expect(snapshotCommission({ acceptedBidCents: 80, basisPoints: 10_000, rateVersion: 4 }).commissionCents).toBe(80);
  });

  it('rejects a missing rate version', () => {
    expect(() => snapshotCommission({ acceptedBidCents: 100, basisPoints: 0, rateVersion: 0 })).toThrow(CommissionCalculationError);
  });
});

function source() {
  return commissionCents.toString();
}
