import { describe, expect, it } from 'vitest';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

describe('wallet money', () => {
  it('keeps the sign of amounts below one dollar', () => {
    expect(formatSignedCents(-60)).toBe('-0.60');
    expect(formatSignedCents(-160)).toBe('-1.60');
    expect(formatSignedCents(140)).toBe('1.40');
    expect(formatSignedCents(0)).toBe('0.00');
    expect(signedCentsFromDecimal('-0.60')).toBe(-60);
    expect(signedCentsFromDecimal(formatSignedCents(-160))).toBe(-160);
  });
});
