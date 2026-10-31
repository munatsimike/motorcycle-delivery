import { describe, expect, it } from 'vitest';

import type { KeyValueStore } from './acceptanceKeys';
import { createBookingAttempts } from './bookingAttempt';

function memoryStore(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe('booking attempt keys', () => {
  it('reuses one key after a lost response and rotates it for a new attempt', async () => {
    const attempts = createBookingAttempts(memoryStore());
    let created = 0;
    const createKey = () => {
      created += 1;
      return `booking-${created}`;
    };

    const first = await attempts.keyFor('same-delivery', createKey);
    const retry = await attempts.keyFor('same-delivery', createKey);
    expect(first).toBe('booking-1');
    expect(retry).toBe('booking-1');
    expect(created).toBe(1);

    const changed = await attempts.keyFor('different-offer', createKey);
    expect(changed).toBe('booking-2');

    await attempts.clear();
    const next = await attempts.keyFor('same-delivery', createKey);
    expect(next).toBe('booking-3');
  });

  it('keeps one key when two confirms start together', async () => {
    const attempts = createBookingAttempts(memoryStore());
    let created = 0;
    const [left, right] = await Promise.all([
      attempts.keyFor('same-delivery', () => {
        created += 1;
        return `booking-${created}`;
      }),
      attempts.keyFor('same-delivery', () => {
        created += 1;
        return `booking-${created}`;
      }),
    ]);
    expect(left).toBe(right);
    expect(created).toBe(1);
  });
});
