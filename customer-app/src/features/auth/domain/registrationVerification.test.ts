import { describe, expect, it } from 'vitest';

import { readRegistrationVerification } from './registrationVerification';

const TOKEN = 'proof-token-proof-token-proof-token';

describe('customer registration verification', () => {
  it('keeps a new registration proof free of personal details', () => {
    expect(readRegistrationVerification({ status: 'verified', registrationToken: TOKEN })).toEqual({
      status: 'verified',
      registrationToken: TOKEN,
    });
  });

  it('keeps verified customer details read-only and reports only missing fields', () => {
    expect(readRegistrationVerification({
      status: 'verified',
      registrationToken: TOKEN,
      fullName: 'Tendai Moyo',
      phone: '+263771234567',
      address: '12 Samora Machel Avenue',
      readOnly: ['fullName', 'phone', 'address'],
      missing: ['accountKind'],
    })).toMatchObject({
      existing: {
        fullName: 'Tendai Moyo',
        phone: '+263771234567',
        address: '12 Samora Machel Avenue',
        readOnly: ['fullName', 'phone', 'address'],
        missing: ['accountKind'],
      },
    });
  });

  it('asks for sign-in without accepting a profile', () => {
    expect(readRegistrationVerification({ status: 'sign_in', fullName: 'Tendai Moyo' })).toEqual({ status: 'sign_in' });
  });

  it('saves an existing-account session and drops any profile fields', () => {
    expect(readRegistrationVerification({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: '2026-10-21T12:00:00.000Z',
      refreshTokenExpiresAt: '2026-10-28T12:00:00.000Z',
      fullName: 'Tendai Moyo',
      phone: '+263771234567',
      status: 'sign_in',
    })).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: '2026-10-21T12:00:00.000Z',
      refreshTokenExpiresAt: '2026-10-28T12:00:00.000Z',
    });
  });
});
