import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import {
  Currency,
  Prisma,
  PromotionalEntryType,
  WalletActorType,
  WalletEntryType,
  WalletFeeReservationStatus,
} from '../generated/prisma/client.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const LEDGER_MISMATCH = 'Wallet balance does not match its ledger';

const MAX_CENTS = 999_999_999_999;

type Money = string | { toFixed(digits: number): string };

export type PromotionalWallet = {
  id: string;
  riderProfileId: string;
  balance: Money;
  promotionalBalance?: Money | null;
};

export type ReservationPortions = {
  total: number;
  promo: number;
  wallet: number;
};

type IssueCommand = {
  riderProfileId: string;
  entryType: typeof WalletEntryType.WELCOME_BONUS | typeof WalletEntryType.PROMOTIONAL_CREDIT;
  amountCents: number;
  idempotencyKey: string;
  reason: string | null;
  actorType: WalletActorType;
  actorId: string | null;
  now: Date;
  configVersion: number;
};

export type PromotionalPosting = {
  entryId: string;
  riderWalletId: string;
  riderProfileId: string;
  entryType: WalletEntryType;
  amount: string;
  balance: string;
  currency: 'USD';
  configVersion: number;
  idempotencyKey: string;
  replayed: boolean;
};

export function reservationPortions(row: {
  amount: Money;
  promotionalAmount?: Money | null;
  walletAmount?: Money | null;
}): ReservationPortions {
  const total = signedCentsFromDecimal(row.amount);
  if (row.promotionalAmount == null || row.walletAmount == null) {
    return { total, promo: 0, wallet: total };
  }
  const promo = signedCentsFromDecimal(row.promotionalAmount);
  const wallet = signedCentsFromDecimal(row.walletAmount);
  if (promo < 0 || wallet < 0 || promo + wallet !== total) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  return { total, promo, wallet };
}

export function splitCommission(
  commissionCents: number,
  promoAvailable: number,
  mainCapacity: number,
  message: string,
): ReservationPortions {
  if (!Number.isSafeInteger(commissionCents) || commissionCents < 0) {
    throw new ConflictException(message);
  }
  const promo = Math.min(Math.max(0, promoAvailable), commissionCents);
  const wallet = commissionCents - promo;
  if (wallet > Math.max(0, mainCapacity)) {
    throw new ConflictException(message);
  }
  return { total: commissionCents, promo, wallet };
}

export function newDeliveriesRestricted(input: {
  coverCents: number;
  platformFeeCents: number;
  marketplace: boolean;
  positivePublishedRate: boolean;
}): boolean {
  if (input.marketplace) {
    return input.positivePublishedRate && input.coverCents <= 0;
  }
  return input.platformFeeCents > 0 && input.coverCents < input.platformFeeCents;
}

export async function readPromotionalPosition(
  tx: Prisma.TransactionClient,
  wallet: PromotionalWallet,
): Promise<{ balance: number; reserved: number; available: number }> {
  const balance = promotionalCents(wallet);
  await assertPromotionalLedger(tx, wallet.id, balance);
  const reserved = await reservedPromotionalCents(tx, wallet.id);
  return { balance, reserved, available: Math.max(0, balance - reserved) };
}

export async function issuePromotionalCredit(
  tx: Prisma.TransactionClient,
  wallet: PromotionalWallet,
  command: IssueCommand,
): Promise<PromotionalPosting> {
  const hash = promotionalPayloadHash(command);
  const existing = await tx.riderPromotionalEntry.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) {
    if (
      existing.payloadHash !== hash
      || existing.riderWalletId !== wallet.id
      || signedCentsFromDecimal(existing.amount) !== command.amountCents
    ) {
      throw new ConflictException('This idempotency key was already used');
    }
    return toPosting(existing, command.riderProfileId, true, command.entryType);
  }
  const balance = promotionalCents(wallet);
  await assertPromotionalLedger(tx, wallet.id, balance);
  const next = balance + command.amountCents;
  assertPromoAmount(next);
  const created = await tx.riderPromotionalEntry.create({
    data: {
      riderWalletId: wallet.id,
      entryType: PromotionalEntryType.ISSUED,
      amount: formatSignedCents(command.amountCents),
      balanceAfter: formatSignedCents(next),
      currency: Currency.USD,
      configVersion: command.configVersion,
      idempotencyKey: command.idempotencyKey,
      payloadHash: hash,
      reservationId: null,
      reason: command.reason,
      actorType: command.actorType,
      actorId: command.actorId,
      createdAt: command.now,
    },
  });
  await tx.riderWallet.update({
    where: { id: wallet.id },
    data: { promotionalBalance: formatSignedCents(next) },
  });
  wallet.promotionalBalance = formatSignedCents(next);
  if (await postedPromotionalCents(tx, wallet.id) !== next) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  return toPosting(created, command.riderProfileId, false, command.entryType);
}

export async function consumeReservedPromotional(
  tx: Prisma.TransactionClient,
  wallet: PromotionalWallet,
  reservation: { id: string; configVersion: number },
  promoCents: number,
  idempotencyKey: string,
  now: Date,
): Promise<void> {
  if (promoCents === 0) {
    return;
  }
  const key = promotionalConsumeKey(idempotencyKey);
  const hash = promotionalPayloadHash({
    riderProfileId: wallet.riderProfileId,
    entryType: WalletEntryType.PROMOTIONAL_CREDIT,
    amountCents: -promoCents,
    idempotencyKey: key,
    reason: null,
    actorType: WalletActorType.SYSTEM,
    actorId: null,
  });
  const existing = await tx.riderPromotionalEntry.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (
      existing.payloadHash !== hash
      || existing.riderWalletId !== wallet.id
      || existing.reservationId !== reservation.id
      || signedCentsFromDecimal(existing.amount) !== -promoCents
    ) {
      throw new ConflictException('Platform fee reservation is corrupted');
    }
    return;
  }
  const balance = promotionalCents(wallet);
  await assertPromotionalLedger(tx, wallet.id, balance);
  const next = balance - promoCents;
  if (next < 0) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  await tx.riderPromotionalEntry.create({
    data: {
      riderWalletId: wallet.id,
      entryType: PromotionalEntryType.CONSUMED,
      amount: formatSignedCents(-promoCents),
      balanceAfter: formatSignedCents(next),
      currency: Currency.USD,
      configVersion: reservation.configVersion,
      idempotencyKey: key,
      payloadHash: hash,
      reservationId: reservation.id,
      reason: null,
      actorType: WalletActorType.SYSTEM,
      actorId: null,
      createdAt: now,
    },
  });
  await tx.riderWallet.update({
    where: { id: wallet.id },
    data: { promotionalBalance: formatSignedCents(next) },
  });
  wallet.promotionalBalance = formatSignedCents(next);
  if (await postedPromotionalCents(tx, wallet.id) !== next) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
}

export async function restoreConsumedPromotional(
  tx: Prisma.TransactionClient,
  wallet: PromotionalWallet,
  promoCents: number,
  idempotencyKey: string,
  configVersion: number,
  now: Date,
): Promise<void> {
  if (promoCents <= 0) {
    return;
  }
  const key = `promo-restore:${idempotencyKey}`;
  if (key.length > 200) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const hash = promotionalPayloadHash({
    riderProfileId: wallet.riderProfileId,
    entryType: WalletEntryType.PROMOTIONAL_CREDIT,
    amountCents: promoCents,
    idempotencyKey: key,
    reason: 'Platform fee restored',
    actorType: WalletActorType.SYSTEM,
    actorId: null,
  });
  const existing = await tx.riderPromotionalEntry.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.payloadHash !== hash || existing.riderWalletId !== wallet.id || signedCentsFromDecimal(existing.amount) !== promoCents) {
      throw new ConflictException('Acceptance commission refund is inconsistent');
    }
    return;
  }
  const balance = promotionalCents(wallet);
  await assertPromotionalLedger(tx, wallet.id, balance);
  const next = balance + promoCents;
  assertPromoAmount(next);
  await tx.riderPromotionalEntry.create({
    data: {
      riderWalletId: wallet.id,
      entryType: PromotionalEntryType.ISSUED,
      amount: formatSignedCents(promoCents),
      balanceAfter: formatSignedCents(next),
      currency: Currency.USD,
      configVersion,
      idempotencyKey: key,
      payloadHash: hash,
      reservationId: null,
      reason: 'Platform fee restored',
      actorType: WalletActorType.SYSTEM,
      actorId: null,
      createdAt: now,
    },
  });
  await tx.riderWallet.update({
    where: { id: wallet.id },
    data: { promotionalBalance: formatSignedCents(next) },
  });
  wallet.promotionalBalance = formatSignedCents(next);
  if (await postedPromotionalCents(tx, wallet.id) !== next) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
}

export function promotionalConsumeKey(idempotencyKey: string): string {
  const key = `promo-consume:${idempotencyKey}`;
  if (key.length > 200) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  return key;
}

export async function marketplaceRateIsPositive(tx: Prisma.TransactionClient): Promise<boolean> {
  if (!v2MarketplaceEnabled()) {
    return false;
  }
  const rates = (tx as Prisma.TransactionClient & {
    v2CommissionRate?: { findFirst(args: { where: { isActive: boolean }; select: { basisPoints: true } }): Promise<{ basisPoints: number } | null> };
  }).v2CommissionRate;
  if (!rates) {
    return false;
  }
  const rate = await rates.findFirst({ where: { isActive: true }, select: { basisPoints: true } });
  return rate != null && rate.basisPoints > 0;
}

function promotionalCents(wallet: PromotionalWallet): number {
  if (wallet.promotionalBalance == null) {
    return 0;
  }
  return signedCentsFromDecimal(wallet.promotionalBalance);
}

async function assertPromotionalLedger(tx: Prisma.TransactionClient, riderWalletId: string, cached: number): Promise<void> {
  const entries = tx.riderPromotionalEntry;
  if (!entries) {
    if (cached !== 0) {
      throw new ConflictException(LEDGER_MISMATCH);
    }
    return;
  }
  if (await postedPromotionalCents(tx, riderWalletId) !== cached) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
}

async function postedPromotionalCents(tx: Prisma.TransactionClient, riderWalletId: string): Promise<number> {
  const entries = tx.riderPromotionalEntry;
  if (!entries) {
    return 0;
  }
  const aggregate = await entries.aggregate({
    where: { riderWalletId },
    _sum: { amount: true },
  });
  return signedCentsFromDecimal(aggregate._sum.amount);
}

async function reservedPromotionalCents(tx: Prisma.TransactionClient, riderWalletId: string): Promise<number> {
  const rows = await tx.walletFeeReservation.findMany({
    where: { riderWalletId, status: WalletFeeReservationStatus.OPEN },
  });
  return rows.reduce((sum, row) => sum + reservationPortions(row).promo, 0);
}

function promotionalPayloadHash(payload: {
  riderProfileId: string;
  entryType: WalletEntryType;
  amountCents: number;
  idempotencyKey: string;
  reason: string | null;
  actorType: WalletActorType;
  actorId: string | null;
}): string {
  const canonical = JSON.stringify({
    actorId: payload.actorId,
    actorType: payload.actorType,
    amountCents: payload.amountCents,
    entryType: payload.entryType,
    idempotencyKey: payload.idempotencyKey,
    reason: payload.reason,
    riderProfileId: payload.riderProfileId,
    walletPaymentId: null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function assertPromoAmount(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_CENTS) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
}

function toPosting(
  entry: { id: string; riderWalletId: string; amount: Money; balanceAfter: Money; configVersion: number; idempotencyKey: string },
  riderProfileId: string,
  replayed: boolean,
  entryType: WalletEntryType,
): PromotionalPosting {
  return {
    entryId: entry.id,
    riderWalletId: entry.riderWalletId,
    riderProfileId,
    entryType,
    amount: formatSignedCents(signedCentsFromDecimal(entry.amount)),
    balance: formatSignedCents(signedCentsFromDecimal(entry.balanceAfter)),
    currency: 'USD',
    configVersion: entry.configVersion,
    idempotencyKey: entry.idempotencyKey,
    replayed,
  };
}
