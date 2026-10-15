import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AssignmentStatus,
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
  WalletEntryType.PLATFORM_FEE_REFUND,
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

export type PlatformFeeReservationResult = {
  reserved: boolean;
  amount: string;
  configVersion: number;
};

// Reserves the active platform fee only. A zero fee writes nothing. The
// balance and the ledger stay unchanged. Callers lock the delivery, the rider
// profile, and the assignment before this, which then locks the wallet.
export async function openPlatformFeeReservation(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  deliveryId: string,
  now: Date,
  assignmentId?: string,
): Promise<PlatformFeeReservationResult> {
  const wallet = await ensureRiderWallet(tx, riderProfileId, now);
  const summary = await readWalletSummary(tx, riderProfileId);
  const config = await tx.walletConfig.findFirst({ where: { isActive: true } });
  if (!config) {
    throw new ConflictException(WALLET_CONFIG_MISSING);
  }
  const feeCents = signedCentsFromDecimal(config.platformFee);
  if (feeCents === 0) {
    return { reserved: false, amount: formatSignedCents(0), configVersion: config.configVersion };
  }
  if (signedCentsFromDecimal(summary.availableCapacity) < feeCents) {
    throw new ConflictException('Wallet capacity is not enough for the platform fee');
  }
  await tx.walletFeeReservation.create({
    data: {
      riderWalletId: wallet.id,
      deliveryId,
      assignmentId,
      amount: formatSignedCents(feeCents),
      currency: Currency.USD,
      configVersion: config.configVersion,
      status: WalletFeeReservationStatus.OPEN,
      createdAt: now,
      releasedAt: null,
      capturedAt: null,
    },
  });
  return {
    reserved: true,
    amount: formatSignedCents(feeCents),
    configVersion: config.configVersion,
  };
}

// Marks the OPEN reservation RELEASED. It does not post a ledger entry and
// does not change the wallet balance.
export async function releasePlatformFeeReservation(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  now: Date,
): Promise<void> {
  const open = await tx.walletFeeReservation.findFirst({
    where: { deliveryId, status: WalletFeeReservationStatus.OPEN },
  });
  if (!open) {
    return;
  }
  const wallet = await tx.riderWallet.findUnique({ where: { id: open.riderWalletId } });
  if (!wallet) {
    throw new NotFoundException('Rider wallet not found');
  }
  await lockWalletOwner(tx, wallet.riderProfileId);
  await lockRiderWallet(tx, wallet.id);
  const current = await tx.walletFeeReservation.findFirst({
    where: { id: open.id, status: WalletFeeReservationStatus.OPEN },
  });
  if (!current) {
    return;
  }
  await tx.walletFeeReservation.update({
    where: { id: current.id },
    data: { status: WalletFeeReservationStatus.RELEASED, releasedAt: now },
  });
}

export type PlatformFeeCapture = {
  captured: boolean;
  replayed: boolean;
  deliveryId: string;
  riderProfileId: string;
  amount: string;
  balance: string;
  currency: 'USD';
  configVersion: number | null;
  entryId: string | null;
};

// Captures the fee snapshotted at acceptance. The caller must already hold the
// delivery, then the rider profile, then the assignment. This function locks
// the rider profile again and then the wallet. It does not lock the delivery
// or the assignment, so it cannot deadlock with accept, release, or cancel.
// It does not move the delivery to DELIVERED.
// A zero-fee acceptance has no reservation row and is recognized from the
// assignment snapshot, not from the active fee. A missing positive-fee
// reservation stays a conflict even if the active fee is later zero.
export async function capturePlatformFeeReservation(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  riderProfileId: string,
  now: Date,
  assignmentId?: string,
): Promise<PlatformFeeCapture> {
  await lockWalletOwner(tx, riderProfileId);
  const owned = await tx.riderWallet.findUnique({ where: { riderProfileId } });
  if (!owned) {
    throw new NotFoundException('Rider wallet not found');
  }
  await lockRiderWallet(tx, owned.id);
  const wallet = await tx.riderWallet.findUnique({ where: { id: owned.id } });
  if (!wallet || wallet.riderProfileId !== riderProfileId) {
    throw new NotFoundException('Rider wallet not found');
  }
  const reservations = await tx.walletFeeReservation.findMany({ where: assignmentId ? { deliveryId, assignmentId } : { deliveryId } });
  const ownedReservations = reservations.filter((row) => row.riderWalletId === wallet.id);
  if (ownedReservations.length > 1) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const reservation = ownedReservations[0];
  if (!reservation) {
    if (reservations.some((row) => row.status === WalletFeeReservationStatus.OPEN || row.status === WalletFeeReservationStatus.CAPTURED)) {
      throw new ConflictException('This platform fee belongs to another rider');
    }
    return captureZeroFee(tx, wallet, deliveryId, riderProfileId, assignmentId);
  }
  if (reservation.deliveryId !== deliveryId) {
    throw new ConflictException('This platform fee belongs to another rider');
  }
  if (reservation.status === WalletFeeReservationStatus.RELEASED) {
    throw new ConflictException('This platform fee reservation was released');
  }
  if (reservation.currency !== Currency.USD || reservation.configVersion < 1) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const reservedCents = signedCentsFromDecimal(reservation.amount);
  if (reservedCents <= 0) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const snapshot = await requireAcceptedFeeSnapshot(tx, deliveryId, riderProfileId, assignmentId);
  if (snapshot.feeCents !== reservedCents || snapshot.configVersion !== reservation.configVersion) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const amountCents = -reservedCents;
  const idempotencyKey = assignmentId ? assignmentPlatformFeeIdempotencyKey(assignmentId) : platformFeeIdempotencyKey(deliveryId);
  const hash = walletPayloadHash({
    riderProfileId,
    entryType: WalletEntryType.PLATFORM_FEE,
    amountCents,
    idempotencyKey,
    reason: null,
    walletPaymentId: null,
    actorType: WalletActorType.SYSTEM,
    actorId: null,
    now,
  });
  const existing = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey } });
  if (reservation.status === WalletFeeReservationStatus.CAPTURED) {
    const posted = await postedCents(tx, wallet.id);
    return replayCapturedFee(existing, wallet, riderProfileId, deliveryId, amountCents, reservation.configVersion, hash, posted);
  }
  if (reservation.status !== WalletFeeReservationStatus.OPEN) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const posted = await postedCents(tx, wallet.id);
  const cached = signedCentsFromDecimal(wallet.balance);
  if (posted !== cached) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  if (existing) {
    if (existing.payloadHash !== hash || existing.riderWalletId !== wallet.id || signedCentsFromDecimal(existing.amount) !== amountCents || existing.configVersion !== reservation.configVersion) {
      throw new ConflictException('Platform fee reservation is corrupted');
    }
  } else {
    const next = cached + amountCents;
    assertNextBalance(next);
    await tx.riderWalletEntry.create({
      data: {
        riderWalletId: wallet.id,
        entryType: WalletEntryType.PLATFORM_FEE,
        amount: formatSignedCents(amountCents),
        balanceAfter: formatSignedCents(next),
        currency: Currency.USD,
        configVersion: reservation.configVersion,
        idempotencyKey,
        payloadHash: hash,
        walletPaymentId: null,
        reason: null,
        actorType: WalletActorType.SYSTEM,
        actorId: null,
        createdAt: now,
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
  }
  const captured = await tx.walletFeeReservation.update({
    where: { id: reservation.id },
    data: { status: WalletFeeReservationStatus.CAPTURED, capturedAt: now },
  });
  const entry = existing ?? await tx.riderWalletEntry.findUnique({ where: { idempotencyKey } });
  const stored = await tx.riderWallet.findUnique({ where: { id: wallet.id } });
  if (!entry || !stored) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const balance = signedCentsFromDecimal(stored.balance);
  if (await postedCents(tx, wallet.id) !== balance) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  return {
    captured: true,
    replayed: false,
    deliveryId,
    riderProfileId,
    amount: formatSignedCents(amountCents),
    balance: formatSignedCents(balance),
    currency: Currency.USD,
    configVersion: captured.configVersion,
    entryId: entry.id,
  };
}

async function captureZeroFee(
  tx: Prisma.TransactionClient,
  wallet: WalletRow,
  deliveryId: string,
  riderProfileId: string,
  assignmentId?: string,
): Promise<PlatformFeeCapture> {
  const snapshot = await requireAcceptedFeeSnapshot(tx, deliveryId, riderProfileId, assignmentId);
  if (snapshot.feeCents !== 0) {
    throw new ConflictException('Platform fee reservation was not found');
  }
  const existing = await tx.riderWalletEntry.findUnique({
    where: { idempotencyKey: assignmentId ? assignmentPlatformFeeIdempotencyKey(assignmentId) : platformFeeIdempotencyKey(deliveryId) },
  });
  if (existing) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const balance = signedCentsFromDecimal(wallet.balance);
  if (await postedCents(tx, wallet.id) !== balance) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  return {
    captured: false,
    replayed: false,
    deliveryId,
    riderProfileId,
    amount: formatSignedCents(0),
    balance: formatSignedCents(balance),
    currency: Currency.USD,
    configVersion: snapshot.configVersion,
    entryId: null,
  };
}

function replayCapturedFee(
  existing: { id: string; riderWalletId: string; amount: string | { toFixed(digits: number): string }; payloadHash: string; configVersion: number } | null,
  wallet: WalletRow,
  riderProfileId: string,
  deliveryId: string,
  amountCents: number,
  configVersion: number,
  hash: string,
  posted: number,
): PlatformFeeCapture {
  if (!existing || existing.payloadHash !== hash || existing.riderWalletId !== wallet.id || existing.configVersion !== configVersion || signedCentsFromDecimal(existing.amount) !== amountCents) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const balance = signedCentsFromDecimal(wallet.balance);
  if (posted !== balance) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  return {
    captured: true,
    replayed: true,
    deliveryId,
    riderProfileId,
    amount: formatSignedCents(amountCents),
    balance: formatSignedCents(balance),
    currency: Currency.USD,
    configVersion,
    entryId: existing.id,
  };
}

async function requireAcceptedFeeSnapshot(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  riderProfileId: string,
  assignmentId?: string,
): Promise<{ feeCents: number; configVersion: number }> {
  const assignment = await tx.deliveryAssignment.findFirst({
    where: {
      deliveryId,
      riderProfileId,
      status: AssignmentStatus.ACCEPTED,
      ...(assignmentId ? { id: assignmentId } : {}),
    },
  });
  if (!assignment) {
    throw new ConflictException('Platform fee reservation was not found');
  }
  const fee = assignment.acceptedPlatformFee;
  const configVersion = assignment.acceptedFeeConfigVersion;
  if (fee == null || configVersion == null || !Number.isSafeInteger(configVersion) || configVersion < 1) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  const feeCents = signedCentsFromDecimal(fee);
  if (feeCents < 0) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  return { feeCents, configVersion };
}

export async function refundAcceptanceCommission(
  tx: Prisma.TransactionClient,
  assignmentId: string,
  now: Date,
): Promise<void> {
  const assignment = await tx.deliveryAssignment.findUnique({
    where: { id: assignmentId },
  });

  if (!assignment || assignment.acceptedCommissionModel !== 'ON_ACCEPTANCE') {
    throw new ConflictException('Acceptance commission assignment is invalid');
  }

  const chargeKey = assignmentPlatformFeeIdempotencyKey(assignmentId);
  const charge = await tx.riderWalletEntry.findUnique({
    where: { idempotencyKey: chargeKey },
  });

  if (!charge || charge.entryType !== WalletEntryType.PLATFORM_FEE) {
    throw new ConflictException('Original acceptance commission charge not found');
  }

  await lockWalletOwner(tx, assignment.riderProfileId);

  const wallet = await tx.riderWallet.findUnique({
    where: { riderProfileId: assignment.riderProfileId },
  });

  if (!wallet || wallet.id !== charge.riderWalletId) {
    throw new ConflictException('Acceptance commission wallet mismatch');
  }

  await lockRiderWallet(tx, wallet.id);

  const feeCents = signedCentsFromDecimal(assignment.acceptedPlatformFee);
  const chargedCents = signedCentsFromDecimal(charge.amount);

  if (
    feeCents <= 0 ||
    chargedCents !== -feeCents ||
    assignment.acceptedFeeConfigVersion !== charge.configVersion ||
    charge.currency !== Currency.USD
  ) {
    throw new ConflictException('Acceptance commission charge is inconsistent');
  }

  const refundKey = assignmentPlatformFeeRefundKey(assignmentId);
  const existingRefund = await tx.riderWalletEntry.findUnique({
    where: { idempotencyKey: refundKey },
  });

  const lockedWallet = await tx.riderWallet.findUnique({
    where: { id: wallet.id },
  });

  if (!lockedWallet) {
    throw new ConflictException('Acceptance commission wallet not found');
  }

  const currentBalance = signedCentsFromDecimal(lockedWallet.balance);
  if (await postedCents(tx, wallet.id) !== currentBalance) {
    throw new ConflictException(LEDGER_MISMATCH);
  }

  if (existingRefund) {
    if (
      existingRefund.entryType !== WalletEntryType.PLATFORM_FEE_REFUND ||
      existingRefund.riderWalletId !== wallet.id ||
      signedCentsFromDecimal(existingRefund.amount) !== feeCents ||
      existingRefund.configVersion !== charge.configVersion
    ) {
      throw new ConflictException('Acceptance commission refund is inconsistent');
    }
    return;
  }

  const nextBalance = currentBalance + feeCents;
  assertNextBalance(nextBalance);

  const hash = walletPayloadHash({
    riderProfileId: assignment.riderProfileId,
    entryType: WalletEntryType.PLATFORM_FEE_REFUND,
    amountCents: feeCents,
    idempotencyKey: refundKey,
    reason: null,
    walletPaymentId: null,
    actorType: WalletActorType.SYSTEM,
    actorId: null,
    now,
  });

  await tx.riderWalletEntry.create({
    data: {
      riderWalletId: wallet.id,
      entryType: WalletEntryType.PLATFORM_FEE_REFUND,
      amount: formatSignedCents(feeCents),
      balanceAfter: formatSignedCents(nextBalance),
      currency: Currency.USD,
      configVersion: charge.configVersion,
      idempotencyKey: refundKey,
      payloadHash: hash,
      walletPaymentId: null,
      reason: null,
      actorType: WalletActorType.SYSTEM,
      actorId: null,
      createdAt: now,
    },
  });

  await tx.riderWallet.update({
    where: { id: wallet.id },
    data: { balance: formatSignedCents(nextBalance) },
  });

  if (await postedCents(tx, wallet.id) !== nextBalance) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
}
export function assignmentPlatformFeeRefundKey(assignmentId: string): string {
  const key = `platform-fee-refund:assignment:${assignmentId}`;
  if (!assignmentId || key.length > 200) {
    throw new ConflictException('Platform fee refund assignment is invalid');
  }
  return key;
}
export function assignmentPlatformFeeIdempotencyKey(assignmentId: string): string {
  const key = `platform-fee:assignment:${assignmentId}`;
  if (!assignmentId || key.length > 200) {
    throw new ConflictException('Platform fee assignment is invalid');
  }
  return key;
}
export function platformFeeIdempotencyKey(deliveryId: string): string {
  const key = `platform-fee:${deliveryId}`;
  if (!deliveryId || key.length > 200) {
    throw new ConflictException('Platform fee reservation is corrupted');
  }
  return key;
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
  // do not change balance.
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


