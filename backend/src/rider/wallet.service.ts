import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readMoneyCents } from '../delivery/money.js';
import {
  applyBorrowingLimit,
  creditWallet,
  ensureRiderWallet,
  isUniqueViolation,
  postLedgerEntry,
  readWalletSummary,
  type CreditCommand,
  type LedgerCommand,
  type LedgerPosting,
  type WalletSummary,
} from './wallet-ledger.js';
import { readTransactionPage, readWalletTransactions, type WalletTransactionPage } from './wallet-history.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';
import { adminPage, readAdminPage, readOptionalUuid } from '../http/admin-query.js';
import { readManualTopUp, recordManualTopUp } from './wallet-top-up.js';

export type RiderWalletView = {
  id: string;
  riderProfileId: string;
  balance: string;
  currency: 'USD';
  borrowingLimitOverride: string | null;
  welcomeBonusAwardedAt: Date | null;
};

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureWallet(riderProfileId: string, now = new Date()): Promise<RiderWalletView> {
    const wallet = await this.transaction((tx) => ensureRiderWallet(tx, riderProfileId, now));
    return toWalletView(wallet);
  }

  summary(riderProfileId: string): Promise<WalletSummary> {
    return this.prisma.$transaction((tx) => readWalletSummary(tx, riderProfileId));
  }

  async transactions(riderProfileId: string, query: unknown): Promise<WalletTransactionPage> {
    const page = readTransactionPage(query);
    return this.prisma.$transaction((tx) => readWalletTransactions(tx, riderProfileId, page));
  }

  credit(command: CreditCommand): Promise<LedgerPosting> {
    return this.transaction((tx) => creditWallet(tx, command));
  }

  post(command: LedgerCommand): Promise<LedgerPosting> {
    return this.transaction((tx) => postLedgerEntry(tx, command));
  }

  async topUp(admin: AdminContext, riderProfileId: string, body: unknown, idempotencyKey: string, now = new Date()) {
    const request = readManualTopUp(body, idempotencyKey);
    return this.transaction((tx) => recordManualTopUp(tx, { ...request, admin, riderProfileId, now }));
  }

  setBorrowingLimit(admin: AdminContext, riderProfileId: string, body: unknown, now = new Date()): Promise<WalletSummary> {
    const overrideCents = readBorrowingLimit(body);
    return this.transaction((tx) => applyBorrowingLimit(tx, admin, riderProfileId, overrideCents, now));
  }

  async borrowingLimitAudits(query: Record<string, unknown>) {
    const page = readAdminPage(query.page, 1, 1, 100000);
    const limit = readAdminPage(query.limit, 20, 1, 100);
    const riderProfileId = readOptionalUuid(query.riderProfileId, 'Invalid rider profile');
    const actorId = readOptionalUuid(query.actorId, 'Invalid actor');
    const where = {
      ...(actorId ? { actorId } : {}),
      ...(riderProfileId ? { riderWallet: { riderProfileId } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.walletBorrowingLimitAudit.count({ where }),
      this.prisma.walletBorrowingLimitAudit.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          riderWalletId: true,
          actorId: true,
          previousOverride: true,
          newOverride: true,
          createdAt: true,
          riderWallet: {
            select: { riderProfileId: true },
          },
        },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        riderWalletId: row.riderWalletId,
        riderProfileId: row.riderWallet.riderProfileId,
        actorId: row.actorId,
        previousOverride: row.previousOverride === null ? null : formatSignedCents(signedCentsFromDecimal(row.previousOverride)),
        newOverride: row.newOverride === null ? null : formatSignedCents(signedCentsFromDecimal(row.newOverride)),
        createdAt: row.createdAt,
      })),
      pagination: adminPage(page, limit, total),
    };
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction((tx) => work(tx));
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.prisma.$transaction((tx) => work(tx));
    }
  }
}

export function readBorrowingLimit(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('borrowingLimit' in body)) {
    throw new BadRequestException('Enter the negative wallet limit');
  }
  const value = (body as { borrowingLimit: unknown }).borrowingLimit;
  if (value === null) {
    return null;
  }
  return readMoneyCents(value, true, 'Enter the negative wallet limit');
}

function toWalletView(wallet: {
  id: string;
  riderProfileId: string;
  balance: string | { toFixed(digits: number): string };
  borrowingLimitOverride: string | { toFixed(digits: number): string } | null;
  welcomeBonusAwardedAt: Date | null;
}): RiderWalletView {
  return {
    id: wallet.id,
    riderProfileId: wallet.riderProfileId,
    balance: formatSignedCents(signedCentsFromDecimal(wallet.balance)),
    currency: 'USD',
    borrowingLimitOverride: wallet.borrowingLimitOverride === null
      ? null
      : formatSignedCents(signedCentsFromDecimal(wallet.borrowingLimitOverride)),
    welcomeBonusAwardedAt: wallet.welcomeBonusAwardedAt,
  };
}
