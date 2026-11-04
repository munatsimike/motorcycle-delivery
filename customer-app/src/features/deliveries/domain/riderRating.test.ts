import { describe, expect, it } from 'vitest';

import { ratingPromptVisible, readCustomerDeliveryRating } from './riderRating';

describe('customer delivery rating', () => {
  it('treats skip as local only and missing payloads as ineligible', () => {
    expect(readCustomerDeliveryRating(undefined)).toEqual({ eligible: false, submitted: false, stars: null });
    const eligible = readCustomerDeliveryRating({ eligible: true, submitted: false, stars: null });
    expect(eligible.eligible).toBe(true);
    expect(ratingPromptVisible(eligible, false)).toBe(true);
    expect(ratingPromptVisible(eligible, true)).toBe(false);
    expect(readCustomerDeliveryRating({ eligible: true, submitted: true, stars: 5 })).toEqual({
      eligible: false,
      submitted: true,
      stars: 5,
    });
  });
});
