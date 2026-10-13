import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CustomerAccountKind, Prisma, UserRole } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CustomerAccountService } from './customer-account.service.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const RIDER = { userId: 'user-1', role: UserRole.RIDER as const };

describe('CustomerAccountService', () => {
  it('activates a rider without changing rider identity or accepting a client role', async () => {
    const ctx = context();
    const response = await ctx.service.activate(RIDER, {
      accountKind: 'INDIVIDUAL',
      fullName: 'Tendai Moyo',
      address: '12 Samora Machel Avenue',
      role: 'ADMIN',
      userId: 'other-user',
      phone: '+263770000000',
    }, NOW);

    expect(response).toEqual({
      id: ctx.accounts[0].id,
      kind: CustomerAccountKind.INDIVIDUAL,
      name: 'Tendai Moyo',
      contactName: null,
      address: '12 Samora Machel Avenue',
      phone: '+263771234567',
    });
    expect(ctx.users[0]).toMatchObject({ role: UserRole.RIDER, fullName: 'Tendai Rider' });
    expect(ctx.rider).toEqual({ approvalStatus: 'APPROVED', availability: 'OFFLINE' });
    expect(ctx.accounts).toHaveLength(1);
  });

  it('rejects an admin user before creating an account', async () => {
    const ctx = context();
    ctx.users[0].role = UserRole.ADMIN;
    await expect(ctx.service.activate(RIDER, businessBody(), NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.users[0].role).toBe(UserRole.ADMIN);
  });

  it('keeps the original account kind when activation is repeated', async () => {
    const ctx = context();
    const first = await ctx.service.activate(RIDER, businessBody(), NOW);
    const again = await ctx.service.activate(RIDER, {
      accountKind: 'INDIVIDUAL',
      fullName: 'Someone Else',
      address: '99 Other Road',
    }, NOW);

    expect(again).toMatchObject({
      kind: CustomerAccountKind.BUSINESS,
      name: 'Moyo Deliveries',
      contactName: 'Rudo Ncube',
      address: '4 Jason Moyo Avenue',
    });
    expect(again.id).toBe(first.id);
    expect(ctx.accounts).toHaveLength(1);
    expect(ctx.writes).toBe(1);
    expect(ctx.users[0].role).toBe(UserRole.RIDER);
  });
});

function businessBody() {
  return {
    accountKind: 'BUSINESS',
    businessName: 'Moyo Deliveries',
    contactName: 'Rudo Ncube',
    address: '4 Jason Moyo Avenue',
  };
}

function context() {
  const users = [{
    id: 'user-1',
    role: UserRole.RIDER,
    fullName: 'Tendai Rider',
    phone: '+263771234567',
    customerAccount: null as null | AccountRow,
  }];
  const accounts: AccountRow[] = [];
  const rider = { approvalStatus: 'APPROVED', availability: 'OFFLINE' };
  let writes = 0;
  const db = {
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        const user = users.find((row) => row.id === where.id);
        if (!user) return null;
        return { ...user, customerAccount: accounts.find((account) => account.userId === user.id) ?? null };
      },
    },
    customerAccount: {
      async findUnique({ where }: { where: { userId: string } }) {
        return accounts.find((account) => account.userId === where.userId) ?? null;
      },
      async create({ data }: { data: Omit<AccountRow, 'id'> }) {
        if (accounts.some((account) => account.userId === data.userId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.1.0' });
        }
        writes += 1;
        const row = { id: 'account-1', ...data };
        accounts.push(row);
        return row;
      },
    },
  };
  return {
    service: new CustomerAccountService(db as unknown as PrismaService),
    users,
    accounts,
    rider,
    get writes() {
      return writes;
    },
  };
}

type AccountRow = {
  id: string;
  userId: string;
  kind: CustomerAccountKind;
  name: string;
  contactName: string | null;
  address: string;
};
