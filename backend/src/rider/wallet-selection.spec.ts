import { describe, expect, it } from 'vitest';
import { selectWorkingWallet, usableFeeCapacityCents } from './wallet-ledger.js';

describe('working wallet selection', () => {
  it('prefers USD while that wallet has fee capacity', () => {
    expect(selectWorkingWallet({ usdUsableCents: 100, zigUsableCents: 500, zigOffersEnabled: true })).toBe('USD');
    expect(selectWorkingWallet({ usdUsableCents: 100, zigUsableCents: 500, zigOffersEnabled: false })).toBe('USD');
  });

  it('keeps USD when the cash balance is negative and borrowing room remains', () => {
    const usable = usableFeeCapacityCents({
      balanceCents: -200,
      borrowingLimitCents: 500,
      openCashHoldCents: 0,
      availablePromotionalCents: 0,
      prepaidOnly: false,
    });
    expect(usable).toBe(300);
    expect(selectWorkingWallet({ usdUsableCents: usable, zigUsableCents: 2_000, zigOffersEnabled: true })).toBe('USD');
  });

  it('selects funded ZiG only after USD capacity is exhausted and ZiG offers are enabled', () => {
    expect(selectWorkingWallet({ usdUsableCents: 0, zigUsableCents: 2_000, zigOffersEnabled: true })).toBe('ZWG');
    expect(selectWorkingWallet({ usdUsableCents: 0, zigUsableCents: 2_000, zigOffersEnabled: false })).toBeNull();
  });

  it('selects neither wallet when both fee capacities are exhausted', () => {
    expect(selectWorkingWallet({ usdUsableCents: 0, zigUsableCents: 0, zigOffersEnabled: true })).toBeNull();
  });

  it('reduces capacity by open cash holds and does not borrow on ZiG', () => {
    expect(usableFeeCapacityCents({
      balanceCents: 1_000,
      borrowingLimitCents: 5_000,
      openCashHoldCents: 400,
      availablePromotionalCents: 100,
      prepaidOnly: false,
    })).toBe(5_700);
    expect(usableFeeCapacityCents({
      balanceCents: 1_000,
      borrowingLimitCents: 5_000,
      openCashHoldCents: 400,
      availablePromotionalCents: 100,
      prepaidOnly: true,
    })).toBe(700);
    expect(usableFeeCapacityCents({
      balanceCents: -100,
      borrowingLimitCents: 5_000,
      openCashHoldCents: 0,
      availablePromotionalCents: 0,
      prepaidOnly: true,
    })).toBe(0);
  });
});
