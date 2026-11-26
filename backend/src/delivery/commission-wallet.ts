import { Currency } from '../generated/prisma/client.js';
import {
  usdCentsFromZigCents,
  zigCentsFromUsdCents,
  type ActiveExchangeRate,
} from './exchange-rate.js';

export type CommissionPayment = {
  sourceCurrency: Currency;
  sourceCents: number;
  payingCurrency: Currency;
  payingCents: number;
  exchangeRateVersion: number | null;
  exchangeRateZigPerUsd: string | null;
};

export type CommissionChoice =
  | { ok: true; payment: CommissionPayment }
  | { ok: false; reason: 'capacity' | 'rate' };

// A fully funded commission may use existing promotional credit. Only positive
// unreserved CASH capacity can authorize a shortfall; promotional credit alone
// must not open another overdraft. The full fee is still reserved.
function canPay(cost: number, cover: number, cashRoom: number): boolean {
  return Number.isSafeInteger(cost) && cost > 0 && (
    cover >= cost || cashRoom > 0
  );
}

// USD remains preferred, including its final trip. ZiG is the fallback for
// the whole commission. The two wallets are never combined.
export function chooseCommissionPayment(input: {
  sourceCurrency: Currency;
  sourceCents: number;
  usdCoverCents: number;
  zigCoverCents: number;
  usdCashRoomCents: number;
  zigCashRoomCents: number;
  rate: ActiveExchangeRate | null;
  zigOffersEnabled: boolean;
}): CommissionChoice {
  if (!Number.isSafeInteger(input.sourceCents) || input.sourceCents < 0) {
    return { ok: false, reason: 'capacity' };
  }
  if (input.sourceCents === 0) {
    return { ok: true, payment: blank(input.sourceCurrency) };
  }
  const usdCost = costIn(Currency.USD, input.sourceCurrency, input.sourceCents, input.rate);
  if (usdCost !== null && canPay(usdCost, input.usdCoverCents, input.usdCashRoomCents)) {
    return { ok: true, payment: payment(input, Currency.USD, usdCost) };
  }
  const zigCost = input.zigOffersEnabled
    ? costIn(Currency.ZWG, input.sourceCurrency, input.sourceCents, input.rate)
    : null;
  if (zigCost !== null && canPay(zigCost, input.zigCoverCents, input.zigCashRoomCents)) {
    return { ok: true, payment: payment(input, Currency.ZWG, zigCost) };
  }
  const usdNeedsRate = input.sourceCurrency !== Currency.USD && input.rate === null && input.usdCoverCents > 0;
  const zigNeedsRate = input.zigOffersEnabled
    && input.sourceCurrency !== Currency.ZWG
    && input.rate === null
    && input.zigCoverCents > 0;
  if (usdNeedsRate || zigNeedsRate) {
    return { ok: false, reason: 'rate' };
  }
  return { ok: false, reason: 'capacity' };
}

function costIn(
  paying: Currency,
  source: Currency,
  sourceCents: number,
  rate: ActiveExchangeRate | null,
): number | null {
  if (paying === source) {
    return sourceCents;
  }
  if (!rate) {
    return null;
  }
  return paying === Currency.USD
    ? usdCentsFromZigCents(sourceCents, rate.zigPerUsdUnits)
    : zigCentsFromUsdCents(sourceCents, rate.zigPerUsdUnits);
}

function payment(
  input: {
    sourceCurrency: Currency;
    sourceCents: number;
    rate: ActiveExchangeRate | null;
  },
  payingCurrency: Currency,
  payingCents: number,
): CommissionPayment {
  const converted = payingCurrency !== input.sourceCurrency;
  return {
    sourceCurrency: input.sourceCurrency,
    sourceCents: input.sourceCents,
    payingCurrency,
    payingCents,
    exchangeRateVersion: converted ? input.rate?.rateVersion ?? null : null,
    exchangeRateZigPerUsd: converted ? input.rate?.zigPerUsd ?? null : null,
  };
}

function blank(currency: Currency): CommissionPayment {
  return {
    sourceCurrency: currency,
    sourceCents: 0,
    payingCurrency: currency,
    payingCents: 0,
    exchangeRateVersion: null,
    exchangeRateZigPerUsd: null,
  };
}
