import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  Currency,
  Prisma,
  WalletPaymentMethod,
  WalletPaymentStatus,
} from '../generated/prisma/client.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { normalizeZimbabweMobile } from '../auth/phone-number.js';
import { readMoneyCents } from '../delivery/money.js';
import { EcocashConfigurationError, ECOCASH_PROVIDER, readEcocashSandboxConfig } from './ecocash-config.js';
import type { EcocashPaymentProvider, EcocashProviderResult, EcocashTransaction } from './ecocash-client.js';
import { postEcocashCredit, type EcocashCreditClient } from './ecocash-credit.js';
import { ensureRiderWallet } from './wallet-ledger.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const PENDING_TTL_MS = 15 * 60 * 1000;
const LOOKUP_DELAY_MS = 15 * 1000;
const RECONCILE_BATCH = 20;
// The published sandbox charge and lookup bodies do not include amount or currency:
//   POST /sandbox/payment/v1/transactions/amount/
//   GET  /sandbox/payment/v1/{endUserId}/transactions/amount/{clientCorrelator}
// EcoCash has not published a transaction-report API for those fields. A merchant
// reconciliation report is the remaining source. Phase 1 does not call an
// undocumented report, and it does not copy the requested amount into the
// provider result. Without both fields the payment stays unresolved.
const AMOUNT_CURRENCY_UNVERIFIED = 'AMOUNT_CURRENCY_UNVERIFIED';
const UNRESOLVED = [WalletPaymentStatus.PENDING, WalletPaymentStatus.UNRESOLVED];
const LOOKUP_STATUSES: WalletPaymentStatus[] = [WalletPaymentStatus.PENDING, WalletPaymentStatus.UNRESOLVED, WalletPaymentStatus.EXPIRED, WalletPaymentStatus.FAILED];
const RECOVERABLE_STATUSES: WalletPaymentStatus[] = [WalletPaymentStatus.PENDING, WalletPaymentStatus.UNRESOLVED, WalletPaymentStatus.EXPIRED, WalletPaymentStatus.FAILED];
const SECRET_FIELDS = ['merchantPin', 'merchantCode', 'merchantNumber', 'merchantName', 'password', 'username'];
const paymentLogger = new Logger('EcocashPayment');

export type EcocashTopUpView = {
  paymentId: string;
  status: WalletPaymentStatus;
  amountCents: number;
  amount: string;
  currency: 'USD';
  payerMsisdn: string;
  clientCorrelator: string;
  referenceCode: string;
  providerReference: string | null;
  replayed: boolean;
  credited: boolean;
};

type TopUpInput = {
  riderProfileId: string;
  amountCents: number;
  payerMsisdn: string;
  idempotencyKey: string;
  payloadHash: string;
};

type PaymentRow = {
  id: string;
  riderWalletId: string;
  method: WalletPaymentMethod;
  status: WalletPaymentStatus;
  amount: string | { toFixed(digits: number): string };
  currency: Currency;
  ecocashReference: string | null;
  provider: string | null;
  providerTransactionId: string | null;
  idempotencyKey: string;
  payloadHash: string;
  payerMsisdn: string | null;
  clientCorrelator: string | null;
  referenceCode: string | null;
  nextLookupAt: Date | null;
  expiresAt: Date | null;
  lastProviderResponseCode: string | null;
  chargeAttemptedAt: Date | null;
  verifiedAt: Date | null;
};

type Persisted = { payment: PaymentRow; replayed: boolean };

export function requireEcocashSandbox(): void {
  try {
    readEcocashSandboxConfig();
  } catch (error) {
    if (error instanceof EcocashConfigurationError || error instanceof ServiceUnavailableException) {
      throw new ServiceUnavailableException('EcoCash top-up is unavailable');
    }
    throw error;
  }
}

export function normalizeEcocashMsisdn(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Enter an EcoCash number');
  }
  try {
    return normalizeZimbabweMobile(value).slice(4);
  } catch {
    throw new BadRequestException('Enter an EcoCash number');
  }
}

export function newClientCorrelator(bytes: Uint8Array = randomBytes(16)): string {
  const digits = Array.from(bytes, (byte) => String(byte % 10)).join('');
  const first = String(1 + ((bytes[0] ?? 0) % 9));
  return `${first}${digits.slice(1, 16)}`;
}

export async function initiateEcocashTopUp(
  prisma: PrismaClientLike,
  provider: EcocashPaymentProvider,
  rider: RiderContext,
  body: unknown,
  idempotencyKey: string,
  now = new Date(),
): Promise<EcocashTopUpView> {
  requireEcocashSandbox();
  const input = readEcocashTopUp(body, idempotencyKey, rider.riderProfileId);
  const saved = await savePending(prisma, input, now);
  if (saved.payment.chargeAttemptedAt) {
    return toView(saved.payment, true);
  }
  const claimed = await prisma.walletPayment.updateMany({
    where: { id: saved.payment.id, chargeAttemptedAt: null, status: WalletPaymentStatus.PENDING },
    data: { chargeAttemptedAt: now },
  });
  if (claimed.count !== 1) {
    return toView(await currentPayment(prisma, saved.payment.id), true);
  }
  let result: EcocashProviderResult;
  try {
    result = await provider.charge({
      clientCorrelator: requiredText(saved.payment.clientCorrelator),
      referenceCode: requiredText(saved.payment.referenceCode),
      endUserId: requiredText(saved.payment.payerMsisdn),
      amountCents: input.amountCents,
    });
  } catch {
    await prisma.walletPayment.updateMany({
      where: { id: saved.payment.id, status: WalletPaymentStatus.PENDING },
      data: uncertainData(now),
    });
    return toView(await currentPayment(prisma, saved.payment.id), false);
  }
  await guardedPaymentWrite(prisma, saved.payment.id, {
    where: { id: saved.payment.id, status: WalletPaymentStatus.PENDING },
    data: chargeUpdate(saved.payment, result, now),
  });
  return toView(await currentPayment(prisma, saved.payment.id), saved.replayed);
}

export async function lookupEcocashTopUp(
  prisma: PrismaClientLike,
  provider: EcocashPaymentProvider,
  rider: RiderContext,
  paymentId: string,
  now = new Date(),
  options?: { credit?: boolean },
): Promise<EcocashTopUpView> {
  requireEcocashSandbox();
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
    throw new BadRequestException('Wallet top-up not found');
  }
  // credit is a test-only opt-in. The HTTP service passes the configuration switch instead.
  const credit = options?.credit === true;
  const payment = await ownedPayment(prisma, rider.riderProfileId, paymentId);
  if (!LOOKUP_STATUSES.includes(payment.status)) {
    if (credit && payment.status === WalletPaymentStatus.VERIFIED) {
      return recoverCredit(prisma, provider, payment, now);
    }
    return toView(payment, true);
  }
  const result = await provider.lookup({
    clientCorrelator: requiredText(payment.clientCorrelator),
    endUserId: requiredText(payment.payerMsisdn),
  });
  const view = await applyLookup(prisma, payment, result, now);
  if (!credit || view.status !== WalletPaymentStatus.VERIFIED || result.kind !== 'transaction') {
    return view;
  }
  const posted = await postEcocashCredit(prisma as unknown as EcocashCreditClient, payment.id, result.transaction, now);
  return { ...view, credited: posted.credited };
}

export async function reconcileEcocashTopUps(
  prisma: PrismaClientLike,
  provider: EcocashPaymentProvider,
  now = new Date(),
  limit = RECONCILE_BATCH,
): Promise<number> {
  requireEcocashSandbox();
  const due = await prisma.walletPayment.findMany({
    where: {
      provider: ECOCASH_PROVIDER,
      method: WalletPaymentMethod.GATEWAY,
      status: { in: [WalletPaymentStatus.PENDING, WalletPaymentStatus.UNRESOLVED, WalletPaymentStatus.EXPIRED] },
      chargeAttemptedAt: { not: null },
      nextLookupAt: { lte: now },
    },
    orderBy: { nextLookupAt: 'asc' },
    take: Math.min(Math.max(limit, 1), RECONCILE_BATCH),
  });
  let processed = 0;
  for (const payment of due) {
    const claimed = await prisma.walletPayment.updateMany({
      where: { id: payment.id, status: payment.status, nextLookupAt: payment.nextLookupAt },
      data: { nextLookupAt: new Date(now.getTime() + LOOKUP_DELAY_MS) },
    });
    if (claimed.count !== 1) continue;
    processed += 1;
    try {
      const result = await provider.lookup({
        clientCorrelator: requiredText(payment.clientCorrelator),
        endUserId: requiredText(payment.payerMsisdn),
      });
      await applyLookup(prisma, payment, result, now);
    } catch (error) {
      paymentLogger.warn(paymentFailureLog(payment.id, error));
    }
  }
  return processed;
}

export function readEcocashTopUp(body: unknown, idempotencyKey: string, riderProfileId: string): TopUpInput {
  const key = idempotencyKey.trim();
  if (!key || key.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Enter the top-up');
  }
  const record = body as Record<string, unknown>;
  for (const field of SECRET_FIELDS) {
    if (record[field] !== undefined) {
      throw new BadRequestException('Enter the top-up amount and EcoCash number');
    }
  }
  if (record.currency !== undefined && record.currency !== Currency.USD) {
    throw new BadRequestException('USD is the only supported currency');
  }
  const amountCents = readMoneyCents(record.amount, false, 'Enter a top-up amount');
  const payerMsisdn = normalizeEcocashMsisdn(record.endUserId);
  return {
    riderProfileId,
    amountCents,
    payerMsisdn,
    idempotencyKey: key,
    payloadHash: topUpHash({ riderProfileId, amountCents, payerMsisdn, idempotencyKey: key }),
  };
}

export function chargeUpdate(payment: PaymentRow, result: EcocashProviderResult, now: Date): Prisma.WalletPaymentUpdateInput {
  if (result.kind === 'uncertain') {
    return uncertainData(now);
  }
  if (result.kind === 'rejected') {
    return { status: WalletPaymentStatus.FAILED, lastProviderResponseCode: String(result.httpStatus) };
  }
  if (result.kind === 'declined') {
    return { status: WalletPaymentStatus.FAILED, lastProviderResponseCode: clip(result.responseCode) };
  }
  if (result.kind === 'not_found') {
    return uncertainData(now);
  }
  if (!chargeIdentityMatches(payment, result.transaction) || result.transaction.responseCode !== '00') {
    if (result.transaction.responseCode !== '00') {
      return { status: WalletPaymentStatus.FAILED, lastProviderResponseCode: clip(result.transaction.responseCode) };
    }
    return { status: WalletPaymentStatus.UNRESOLVED, nextLookupAt: new Date(now.getTime() + LOOKUP_DELAY_MS) };
  }
  const reference = providerReference(result.transaction.ecocashReference);
  if (result.transaction.transactionOperationStatus !== 'Charged' || !reference) {
    return { status: WalletPaymentStatus.UNRESOLVED, nextLookupAt: new Date(now.getTime() + LOOKUP_DELAY_MS) };
  }
  return {
    status: WalletPaymentStatus.PENDING,
    lastProviderResponseCode: '00',
    providerTransactionId: reference,
    ecocashReference: reference,
    nextLookupAt: now,
  };
}

export function lookupUpdate(payment: PaymentRow, result: EcocashProviderResult, now: Date): Prisma.WalletPaymentUpdateInput {
  if (isConfirmed(payment.status)) {
    return {};
  }
  const expired = payment.expiresAt !== null && payment.expiresAt <= now;
  if (result.kind === 'not_found') {
    if (payment.status === WalletPaymentStatus.FAILED) {
      return { lastProviderResponseCode: 'NOT_FOUND', nextLookupAt: backoff(now, payment) };
    }
    if (payment.status === WalletPaymentStatus.EXPIRED || expired) {
      return { status: WalletPaymentStatus.EXPIRED, lastProviderResponseCode: 'NOT_FOUND', nextLookupAt: backoff(now, payment) };
    }
    return uncertainData(now);
  }
  if (result.kind === 'uncertain' || result.kind === 'rejected') {
    if (payment.status === WalletPaymentStatus.EXPIRED) {
      return { nextLookupAt: backoff(now, payment) };
    }
    return expired
      ? { status: WalletPaymentStatus.UNRESOLVED, nextLookupAt: backoff(now, payment) }
      : uncertainData(now);
  }
  if (result.kind === 'declined') {
    return { status: WalletPaymentStatus.FAILED, lastProviderResponseCode: clip(result.responseCode) };
  }
  const transaction = result.transaction;
  if (!payerIdentityMatches(payment, transaction)) {
    return { status: WalletPaymentStatus.UNRESOLVED, lastProviderResponseCode: clip(transaction.responseCode), nextLookupAt: backoff(now, payment) };
  }
  if (transaction.responseCode !== '00') {
    return { status: WalletPaymentStatus.FAILED, lastProviderResponseCode: clip(transaction.responseCode) };
  }
  const reference = providerReference(transaction.ecocashReference);
  if (transaction.transactionOperationStatus !== 'Charged' || !reference) {
    return { status: WalletPaymentStatus.UNRESOLVED, lastProviderResponseCode: '00', nextLookupAt: backoff(now, payment) };
  }
  if (payment.providerTransactionId && payment.providerTransactionId !== reference) {
    return { status: WalletPaymentStatus.UNRESOLVED, lastProviderResponseCode: '00', nextLookupAt: backoff(now, payment) };
  }
  const storedReference = { providerTransactionId: reference, ecocashReference: reference };
  const evidence = authoritativeAmount(payment, transaction);
  if (evidence === 'missing') {
    return {
      status: WalletPaymentStatus.UNRESOLVED,
      lastProviderResponseCode: AMOUNT_CURRENCY_UNVERIFIED,
      nextLookupAt: backoff(now, payment),
      ...storedReference,
    };
  }
  if (evidence === 'mismatch') {
    return { status: WalletPaymentStatus.UNRESOLVED, lastProviderResponseCode: '00', nextLookupAt: backoff(now, payment), ...storedReference };
  }
  return {
    status: WalletPaymentStatus.VERIFIED,
    verifiedAt: now,
    lastProviderResponseCode: '00',
    nextLookupAt: now,
    ...storedReference,
  };
}

export type PrismaClientLike = {
  $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T>;
  walletPayment: Prisma.TransactionClient['walletPayment'];
  riderWallet: {
    findUnique(args: { where: { riderProfileId: string } }): Promise<{ id: string } | null>;
  };
};

async function savePending(prisma: PrismaClientLike, input: TopUpInput, now: Date): Promise<Persisted> {
  try {
    return await prisma.$transaction((tx) => persistPending(tx, input, now));
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (!isPaymentUniqueViolation(error)) {
      paymentLogger.warn(paymentFailureLog('new', error));
      throw new ConflictException('Wallet top-up could not be saved');
    }
  }
  return loadAfterUniqueConflict(prisma, input);
}

async function persistPending(tx: Prisma.TransactionClient, input: TopUpInput, now: Date): Promise<Persisted> {
  const wallet = await ensureRiderWallet(tx, input.riderProfileId, now);
  const existing = await tx.walletPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { payment: replay(existing, wallet.id, input.payloadHash), replayed: true };
  }
  const open = await tx.walletPayment.findFirst({
    where: { riderWalletId: wallet.id, status: { in: UNRESOLVED } },
    orderBy: { createdAt: 'asc' },
  });
  if (open) {
    if (sameIntent(open, input)) {
      return { payment: open, replayed: true };
    }
    throw new ConflictException('A wallet top-up is already in progress');
  }
  const correlator = newClientCorrelator();
  const payment = await tx.walletPayment.create({
    data: {
      riderWalletId: wallet.id,
      method: WalletPaymentMethod.GATEWAY,
      status: WalletPaymentStatus.PENDING,
      amount: formatSignedCents(input.amountCents),
      currency: Currency.USD,
      provider: ECOCASH_PROVIDER,
      providerTransactionId: null,
      ecocashReference: null,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      payerMsisdn: input.payerMsisdn,
      clientCorrelator: correlator,
      referenceCode: `RDR${correlator}`,
      nextLookupAt: now,
      expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
      createdAt: now,
      updatedAt: now,
    },
  });
  return { payment, replayed: false };
}

async function loadAfterUniqueConflict(prisma: PrismaClientLike, input: TopUpInput): Promise<Persisted> {
  const existing = await prisma.walletPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    const wallet = await prisma.riderWallet.findUnique({ where: { riderProfileId: input.riderProfileId } });
    if (!wallet) throw new ConflictException('This idempotency key was already used');
    return { payment: replay(existing, wallet.id, input.payloadHash), replayed: true };
  }
  const wallet = await prisma.riderWallet.findUnique({ where: { riderProfileId: input.riderProfileId } });
  if (wallet) {
    const unresolved = await prisma.walletPayment.findFirst({
      where: { riderWalletId: wallet.id, status: { in: UNRESOLVED } },
      orderBy: { createdAt: 'asc' },
    });
    if (unresolved && sameIntent(unresolved, input)) {
      return { payment: unresolved, replayed: true };
    }
  }
  throw new ConflictException('A wallet top-up is already in progress');
}

async function ownedPayment(prisma: PrismaClientLike, riderProfileId: string, paymentId: string): Promise<PaymentRow> {
  const payment = await prisma.walletPayment.findUnique({
    where: { id: paymentId },
    include: { riderWallet: { select: { riderProfileId: true } } },
  });
  if (!payment || payment.riderWallet.riderProfileId !== riderProfileId || !isEcocashGateway(payment)) {
    throw new NotFoundException('Wallet top-up not found');
  }
  return payment;
}

async function currentPayment(prisma: PrismaClientLike, paymentId: string): Promise<PaymentRow> {
  const payment = await prisma.walletPayment.findUnique({ where: { id: paymentId } });
  if (!payment || !isEcocashGateway(payment)) {
    throw new NotFoundException('Wallet top-up not found');
  }
  return payment;
}

async function recoverCredit(
  prisma: PrismaClientLike,
  provider: EcocashPaymentProvider,
  payment: PaymentRow,
  now: Date,
): Promise<EcocashTopUpView> {
  const result = await provider.lookup({
    clientCorrelator: requiredText(payment.clientCorrelator),
    endUserId: requiredText(payment.payerMsisdn),
  });
  if (result.kind !== 'transaction') {
    const stored = await prisma.walletPayment.findUnique({ where: { id: payment.id }, include: { entry: true } });
    return { ...toView(await currentPayment(prisma, payment.id), true), credited: stored?.entry != null };
  }
  const posted = await postEcocashCredit(prisma as unknown as EcocashCreditClient, payment.id, result.transaction, now);
  return { ...toView(await currentPayment(prisma, payment.id), true), credited: posted.credited };
}

async function applyLookup(
  prisma: PrismaClientLike,
  payment: PaymentRow,
  result: EcocashProviderResult,
  now: Date,
): Promise<EcocashTopUpView> {
  const data = lookupUpdate(payment, result, now);
  if (Object.keys(data).length === 0) {
    return toView(await currentPayment(prisma, payment.id), true);
  }
  const applied = await guardedPaymentWrite(prisma, payment.id, {
    where: lookupGuard(payment, data),
    data,
  });
  return toView(await currentPayment(prisma, payment.id), !applied);
}

async function guardedPaymentWrite(
  prisma: PrismaClientLike,
  paymentId: string,
  update: { where: Prisma.WalletPaymentWhereInput; data: Prisma.WalletPaymentUpdateInput },
): Promise<boolean> {
  try {
    const written = await prisma.walletPayment.updateMany(update);
    return written.count === 1;
  } catch (error) {
    if (error instanceof HttpException) throw error;
    paymentLogger.warn(paymentFailureLog(paymentId, error));
    return false;
  }
}

function lookupGuard(payment: PaymentRow, data: Prisma.WalletPaymentUpdateInput): Prisma.WalletPaymentWhereInput {
  if (data.status === WalletPaymentStatus.VERIFIED) {
    return { id: payment.id, status: { in: RECOVERABLE_STATUSES } };
  }
  return { id: payment.id, status: payment.status };
}

export function paymentFailureLog(paymentId: string, error: unknown): string {
  let code = 'payment_error';
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    code = error.code;
  } else if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code)) {
    code = error.code;
  }
  return JSON.stringify({ event: 'ecocash.payment_error', paymentId, code });
}

function isPaymentUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return true;
  if (typeof error !== 'object' || error === null || !('cause' in error)) return false;
  const cause = error.cause;
  if (typeof cause !== 'object' || cause === null) return false;
  const original = 'originalCode' in cause ? cause.originalCode : undefined;
  const code = 'code' in cause ? cause.code : undefined;
  return original === '23505' || code === '23505';
}

function isConfirmed(status: WalletPaymentStatus): boolean {
  return status === WalletPaymentStatus.VERIFIED
    || status === WalletPaymentStatus.REFUNDED
    || status === WalletPaymentStatus.REVERSED;
}

function payerIdentityMatches(payment: PaymentRow, transaction: EcocashTransaction): boolean {
  return transaction.clientCorrelator === payment.clientCorrelator
    && transaction.referenceCode === payment.referenceCode
    && transaction.endUserId === payment.payerMsisdn;
}

function chargeIdentityMatches(payment: PaymentRow, transaction: EcocashTransaction): boolean {
  return payerIdentityMatches(payment, transaction)
    && (transaction.amountCents === null || transaction.amountCents === signedCentsFromDecimal(payment.amount))
    && (transaction.currency === null || transaction.currency === Currency.USD);
}

function authoritativeAmount(payment: PaymentRow, transaction: EcocashTransaction): 'match' | 'missing' | 'mismatch' {
  if (transaction.amountCents === null || transaction.currency === null) return 'missing';
  if (transaction.amountCents !== signedCentsFromDecimal(payment.amount) || transaction.currency !== Currency.USD) return 'mismatch';
  return 'match';
}

function backoff(now: Date, payment: PaymentRow): Date {
  const elapsed = payment.chargeAttemptedAt ? now.getTime() - payment.chargeAttemptedAt.getTime() : 0;
  const delay = elapsed > 5 * 60 * 1000 ? 60_000 : LOOKUP_DELAY_MS;
  return new Date(now.getTime() + delay);
}

function replay(payment: PaymentRow, riderWalletId: string, payloadHash: string): PaymentRow {
  if (payment.riderWalletId !== riderWalletId || payment.payloadHash !== payloadHash || !isEcocashGateway(payment)) {
    throw new ConflictException('This idempotency key was already used');
  }
  return payment;
}

function sameIntent(payment: PaymentRow, input: TopUpInput): boolean {
  return isEcocashGateway(payment)
    && payment.payerMsisdn === input.payerMsisdn
    && signedCentsFromDecimal(payment.amount) === input.amountCents
    && payment.currency === Currency.USD;
}

function isEcocashGateway(payment: { method: WalletPaymentMethod; provider: string | null }): boolean {
  return payment.method === WalletPaymentMethod.GATEWAY && payment.provider === ECOCASH_PROVIDER;
}

function uncertainData(now: Date): Prisma.WalletPaymentUpdateInput {
  return { nextLookupAt: new Date(now.getTime() + LOOKUP_DELAY_MS) };
}

function topUpHash(input: { riderProfileId: string; amountCents: number; payerMsisdn: string; idempotencyKey: string }): string {
  return createHash('sha256').update(JSON.stringify({
    amountCents: input.amountCents,
    currency: Currency.USD,
    idempotencyKey: input.idempotencyKey,
    payerMsisdn: input.payerMsisdn,
    provider: ECOCASH_PROVIDER,
    riderProfileId: input.riderProfileId,
  })).digest('hex');
}

function toView(payment: PaymentRow, replayed: boolean): EcocashTopUpView {
  return {
    paymentId: payment.id,
    status: payment.status,
    amountCents: signedCentsFromDecimal(payment.amount),
    amount: formatSignedCents(signedCentsFromDecimal(payment.amount)),
    currency: Currency.USD,
    payerMsisdn: requiredText(payment.payerMsisdn),
    clientCorrelator: requiredText(payment.clientCorrelator),
    referenceCode: requiredText(payment.referenceCode),
    providerReference: payment.providerTransactionId,
    replayed,
    credited: false,
  };
}

function requiredText(value: string | null): string {
  if (!value) {
    throw new ConflictException('Wallet top-up is incomplete');
  }
  return value;
}

function clip(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.slice(0, 32);
}

function providerReference(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  return trimmed;
}
