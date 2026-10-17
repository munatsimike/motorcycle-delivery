import { describe, expect, it } from 'vitest';
import { isRiderAvailabilityNotification, riderAlertHomeTarget } from './riderAlertNotification';

describe('rider availability notification taps', () => {
  it('recognises only a rider availability payload', () => {
    expect(isRiderAvailabilityNotification({ kind: 'rider-availability' })).toBe(true);
    expect(isRiderAvailabilityNotification({ kind: 'delivery' })).toBe(false);
    expect(isRiderAvailabilityNotification(null)).toBe(false);
  });

  it('opens Home with a refresh token', () => {
    expect(riderAlertHomeTarget(20)).toEqual({
      name: 'CustomerHome',
      params: {
        screen: 'Dashboard',
        params: { nearbyRefreshAt: 20 },
      },
    });
  });
});
