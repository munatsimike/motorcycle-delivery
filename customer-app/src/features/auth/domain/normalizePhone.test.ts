import { describe, expect, it } from 'vitest';

import { normalizePhone } from './normalizePhone';

describe('normalizePhone', () => {
  it('accepts Zimbabwe numbers in local and international form', () => {
    expect(normalizePhone('0771234567')).toBe('+263771234567');
    expect(normalizePhone('771234567')).toBe('+263771234567');
    expect(normalizePhone('263771234567')).toBe('+263771234567');
    expect(normalizePhone('+263 77 123 4567')).toBe('+263771234567');
  });

  it('accepts Netherlands numbers in local and international form', () => {
    expect(normalizePhone('0612345678')).toBe('+31612345678');
    expect(normalizePhone('612345678')).toBe('+31612345678');
    expect(normalizePhone('31612345678')).toBe('+31612345678');
    expect(normalizePhone('+31 6 12345678')).toBe('+31612345678');
  });

  it('rejects numbers that are not Zimbabwean or Dutch mobiles', () => {
    expect(() => normalizePhone('0812345678')).toThrow('Enter a valid Zimbabwean or Dutch mobile number.');
    expect(() => normalizePhone('+2637712345678')).toThrow('Enter a valid Zimbabwean or Dutch mobile number.');
    expect(() => normalizePhone('')).toThrow('Enter a valid Zimbabwean or Dutch mobile number.');
  });
});
