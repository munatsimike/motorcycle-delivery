import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  Currency,
  Prisma,
  WalletActorType,
  WalletEntryType,
  WalletFeeReservationStatus,
  WalletPaymentStatus,
} from '../generated/prisma/client.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { lockRiderWallet, lockWalletOwner } from './wallet-lock.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

export const WALLET_CONFIG_MISSING = 'Wallet configuration is not configured';
export const IDEMPOTENCY_CONFLICT = 'This idempotency key was already used';
export const LEDGER_MISMATCH = 'Wallet balance does not match its ledger';

const MAX_CENTS = 999_999_999_999;
const CREDIT_TYPES = new Set<WalletEntryType>([
  WalletEntryType.WELCOME_BONUS,
  WalletEntryType.TOP_UP,
  WalletEntryType.PROMOTIONAL_CREDIT,
]);
const FEE_TYPES = new Set<WalletEntryType>([
  WalletEntryType.PLATFORM_FEE_HOLD,
  WalletEntryType.PLATFORM_FEE,
  WalletEntryType.PLATFORM_FEE_RELEASE,
]);

export type LedgerCommand = {
  riderProfileId: string;
  entryType: WalletEntryType;
  amountCents: number;
  idempotencyKey: string;
  reason: string | null;
  walletPaymentId: string | null;
  actorType: WalletActorType;
  actorId: string | null;
  now?: Date;
};

export type CreditCommand = LedgerCommand & {
  entryType: typeof WalletEntryType.WELCOME_BONUS | typeof WalletEntryType.TOP_UP | typeof WalletEntryType.PROMOTIONAL_CREDIT;
};

export type LedgerPosting = {
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

export type WalletSummary = {
  riderProfileId: string;
  balance: string;
  borrowingLimit: string;
  borrowingLimitSource: 'DEFAULT' | 'OVERRIDE';
  reservedFees: string;
  availableCapacity: string;
  currency: 'USD';
};

type NormalizedLedger = {
  riderProfileId: string;
  entryType: WalletEntryType;
  amountCents: number;
  idempotencyKey: string;
  reason: string | null;
  walletPaymentId: string | null;
  actorType: WalletActorType;
  actorId: string | null;
  now: Date;
};

type WalletRow = {
  id: string;
  riderProfileId: string;
  balance: string | { toFixed(digits: number): string };
  borrowingLimitOverride: string | { toFixed(digits: number): string } | null;
  welcomeBonusAwardedAt: Date | null;
};

type EntryRow = {
  id: string;
  riderWalletId: string;
  entryType: WalletEntryType;
  amount: string | { toFixed(digits: number): string };
  balanceAfter: string | { toFixed(digits: number): string };
  configVersion: number;
  idempotencyKey: string;
  payloadHash: string;
};

// Cash, EcoCash, an approved rider request, and a later verified gateway
// webhook all credit through creditWallet. A reversal is another posting
// through postLedgerEntry. Historical rows are never updated or deleted.
export async function creditWallet(tx: Prisma.TransactionClient, command: CreditCommand): Promise<LedgerPosting> {
  if (!CREDIT_TYPES.has(command.entryType)) {
    throw new BadRequestException('Enter a credit type');
  }
  if (!Number.isSafeInteger(command.amountCents) || command.amountCents <= 0) {
    throw new BadRequestException('Enter a credit amount');
  }
  return postLedgerEntry(tx, command);
}

export async function postLedgerEntry(tx: Prisma.TransactionClient, command: LedgerCommand): Promise<LedgerPosting> {
  if (FEE_TYPES.has(command.entryType)) {
    throw new ConflictException('Platform fee posting is not available');
  }
  const input = normalizeLedger(command);
  const hash = walletPayloadHash(input);
  await lockWalletOwner(tx, input.riderProfileId);
  const existing = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    const credited = await tx.riderWallet.findUnique({ where: { id: existing.riderWalletId } });
    if (!credited) {
      throw new ConflictException(IDEMPOTENCY_CONFLICT);
    }
    await lockRiderWallet(tx, credited.id);
    return replayOrReject(existing, credited, hash);
  }
  const wallet = await lockedWallet(tx, input.riderProfileId, input.now);
  const raced = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (raced) {
    return replayOrReject(raced, wallet, hash);
  }

  if (input.walletPaymentId) {
    const linked = await tx.riderWalletEntry.findUnique({ where: { walletPaymentId: input.walletPaymentId } });
    if (linked) {
      throw new ConflictException('This payment has already been credited');
    }
    await requireVerifiedPayment(tx, wallet.id, input);
  }

  const config = await tx.walletConfig.findFirst({ where: { isActive: true } });
  if (!config) {
    throw new ConflictException(WALLET_CONFIG_MISSING);
  }
  const posted = await postedCents(tx, wallet.id);
  const cached = signedCentsFromDecimal(wallet.balance);
  if (posted !== cached) {
    throw new ConflictException(LEDGER_MISMATCH);
  }

  const next = cached + input.amountCents;
  assertNextBalance(next);
  if (input.entryType === WalletEntryType.ADJUSTMENT && input.amountCents < 0) {
    const limit = effectiveLimitCents(wallet, config.defaultBorrowingLimit);
    if (next < -limit) {
      throw new ConflictException('This debit exceeds the borrowing limit');
    }
  }

  const created = await tx.riderWalletEntry.create({
    data: {
      riderWalletId: wallet.id,
      entryType: input.entryType,
      amount: formatSignedCents(input.amountCents),
      balanceAfter: formatSignedCents(next),
      currency: Currency.USD,
      configVersion: config.configVersion,
      idempotencyKey: input.idempotencyKey,
      payloadHash: hash,
      walletPaymentId: input.walletPaymentId,
      reason: input.reason,
      actorType: input.actorType,
      actorId: input.actorId,
      createdAt: input.now,
    },
  });
  await tx.riderWallet.update({
    where: { id: wallet.id },
    data: { balance: formatSignedCents(next) },
  });
  const confirmed = await postedCents(tx, wallet.id);
  if (confirmed !== next) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  return toPosting(created, input.riderProfileId, false);
}

export async function ensureRiderWallet(tx: Prisma.TransactionClient, riderProfileId: string, now: Date) {
  await lockWalletOwner(tx, riderProfileId);
  return lockedWallet(tx, riderProfileId, now);
}

// Called inside the approval transaction after the rider profile lock. A $0
// bonus only marks the entitlement. A positive bonus is posted through
// creditWallet in this same transaction.
export async function awardWelcomeBonus(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  admin: AdminContext,
  now: Date,
): Promise<void> {
  const wallet = await lockedWallet(tx, riderProfileId, now);
  if (wallet.welcomeBonusAwardedAt) {
    return;
  }
  const config = await tx.walletConfig.findFirst({ where: { isActive: true } });
  if (!config) {
    throw new ConflictException(WALLET_CONFIG_MISSING);
  }
  const bonusCents = signedCentsFromDecimal(config.welcomeBonus);
  const posted = await postedCents(tx, wallet.id);
  if (posted !== signedCentsFromDecimal(wallet.balance)) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  if (bonusCents > 0) {
    await creditWallet(tx, {
      riderProfileId,
      entryType: WalletEntryType.WELCOME_BONUS,
      amountCents: bonusCents,
      idempotencyKey: `welcome-bonus:${riderProfileId}`,
      reason: null,
      walletPaymentId: null,
      actorType: WalletActorType.ADMIN,
      actorId: admin.userId,
      now,
    });
  }
  await tx.riderWallet.update({
    where: { id: wallet.id },
    data: { welcomeBonusAwardedAt: now },
  });
}

export async function createEmptyWallet(tx: Prisma.TransactionClient, riderProfileId: string, now: Date) {
  return tx.riderWallet.create({
    data: {
      riderProfileId,
      currency: Currency.USD,
      balance: '0.00',
      borrowingLimitOverride: null,
      welcomeBonusAwardedAt: null,
      updatedAt: now,
    },
  });
}

export async function readWalletSummary(tx: Prisma.TransactionClient, riderProfileId: string): Promise<WalletSummary> {
  const wallet = await tx.riderWallet.findUnique({ where: { riderProfileId } });
  if (!wallet) {
    throw new NotFoundException('Rider wallet not found');
  }
  const posted = await postedCents(tx, wallet.id);
  const cached = signedCentsFromDecimal(wallet.balance);
  if (posted !== cached) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  const config = await tx.walletConfig.findFirst({ where: { isActive: true } });
  const override = wallet.borrowingLimitOverride;
  let source: WalletSummary['borrowingLimitSource'];
  let limit: number;
  if (override === null) {
    if (!config) {
      throw new ConflictException(WALLET_CONFIG_MISSING);
    }
    source = 'DEFAULT';
    limit = signedCentsFromDecimal(config.defaultBorrowingLimit);
  } else {
    source = 'OVERRIDE';
    limit = signedCentsFromDecimal(override);
  }
  // Open reservation rows reduce capacity and are not ledger entries, so they
  // do not change balance. This phase does not create reservations.
  const reserved = await reservedFeeCents(tx, wallet.id);
  const available = Math.max(0, cached + limit - reserved);
  return {
    riderProfileId,
    balance: formatSignedCents(cached),
    borrowingLimit: formatSignedCents(limit),
    borrowingLimitSource: source,
    reservedFees: formatSignedCents(reserved),
    availableCapacity: formatSignedCents(available),
    currency: Currency.USD,
  };
}

export async function applyBorrowingLimit(
  tx: Prisma.TransactionClient,
  admin: AdminContext,
  riderProfileId: string,
  overrideCents: number | null,
  now: Date,
): Promise<WalletSummary> {
  await lockWalletOwner(tx, riderProfileId);
  const wallet = await lockedWallet(tx, riderProfileId, now);
  const previous = wallet.borrowingLimitOverride === null ? null : signedCentsFromDecimal(wallet.borrowingLimitOverride);
  if (previous !== overrideCents) {
    const balance = signedCentsFromDecimal(wallet.balance);
    await tx.riderWallet.update({
      where: { id: wallet.id },
      data: { borrowingLimitOverride: overrideCents === null ? null : formatSignedCents(overrideCents) },
    });
    await tx.walletBorrowingLimitAudit.create({
      data: {
        riderWalletId: wallet.id,
        actorId: admin.userId,
        previousOverride: previous === null ? null : formatSignedCents(previous),
        newOverride: overrideCents === null ? null : formatSignedCents(overrideCents),
        createdAt: now,
      },
    });
    const storedWallet = await tx.riderWallet.findUnique({ where: { id: wallet.id } });
    if (!storedWallet) {
      throw new NotFoundException('Rider wallet not found');
    }
    const stored = signedCentsFromDecimal(storedWallet.balance);
    if (stored !== balance) {
      throw new ConflictException(LEDGER_MISMATCH);
    }
  }
  return readWalletSummary(tx, riderProfileId);
}

export function walletPayloadHash(payload: NormalizedLedger): string {
  const canonical = JSON.stringify({
    actorId: payload.actorId,
    actorType: payload.actorType,
    amountCents: payload.amountCents,
    entryType: payload.entryType,
    idempotencyKey: payload.idempotencyKey,
    reason: payload.reason,
    riderProfileId: payload.riderProfileId,
    walletPaymentId: payload.walletPaymentId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function normalizeLedger(command: LedgerCommand): NormalizedLedger {
  const idempotencyKey = typeof command.idempotencyKey === 'string' ? command.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  if (!Number.isSafeInteger(command.amountCents) || Math.abs(command.amountCents) > MAX_CENTS) {
    throw new BadRequestException('Enter a valid amount');
  }
  const reason = normalizeReason(command.reason);
  if (command.actorType === WalletActorType.SYSTEM) {
    if (command.actorId !== null) {
      throw new BadRequestException('Enter the acting user');
    }
  } else if (!command.actorId) {
    throw new BadRequestException('Enter the acting user');
  }
  assertEntryShape(command.entryType, command.amountCents, reason, command.walletPaymentId);
  return {
    riderProfileId: command.riderProfileId,
    entryType: command.entryType,
    amountCents: command.amountCents,
    idempotencyKey,
    reason,
    walletPaymentId: command.walletPaymentId,
    actorType: command.actorType,
    actorId: command.actorType === WalletActorType.SYSTEM ? null : command.actorId,
    now: command.now ?? new Date(),
  };
}

function assertEntryShape(
  entryType: WalletEntryType,
  amountCents: number,
  reason: string | null,
  walletPaymentId: string | null,
): void {
  if (entryType === WalletEntryType.TOP_UP) {
    if (amountCents <= 0) throw new BadRequestException('Enter a credit amount');
    if (!walletPaymentId) throw new BadRequestException('A verified payment is required');
    return;
  }
  if (walletPaymentId) {
    throw new BadRequestException('This entry cannot reference a payment');
  }
  if (entryType === WalletEntryType.WELCOME_BONUS || entryType === WalletEntryType.PROMOTIONAL_CREDIT) {
    if (amountCents <= 0) throw new BadRequestException('Enter a credit amount');
  }
  if (entryType === WalletEntryType.ADJUSTMENT && amountCents === 0) {
    throw new BadRequestException('Enter an adjustment amount');
  }
  if (
    (entryType === WalletEntryType.PROMOTIONAL_CREDIT || entryType === WalletEntryType.ADJUSTMENT)
    && !reason
  ) {
    throw new BadRequestException('Enter a reason');
  }
}

function normalizeReason(reason: string | null): string | null {
  if (reason === null) return null;
  if (typeof reason !== 'string') throw new BadRequestException('Enter a reason');
  const trimmed = reason.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) throw new BadRequestException('Enter a reason');
  return trimmed;
}

async function lockedWallet(tx: Prisma.TransactionClient, riderProfileId: string, now: Date): Promise<WalletRow> {
  const existing = await tx.riderWallet.findUnique({ where: { riderProfileId } });
  const wallet = existing ?? await createEmptyWallet(tx, riderProfileId, now);
  await lockRiderWallet(tx, wallet.id);
  const locked = await tx.riderWallet.findUnique({ where: { id: wallet.id } });
  if (!locked) {
    throw new NotFoundException('Rider wallet not found');
  }
  return locked;
}

async function requireVerifiedPayment(tx: Prisma.TransactionClient, riderWalletId: string, input: NormalizedLedger): Promise<void> {
  const payment = await tx.walletPayment.findUnique({ where: { id: input.walletPaymentId ?? '' } });
  if (!payment || payment.riderWalletId !== riderWalletId || payment.currency !== Currency.USD) {
    throw new ConflictException('A verified payment is required');
  }
  if (payment.status !== WalletPaymentStatus.VERIFIED) {
    throw new ConflictException('Only a verified payment can credit a wallet');
  }
  if (signedCentsFromDecimal(payment.amount) !== input.amountCents) {
    throw new ConflictException('This payment does not match the credit');
  }
}

function replayOrReject(existing: EntryRow, wallet: WalletRow, hash: string): LedgerPosting {
  if (existing.payloadHash === hash && existing.riderWalletId === wallet.id) {
    return toPosting(existing, wallet.riderProfileId, true);
  }
  throw new ConflictException(IDEMPOTENCY_CONFLICT);
}

function assertNextBalance(cents: number): void {
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS) {
    throw new BadRequestException('Enter a valid amount');
  }
}

function effectiveLimitCents(
  wallet: WalletRow,
  defaultLimit: string | { toFixed(digits: number): string },
): number {
  if (wallet.borrowingLimitOverride === null) {
    return signedCentsFromDecimal(defaultLimit);
  }
  return signedCentsFromDecimal(wallet.borrowingLimitOverride);
}

async function postedCents(tx: Prisma.TransactionClient, riderWalletId: string): Promise<number> {
  const aggregate = await tx.riderWalletEntry.aggregate({
    where: { riderWalletId },
    _sum: { amount: true },
  });
  return signedCentsFromDecimal(aggregate._sum.amount);
}

async function reservedFeeCents(tx: Prisma.TransactionClient, riderWalletId: string): Promise<number> {
  const rows = await tx.walletFeeReservation.findMany({
    where: { riderWalletId, status: WalletFeeReservationStatus.OPEN },
    select: { amount: true },
  });
  return rows.reduce((sum, row) => sum + signedCentsFromDecimal(row.amount), 0);
}

function toPosting(entry: EntryRow, riderProfileId: string, replayed: boolean): LedgerPosting {
  return {
    entryId: entry.id,
    riderWalletId: entry.riderWalletId,
    riderProfileId,
    entryType: entry.entryType,
    amount: formatSignedCents(signedCentsFromDecimal(entry.amount)),
    balance: formatSignedCents(signedCentsFromDecimal(entry.balanceAfter)),
    currency: Currency.USD,
    configVersion: entry.configVersion,
    idempotencyKey: entry.idempotencyKey,
    replayed,
  };
}
