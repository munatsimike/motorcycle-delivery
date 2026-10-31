import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLoginService } from './admin-login.service.js';
import { hashAdminOtp } from './admin-otp-code.js';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';

describe('Admin login OTP verification', () => {
  const originalSecret = process.env.ADMIN_OTP_HMAC_SECRET;
  const challengeId = '0199aabb-ccdd-7eee-8fff-123456789abc';
  const adminUserId = '0199aabb-ccdd-7eee-8fff-123456789abd';

  const checkAndRecord = vi.fn();
  const executeRaw = vi.fn();
  const findChallenge = vi.fn();
  const updateChallenge = vi.fn();
  const findUser = vi.fn();
  const issue = vi.fn();

  const tx = {
    $queryRaw: executeRaw,
    adminLoginChallenge: {
      findUnique: findChallenge,
      update: updateChallenge,
    },
    user: { findUnique: findUser },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  const service = new AdminLoginService(
    prisma as never,
    { issue } as never,
    {} as never,
    { checkAndRecord } as never,
    {} as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.ADMIN_OTP_HMAC_SECRET =
      'test-only-admin-otp-secret-at-least-32-characters';

    checkAndRecord.mockResolvedValue(undefined);
    executeRaw.mockResolvedValue(1);
    updateChallenge.mockResolvedValue({});
    issue.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    });

    findChallenge.mockResolvedValue({
      id: challengeId,
      adminUserId,
      codeHash: hashAdminOtp(challengeId, '123456'),
      expiresAt: new Date(Date.now() + 300_000),
      consumedAt: null,
      checkAttempts: 0,
    });

    findUser.mockResolvedValue({
      id: adminUserId,
      role: UserRole.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      passwordHash: 'test-hash',
      email: 'admin@example.com',
    });
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.ADMIN_OTP_HMAC_SECRET;
    } else {
      process.env.ADMIN_OTP_HMAC_SECRET = originalSecret;
    }
  });

  it('rejects an expired OTP without issuing a session', async () => {
    findChallenge.mockResolvedValueOnce({
      id: challengeId,
      adminUserId,
      codeHash: hashAdminOtp(challengeId, '123456'),
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
      checkAttempts: 0,
    });

    await expect(
      service.verifyLogin(
        { challengeId, code: '123456' },
        '192.0.2.10',
      ),
    ).rejects.toThrow('Verification code is invalid');

    expect(issue).not.toHaveBeenCalled();
    expect(updateChallenge).not.toHaveBeenCalled();
  });
  it('records an incorrect OTP attempt without issuing a session', async () => {
    await expect(
      service.verifyLogin(
        { challengeId, code: '654321' },
        '192.0.2.10',
      ),
    ).rejects.toThrow('Verification code is invalid');

    expect(updateChallenge).toHaveBeenCalledWith({
      where: { id: challengeId },
      data: {
        checkAttempts: { increment: 1 },
      },
    });

    expect(issue).not.toHaveBeenCalled();
  });

  it('rejects a challenge after five failed attempts', async () => {
    findChallenge.mockResolvedValueOnce({
      id: challengeId,
      adminUserId,
      codeHash: hashAdminOtp(challengeId, '123456'),
      expiresAt: new Date(Date.now() + 300_000),
      consumedAt: null,
      checkAttempts: 5,
    });

    await expect(
      service.verifyLogin(
        { challengeId, code: '123456' },
        '192.0.2.10',
      ),
    ).rejects.toThrow('Verification code is invalid');

    expect(updateChallenge).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });
  it('allows only one concurrent OTP verification', async () => {
    let consumed = false;

    findChallenge.mockImplementation(async () => ({
      id: challengeId,
      adminUserId,
      codeHash: hashAdminOtp(challengeId, '123456'),
      expiresAt: new Date(Date.now() + 300_000),
      consumedAt: consumed ? new Date() : null,
      checkAttempts: 0,
    }));

    updateChallenge.mockImplementation(async () => {
      consumed = true;
      return {};
    });

    // Simulate the database serializing transactions.
    let queue = Promise.resolve();

    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => {
        const previous = queue;
        let release!: () => void;
        queue = new Promise<void>((resolve) => {
          release = resolve;
        });

        await previous;

        try {
          return await callback(tx);
        } finally {
          release();
        }
      },
    );

    const request = { challengeId, code: '123456' };

    const results = await Promise.allSettled([
      service.verifyLogin(request, '192.0.2.10'),
      service.verifyLogin(request, '192.0.2.10'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled'))
      .toHaveLength(1);

    expect(results.filter((result) => result.status === 'rejected'))
      .toHaveLength(1);

    expect(issue).toHaveBeenCalledOnce();
  });
  it('issues a session once and rejects OTP reuse', async () => {
    const request = { challengeId, code: '123456' };

    await expect(
      service.verifyLogin(request, '192.0.2.10'),
    ).resolves.toHaveProperty('accessToken');

    expect(updateChallenge).toHaveBeenCalledWith({
      where: { id: challengeId },
      data: { consumedAt: expect.any(Date) },
    });
    expect(issue).toHaveBeenCalledOnce();

    findChallenge.mockResolvedValueOnce({
      id: challengeId,
      adminUserId,
      codeHash: hashAdminOtp(challengeId, '123456'),
      expiresAt: new Date(Date.now() + 300_000),
      consumedAt: new Date(),
      checkAttempts: 0,
    });

    await expect(
      service.verifyLogin(request, '192.0.2.10'),
    ).rejects.toThrow('Verification code is invalid');

    expect(issue).toHaveBeenCalledOnce();
  });
});




