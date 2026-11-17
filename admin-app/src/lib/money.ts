const MONEY = /^\d{1,10}\.\d{2}$/;

export function deliveryMoney(currency: string, amount: string): string {
  if (currency === 'USD') return `US$ ${amount}`;
  if (currency === 'ZWG') return `ZiG ${amount}`;
  return `${currency} ${amount}`;
}

const EXCHANGE_RATE = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,4})?$/;

export function exchangeRateValue(input: string): string | null {
  const value = input.trim();
  if (!EXCHANGE_RATE.test(value)) return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) return null;
  return value;
}

export function moneyValue(input: string, allowZero: boolean): string | null {
  const value = input.trim();
  if (!MONEY.test(value)) {
    return null;
  }
  const cents = Number(value.replace('.', ''));
  if (!Number.isSafeInteger(cents) || cents < 0 || (!allowZero && cents === 0)) {
    return null;
  }
  return value;
}

export function wholeMetres(input: string): number | null {
  const value = input.trim();
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const metres = Number(value);
  if (!Number.isSafeInteger(metres) || metres > 2_000_000_000) {
    return null;
  }
  return metres;
}

export type TopUpMethod = 'CASH' | 'ECOCASH';

export type TopUpDraft = {
  idempotencyKey: string;
  amount: string;
  method: TopUpMethod;
  externalReceiptNumber: string | null;
  ecocashReference: string | null;
};

export function topUpBody(draft: TopUpDraft) {
  return {
    currency: 'USD' as const,
    method: draft.method,
    amount: draft.amount,
    paymentReceived: true as const,
    externalReceiptNumber: draft.method === 'CASH' ? draft.externalReceiptNumber : null,
    ecocashReference: draft.method === 'ECOCASH' ? draft.ecocashReference : null,
  };
}

export function newTopUpKey(): string {
  return crypto.randomUUID();
}
