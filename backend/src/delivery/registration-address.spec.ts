import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { RegistrationAddressController } from './registration-address.controller.js';
import { REGISTRATION_PLACE_LIMIT, RegistrationPlaceLimiter } from './registration-address-limit.js';

describe('registration address search', () => {
  it('is available before an account exists and does not require a session', () => {
    expect(Reflect.getMetadata(PATH_METADATA, RegistrationAddressController)).toBe('auth/places');
    expect(Reflect.getMetadata(GUARDS_METADATA, RegistrationAddressController)).toBeUndefined();
  });

  it('stops one network after the registration search limit', () => {
    const limiter = new RegistrationPlaceLimiter();
    const now = Date.parse('2026-10-24T20:00:00.000Z');
    for (let attempt = 0; attempt < REGISTRATION_PLACE_LIMIT; attempt += 1) {
      expect(limiter.allow('127.0.0.1', now + attempt)).toBe(true);
    }
    expect(limiter.allow('127.0.0.1', now + REGISTRATION_PLACE_LIMIT)).toBe(false);
    expect(limiter.allow('10.0.2.2', now + REGISTRATION_PLACE_LIMIT)).toBe(true);
  });
});
