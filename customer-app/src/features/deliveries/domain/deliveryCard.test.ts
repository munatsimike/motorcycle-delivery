import { describe, expect, it } from 'vitest';

import { deliveryWhenLabel, shortDeliveryReference } from './deliveryCard';

describe('delivery card text', () => {
  it('shows the last five characters of the delivery id', () => {
    expect(shortDeliveryReference('11111111-2222-3333-4444-abcd1024')).toBe('#D1024');
  });

  it('includes today and the clock time', () => {
    const now = new Date(2026, 9, 15, 20, 0, 0);
    const createdAt = new Date(2026, 9, 15, 18, 25, 0).toISOString();
    expect(deliveryWhenLabel(createdAt, now)).toBe('Today, 15 Oct 2026 • 18:25');
  });
});
