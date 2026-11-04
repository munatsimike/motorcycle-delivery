import { describe, expect, it } from 'vitest';

import { readRiderClass, riderClassLabel, riderRatingLine } from './riderClass';

describe('rider class labels', () => {
  it('never fabricates a rating for an unrated rider', () => {
    expect(readRiderClass(undefined)).toBe('SILVER');
    expect(riderClassLabel('SILVER')).toBe('Silver');
    expect(riderClassLabel('GOLD')).toBe('Gold');
    expect(riderClassLabel('PLATINUM')).toBe('Platinum');
    expect(riderRatingLine({ averageRating: null, ratingCount: 0, completedDeliveries: 0 })).toEqual({
      rating: null,
      rides: '0 rides',
    });
    expect(riderRatingLine({ averageRating: 4.8, ratingCount: 0, completedDeliveries: 12 })).toEqual({
      rating: null,
      rides: '12 rides',
    });
    expect(riderRatingLine({ averageRating: 4.5, ratingCount: 10, completedDeliveries: 80 })).toEqual({
      rating: '4.5',
      rides: '80 rides',
    });
  });
});
