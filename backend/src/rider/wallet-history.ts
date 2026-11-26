import { exactPageKeys, orderedPageRows } from '../common/exact-page.js';
import { encodeListCursor, readKeysetCursor, type ListCursor } from '../common/list-cursor.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Currency, Prisma, WalletEntryType, WalletPaymentMethod } from '../generated/prisma/client.js';
import { readWalletSummary, walletWhere } from './wallet-ledger.js';
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
  currency: Currency;
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
  cursor: ListCursor | null;
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
export function readHistoryCurrency(query: unknown): Currency {
  if (query === undefined || query === null || typeof query !== 'object' || Array.isArray(query)) {
    return Currency.USD;
  }
  const value = (query as { currency?: unknown }).currency;
  if (value === undefined || value === null || value === '' || value === Currency.USD) {
    return Currency.USD;
  }
  if (value === Currency.ZWG) {
    return Currency.ZWG;
  }
  throw new BadRequestException('Choose USD or ZiG');
}

export async function readWalletTransactions(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  page: TransactionPageRequest,
  currency: Currency = Currency.USD,
): Promise<WalletTransactionPage> {
  if (currency === Currency.USD) {
    await readWalletSummary(tx, riderProfileId);
  }
  const wallet = await tx.riderWallet.findUnique({
    where: walletWhere(riderProfileId, currency),
    select: { id: true },
  });
  if (!wallet) {
    if (currency === Currency.ZWG) {
      return { transactions: [], nextCursor: null };
    }
    throw new NotFoundException('Rider wallet not found');
  }
  const keys = await exactPageKeys(tx, 'wallet', wallet.id, page.limit, page.cursor ?? undefined);
  const visibleKeys = keys.slice(0, page.limit);
  const rows = await tx.riderWalletEntry.findMany({
    where: { riderWalletId: wallet.id, id: { in: visibleKeys.map(key => key.id) } },
    take: page.limit,
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
  const visible = orderedPageRows(visibleKeys, rows);
  const last = visibleKeys[visibleKeys.length - 1];
  return {
    transactions: visible.map((row) => toTransaction(row, currency)),
    nextCursor: keys.length > page.limit && last ? encodeListCursor(last.at, last.id) : null,
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
  if (value === undefined || value === null || value === '') return null;
  return readKeysetCursor(value);
}

function toTransaction(row: HistoryRow, currency: Currency): WalletTransactionView {
  return {
    id: row.id,
    type: row.entryType,
    amount: formatSignedCents(signedCentsFromDecimal(row.amount)),
    balanceAfter: formatSignedCents(signedCentsFromDecimal(row.balanceAfter)),
    currency,
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
