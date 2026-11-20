import { describe, expect, it } from 'vitest';
import { formatCents, roundSuggestedCents } from './money.js';

describe('suggested price rounding', () => {
  it('rounds generated suggestions to the nearest 0.50 and leaves exact halves', () => {
    expect(formatCents(roundSuggestedCents(2_005))).toBe('20.00');
    expect(formatCents(roundSuggestedCents(2_030))).toBe('20.50');
    expect(formatCents(roundSuggestedCents(2_075))).toBe('21.00');
    expect(formatCents(roundSuggestedCents(2_024))).toBe('20.00');
    expect(formatCents(roundSuggestedCents(2_025))).toBe('20.50');
    expect(formatCents(roundSuggestedCents(2_000))).toBe('20.00');
    expect(formatCents(roundSuggestedCents(2_050))).toBe('20.50');
    expect(formatCents(roundSuggestedCents(0))).toBe('0.00');
  });
});
