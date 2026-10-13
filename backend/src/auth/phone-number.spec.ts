import { afterEach, describe, expect, it } from 'vitest';
import { InvalidPersonNameError, normalizePersonName } from './person-name.js';
import { InvalidPhoneNumberError, normalizeAuthPhone, normalizeZimbabweMobile } from './phone-number.js';

describe('Zimbabwe mobile numbers', () => {
  it.each([
    ['0771234567', '+263771234567'],
    ['263771234567', '+263771234567'],
    ['+263771234567', '+263771234567'],
    ['+263 77 123 4567', '+263771234567'],
    ['00263771234567', '+263771234567'],
    ['+2630771234567', '+263771234567'],
    ['771234567', '+263771234567'],
    ['0712345678', '+263712345678'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeZimbabweMobile(input)).toBe(expected);
  });

  it.each(['', '123', '+14155552671', '+263212345678', '077123', 'phone'])(
    'rejects %s',
    (input) => {
      expect(() => normalizeZimbabweMobile(input)).toThrow(InvalidPhoneNumberError);
    },
  );
});

describe('development Dutch test numbers', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    restoreNodeEnv(originalNodeEnv);
    delete process.env.ALLOW_TEST_NL_PHONE_NUMBERS;
  });

  it.each([
    ['+31612345678', '+31612345678'],
    ['+31 6 1234 5678', '+31612345678'],
    ['0031612345678', '+31612345678'],
    ['31612345678', '+31612345678'],
    ['0612345678', '+31612345678'],
    ['612345678', '+31612345678'],
    ['+310612345678', '+31612345678'],
  ])('accepts %s when development testing is enabled', (input, expected) => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
    expect(normalizeAuthPhone(input)).toBe(expected);
  });

  it('keeps Zimbabwean numbers available while Dutch testing is enabled', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
    expect(normalizeAuthPhone('0771234567')).toBe('+263771234567');
    expect(normalizeAuthPhone('+263 77 123 4567')).toBe('+263771234567');
  });

  it('rejects a Dutch number with the wrong length', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
    expect(() => normalizeAuthPhone('+3161234567')).toThrow(InvalidPhoneNumberError);
    expect(() => normalizeAuthPhone('+316123456789')).toThrow(InvalidPhoneNumberError);
    expect(() => normalizeAuthPhone('+31712345678')).toThrow(InvalidPhoneNumberError);
  });

  it.each([
    ['development', undefined],
    ['development', 'false'],
    ['development', 'TRUE'],
    ['production', 'true'],
    ['test', 'true'],
  ] as const)('rejects Dutch numbers when NODE_ENV=%s and the flag is %s', (nodeEnv, flag) => {
    process.env.NODE_ENV = nodeEnv;
    if (flag === undefined) {
      delete process.env.ALLOW_TEST_NL_PHONE_NUMBERS;
    } else {
      process.env.ALLOW_TEST_NL_PHONE_NUMBERS = flag;
    }
    expect(() => normalizeAuthPhone('+31612345678')).toThrow(InvalidPhoneNumberError);
    expect(() => normalizeAuthPhone('0612345678')).toThrow(InvalidPhoneNumberError);
    expect(normalizeAuthPhone('0771234567')).toBe('+263771234567');
  });
});

function restoreNodeEnv(original: string | undefined): void {
  if (original === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = original;
  }
}

describe('person names', () => {
  it('collapses surrounding and repeated spaces', () => {
    expect(normalizePersonName('  Tendai   Moyo ')).toBe('Tendai Moyo');
  });

  it('rejects an empty name', () => {
    expect(() => normalizePersonName('   ')).toThrow(InvalidPersonNameError);
  });
});
