import { describe, expect, it } from 'vitest';
import { label } from './labels';
import { moneyValue, topUpBody, wholeMetres, type TopUpDraft } from './money';

describe('money and top-up payload', () => {
  it('accepts dollar strings and rejects blank or zero top-ups', () => {
    expect(moneyValue('1.50', false)).toBe('1.50');
    expect(moneyValue('0.00', false)).toBeNull();
    expect(moneyValue('0.00', true)).toBe('0.00');
    expect(moneyValue('1.5', false)).toBeNull();
    expect(wholeMetres('500')).toBe(500);
    expect(wholeMetres('-1')).toBeNull();
  });

  it('labels known statuses and keeps the same top-up key in the body contract', () => {
    expect(label('NO_RIDER_FOUND')).toBe('No rider found');
    const draft: TopUpDraft = {
      idempotencyKey: 'key-1',
      amount: '2.00',
      method: 'ECOCASH',
      externalReceiptNumber: 'ignored',
      ecocashReference: 'MP1',
    };
    expect(topUpBody(draft)).toEqual({
      currency: 'USD',
      method: 'ECOCASH',
      amount: '2.00',
      paymentReceived: true,
      externalReceiptNumber: null,
      ecocashReference: 'MP1',
    });
    expect(topUpBody({ ...draft, method: 'CASH', externalReceiptNumber: 'R-1', ecocashReference: 'MP1' })).toMatchObject({
      method: 'CASH',
      externalReceiptNumber: 'R-1',
      ecocashReference: null,
    });
  });
});
