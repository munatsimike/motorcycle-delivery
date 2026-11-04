import { describe, expect, it } from 'vitest';

import { normalizeRiderName } from './personName';
import { normalizeRiderPhone } from './phone';

describe('rider phone and name', () => {
  it('normalizes Zimbabwe mobile numbers', () => {
    expect(normalizeRiderPhone('0771234567')).toBe('+263771234567');
    expect(normalizeRiderPhone('771234567')).toBe('+263771234567');
    expect(normalizeRiderPhone('+263 77 123 4567')).toBe('+263771234567');
  });

  it('accepts Netherlands numbers in local and international form', () => {
    expect(normalizeRiderPhone('0612345678')).toBe('+31612345678');
    expect(normalizeRiderPhone('612345678')).toBe('+31612345678');
    expect(normalizeRiderPhone('+31 6 12345678')).toBe('+31612345678');
  });

  it('rejects a number the rider API will not accept', () => {
    expect(() => normalizeRiderPhone('0812345678')).toThrow('Enter a valid Zimbabwe mobile number');
  });

  it('collapses a rider name the same way the API does', () => {
    expect(normalizeRiderName('  Tariro   Moyo ')).toBe('Tariro Moyo');
    expect(() => normalizeRiderName('   ')).toThrow('Full name is required');
  });
});
