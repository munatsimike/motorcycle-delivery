import { describe, expect, it } from 'vitest';
import { Currency } from '../generated/prisma/client.js';
import { chooseCommissionPayment } from './commission-wallet.js';
import type { ActiveExchangeRate } from './exchange-rate.js';

const RATE: ActiveExchangeRate = { rateVersion: 1, zigPerUsdUnits: 330_000, zigPerUsd: '33.0000' };

function choose(
  source: Currency,
  sourceCents: number,
  usdCoverCents: number,
  zigCoverCents: number,
  rate: ActiveExchangeRate | null = RATE,
  zigOffersEnabled = true,
  usdCashRoomCents = usdCoverCents,
  zigCashRoomCents = zigCoverCents,
) {
  return chooseCommissionPayment({
    sourceCurrency: source,
    sourceCents,
    usdCoverCents,
    zigCoverCents,
    usdCashRoomCents,
    zigCashRoomCents,
    rate,
    zigOffersEnabled,
  });
}

describe('USD-first commission payment', () => {
  it('charges USD for a USD delivery when both wallets can pay', () => {
    const choice = choose(Currency.USD, 100, 100, 10_000);
    expect(choice).toMatchObject({
      ok: true,
      payment: { payingCurrency: 'USD', payingCents: 100, sourceCurrency: 'USD', sourceCents: 100, exchangeRateVersion: null },
    });
  });

  it('charges USD for a USD delivery when ZiG is empty', () => {
    expect(choose(Currency.USD, 100, 100, 0)).toMatchObject({ ok: true, payment: { payingCurrency: 'USD', payingCents: 100 } });
  });

  it('charges ZiG for a USD delivery when USD has only insufficient promotional credit', () => {
    const choice = choose(Currency.USD, 100, 99, 3_300, RATE, true, 0);
    expect(choice).toMatchObject({
      ok: true,
      payment: { payingCurrency: 'ZWG', payingCents: 3_300, sourceCents: 100, exchangeRateVersion: 1, exchangeRateZigPerUsd: '33.0000' },
    });
  });

  it('charges ZiG for a USD delivery when USD is empty', () => {
    expect(choose(Currency.USD, 100, 0, 3_300)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 3_300 } });
  });

  it('rejects a USD delivery when neither wallet has cash room and promo cannot cover the fee', () => {
    expect(choose(Currency.USD, 100, 50, 3_249, RATE, true, 0, 0)).toEqual({ ok: false, reason: 'capacity' });
  });

  it('converts a ZiG commission to USD and prefers USD even when ZiG is funded', () => {
    const choice = choose(Currency.ZWG, 100, 3, 100);
    expect(choice).toMatchObject({
      ok: true,
      payment: { payingCurrency: 'USD', payingCents: 3, sourceCurrency: 'ZWG', sourceCents: 100, exchangeRateVersion: 1 },
    });
  });

  it('uses ZiG for a ZiG delivery when USD has no cash room and insufficient promotional credit', () => {
    expect(choose(Currency.ZWG, 100, 2, 100, RATE, true, 0)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 100, exchangeRateVersion: null } });
  });

  it('rejects a ZiG delivery when neither wallet has cash room and promo cannot cover the fee', () => {
    expect(choose(Currency.ZWG, 100, 2, 49, RATE, true, 0, 0)).toEqual({ ok: false, reason: 'capacity' });
  });

  it('does not use ZiG while ZiG offers are disabled', () => {
    expect(choose(Currency.USD, 100, 0, 10_000, RATE, false)).toEqual({ ok: false, reason: 'capacity' });
    expect(choose(Currency.ZWG, 100, 0, 100, RATE, false)).toEqual({ ok: false, reason: 'capacity' });
  });

  it('asks for an exchange rate only when the other wallet could otherwise pay', () => {
    expect(choose(Currency.ZWG, 100, 3, 0, null)).toEqual({ ok: false, reason: 'rate' });
    expect(choose(Currency.ZWG, 100, 0, 100, null)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 100 } });
  });
});


describe('final trip capacity', () => {
  it('allows the last USD fee without an extra shortfall ceiling', () => {
    expect(choose(Currency.USD, 200, 10, 0)).toMatchObject({ ok: true, payment: { payingCurrency: 'USD', payingCents: 200 } });
    expect(choose(Currency.USD, 100_000, 1, 0)).toMatchObject({ ok: true, payment: { payingCurrency: 'USD', payingCents: 100_000 } });
    expect(choose(Currency.USD, 1, 0, 0)).toEqual({ ok: false, reason: 'capacity' });
  });

  it('keeps USD first even if ZiG could fully cover the fee', () => {
    expect(choose(Currency.USD, 200, 10, 100_000)).toMatchObject({ ok: true, payment: { payingCurrency: 'USD' } });
  });

  it('allows the last ZiG fee without an extra shortfall ceiling', () => {
    expect(choose(Currency.ZWG, 60, 0, 10)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 60 } });
    expect(choose(Currency.ZWG, 61, 0, 10)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 61 } });
    expect(choose(Currency.ZWG, 100_000, 0, 1)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 100_000 } });
    expect(choose(Currency.USD, 100, 0, 1)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 3_300 } });
    expect(choose(Currency.ZWG, 1, 0, 0, RATE, true, 0, -1)).toEqual({ ok: false, reason: 'capacity' });
    expect(choose(Currency.ZWG, 1, 0, 0)).toEqual({ ok: false, reason: 'capacity' });
  });

  it('does not use promotional credit alone to authorize an overdraft', () => {
    expect(choose(Currency.USD, 20, 10, 0, RATE, true, 0)).toEqual({ ok: false, reason: 'capacity' });
    expect(choose(Currency.ZWG, 20, 0, 10, RATE, true, 0, 0)).toEqual({ ok: false, reason: 'capacity' });
    expect(choose(Currency.USD, 10, 10, 0, RATE, true, 0)).toMatchObject({ ok: true, payment: { payingCurrency: 'USD', payingCents: 10 } });
  });

  it('allows an actually free trip, but does not treat a rounded conversion of a positive fee as free', () => {
    expect(choose(Currency.USD, 0, 0, 0)).toMatchObject({ ok: true, payment: { payingCents: 0 } });
    expect(choose(Currency.ZWG, 1, 10, 0)).toEqual({ ok: false, reason: 'capacity' });
  });
});
