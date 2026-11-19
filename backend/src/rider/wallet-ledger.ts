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
  type PrismaClient,
} from '../generated/prisma/client.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { chooseCommissionPayment, type CommissionPayment } from '../delivery/commission-wallet.js';
import { readActiveExchangeRate, riderZwgOffersEnabled } from '../delivery/exchange-rate.js';
import {
  consumeReservedPromotional,
  issuePromotionalCredit,
  marketplaceRateIsPositive,
  newDeliveriesRestricted,
  readPromotionalPosition,
  promotionalConsumeKey,
  reservationPortions,
  restoreConsumedPromotional,
  splitCommission,
} from './promotional-credit.js';
import { lockRiderWallet, lockWalletOwner } from './wallet-lock.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

export const WALLET_CONFIG_MISSING = 'Wallet configuration is not configured';
export const IDEMPOTENCY_CONFLICT = 'This idempotency key was already used';
export const LEDGER_MISMATCH = 'Wallet balance does not match its ledger';

export function usdWalletWhere(riderProfileId: string) {
  return { riderProfileId_currency: { riderProfileId, currency: Currency.USD } };
}

export function walletWhere(riderProfileId: string, currency: Currency) {
  return { riderProfileId_currency: { riderProfileId, currency } };
}

export function usdBorrowingRoomCents(balanceCents: number, limitCents: number, openCashHoldCents: number): number {
  return balanceCents + limitCents - openCashHoldCents;
}

// USD may use its borrowing limit. ZiG is prepaid: only cash and promotional
// credit remain after open reservations. The two amounts are never added together.
export function usableFeeCapacityCents(input: {
  balanceCents: number;
  borrowingLimitCents: number;
  openCashHoldCents: number;
  availablePromotionalCents: number;
  prepaidOnly: boolean;
}): number {
  const cashRoom = input.prepaidOnly
    ? input.balanceCents - input.openCashHoldCents
    : input.balanceCents + input.borrowingLimitCents - input.openCashHoldCents;
  return Math.max(0, cashRoom) + Math.max(0, input.availablePromotionalCents);
}

// USD is preferred. ZiG is selected only when USD has no usable fee capacity,
// ZiG has prepaid capacity, and ZiG offers are enabled. A null result means
// neither wallet can fund a platform fee.
export function selectWorkingWallet(input: {
  usdUsableCents: number;
  zigUsableCents: number;
  zigOffersEnabled: boolean;
}): 'USD' | 'ZWG' | null {
  if (input.usdUsableCents > 0) {
    return 'USD';
  }
  if (input.zigOffersEnabled && input.zigUsableCents > 0) {
    return 'ZWG';
  }
  return null;
}

export const USD_DEBT_MUST_BE_CLEARED = 'USD_DEBT_MUST_BE_CLEARED';

// Cash balance only. Promotional credit and borrowing capacity do not clear USD debt.
export async function assertNoUsdCashDebt(tx: Prisma.TransactionClient, riderProfileId: string): Promise<void> {
  await lockWalletOwner(tx, riderProfileId);
  const existing = await tx.riderWallet.findUnique({ where: usdWalletWhere(riderProfileId) });
  if (!existing) {
    return;
  }
  await lockRiderWallet(tx, existing.id);
  const locked = await tx.riderWallet.findUnique({ where: { id: existing.id } });
  if (!locked || signedCentsFromDecimal(locked.balance) >= 0) {
    return;
  }
  throw new ConflictException({
    statusCode: 409,
    code: USD_DEBT_MUST_BE_CLEARED,
    message: 'Clear the USD wallet balance before adding ZiG',
    error: 'Conflict',
  });
}

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
  currency?: Currency;
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
  currency: Currency;
  configVersion: number;
  idempotencyKey: string;
  replayed: boolean;
};

export type WalletSummary = {
  riderProfileId: string;
  balance: string;
  promotionalBalance: string;
  borrowingLimit: string;
  borrowingLimitSource: 'DEFAULT' | 'OVERRIDE';
  reservedFees: string;
  availableCapacity: string;
  availablePromotionalCredit: string;
  newDeliveriesRestricted: boolean;
  currency: 'USD';
};

export type ZigWalletSummary = {
  riderProfileId: string;
  balance: string;
  promotionalBalance: string;
  reservedFees: string;
  availableCapacity: string;
  availablePromotionalCredit: string;
  currency: 'ZWG';
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
  promotionalBalance?: string | { toFixed(digits: number): string } | null;
  borrowingLimitOverride: string | { toFixed(digits: number): string } | null;
  welcomeBonusAwardedAt: Date | null;
  currency?: Currency | string | null;
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
  if (command.entryType === WalletEntryType.WELCOME_BONUS || command.entryType === WalletEntryType.PROMOTIONAL_CREDIT) {
    return postPromotionalCredit(tx, command);
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
  const wallet = await lockedWalletFor(tx, input.riderProfileId, command.currency ?? Currency.USD, input.now);
  const raced = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (raced) {
    return replayOrReject(raced, wallet, hash);
  }

  if (input.walletPaymentId) {
    const linked = await tx.riderWalletEntry.findUnique({ where: { walletPaymentId: input.walletPaymentId } });
    if (linked) {
      throw new ConflictException('This payment has already been credited');
    }
    await requireVerifiedPayment(tx, wallet, input);
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
        currency: walletCurrency(wallet),
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
  return toPosting(created, input.riderProfileId, false, walletCurrency(wallet));
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
  if (signedCentsFromDecimal(summary.availableCapacity) <= 0) {
    throw new ConflictException('Wallet capacity is not enough for the platform fee');
  }
  const split = splitCommission(
    feeCents,
    signedCentsFromDecimal(summary.availablePromotionalCredit),
    signedCentsFromDecimal(summary.availableCapacity),
    'Wallet capacity is not enough for the platform fee',
  );
  await tx.walletFeeReservation.create({
    data: {
      riderWalletId: wallet.id,
      deliveryId,
      assignmentId,
      amount: formatSignedCents(feeCents),
      promotionalAmount: formatSignedCents(split.promo),
      walletAmount: formatSignedCents(split.wallet),
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

export type V2CommissionReservationResult = {
  reserved: boolean;
  amount: string;
  rateVersion: number;
};

// Reserves a commission amount already calculated from the accepted bid.
// A zero amount writes nothing. The balance and the ledger stay unchanged.
// config_version stores the V2 commission rate version. This does not read
// WalletConfig.platformFee. Callers lock the delivery, the rider profile,
// and the bid before this, which then locks the wallet.
export async function openV2CommissionReservation(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  deliveryId: string,
  assignmentId: string,
  amountCents: number,
  rateVersion: number,
  now: Date,
  currency: Currency = Currency.USD,
): Promise<V2CommissionReservationResult> {
  const quoted = await quoteCommissionPayment(tx, riderProfileId, amountCents, currency);
  if (amountCents === 0 || !quoted.wallet) {
    return { reserved: false, amount: formatSignedCents(0), rateVersion };
  }
  const split = splitCommission(
    quoted.payment.payingCents,
    quoted.promo,
    quoted.cash,
    'Wallet capacity is not enough for this bid',
  );
  await tx.walletFeeReservation.create({
    data: {
      riderWalletId: quoted.wallet.id,
      deliveryId,
      assignmentId,
      amount: formatSignedCents(quoted.payment.payingCents),
      promotionalAmount: formatSignedCents(split.promo),
      walletAmount: formatSignedCents(split.wallet),
      currency: walletCurrency(quoted.wallet),
      configVersion: rateVersion,
      sourceCurrency: quoted.payment.sourceCurrency,
      sourceAmount: formatSignedCents(quoted.payment.sourceCents),
      exchangeRateVersion: quoted.payment.exchangeRateVersion,
      exchangeRateZigPerUsd: quoted.payment.exchangeRateZigPerUsd,
      status: WalletFeeReservationStatus.OPEN,
      createdAt: now,
      releasedAt: null,
      capturedAt: null,
    },
  });
  return { reserved: true, amount: formatSignedCents(quoted.payment.payingCents), rateVersion };
}

export async function assertV2CommissionCapacity(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  amountCents: number,
  currency: Currency = Currency.USD,
): Promise<WalletRow | null> {
  const quoted = await quoteCommissionPayment(tx, riderProfileId, amountCents, currency);
  return quoted.wallet;
}

async function quoteCommissionPayment(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  amountCents: number,
  currency: Currency,
): Promise<{ wallet: WalletRow | null; payment: CommissionPayment; promo: number; cash: number }> {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !supportedFeeCurrency(currency)) {
    throw new ConflictException('Wallet capacity is not enough for this bid');
  }
  await lockWalletOwner(tx, riderProfileId);
  const usd = await tx.riderWallet.findUnique({ where: usdWalletWhere(riderProfileId) });
  if (!usd) {
    throw new ConflictException('Wallet capacity is not enough for this bid');
  }
  await lockRiderWallet(tx, usd.id);
  const lockedUsd = await tx.riderWallet.findUnique({ where: { id: usd.id } });
  if (!lockedUsd || lockedUsd.riderProfileId !== riderProfileId) {
    throw new ConflictException('Wallet capacity is not enough for this bid');
  }
  if (amountCents === 0) {
    return {
      wallet: null,
      promo: 0,
      cash: 0,
      payment: {
        sourceCurrency: currency,
        sourceCents: 0,
        payingCurrency: currency,
        payingCents: 0,
        exchangeRateVersion: null,
        exchangeRateZigPerUsd: null,
      },
    };
  }
  const usdCover = await feeCoverCents(tx, lockedUsd);
  const zigRow = await tx.riderWallet.findUnique({ where: walletWhere(riderProfileId, Currency.ZWG) });
  let lockedZig: WalletRow | null = null;
  let zigCover = { cash: 0, promo: 0 };
  if (zigRow && zigRow.riderProfileId === riderProfileId) {
    if (zigRow.id !== lockedUsd.id) {
      await lockRiderWallet(tx, zigRow.id);
    }
    lockedZig = await tx.riderWallet.findUnique({ where: { id: zigRow.id } });
    if (lockedZig && lockedZig.riderProfileId === riderProfileId) {
      zigCover = await feeCoverCents(tx, lockedZig);
    } else {
      lockedZig = null;
    }
  }
  const rate = await readActiveExchangeRate(tx);
  const zigEnabled = riderZwgOffersEnabled();
  const choice = chooseCommissionPayment({
    sourceCurrency: currency,
    sourceCents: amountCents,
    usdCoverCents: usdCover.cash + usdCover.promo,
    zigCoverCents: zigEnabled ? zigCover.cash + zigCover.promo : 0,
    rate,
    zigOffersEnabled: zigEnabled,
  });
  if (!choice.ok) {
    if (choice.reason === 'rate') {
      throw new BadRequestException('An exchange rate has not been published');
    }
    throw new ConflictException('Wallet capacity is not enough for this bid');
  }
  const paying = choice.payment.payingCurrency === Currency.USD ? lockedUsd : lockedZig;
  if (!paying || walletCurrency(paying) !== choice.payment.payingCurrency) {
    throw new ConflictException('Wallet capacity is not enough for this bid');
  }
  const cover = choice.payment.payingCurrency === Currency.USD ? usdCover : zigCover;
  return { wallet: paying, payment: choice.payment, promo: cover.promo, cash: cover.cash };
}

export async function riderIdsWithOpenUsdBorrowing(
  db: Pick<PrismaClient, 'walletConfig' | 'riderWallet'>,
  riderProfileIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(riderProfileIds)];
  if (ids.length === 0) {
    return new Set();
  }
  const config = await db.walletConfig.findFirst({ where: { isActive: true } });
  const wallets = await db.riderWallet.findMany({
    where: { riderProfileId: { in: ids }, currency: Currency.USD },
    select: {
      riderProfileId: true,
      balance: true,
      borrowingLimitOverride: true,
      feeReservations: {
        where: { status: WalletFeeReservationStatus.OPEN },
        select: { amount: true, promotionalAmount: true, walletAmount: true },
      },
    },
  });
  const open = new Set<string>();
  for (const wallet of wallets) {
    if (wallet.borrowingLimitOverride === null && !config) {
      continue;
    }
    const limit = wallet.borrowingLimitOverride === null
      ? signedCentsFromDecimal(config?.defaultBorrowingLimit ?? '0.00')
      : signedCentsFromDecimal(wallet.borrowingLimitOverride);
    const holds = wallet.feeReservations.reduce((sum, row) => sum + reservationPortions(row).wallet, 0);
    if (usdBorrowingRoomCents(signedCentsFromDecimal(wallet.balance), limit, holds) > 0) {
      open.add(wallet.riderProfileId);
    }
  }
  return open;
}

export async function currencyFeeCapacityOpen(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  currency: Currency,
): Promise<boolean> {
  const wallet = await tx.riderWallet.findUnique({ where: walletWhere(riderProfileId, currency) });
  if (!wallet) {
    return false;
  }
  try {
    const cover = await feeCoverCents(tx, wallet);
    return cover.cash + cover.promo > 0;
  } catch {
    return false;
  }
}

export async function riderIdsWithFeeCapacity(
  db: Pick<PrismaClient, 'walletConfig' | 'riderWallet'>,
  riderProfileIds: readonly string[],
  currency: Currency,
): Promise<Set<string>> {
  const ids = [...new Set(riderProfileIds)];
  if (ids.length === 0 || !supportedFeeCurrency(currency)) {
    return new Set();
  }
  const config = currency === Currency.USD
    ? await db.walletConfig.findFirst({ where: { isActive: true } })
    : null;
  const wallets = await db.riderWallet.findMany({
    where: { riderProfileId: { in: ids }, currency },
    select: {
      riderProfileId: true,
      balance: true,
      promotionalBalance: true,
      borrowingLimitOverride: true,
      feeReservations: {
        where: { status: WalletFeeReservationStatus.OPEN },
        select: { amount: true, promotionalAmount: true, walletAmount: true },
      },
    },
  });
  const open = new Set<string>();
  for (const wallet of wallets) {
    if (currency === Currency.USD && wallet.borrowingLimitOverride === null && !config) {
      continue;
    }
    try {
      const holds = wallet.feeReservations.reduce((sum, row) => {
        const portions = reservationPortions(row);
        return { wallet: sum.wallet + portions.wallet, promo: sum.promo + portions.promo };
      }, { wallet: 0, promo: 0 });
      const promotional = Math.max(0, signedCentsFromDecimal(wallet.promotionalBalance ?? '0.00') - holds.promo);
      const limit = currency === Currency.USD
        ? (wallet.borrowingLimitOverride === null
          ? signedCentsFromDecimal(config?.defaultBorrowingLimit ?? '0.00')
          : signedCentsFromDecimal(wallet.borrowingLimitOverride))
        : 0;
      const usable = usableFeeCapacityCents({
        balanceCents: signedCentsFromDecimal(wallet.balance),
        borrowingLimitCents: limit,
        openCashHoldCents: holds.wallet,
        availablePromotionalCents: promotional,
        prepaidOnly: currency === Currency.ZWG,
      });
      if (usable > 0) {
        open.add(wallet.riderProfileId);
      }
    } catch {
      // A corrupted reservation cannot make this rider eligible.
    }
  }
  return open;
}

export async function usdBorrowingRoomOpen(tx: Prisma.TransactionClient, riderProfileId: string): Promise<boolean> {
  const wallet = await tx.riderWallet.findUnique({ where: usdWalletWhere(riderProfileId) });
  if (!wallet) {
    return false;
  }
  try {
    return await usdRoomCents(tx, wallet) > 0;
  } catch {
    return false;
  }
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
  currency: Currency;
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
  const owned = await tx.riderWallet.findUnique({ where: usdWalletWhere(riderProfileId) });
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
  if (reservation.currency !== walletCurrency(wallet) || reservation.configVersion < 1) {
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
  const portions = reservationPortions(reservation);
  const amountCents = -portions.wallet;
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
  const existing = portions.wallet === 0 ? null : await tx.riderWalletEntry.findUnique({ where: { idempotencyKey } });
  if (reservation.status === WalletFeeReservationStatus.CAPTURED) {
    if (portions.wallet === 0) {
      const stored = await tx.riderWallet.findUnique({ where: { id: wallet.id } });
      if (!stored) {
        throw new ConflictException('Platform fee reservation is corrupted');
      }
      return {
        captured: true,
        replayed: true,
        deliveryId,
        riderProfileId,
        amount: formatSignedCents(0),
        balance: formatSignedCents(signedCentsFromDecimal(stored.balance)),
        currency: walletCurrency(wallet),
        configVersion: reservation.configVersion,
        entryId: null,
      };
    }
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
  if (portions.wallet > 0 && existing) {
    if (existing.payloadHash !== hash || existing.riderWalletId !== wallet.id || signedCentsFromDecimal(existing.amount) !== amountCents || existing.configVersion !== reservation.configVersion) {
      throw new ConflictException('Platform fee reservation is corrupted');
    }
  } else if (portions.wallet > 0) {
    const next = cached + amountCents;
    const currency = walletCurrency(wallet);
    assertPostedBalance(currency, next);
    await tx.riderWalletEntry.create({
      data: {
        riderWalletId: wallet.id,
        entryType: WalletEntryType.PLATFORM_FEE,
        amount: formatSignedCents(amountCents),
        balanceAfter: formatSignedCents(next),
        currency,
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
  if (portions.promo > 0) {
    await consumeReservedPromotional(tx, wallet, reservation, portions.promo, idempotencyKey, now);
  }
  const captured = await tx.walletFeeReservation.update({
    where: { id: reservation.id },
    data: { status: WalletFeeReservationStatus.CAPTURED, capturedAt: now },
  });
  const entry = portions.wallet === 0 ? null : existing ?? await tx.riderWalletEntry.findUnique({ where: { idempotencyKey } });
  const stored = await tx.riderWallet.findUnique({ where: { id: wallet.id } });
  if ((portions.wallet > 0 && !entry) || !stored) {
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
    currency: walletCurrency(wallet),
    configVersion: captured.configVersion,
    entryId: entry?.id ?? null,
  };
}

// Captures the V2 commission snapshotted at bid acceptance. The amount is the
// assignment's accepted_commission_amount. This does not read the active
// percentage or the suggested price. The caller already holds the delivery,
// the rider profile, and the assignment. This then locks the wallet. A zero
// snapshot writes no reservation and no ledger entry. A positive snapshot
// requires the matching OPEN reservation and posts one negative PLATFORM_FEE.
export async function captureV2CommissionReservation(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  riderProfileId: string,
  assignmentId: string,
  now: Date,
): Promise<PlatformFeeCapture> {
  const assignment = await tx.deliveryAssignment.findFirst({
    where: { id: assignmentId, deliveryId, riderProfileId },
  });
  if (
    !assignment
    || assignment.acceptedBidAmount == null
    || assignment.acceptedCommissionAmount == null
    || assignment.acceptedCommissionBasisPoints == null
    || assignment.acceptedV2CommissionRateVersion == null
  ) {
    throw new ConflictException('This commission snapshot is missing');
  }
  const commissionCents = signedCentsFromDecimal(assignment.acceptedCommissionAmount);
  if (commissionCents < 0 || assignment.acceptedV2CommissionRateVersion < 1) {
    throw new ConflictException('This commission snapshot is missing');
  }
  const idempotencyKey = assignmentPlatformFeeIdempotencyKey(assignmentId);
  if (commissionCents === 0) {
    const reservation = await tx.walletFeeReservation.findFirst({ where: { assignmentId } });
    const existing = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey } });
    if (reservation || existing) {
      throw new ConflictException('This commission reservation does not match the accepted bid');
    }
    const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { currency: true } });
    return {
      captured: false,
      replayed: false,
      deliveryId,
      riderProfileId,
      amount: formatSignedCents(0),
      balance: formatSignedCents(0),
      currency: delivery?.currency === Currency.ZWG ? Currency.ZWG : Currency.USD,
      configVersion: assignment.acceptedV2CommissionRateVersion,
      entryId: null,
    };
  }
  await lockWalletOwner(tx, riderProfileId);
  const reservation = await tx.walletFeeReservation.findFirst({ where: { assignmentId } });
  if (!reservation) {
    throw new ConflictException('This commission reservation was not found');
  }
  const owned = await tx.riderWallet.findUnique({ where: { id: reservation.riderWalletId } });
  if (!owned || owned.riderProfileId !== riderProfileId) {
    throw new ConflictException('This commission reservation was not found');
  }
  await lockRiderWallet(tx, owned.id);
  const wallet = await tx.riderWallet.findUnique({ where: { id: owned.id } });
  if (!wallet || wallet.riderProfileId !== riderProfileId) {
    throw new ConflictException('This commission reservation was not found');
  }
  if (
    reservation.deliveryId !== deliveryId
    || reservation.riderWalletId !== wallet.id
    || reservation.currency !== walletCurrency(wallet)
  ) {
    throw new ConflictException('This commission reservation does not match the accepted bid');
  }
  const reservedCents = signedCentsFromDecimal(reservation.amount);
  const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { currency: true } });
  if (reservation.sourceAmount == null) {
    if (reservedCents !== commissionCents) {
      throw new ConflictException('This commission reservation does not match the accepted bid');
    }
  } else {
    const sourceCents = signedCentsFromDecimal(reservation.sourceAmount);
    if (sourceCents !== commissionCents || reservation.sourceCurrency !== delivery?.currency) {
      throw new ConflictException('This commission reservation does not match the accepted bid');
    }
  }
  if (reservation.configVersion !== assignment.acceptedV2CommissionRateVersion) {
    throw new ConflictException('This commission reservation does not match the accepted bid');
  }
  if (reservation.status === WalletFeeReservationStatus.RELEASED) {
    throw new ConflictException('This commission reservation was released');
  }
  const portions = reservationPortions(reservation);
  const amountCents = -portions.wallet;
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
  const existing = portions.wallet === 0 ? null : await tx.riderWalletEntry.findUnique({ where: { idempotencyKey } });
  if (reservation.status === WalletFeeReservationStatus.CAPTURED) {
    if (portions.wallet === 0) {
      const stored = await tx.riderWallet.findUnique({ where: { id: wallet.id } });
      if (!stored) {
        throw new ConflictException('This commission reservation does not match the accepted bid');
      }
      return {
        captured: true,
        replayed: true,
        deliveryId,
        riderProfileId,
        amount: formatSignedCents(0),
        balance: formatSignedCents(signedCentsFromDecimal(stored.balance)),
        currency: walletCurrency(wallet),
        configVersion: reservation.configVersion,
        entryId: null,
      };
    }
    const posted = await postedCents(tx, wallet.id);
    return replayCapturedFee(existing, wallet, riderProfileId, deliveryId, amountCents, reservation.configVersion, hash, posted);
  }
  if (reservation.status !== WalletFeeReservationStatus.OPEN) {
    throw new ConflictException('This commission reservation does not match the accepted bid');
  }
  const posted = await postedCents(tx, wallet.id);
  const cached = signedCentsFromDecimal(wallet.balance);
  if (posted !== cached) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  if (portions.wallet > 0 && existing) {
    if (
      existing.payloadHash !== hash
      || existing.riderWalletId !== wallet.id
      || signedCentsFromDecimal(existing.amount) !== amountCents
      || existing.configVersion !== reservation.configVersion
    ) {
      throw new ConflictException('This idempotency key was already used');
    }
  } else if (portions.wallet > 0) {
    const next = cached + amountCents;
    const currency = walletCurrency(wallet);
    assertPostedBalance(currency, next);
    await tx.riderWalletEntry.create({
      data: {
        riderWalletId: wallet.id,
        entryType: WalletEntryType.PLATFORM_FEE,
        amount: formatSignedCents(amountCents),
        balanceAfter: formatSignedCents(next),
        currency,
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
  if (portions.promo > 0) {
    await consumeReservedPromotional(tx, wallet, reservation, portions.promo, idempotencyKey, now);
  }
  await tx.walletFeeReservation.update({
    where: { id: reservation.id },
    data: { status: WalletFeeReservationStatus.CAPTURED, capturedAt: now },
  });
  const entry = portions.wallet === 0 ? null : existing ?? await tx.riderWalletEntry.findUnique({ where: { idempotencyKey } });
  const stored = await tx.riderWallet.findUnique({ where: { id: wallet.id } });
  if ((portions.wallet > 0 && !entry) || !stored || signedCentsFromDecimal(stored.balance) !== await postedCents(tx, wallet.id)) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  return {
    captured: true,
    replayed: false,
    deliveryId,
    riderProfileId,
    amount: formatSignedCents(amountCents),
    balance: formatSignedCents(signedCentsFromDecimal(stored.balance)),
    currency: walletCurrency(stored),
    configVersion: reservation.configVersion,
    entryId: entry?.id ?? null,
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
    currency: walletCurrency(wallet),
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
    currency: walletCurrency(wallet),
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

  if (assignment.acceptedPlatformFee == null || assignment.acceptedFeeConfigVersion == null || assignment.acceptedFeeConfigVersion < 1) {
    throw new ConflictException('Acceptance commission charge is inconsistent');
  }
  const feeCents = signedCentsFromDecimal(assignment.acceptedPlatformFee);
  if (feeCents <= 0) {
    throw new ConflictException('Acceptance commission charge is inconsistent');
  }

  await lockWalletOwner(tx, assignment.riderProfileId);
  const reservation = await tx.walletFeeReservation.findFirst({ where: { assignmentId } });
  const owned = reservation
    ? await tx.riderWallet.findUnique({ where: { id: reservation.riderWalletId } })
    : await tx.riderWallet.findUnique({ where: usdWalletWhere(assignment.riderProfileId) });
  if (!owned || owned.riderProfileId !== assignment.riderProfileId) {
    throw new ConflictException('Acceptance commission wallet not found');
  }
  await lockRiderWallet(tx, owned.id);
  const wallet = await tx.riderWallet.findUnique({ where: { id: owned.id } });
  if (!wallet) {
    throw new ConflictException('Acceptance commission wallet not found');
  }

  let portions = { total: feeCents, promo: 0, wallet: feeCents };
  let configVersion = assignment.acceptedFeeConfigVersion;
  if (reservation) {
    if (
      reservation.status !== WalletFeeReservationStatus.CAPTURED
      || reservation.riderWalletId !== wallet.id
      || reservation.currency !== walletCurrency(wallet)
      || reservation.configVersion !== assignment.acceptedFeeConfigVersion
    ) {
      throw new ConflictException('Acceptance commission charge is inconsistent');
    }
    portions = reservationPortions(reservation);
    if (reservation.sourceAmount != null) {
      const source = signedCentsFromDecimal(reservation.sourceAmount);
      const accepted = assignment.acceptedCommissionAmount == null
        ? null
        : signedCentsFromDecimal(assignment.acceptedCommissionAmount);
      if (accepted == null || source !== accepted || feeCents !== signedCentsFromDecimal(reservation.amount)) {
        throw new ConflictException('Acceptance commission charge is inconsistent');
      }
    }
    if (portions.total !== feeCents) {
      throw new ConflictException('Acceptance commission charge is inconsistent');
    }
    configVersion = reservation.configVersion;
  }

  const chargeKey = assignmentPlatformFeeIdempotencyKey(assignmentId);
  const charge = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey: chargeKey } });
  if (portions.wallet > 0) {
    if (
      !charge
      || charge.entryType !== WalletEntryType.PLATFORM_FEE
      || charge.riderWalletId !== wallet.id
      || signedCentsFromDecimal(charge.amount) !== -portions.wallet
      || charge.configVersion !== configVersion
      || (charge.currency ?? Currency.USD) !== walletCurrency(wallet)
    ) {
      throw new ConflictException('Original acceptance commission charge not found');
    }
  } else if (charge) {
    throw new ConflictException('Acceptance commission charge is inconsistent');
  }
  if (portions.promo > 0) {
    const consumed = await tx.riderPromotionalEntry.findUnique({
      where: { idempotencyKey: promotionalConsumeKey(chargeKey) },
    });
    if (
      !reservation
      || !consumed
      || consumed.riderWalletId !== wallet.id
      || consumed.reservationId !== reservation.id
      || signedCentsFromDecimal(consumed.amount) !== -portions.promo
    ) {
      throw new ConflictException('Acceptance commission charge is inconsistent');
    }
  }

  const currentBalance = signedCentsFromDecimal(wallet.balance);
  if (await postedCents(tx, wallet.id) !== currentBalance) {
    throw new ConflictException(LEDGER_MISMATCH);
  }

  const refundKey = assignmentPlatformFeeRefundKey(assignmentId);
  const existingRefund = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey: refundKey } });
  if (portions.wallet === 0 && existingRefund) {
    throw new ConflictException('Acceptance commission refund is inconsistent');
  }
  if (existingRefund) {
    if (
      existingRefund.entryType !== WalletEntryType.PLATFORM_FEE_REFUND
      || existingRefund.riderWalletId !== wallet.id
      || signedCentsFromDecimal(existingRefund.amount) !== portions.wallet
      || existingRefund.configVersion !== configVersion
    ) {
      throw new ConflictException('Acceptance commission refund is inconsistent');
    }
    if (portions.promo > 0) {
      await restoreConsumedPromotional(tx, wallet, portions.promo, refundKey, configVersion, now);
    }
    return;
  }

  if (portions.wallet > 0) {
    const nextBalance = currentBalance + portions.wallet;
    const currency = walletCurrency(wallet);
    assertPostedBalance(currency, nextBalance);
    const hash = walletPayloadHash({
      riderProfileId: assignment.riderProfileId,
      entryType: WalletEntryType.PLATFORM_FEE_REFUND,
      amountCents: portions.wallet,
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
        amount: formatSignedCents(portions.wallet),
        balanceAfter: formatSignedCents(nextBalance),
        currency,
        configVersion,
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
  if (portions.promo > 0) {
    await restoreConsumedPromotional(tx, wallet, portions.promo, refundKey, configVersion, now);
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
  const welcomeKey = `welcome-bonus:${riderProfileId}`;
  const historical = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey: welcomeKey } });
  if (wallet.welcomeBonusAwardedAt || historical) {
    if (!wallet.welcomeBonusAwardedAt) {
      await tx.riderWallet.update({
        where: { id: wallet.id },
        data: { welcomeBonusAwardedAt: now },
      });
    }
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
  const usd = await tx.riderWallet.create({
    data: {
      riderProfileId,
      currency: Currency.USD,
      balance: '0.00',
      promotionalBalance: '0.00',
      borrowingLimitOverride: null,
      welcomeBonusAwardedAt: null,
      updatedAt: now,
    },
  });
  const zig = await tx.riderWallet.findUnique({
    where: { riderProfileId_currency: { riderProfileId, currency: Currency.ZWG } },
  });
  if (!zig) {
    await tx.riderWallet.create({
      data: {
        riderProfileId,
        currency: Currency.ZWG,
        balance: '0.00',
        promotionalBalance: '0.00',
        borrowingLimitOverride: null,
        welcomeBonusAwardedAt: now,
        updatedAt: now,
      },
    });
  }
  return usd;
}

export async function readWalletSummary(tx: Prisma.TransactionClient, riderProfileId: string): Promise<WalletSummary> {
  const wallet = await tx.riderWallet.findUnique({ where: usdWalletWhere(riderProfileId) });
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
  // do not change either balance. Only the cash portion reduces main capacity.
  const holds = await openHoldCents(tx, wallet.id);
  const available = Math.max(0, cached + limit - holds.wallet);
  const promotional = await readPromotionalPosition(tx, wallet);
  const platformFee = config?.platformFee == null ? 0 : signedCentsFromDecimal(config.platformFee);
  const positiveRate = await marketplaceRateIsPositive(tx);
  return {
    riderProfileId,
    balance: formatSignedCents(cached),
    promotionalBalance: formatSignedCents(promotional.balance),
    borrowingLimit: formatSignedCents(limit),
    borrowingLimitSource: source,
    reservedFees: formatSignedCents(holds.total),
    availableCapacity: formatSignedCents(available),
    availablePromotionalCredit: formatSignedCents(promotional.available),
    newDeliveriesRestricted: newDeliveriesRestricted({
      coverCents: v2MarketplaceEnabled() ? cached + limit - holds.wallet : available + promotional.available,
      platformFeeCents: platformFee,
      marketplace: v2MarketplaceEnabled(),
      positivePublishedRate: positiveRate,
    }),
    currency: Currency.USD,
  };
}

export async function readZigWalletSummary(tx: Prisma.TransactionClient, riderProfileId: string): Promise<ZigWalletSummary> {
  const wallet = await tx.riderWallet.findUnique({ where: walletWhere(riderProfileId, Currency.ZWG) });
  if (!wallet) {
    return {
      riderProfileId,
      balance: '0.00',
      promotionalBalance: '0.00',
      reservedFees: '0.00',
      availableCapacity: '0.00',
      availablePromotionalCredit: '0.00',
      currency: Currency.ZWG,
    };
  }
  const posted = await postedCents(tx, wallet.id);
  const cached = signedCentsFromDecimal(wallet.balance);
  if (posted !== cached) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  const holds = await openHoldCents(tx, wallet.id);
  const promotional = await readPromotionalPosition(tx, wallet);
  return {
    riderProfileId,
    balance: formatSignedCents(cached),
    promotionalBalance: formatSignedCents(promotional.balance),
    reservedFees: formatSignedCents(holds.total),
    availableCapacity: formatSignedCents(Math.max(0, cached - holds.wallet)),
    availablePromotionalCredit: formatSignedCents(promotional.available),
    currency: Currency.ZWG,
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
  const existing = await tx.riderWallet.findUnique({ where: usdWalletWhere(riderProfileId) });
  const wallet = existing ?? await createEmptyWallet(tx, riderProfileId, now);
  await lockRiderWallet(tx, wallet.id);
  const locked = await tx.riderWallet.findUnique({ where: { id: wallet.id } });
  if (!locked) {
    throw new NotFoundException('Rider wallet not found');
  }
  return locked;
}

async function lockedWalletFor(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  currency: Currency,
  now: Date,
): Promise<WalletRow> {
  if (currency !== Currency.ZWG) {
    return lockedWallet(tx, riderProfileId, now);
  }
  const usd = await tx.riderWallet.findUnique({ where: usdWalletWhere(riderProfileId) });
  if (usd) {
    await lockRiderWallet(tx, usd.id);
  }
  const zig = await tx.riderWallet.findUnique({ where: walletWhere(riderProfileId, Currency.ZWG) });
  if (!zig) {
    throw new NotFoundException('Rider wallet not found');
  }
  await lockRiderWallet(tx, zig.id);
  const locked = await tx.riderWallet.findUnique({ where: { id: zig.id } });
  if (!locked || locked.riderProfileId !== riderProfileId) {
    throw new NotFoundException('Rider wallet not found');
  }
  return locked;
}

async function requireVerifiedPayment(tx: Prisma.TransactionClient, wallet: WalletRow, input: NormalizedLedger): Promise<void> {
  const payment = await tx.walletPayment.findUnique({ where: { id: input.walletPaymentId ?? '' } });
  if (!payment || payment.riderWalletId !== wallet.id || payment.currency !== walletCurrency(wallet)) {
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
    return toPosting(existing, wallet.riderProfileId, true, walletCurrency(wallet));
  }
  throw new ConflictException(IDEMPOTENCY_CONFLICT);
}

function assertNextBalance(cents: number): void {
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS) {
    throw new BadRequestException('Enter a valid amount');
  }
}

function walletCurrency(wallet: { currency?: string | null }): Currency {
  return wallet.currency === Currency.ZWG ? Currency.ZWG : Currency.USD;
}

function supportedFeeCurrency(currency: Currency): boolean {
  return currency === Currency.USD || currency === Currency.ZWG;
}

function assertPostedBalance(currency: Currency, next: number): void {
  assertNextBalance(next);
  if (currency === Currency.ZWG && next < 0) {
    throw new ConflictException('ZiG wallet balance cannot become negative');
  }
}

async function usdRoomCents(tx: Prisma.TransactionClient, wallet: WalletRow): Promise<number> {
  const posted = await postedCents(tx, wallet.id);
  const cached = signedCentsFromDecimal(wallet.balance);
  if (posted !== cached) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  const config = await tx.walletConfig.findFirst({ where: { isActive: true } });
  if (wallet.borrowingLimitOverride === null && !config) {
    throw new ConflictException(WALLET_CONFIG_MISSING);
  }
  const limit = effectiveLimitCents(wallet, config?.defaultBorrowingLimit ?? '0.00');
  const holds = await openHoldCents(tx, wallet.id);
  return usdBorrowingRoomCents(cached, limit, holds.wallet);
}

async function feeCoverCents(tx: Prisma.TransactionClient, wallet: WalletRow): Promise<{ cash: number; promo: number }> {
  const posted = await postedCents(tx, wallet.id);
  const cached = signedCentsFromDecimal(wallet.balance);
  if (posted !== cached) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  const holds = await openHoldCents(tx, wallet.id);
  const promotional = await readPromotionalPosition(tx, wallet);
  if (walletCurrency(wallet) === Currency.ZWG) {
    return { cash: Math.max(0, cached - holds.wallet), promo: promotional.available };
  }
  const config = await tx.walletConfig.findFirst({ where: { isActive: true } });
  if (wallet.borrowingLimitOverride === null && !config) {
    throw new ConflictException(WALLET_CONFIG_MISSING);
  }
  const limit = effectiveLimitCents(wallet, config?.defaultBorrowingLimit ?? '0.00');
  return { cash: Math.max(0, cached + limit - holds.wallet), promo: promotional.available };
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

async function openHoldCents(
  tx: Prisma.TransactionClient,
  riderWalletId: string,
): Promise<{ total: number; wallet: number }> {
  const rows = await tx.walletFeeReservation.findMany({
    where: { riderWalletId, status: WalletFeeReservationStatus.OPEN },
  });
  return rows.reduce((sum, row) => {
    const portions = reservationPortions(row);
    return { total: sum.total + portions.total, wallet: sum.wallet + portions.wallet };
  }, { total: 0, wallet: 0 });
}

export async function riderCanCoverPlatformFee(tx: Prisma.TransactionClient, riderProfileId: string): Promise<boolean> {
  const config = await tx.walletConfig.findFirst({ where: { isActive: true } });
  if (!config) {
    return false;
  }
  const feeCents = signedCentsFromDecimal(config.platformFee);
  if (feeCents === 0) {
    return true;
  }
  const wallet = await tx.riderWallet.findUnique({ where: usdWalletWhere(riderProfileId) });
  if (!wallet) {
    return false;
  }
  const summary = await readWalletSummary(tx, riderProfileId);
  const cover = signedCentsFromDecimal(summary.availableCapacity) + signedCentsFromDecimal(summary.availablePromotionalCredit);
  return cover >= feeCents;
}

async function postPromotionalCredit(tx: Prisma.TransactionClient, command: CreditCommand): Promise<LedgerPosting> {
  const input = normalizeLedger(command);
  await lockWalletOwner(tx, input.riderProfileId);
  const wallet = await lockedWallet(tx, input.riderProfileId, input.now);
  const posted = await postedCents(tx, wallet.id);
  if (posted !== signedCentsFromDecimal(wallet.balance)) {
    throw new ConflictException(LEDGER_MISMATCH);
  }
  const config = await tx.walletConfig.findFirst({ where: { isActive: true } });
  if (!config) {
    throw new ConflictException(WALLET_CONFIG_MISSING);
  }
  const entryType = input.entryType;
  if (entryType !== WalletEntryType.WELCOME_BONUS && entryType !== WalletEntryType.PROMOTIONAL_CREDIT) {
    throw new BadRequestException('Enter a credit type');
  }
  return issuePromotionalCredit(tx, wallet, {
    riderProfileId: input.riderProfileId,
    entryType,
    amountCents: input.amountCents,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    actorType: input.actorType,
    actorId: input.actorId,
    now: input.now,
    configVersion: config.configVersion,
  });
}

function toPosting(entry: EntryRow, riderProfileId: string, replayed: boolean, currency: Currency = Currency.USD): LedgerPosting {
  return {
    entryId: entry.id,
    riderWalletId: entry.riderWalletId,
    riderProfileId,
    entryType: entry.entryType,
    amount: formatSignedCents(signedCentsFromDecimal(entry.amount)),
    balance: formatSignedCents(signedCentsFromDecimal(entry.balanceAfter)),
    currency,
    configVersion: entry.configVersion,
    idempotencyKey: entry.idempotencyKey,
    replayed,
  };
}


