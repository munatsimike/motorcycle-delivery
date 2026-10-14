import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLoginRateLimitService } from './admin-login-rate-limit.service.js';

describe('Admin login rate limiting', () => {
  const originalSecret = process.env.ADMIN_OTP_HMAC_SECRET;

  const count = vi.fn();
  const create = vi.fn();
  const executeRaw = vi.fn();

  const tx = {
    $queryRaw: executeRaw,
    adminLoginAttempt: { count, create },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof tx) => Promise<void>) =>
      callback(tx),
    ),
  };

  const service = new AdminLoginRateLimitService(prisma as never);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_OTP_HMAC_SECRET =
      'test-only-admin-otp-secret-at-least-32-characters';
    count.mockResolvedValue(0);
    create.mockResolvedValue({});
    executeRaw.mockResolvedValue(1);
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.ADMIN_OTP_HMAC_SECRET;
    } else {
      process.env.ADMIN_OTP_HMAC_SECRET = originalSecret;
    }
  });

  it('records a hashed IP address', async () => {
    await service.checkAndRecord('192.0.2.10');

    expect(create).toHaveBeenCalledOnce();

    const data = create.mock.calls[0][0].data;

    expect(data.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.ipHash).not.toContain('192.0.2.10');
  });

  it('blocks an IP after 10 attempts', async () => {
    count.mockResolvedValue(10);

    await expect(service.checkAndRecord('192.0.2.10'))
      .rejects.toThrow('Too many login attempts');

    expect(create).not.toHaveBeenCalled();
  });

  it('allows an IP with fewer than 10 attempts', async () => {
    count.mockResolvedValue(9);

    await expect(service.checkAndRecord('192.0.2.10'))
      .resolves.toBeUndefined();

    expect(create).toHaveBeenCalledOnce();
  });

  it('fails closed without the HMAC secret', async () => {
    delete process.env.ADMIN_OTP_HMAC_SECRET;

    await expect(service.checkAndRecord('192.0.2.10'))
      .rejects.toThrow('Admin login rate limiting is not configured');

    expect(create).not.toHaveBeenCalled();
  });
});

