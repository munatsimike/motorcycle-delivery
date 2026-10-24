import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { CustomerAuthApiRepository } from '../data/repositories/CustomerAuthApiRepository';
import { authEntryActions, WHATSAPP_AUTH_ENABLED } from './whatsappRelease';
import { isVerificationCode } from './verificationCode';

const originalFetch = globalThis.fetch;
const repository = new CustomerAuthApiRepository();
const registration = {
  phone: '+263771234567',
  password: 'correct-horse',
  accountKind: 'INDIVIDUAL' as const,
  fullName: 'Tendai Moyo',
  address: '12 Samora Machel Avenue',
  whatsappConsent: true as const,
};
const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-10-23T21:00:00.000Z',
  refreshTokenExpiresAt: '2026-11-23T21:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
});

describe('WhatsApp release gate', () => {
  it('keeps SMS registration and login available while WhatsApp actions stay hidden', () => {
    expect(WHATSAPP_AUTH_ENABLED).toBe(false);
    expect(authEntryActions()).toEqual({
      smsRegistration: true,
      smsLogin: true,
      passwordLogin: true,
      whatsappRegistration: false,
      passwordRecovery: false,
    });
  });
});

describe('verification code contract', () => {
  it('accepts the backend range of 4 to 10 digits', () => {
    expect(isVerificationCode('1234')).toBe(true);
    expect(isVerificationCode('123456')).toBe(true);
    expect(isVerificationCode('1234567890')).toBe(true);
    expect(isVerificationCode('123')).toBe(false);
    expect(isVerificationCode('12345678901')).toBe(false);
    expect(isVerificationCode('12345a')).toBe(false);
  });
});

describe('customer WhatsApp authentication', () => {
  it('starts registration without creating a session', async () => {
    const calls = mockJson(200, { status: 'pending', accessToken: 'not-a-session' });

    await expect(repository.startWhatsAppRegistration(registration)).resolves.toEqual({ status: 'pending' });

    expect(calls[0]?.url).toBe('https://api.example.com/auth/customer/register/whatsapp');
    expect(calls[0]?.body).toEqual(registration);
    expect(calls[0]?.body).not.toHaveProperty('accessToken');
  });

  it('creates a session only after the verification code is accepted', async () => {
    mockJson(200, session);

    await expect(repository.verifyWhatsAppRegistration('+263771234567', '123456')).resolves.toEqual(session);

    const calls = recordedCalls();
    expect(calls[0]?.url).toBe('https://api.example.com/auth/customer/register/whatsapp/verify');
    expect(calls[0]?.body).toEqual({ phone: '+263771234567', code: '123456' });
  });

  it('does not treat a pending verification response as a session', async () => {
    mockJson(200, { status: 'pending' });

    await expect(repository.verifyWhatsAppRegistration('+263771234567', '123456')).rejects.toThrow('Authentication failed.');
  });

  it('resends the registration code', async () => {
    const calls = mockJson(200, { status: 'pending' });

    await expect(repository.resendWhatsAppRegistration('+263771234567')).resolves.toEqual({ status: 'pending' });

    expect(calls[0]?.url).toBe('https://api.example.com/auth/customer/register/whatsapp/resend');
    expect(calls[0]?.body).toEqual({ phone: '+263771234567' });
  });

  it('shows an invalid code without a session', async () => {
    mockJson(401, { message: 'Verification code is invalid', statusCode: 401 });

    await expect(repository.verifyWhatsAppRegistration('+263771234567', '000000')).rejects.toMatchObject({
      message: 'Verification code is invalid',
      status: 401,
    });
  });

  it('shows an expired code as the same verification failure', async () => {
    mockJson(401, { message: 'Verification code is invalid', statusCode: 401 });

    await expect(repository.verifyWhatsAppRegistration('+263771234567', '999999')).rejects.toMatchObject({
      message: 'Verification code is invalid',
      status: 401,
    });
  });

  it('shows the rate-limit message', async () => {
    mockJson(429, { message: 'Too many verification attempts. Try again later.', statusCode: 429 });

    await expect(repository.resendWhatsAppRegistration('+263771234567')).rejects.toMatchObject({
      message: 'Too many verification attempts. Try again later.',
      status: 429,
    });
  });

  it('reports a network failure without a session', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));

    await expect(repository.verifyWhatsAppRegistration('+263771234567', '123456')).rejects.toThrow(
      'Network request failed. Check your connection and try again.',
    );
  });

  it('requests password recovery with WhatsApp consent', async () => {
    const calls = mockJson(200, { status: 'pending' });

    await expect(repository.requestPasswordReset('+263771234567')).resolves.toEqual({ status: 'pending' });

    expect(calls[0]?.url).toBe('https://api.example.com/auth/customer/password/forgot');
    expect(calls[0]?.body).toEqual({ phone: '+263771234567', whatsappConsent: true });
  });

  it('resets the password without creating a session', async () => {
    const calls = mockJson(204, null);

    await expect(repository.resetPassword('+263771234567', '123456', 'correct-horse')).resolves.toBeUndefined();

    expect(calls[0]?.url).toBe('https://api.example.com/auth/customer/password/reset');
    expect(calls[0]?.body).toEqual({ phone: '+263771234567', code: '123456', password: 'correct-horse' });
  });

  it('keeps a failed password reset from looking successful', async () => {
    mockJson(401, { message: 'Authentication failed', statusCode: 401 });

    await expect(repository.resetPassword('+263771234567', '000000', 'correct-horse')).rejects.toMatchObject({
      message: 'Authentication failed',
      status: 401,
    });
  });
});

type RecordedCall = { url: string; body: unknown };
let calls: RecordedCall[] = [];

function recordedCalls(): RecordedCall[] {
  return calls;
}

function mockJson(status: number, body: unknown): RecordedCall[] {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) as unknown : null,
    });
    return new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: body === null ? undefined : { 'Content-Type': 'application/json' },
    });
  }));
  return calls;
}
