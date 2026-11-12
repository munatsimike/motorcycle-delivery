import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminOtpEmailService, localAdminOtpFallbackAllowed } from './admin-otp-email.service.js';

describe('local admin OTP fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is limited to local development', () => {
    expect(localAdminOtpFallbackAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(localAdminOtpFallbackAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(localAdminOtpFallbackAllowed({ NODE_ENV: 'development', RAILWAY_ENVIRONMENT: 'production' })).toBe(false);
    expect(localAdminOtpFallbackAllowed({ NODE_ENV: 'development', TRUST_RAILWAY_EDGE_CLIENT_IP: 'true' })).toBe(false);
  });

  it('prints a local code when email delivery is not configured', async () => {
    const logs: unknown[][] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    const service = new AdminOtpEmailService();
    await expect(service.sendCode('admin@example.com', '042817', { NODE_ENV: 'development' })).resolves.toBeUndefined();
    expect(JSON.stringify(logs)).toContain('042817');
    expect(JSON.stringify(logs)).not.toContain('password');
  });

  it('does not print a code outside local development', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new AdminOtpEmailService();
    await expect(service.sendCode('admin@example.com', '042817', { NODE_ENV: 'production' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify(log.mock.calls)).not.toContain('042817');
  });
});
