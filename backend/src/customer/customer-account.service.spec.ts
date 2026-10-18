import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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
      email: null,
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

  it('updates the signed-in customer name and email without accepting another user or a new phone', async () => {
    const ctx = context();
    await ctx.service.activate(RIDER, {
      accountKind: 'INDIVIDUAL',
      fullName: 'Tendai Moyo',
      address: '12 Samora Machel Avenue',
    }, NOW);
    ctx.users.push({
      id: 'user-2',
      role: UserRole.CUSTOMER,
      fullName: 'Other Person',
      phone: '+263772222222',
      email: 'taken@example.com',
      customerAccount: null,
    });

    const updated = await ctx.service.update({ userId: 'user-1' }, {
      fullName: '  Rudo   Ncube ',
      email: ' Rudo@Example.com ',
      phone: '+263779999999',
      userId: 'user-2',
      role: 'ADMIN',
      address: '99 Other Road',
    });

    expect(updated).toMatchObject({
      id: 'account-1',
      kind: CustomerAccountKind.INDIVIDUAL,
      name: 'Rudo Ncube',
      contactName: null,
      address: '99 Other Road',
      phone: '+263771234567',
      email: 'rudo@example.com',
    });
    expect(ctx.users[0]).toMatchObject({
      role: UserRole.RIDER,
      fullName: 'Rudo Ncube',
      phone: '+263771234567',
      email: 'rudo@example.com',
    });
    expect(ctx.users[1].fullName).toBe('Other Person');
  });

  it('updates a business contact name and leaves the business name unchanged', async () => {
    const ctx = context();
    await ctx.service.activate(RIDER, businessBody(), NOW);

    const updated = await ctx.service.update({ userId: 'user-1' }, {
      fullName: 'Chipo Dube',
      email: null,
      address: '  4   Jason Moyo Avenue ',
    });

    expect(updated).toMatchObject({
      kind: CustomerAccountKind.BUSINESS,
      name: 'Moyo Deliveries',
      contactName: 'Chipo Dube',
      address: '4 Jason Moyo Avenue',
      phone: '+263771234567',
      email: null,
    });
    expect(ctx.users[0].fullName).toBe('Chipo Dube');
  });

  it('rejects an empty name and a duplicate email without changing the saved profile', async () => {
    const ctx = context();
    await ctx.service.activate(RIDER, businessBody(), NOW);
    ctx.users.push({
      id: 'user-2',
      role: UserRole.CUSTOMER,
      fullName: 'Other Person',
      phone: '+263772222222',
      email: 'taken@example.com',
      customerAccount: null,
    });

    await expect(ctx.service.update({ userId: 'user-1' }, { fullName: '   ', email: null, address: '4 Jason Moyo Avenue' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.update({ userId: 'user-1' }, { fullName: 'Rudo Ncube', email: null, address: '   ' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.update({ userId: 'user-1' }, {
      fullName: 'Rudo Ncube',
      email: 'taken@example.com',
      address: '4 Jason Moyo Avenue',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.accounts[0]).toMatchObject({ name: 'Moyo Deliveries', contactName: 'Rudo Ncube' });
    expect(ctx.users[0].email).toBeNull();
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
    email: null as string | null,
    customerAccount: null as null | AccountRow,
  }];
  const accounts: AccountRow[] = [];
  const rider = { approvalStatus: 'APPROVED', availability: 'OFFLINE' };
  let writes = 0;
  const db = {
    async $transaction<T>(run: (tx: typeof db) => Promise<T>) {
      return run(db);
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        const user = users.find((row) => row.id === where.id);
        if (!user) return null;
        return { ...user, customerAccount: accounts.find((account) => account.userId === user.id) ?? null };
      },
      async update({ where, data }: { where: { id: string }; data: { fullName?: string; email?: string | null; phone?: string } }) {
        const user = users.find((row) => row.id === where.id);
        if (!user) {
          throw new Error('missing user');
        }
        if (data.email && users.some((row) => row.id !== user.id && row.email === data.email)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.1.0' });
        }
        if (data.fullName !== undefined) {
          user.fullName = data.fullName;
        }
        if (data.email !== undefined) {
          user.email = data.email;
        }
        if (data.phone !== undefined) {
          user.phone = data.phone;
        }
        return user;
      },
    },
    customerAccount: {
      async findUnique({ where }: { where: { userId: string } }) {
        return accounts.find((account) => account.userId === where.userId) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<AccountRow> }) {
        const account = accounts.find((row) => row.id === where.id);
        if (!account) {
          throw new Error('missing account');
        }
        Object.assign(account, data);
        return account;
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
