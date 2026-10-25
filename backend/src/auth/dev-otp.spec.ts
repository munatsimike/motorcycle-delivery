import { readFileSync } from 'node:fs';
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_OTP_TTL_MS, OTP_COOLDOWN_MS, OTP_MAX_CHECK_ATTEMPTS, OTP_PHONE_HOURLY_LIMIT } from './auth.constants.js';
import type { Clock } from './clock.js';
import {
  DevOtpConfigurationError,
  DevOtpVerificationProvider,
  devOtpAllowed,
  formatDevOtpNotice,
  generateDevOtp,
  selectPhoneVerificationProvider,
  writeDevOtpLine,
} from './dev-otp.js';
import type { PhoneVerificationProvider } from './phone-verification.provider.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';

const PHONE = '+263771234567';
const START = new Date('2026-10-24T18:00:00.000Z');
const ENV_KEYS = [
  'NODE_ENV',
  'DEV_OTP_ENABLED',
  'WHATSAPP_VERIFICATION_ENABLED',
  'WHATSAPP_VERIFICATION_PROVIDER',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_SERVICE_ID',
  'PUBLIC_URL',
  'APP_URL',
  'API_PUBLIC_URL',
  'HOST',
  'BIND_HOST',
  'APP_ENV',
  'DEPLOY_ENV',
  'ENVIRONMENT',
  'STAGE',
  'TRUST_RAILWAY_EDGE_CLIENT_IP',
  'RENDER',
  'FLY_APP_NAME',
  'DYNO',
  'K_SERVICE',
  'VERCEL',
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = savedEnv[key];
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

describe('local mock OTP', () => {
  it('generates a six-digit code and stores only its hash', async () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateDevOtp()));
    expect(codes.size).toBeGreaterThan(1);
    for (const code of codes) {
      expect(code).toMatch(/^\d{6}$/);
    }

    enableLocal();
    const notices: string[] = [];
    const { provider } = providerAt(START, notices);
    const issued = await provider.send(PHONE);
    const notice = notices.join('\n');
    const code = notice.match(/Code: (\d{6})/)?.[1] ?? '';
    const stored = provider.storedOtp(PHONE);

    expect(code).toMatch(/^\d{6}$/);
    expect(issued.sid).toMatch(/^dev_[0-9a-f]{32}$/);
    expect(issued.sid).not.toBe(code);
    expect(JSON.stringify(issued)).not.toContain(code);
    expect(stored?.hashHex).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.hashHex).not.toBe(code);
    expect(stored).not.toHaveProperty('code');
    expect(notice).toContain('[riders-dev-otp] LOCAL DEVELOPMENT OTP. This code was not sent on WhatsApp.');
    expect(notice).toContain(`Phone: ${PHONE}`);
  });

  it('rejects a code at five minutes and accepts it before then', async () => {
    enableLocal();
    const notices: string[] = [];
    const { provider, advance } = providerAt(START, notices);
    await provider.send(PHONE);
    const code = readCode(notices);

    advance(DEV_OTP_TTL_MS - 1_000);
    await expect(provider.check(PHONE, code)).resolves.toBe(true);

    const again = providerAt(START, []);
    await again.provider.send(PHONE);
    const second = readCode(again.notices);
    again.advance(DEV_OTP_TTL_MS);
    await expect(again.provider.check(PHONE, second)).resolves.toBe(false);
    expect(again.provider.storedOtp(PHONE)?.used).toBe(false);
  });

  it('rejects an invalid code without consuming the real one', async () => {
    enableLocal();
    const notices: string[] = [];
    const { provider } = providerAt(START, notices);
    await provider.send(PHONE);
    const code = readCode(notices);

    const wrong = code === '000000' ? '111111' : '000000';
    await expect(provider.check(PHONE, wrong)).resolves.toBe(false);
    expect(provider.storedOtp(PHONE)?.attempts).toBe(1);
    await expect(provider.check(PHONE, code)).resolves.toBe(true);
  });

  it('accepts a code once', async () => {
    enableLocal();
    const notices: string[] = [];
    const { provider } = providerAt(START, notices);
    await provider.send(PHONE);
    const code = readCode(notices);

    await expect(provider.check(PHONE, code)).resolves.toBe(true);
    await expect(provider.check(PHONE, code)).resolves.toBe(false);
    expect(provider.storedOtp(PHONE)?.used).toBe(true);
  });

  it('locks the code after the check limit', async () => {
    enableLocal();
    const notices: string[] = [];
    const { provider } = providerAt(START, notices);
    await provider.send(PHONE);
    const code = readCode(notices);

    const wrong = code === '111111' ? '222222' : '111111';
    for (let attempt = 0; attempt < OTP_MAX_CHECK_ATTEMPTS; attempt += 1) {
      await expect(provider.check(PHONE, wrong)).resolves.toBe(false);
    }
    await expect(provider.check(PHONE, code)).resolves.toBe(false);
    expect(provider.storedOtp(PHONE)?.attempts).toBe(OTP_MAX_CHECK_ATTEMPTS);
    expect(provider.storedOtp(PHONE)?.used).toBe(false);
  });

  it('enforces the resend cooldown and replaces the previous code afterwards', async () => {
    enableLocal();
    const notices: string[] = [];
    const { provider, advance } = providerAt(START, notices);
    await provider.send(PHONE);
    const first = readCode(notices);

    await expect(provider.send(PHONE)).rejects.toBeInstanceOf(TooManyRequestsException);
    await expect(provider.check(PHONE, first)).resolves.toBe(true);

    const later = providerAt(START, []);
    await later.provider.send(PHONE);
    const original = readCode(later.notices);
    later.advance(OTP_COOLDOWN_MS);
    await later.provider.send(PHONE);
    const replacement = readCode(later.notices);
    expect(replacement).not.toBe(original);
    await expect(later.provider.check(PHONE, original)).resolves.toBe(false);
    await expect(later.provider.check(PHONE, replacement)).resolves.toBe(true);
  });

  it('stops sending to one number after the hourly limit', async () => {
    enableLocal();
    const notices: string[] = [];
    const { provider, advance } = providerAt(START, notices);
    for (let send = 0; send < OTP_PHONE_HOURLY_LIMIT; send += 1) {
      if (send > 0) {
        advance(OTP_COOLDOWN_MS);
      }
      await provider.send(PHONE);
    }
    advance(OTP_COOLDOWN_MS);
    await expect(provider.send(PHONE)).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(notices).toHaveLength(OTP_PHONE_HOURLY_LIMIT);
  });

  it('prints the code only from the local mock provider', () => {
    const twilio = readFileSync('src/auth/twilio-verify.client.ts', 'utf8');
    const whatsapp = readFileSync('src/auth/phone-verification.provider.ts', 'utf8');
    expect(twilio).not.toContain('riders-dev-otp');
    expect(twilio).not.toContain('writeDevOtpLine');
    expect(whatsapp).not.toContain('riders-dev-otp');
    expect(whatsapp).not.toContain('console.');
    expect(formatDevOtpNotice({ phone: PHONE, code: '042817', expiresAt: START })).toContain('Code: 042817');
  });

  it('refuses mock OTP outside local development and does not print a code', () => {
    const twilio = stubProvider();
    const meta = stubProvider();
    const devOtp = stubProvider();
    const local = localEnv();
    expect(selectPhoneVerificationProvider(local, twilio, meta, devOtp)).toBe(devOtp);
    expect(devOtpAllowed({ ...local, PUBLIC_URL: 'http://127.0.0.1:3000', HOST: '0.0.0.0' })).toBe(true);
    expect(selectPhoneVerificationProvider({ ...local, DEV_OTP_ENABLED: 'false' }, twilio, meta, devOtp)).toBe(twilio);
    expect(selectPhoneVerificationProvider({ NODE_ENV: 'development', WHATSAPP_VERIFICATION_PROVIDER: 'meta' }, twilio, meta, devOtp)).toBe(meta);
    expect(devOtpAllowed({ NODE_ENV: 'development' })).toBe(false);

    for (const env of rejectedEnvironments()) {
      expect(() => selectPhoneVerificationProvider(env, twilio, meta, devOtp)).toThrow(DevOtpConfigurationError);
      expect(devOtpAllowed(env)).toBe(false);
    }

    process.env.NODE_ENV = 'production';
    process.env.DEV_OTP_ENABLED = 'true';
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(() => writeDevOtpLine('[riders-dev-otp] Code: 042817')).toThrow(DevOtpConfigurationError);
      expect(writes.join('')).not.toContain('042817');
    } finally {
      process.stderr.write = original;
    }
  });

  it('does not issue a code when the process is not a local development process', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_OTP_ENABLED = 'true';
    const notices: string[] = [];
    const { provider } = providerAt(START, notices);
    await expect(provider.send(PHONE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(notices).toEqual([]);
    expect(provider.storedOtp(PHONE)).toBeNull();
  });
});

function stubProvider(): PhoneVerificationProvider {
  return {
    send: () => Promise.resolve({ sid: 'stub' }),
    check: () => Promise.resolve(false),
  };
}

function enableLocal(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  process.env.NODE_ENV = 'development';
  process.env.DEV_OTP_ENABLED = 'true';
}

function localEnv(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'development', DEV_OTP_ENABLED: 'true' };
}

function rejectedEnvironments(): NodeJS.ProcessEnv[] {
  const enabled = { DEV_OTP_ENABLED: 'true' };
  return [
    { ...enabled, NODE_ENV: 'production' },
    { ...enabled, NODE_ENV: 'staging' },
    { ...enabled, NODE_ENV: 'test' },
    { ...enabled },
    { ...enabled, NODE_ENV: 'development', APP_ENV: 'staging' },
    { ...enabled, NODE_ENV: 'development', DEPLOY_ENV: 'production' },
    { ...enabled, NODE_ENV: 'development', RAILWAY_ENVIRONMENT: 'production' },
    { ...enabled, NODE_ENV: 'development', RAILWAY_PROJECT_ID: 'project' },
    { ...enabled, NODE_ENV: 'development', RENDER: 'true' },
    { ...enabled, NODE_ENV: 'development', FLY_APP_NAME: 'riders' },
    { ...enabled, NODE_ENV: 'development', DYNO: 'web.1' },
    { ...enabled, NODE_ENV: 'development', K_SERVICE: 'riders' },
    { ...enabled, NODE_ENV: 'development', VERCEL: '1' },
    { ...enabled, NODE_ENV: 'development', TRUST_RAILWAY_EDGE_CLIENT_IP: 'true' },
    { ...enabled, NODE_ENV: 'development', WHATSAPP_VERIFICATION_ENABLED: 'true' },
    { ...enabled, NODE_ENV: 'development', PUBLIC_URL: 'https://motorcycle-delivery.example' },
    { ...enabled, NODE_ENV: 'development', HOST: '203.0.113.10' },
  ];
}

function providerAt(start: Date, notices: string[]) {
  let time = start.getTime();
  const clock: Clock = {
    concealmentMs: 0,
    now: () => new Date(time),
    pause: () => Promise.resolve(),
  };
  const provider = new DevOtpVerificationProvider(clock);
  provider.bindNotice((line) => {
    notices.push(line);
  });
  return {
    provider,
    notices,
    advance(ms: number) {
      time += ms;
    },
  };
}

function readCode(notices: string[]): string {
  const code = notices[notices.length - 1]?.match(/Code: (\d{6})/)?.[1];
  if (!code) {
    throw new Error('expected a local OTP notice');
  }
  return code;
}
