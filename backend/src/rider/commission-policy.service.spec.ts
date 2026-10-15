import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CommissionPolicyService } from './commission-policy.service.js';

describe('CommissionPolicyService', () => {
  function setup() {
    const policies = [
      {
        id: 'policy-1',
        policyVersion: 1,
        model: 'ON_COMPLETION',
        isActive: true,
        createdById: null,
      },
    ];

    const delegate = {
      findFirst: vi.fn(async () =>
        policies.find((policy) => policy.isActive) ?? null
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const policy = policies.find((row) => row.id === where.id)!;
        Object.assign(policy, data);
        return policy;
      }),
      create: vi.fn(async ({ data }: any) => {
        const policy = {
          id: `policy-${policies.length + 1}`,
          ...data,
        };
        policies.push(policy);
        return policy;
      }),
    };

    const prisma = {
      commissionPolicy: delegate,
      $transaction: async (fn: any) =>
        fn({
          commissionPolicy: delegate,
          $queryRaw: vi.fn(async () => []),
        }),
    };

    const service = new CommissionPolicyService(prisma as any);
    const admin = { userId: 'admin-1' } as any;

    return { service, policies, delegate, admin };
  }

  it('returns the active policy', async () => {
    const ctx = setup();

    await expect(ctx.service.current()).resolves.toEqual({
      model: 'ON_COMPLETION',
      policyVersion: 1,
    });
  });

  it('creates a new version when the model changes', async () => {
    const ctx = setup();

    await expect(
      ctx.service.replace(ctx.admin, { model: 'ON_ACCEPTANCE' }),
    ).resolves.toEqual({
      model: 'ON_ACCEPTANCE',
      policyVersion: 2,
    });

    expect(ctx.policies).toHaveLength(2);
    expect(ctx.policies[0].isActive).toBe(false);
    expect(ctx.policies[1].isActive).toBe(true);
    expect(ctx.policies[1].createdById).toBe('admin-1');
  });

  it('does not create another version when unchanged', async () => {
    const ctx = setup();

    await ctx.service.replace(ctx.admin, { model: 'ON_COMPLETION' });

    expect(ctx.policies).toHaveLength(1);
    expect(ctx.delegate.create).not.toHaveBeenCalled();
  });

  it('rejects invalid commission models', async () => {
    const ctx = setup();

    await expect(
      ctx.service.replace(ctx.admin, { model: 'INVALID' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});