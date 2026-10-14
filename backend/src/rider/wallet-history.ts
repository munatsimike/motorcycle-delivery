import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Currency, Prisma, WalletEntryType, WalletPaymentMethod } from '../generated/prisma/client.js';
import { readWalletSummary } from './wallet-ledger.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const VISIBLE_REASONS = new Set<WalletEntryType>([
  WalletEntryType.ADJUSTMENT,
  WalletEntryType.PROMOTIONAL_CREDIT,
]);

export type WalletPaymentView = {
  method: 'CASH' | 'ECOCASH' | 'GATEWAY';
  internalReceiptId: string | null;
  externalReceiptNumber: string | null;
  ecocashReference: string | null;
};

export type WalletTransactionView = {
  id: string;
  type: WalletEntryType;
  amount: string;
  balanceAfter: string;
  currency: 'USD';
  createdAt: Date;
  reason: string | null;
  payment: WalletPaymentView | null;
};

export type WalletTransactionPage = {
  transactions: WalletTransactionView[];
  nextCursor: string | null;
};

export type TransactionPageRequest = {
  limit: number;
  cursor: { createdAt: Date; id: string } | null;
};

type HistoryRow = {
  id: string;
  entryType: WalletEntryType;
  amount: string | { toFixed(digits: number): string };
  balanceAfter: string | { toFixed(digits: number): string };
  createdAt: Date;
  reason: string | null;
  payment: {
    method: WalletPaymentMethod;
    internalReceiptId: string | null;
    externalReceiptNumber: string | null;
    ecocashReference: string | null;
  } | null;
};

// Read-only history. A missing wallet stays missing: this does not create a
// wallet, post a ledger row, or award a welcome bonus.
export async function readWalletTransactions(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  page: TransactionPageRequest,
): Promise<WalletTransactionPage> {
  await readWalletSummary(tx, riderProfileId);
  const wallet = await tx.riderWallet.findUnique({
    where: { riderProfileId },
    select: { id: true },
  });
  if (!wallet) {
    throw new NotFoundException('Rider wallet not found');
  }
  const rows = await tx.riderWalletEntry.findMany({
    where: page.cursor
      ? {
          riderWalletId: wallet.id,
          OR: [
            { createdAt: { lt: page.cursor.createdAt } },
            { AND: [{ createdAt: page.cursor.createdAt }, { id: { lt: page.cursor.id } }] },
          ],
        }
      : { riderWalletId: wallet.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
    select: {
      id: true,
      entryType: true,
      amount: true,
      balanceAfter: true,
      createdAt: true,
      reason: true,
      payment: {
        select: {
          method: true,
          internalReceiptId: true,
          externalReceiptNumber: true,
          ecocashReference: true,
        },
      },
    },
  });
  const visible = rows.slice(0, page.limit);
  const last = visible[visible.length - 1];
  return {
    transactions: visible.map(toTransaction),
    nextCursor: rows.length > page.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export function readTransactionPage(query: unknown): TransactionPageRequest {
  if (query !== undefined && (typeof query !== 'object' || query === null || Array.isArray(query))) {
    throw new BadRequestException('Enter a page size');
  }
  const record = (query ?? {}) as Record<string, unknown>;
  return {
    limit: readLimit(record.limit),
    cursor: readCursor(record.cursor),
  };
}

function readLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_LIMIT;
  }
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) {
    throw new BadRequestException('Enter a page size');
  }
  const limit = Number(value);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException('Enter a page size');
  }
  return limit;
}

function readCursor(value: unknown): TransactionPageRequest['cursor'] {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('Enter a valid cursor');
  }
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const split = decoded.split('\n');
  if (split.length !== 2) {
    throw new BadRequestException('Enter a valid cursor');
  }
  const [iso, id] = split;
  const createdAt = new Date(iso ?? '');
  if (!iso || Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) {
    throw new BadRequestException('Enter a valid cursor');
  }
  if (!id || id.length > 64 || !/^[0-9a-zA-Z-]+$/.test(id)) {
    throw new BadRequestException('Enter a valid cursor');
  }
  return { createdAt, id };
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}\n${id}`, 'utf8').toString('base64url');
}

function toTransaction(row: HistoryRow): WalletTransactionView {
  return {
    id: row.id,
    type: row.entryType,
    amount: formatSignedCents(signedCentsFromDecimal(row.amount)),
    balanceAfter: formatSignedCents(signedCentsFromDecimal(row.balanceAfter)),
    currency: Currency.USD,
    createdAt: row.createdAt,
    reason: VISIBLE_REASONS.has(row.entryType) ? row.reason : null,
    payment: row.payment
      ? {
          method: row.payment.method,
          internalReceiptId: row.payment.internalReceiptId,
          externalReceiptNumber: row.payment.externalReceiptNumber,
          ecocashReference: row.payment.ecocashReference,
        }
      : null,
  };
}
