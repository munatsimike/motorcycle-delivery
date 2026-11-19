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
) {
  return chooseCommissionPayment({
    sourceCurrency: source,
    sourceCents,
    usdCoverCents,
    zigCoverCents,
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

  it('charges ZiG for a USD delivery only when USD cannot cover the whole fee', () => {
    const choice = choose(Currency.USD, 100, 99, 3_300);
    expect(choice).toMatchObject({
      ok: true,
      payment: { payingCurrency: 'ZWG', payingCents: 3_300, sourceCents: 100, exchangeRateVersion: 1, exchangeRateZigPerUsd: '33.0000' },
    });
  });

  it('charges ZiG for a USD delivery when USD is empty', () => {
    expect(choose(Currency.USD, 100, 0, 3_300)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 3_300 } });
  });

  it('rejects a USD delivery when neither wallet covers the whole fee', () => {
    expect(choose(Currency.USD, 100, 50, 3_299)).toEqual({ ok: false, reason: 'capacity' });
  });

  it('converts a ZiG commission to USD and prefers USD even when ZiG is funded', () => {
    const choice = choose(Currency.ZWG, 100, 3, 100);
    expect(choice).toMatchObject({
      ok: true,
      payment: { payingCurrency: 'USD', payingCents: 3, sourceCurrency: 'ZWG', sourceCents: 100, exchangeRateVersion: 1 },
    });
  });

  it('uses ZiG for a ZiG delivery when USD cannot cover the converted fee', () => {
    expect(choose(Currency.ZWG, 100, 2, 100)).toMatchObject({ ok: true, payment: { payingCurrency: 'ZWG', payingCents: 100, exchangeRateVersion: null } });
  });

  it('rejects a ZiG delivery when neither wallet covers it', () => {
    expect(choose(Currency.ZWG, 100, 2, 99)).toEqual({ ok: false, reason: 'capacity' });
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
