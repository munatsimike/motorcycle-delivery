import {
  parseAdminLoginRequest,
  parseAdminVerifyRequest,
} from './admin-login.validation.js';

describe('Admin login request validation', () => {
  const challengeId = '0199aabb-ccdd-7eee-8fff-123456789abc';

  it('accepts valid login credentials', () => {
    expect(
      parseAdminLoginRequest({
        email: 'Admin@Example.com',
        password: 'SecurePassword123!',
      }),
    ).toEqual({
      email: 'admin@example.com',
      password: 'SecurePassword123!',
    });
  });

  it('rejects missing login credentials', () => {
    expect(() => parseAdminLoginRequest({ email: 'admin@example.com' }))
      .toThrow();
  });

  it('rejects malformed email addresses', () => {
    expect(() =>
      parseAdminLoginRequest({
        email: 'not-an-email',
        password: 'SecurePassword123!',
      }),
    ).toThrow();
  });

  it('rejects oversized passwords', () => {
    expect(() =>
      parseAdminLoginRequest({
        email: 'admin@example.com',
        password: 'x'.repeat(129),
      }),
    ).toThrow();
  });

  it('accepts a valid OTP verification request', () => {
    expect(
      parseAdminVerifyRequest({ challengeId, code: '012345' }),
    ).toEqual({ challengeId, code: '012345' });
  });

  it('rejects malformed challenge IDs', () => {
    expect(() =>
      parseAdminVerifyRequest({
        challengeId: 'invalid',
        code: '123456',
      }),
    ).toThrow();
  });

  it('rejects malformed OTP codes', () => {
    expect(() =>
      parseAdminVerifyRequest({
        challengeId,
        code: '12345',
      }),
    ).toThrow();
  });
});
