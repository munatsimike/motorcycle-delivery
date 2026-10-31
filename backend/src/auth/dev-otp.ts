import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DEV_OTP_TTL_MS, OTP_COOLDOWN_MS, OTP_MAX_CHECK_ATTEMPTS, OTP_PHONE_HOURLY_LIMIT } from './auth.constants.js';
import { Clock } from './clock.js';
import { PhoneVerificationProvider } from './phone-verification.provider.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';

const HOUR_MS = 60 * 60 * 1000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_BIND_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);
const HOSTED_ENV_KEYS = [
  'RENDER',
  'RENDER_SERVICE_ID',
  'FLY_APP_NAME',
  'DYNO',
  'K_SERVICE',
  'WEBSITE_SITE_NAME',
  'VERCEL',
  'VERCEL_ENV',
] as const;
const STAGE_ENV_KEYS = ['APP_ENV', 'DEPLOY_ENV', 'ENVIRONMENT', 'STAGE'] as const;

export class DevOtpConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevOtpConfigurationError';
  }
}

type StoredDevOtp = {
  sid: string;
  hash: Buffer;
  expiresAt: number;
  attempts: number;
  used: boolean;
};

export type DevOtpInspection = {
  sid: string;
  hashHex: string;
  expiresAt: number;
  attempts: number;
  used: boolean;
};

export function devOtpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEV_OTP_ENABLED === 'true' && devOtpRejectionReasons(env).length === 0;
}

export function devOtpRejectionReasons(env: NodeJS.ProcessEnv): string[] {
  if (env.DEV_OTP_ENABLED !== 'true') {
    return [];
  }
  const reasons: string[] = [];
  if (env.NODE_ENV !== 'development') {
    reasons.push('NODE_ENV must be development');
  }
  for (const key of STAGE_ENV_KEYS) {
    const value = env[key]?.toLowerCase() ?? '';
    if (value === 'production' || value === 'staging') {
      reasons.push(`${key} is ${value}`);
    }
  }
  if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') {
    reasons.push(`NODE_ENV is ${env.NODE_ENV}`);
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('RAILWAY_') && value) {
      reasons.push(key);
    }
  }
  for (const key of HOSTED_ENV_KEYS) {
    if (env[key]) {
      reasons.push(key);
    }
  }
  if (env.TRUST_RAILWAY_EDGE_CLIENT_IP === 'true') {
    reasons.push('TRUST_RAILWAY_EDGE_CLIENT_IP');
  }
  if (env.WHATSAPP_VERIFICATION_ENABLED === 'true') {
    reasons.push('WHATSAPP_VERIFICATION_ENABLED');
  }
  const bindHost = env.HOST ?? env.BIND_HOST;
  if (bindHost && !LOCAL_BIND_HOSTS.has(bindHost)) {
    reasons.push('public bind address');
  }
  for (const key of ['PUBLIC_URL', 'APP_URL', 'API_PUBLIC_URL'] as const) {
    const value = env[key];
    if (value && !isLoopbackUrl(value)) {
      reasons.push(`${key} is public`);
    }
  }
  return reasons;
}

export function rejectDevOtpUnlessLocal(env: NodeJS.ProcessEnv = process.env): void {
  if (env.DEV_OTP_ENABLED !== 'true') {
    return;
  }
  const reasons = devOtpRejectionReasons(env);
  if (reasons.length > 0) {
    throw new DevOtpConfigurationError(`Mock OTP is refused outside local development: ${reasons.join('; ')}`);
  }
}

export function selectPhoneVerificationProvider(
  env: NodeJS.ProcessEnv,
  twilio: PhoneVerificationProvider,
  devOtp: PhoneVerificationProvider,
  infobip?: PhoneVerificationProvider,
): PhoneVerificationProvider {
  rejectDevOtpUnlessLocal(env);
  if (devOtpAllowed(env)) {
    return devOtp;
  }
  const provider = env.WHATSAPP_VERIFICATION_PROVIDER ?? 'twilio';
  if (provider === 'twilio') {
    return twilio;
  }
  if (provider === 'infobip') {
    if (!infobip) {
      throw new ServiceUnavailableException('WhatsApp verification is unavailable');
    }
    return infobip;
  }
  throw new ServiceUnavailableException('WhatsApp verification provider is not supported');
}

export function generateDevOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function formatDevOtpNotice(input: { phone: string; code: string; expiresAt: Date }): string {
  return [
    '[riders-dev-otp] LOCAL DEVELOPMENT OTP. This code was not sent on WhatsApp.',
    `[riders-dev-otp] Phone: ${input.phone}`,
    `[riders-dev-otp] Code: ${input.code}`,
    `[riders-dev-otp] Expires: ${input.expiresAt.toISOString()}`,
  ].join('\n');
}

export function writeDevOtpLine(line: string): void {
  rejectDevOtpUnlessLocal();
  if (!devOtpAllowed()) {
    throw new DevOtpConfigurationError('Mock OTP output is refused');
  }
  process.stderr.write(line.endsWith('\n') ? line : `${line}\n`);
}

@Injectable()
export class DevOtpVerificationProvider extends PhoneVerificationProvider {
  private readonly key = randomBytes(32);
  private readonly challenges = new Map<string, StoredDevOtp>();
  private readonly sentAt = new Map<string, number[]>();
  private notice: (line: string) => void = writeDevOtpLine;

  constructor(private readonly clock: Clock) {
    super();
  }

  bindNotice(write: (line: string) => void): void {
    this.notice = write;
  }

  storedOtp(phone: string): DevOtpInspection | null {
    const stored = this.challenges.get(phone);
    if (!stored) {
      return null;
    }
    return {
      sid: stored.sid,
      hashHex: stored.hash.toString('hex'),
      expiresAt: stored.expiresAt,
      attempts: stored.attempts,
      used: stored.used,
    };
  }

  async send(phone: string): Promise<{ sid: string }> {
    this.assertLocal();
    const now = this.clock.now().getTime();
    this.prune(now);
    const history = this.sentAt.get(phone) ?? [];
    const latest = history[history.length - 1];
    if (latest !== undefined && now - latest < OTP_COOLDOWN_MS) {
      throw new TooManyRequestsException();
    }
    if (history.length >= OTP_PHONE_HOURLY_LIMIT) {
      throw new TooManyRequestsException();
    }
    const code = generateDevOtp();
    const sid = `dev_${randomBytes(16).toString('hex')}`;
    const expiresAt = now + DEV_OTP_TTL_MS;
    this.challenges.set(phone, {
      sid,
      hash: hashDevOtp(this.key, phone, sid, code),
      expiresAt,
      attempts: 0,
      used: false,
    });
    history.push(now);
    this.sentAt.set(phone, history);
    this.notice(formatDevOtpNotice({ phone, code, expiresAt: new Date(expiresAt) }));
    return { sid };
  }

  async check(phone: string, code: string): Promise<boolean> {
    this.assertLocal();
    const stored = this.challenges.get(phone);
    const now = this.clock.now().getTime();
    if (!stored || stored.used || stored.expiresAt <= now || stored.attempts >= OTP_MAX_CHECK_ATTEMPTS) {
      return false;
    }
    if (!/^\d{6}$/.test(code) || !verifyDevOtp(this.key, phone, stored.sid, code, stored.hash)) {
      stored.attempts += 1;
      return false;
    }
    stored.used = true;
    return true;
  }

  private assertLocal(): void {
    try {
      rejectDevOtpUnlessLocal();
    } catch {
      throw new ServiceUnavailableException('WhatsApp verification is unavailable');
    }
    if (!devOtpAllowed()) {
      throw new ServiceUnavailableException('WhatsApp verification is unavailable');
    }
  }

  private prune(now: number): void {
    for (const [phone, history] of this.sentAt) {
      const recent = history.filter((sent) => now - sent < HOUR_MS);
      if (recent.length === 0) {
        this.sentAt.delete(phone);
      } else {
        this.sentAt.set(phone, recent);
      }
    }
  }
}

function hashDevOtp(key: Buffer, phone: string, sid: string, code: string): Buffer {
  return createHmac('sha256', key).update(`${phone}\0${sid}\0${code}`).digest();
}

function verifyDevOtp(key: Buffer, phone: string, sid: string, code: string, expected: Buffer): boolean {
  const actual = hashDevOtp(key, phone, sid, code);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    return LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
