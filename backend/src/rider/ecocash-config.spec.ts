import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertEcocashConfiguration,
  ecocashAutoCreditEnabled,
  EcocashConfigurationError,
  readEcocashSandboxConfig,
} from './ecocash-config.js';

const ENABLED = {
  NODE_ENV: 'development',
  ECOCASH_ENABLED: 'true',
  ECOCASH_ENVIRONMENT: 'sandbox',
  ECOCASH_SANDBOX_BASE_URL: 'https://developers.ecocash.co.zw',
  ECOCASH_USERNAME: 'sandbox-user',
  ECOCASH_PASSWORD: 'sandbox-pass',
  ECOCASH_MERCHANT_CODE: 'ABC123',
  ECOCASH_MERCHANT_NUMBER: '771234567',
  ECOCASH_MERCHANT_PIN: '2468',
  ECOCASH_TERMINAL_ID: 'TERM01',
  ECOCASH_LOCATION: 'Harare',
  ECOCASH_SUPER_MERCHANT_NAME: 'Riders',
  ECOCASH_MERCHANT_NAME: 'Riders',
  ECOCASH_PURCHASE_CATEGORY: 'Online Payment',
  ECOCASH_CHARGE_DESCRIPTION: 'Riders wallet top-up',
};

const previous = new Map<string, string | undefined>();

describe('EcoCash sandbox configuration', () => {

  afterEach(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });

  it('starts without credentials while payments are disabled', () => {
    expect(() => assertEcocashConfiguration({
      ...ENABLED,
      ECOCASH_ENABLED: 'false',
      ECOCASH_ENVIRONMENT: 'production',
      ECOCASH_PASSWORD: '',
      ECOCASH_MERCHANT_PIN: '',
    })).not.toThrow();
    expect(() => readEcocashSandboxConfig({ ECOCASH_ENABLED: 'false' })).toThrow(ServiceUnavailableException);
  });

  it('rejects production and non-sandbox endpoints without echoing secrets', () => {
    expect(() => readEcocashSandboxConfig({ ...ENABLED, ECOCASH_ENVIRONMENT: 'production' })).toThrow(EcocashConfigurationError);
    expect(() => readEcocashSandboxConfig({
      ...ENABLED,
      ECOCASH_SANDBOX_BASE_URL: 'https://pay.example.com/payment/v1/transactions/amount/',
    })).toThrow(EcocashConfigurationError);
    try {
      readEcocashSandboxConfig({ ...ENABLED, ECOCASH_PASSWORD: 'short', RAILWAY_ENVIRONMENT: 'production' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain('sandbox-pass');
      expect(message).not.toContain('2468');
      expect(message).toContain('RAILWAY_ENVIRONMENT');
    }
  });

  it('reads a local sandbox configuration', () => {
    const config = readEcocashSandboxConfig(ENABLED);
    expect(config.baseUrl).toBe('https://developers.ecocash.co.zw');
    expect(config.environment).toBe('sandbox');
    remember(ENABLED);
    expect(() => assertEcocashConfiguration()).not.toThrow();
  });

  it('keeps automatic crediting disabled unless its own switch is exactly true', () => {
    expect(ecocashAutoCreditEnabled({})).toBe(false);
    expect(ecocashAutoCreditEnabled({ ...ENABLED })).toBe(false);
    expect(ecocashAutoCreditEnabled({ ...ENABLED, ECOCASH_AUTO_CREDIT_ENABLED: 'false' })).toBe(false);
    expect(ecocashAutoCreditEnabled({ ...ENABLED, ECOCASH_AUTO_CREDIT: 'true' })).toBe(false);
    expect(ecocashAutoCreditEnabled({ NODE_ENV: 'development', ECOCASH_AUTO_CREDIT_ENABLED: 'true' })).toBe(true);
    expect(ecocashAutoCreditEnabled({ ...ENABLED, NODE_ENV: 'production', ECOCASH_AUTO_CREDIT_ENABLED: 'true' })).toBe(false);
    expect(ecocashAutoCreditEnabled({
      NODE_ENV: 'development',
      ECOCASH_AUTO_CREDIT_ENABLED: 'true',
      RAILWAY_ENVIRONMENT: 'production',
    })).toBe(false);
  });
});

function remember(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    if (!previous.has(key)) previous.set(key, process.env[key]);
    process.env[key] = value;
  }
}
