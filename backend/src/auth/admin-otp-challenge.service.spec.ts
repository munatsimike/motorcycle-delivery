import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminOtpChallengeService } from './admin-otp-challenge.service.js';
import { verifyAdminOtp } from './admin-otp-code.js';

describe('Admin OTP challenge service', () => {
  const originalSecret = process.env.ADMIN_OTP_HMAC_SECRET;

  const executeRaw = vi.fn();
  const findMany = vi.fn();
  const create = vi.fn();

  const tx = {
    $queryRaw: executeRaw,
    adminLoginChallenge: { findMany, create },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  const service = new AdminOtpChallengeService(prisma as never);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_OTP_HMAC_SECRET =
      'test-only-admin-otp-secret-at-least-32-characters';

    executeRaw.mockResolvedValue(1);
    findMany.mockResolvedValue([]);
    create.mockResolvedValue({});
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.ADMIN_OTP_HMAC_SECRET;
    } else {
      process.env.ADMIN_OTP_HMAC_SECRET = originalSecret;
    }
  });

  it('creates a challenge with a hashed OTP', async () => {
    const result = await service.create('admin-user-1');

    expect(result).not.toBeNull();
    expect(result!.code).toMatch(/^\d{6}$/);
    expect(create).toHaveBeenCalledOnce();

    const data = create.mock.calls[0][0].data;

    expect(data.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.codeHash).not.toBe(result!.code);
    expect(
      verifyAdminOtp(result!.challengeId, result!.code, data.codeHash),
    ).toBe(true);
  });

  it('blocks requests during the cooldown', async () => {
    findMany.mockResolvedValue([
      { createdAt: new Date(Date.now() - 30_000) },
    ]);

    const result = await service.create('admin-user-1');

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks requests after five challenges in an hour', async () => {
    findMany.mockResolvedValue(
      [2, 10, 20, 30, 40].map((minutes) => ({
        createdAt: new Date(Date.now() - minutes * 60_000),
      })),
    );

    const result = await service.create('admin-user-1');

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('fails without the HMAC secret', async () => {
    delete process.env.ADMIN_OTP_HMAC_SECRET;

    await expect(service.create('admin-user-1')).rejects.toThrow(
      'Admin OTP HMAC secret is not configured',
    );

    expect(create).not.toHaveBeenCalled();
  });
});

