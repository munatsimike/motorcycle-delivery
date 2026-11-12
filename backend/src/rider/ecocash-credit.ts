import { Logger } from '@nestjs/common';
import {
  Currency,
  Prisma,
  WalletActorType,
  WalletEntryType,
  WalletPaymentMethod,
  WalletPaymentStatus,
} from '../generated/prisma/client.js';
import type { EcocashTransaction } from './ecocash-client.js';
import { ECOCASH_PROVIDER, ecocashAutoCreditEnabled } from './ecocash-config.js';
import { creditWallet, isUniqueViolation } from './wallet-ledger.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const CREDIT_BATCH = 20;
const LOOKUP_DELAY_MS = 15 * 1000;
const creditLogger = new Logger('EcocashCredit');

export type EcocashCreditResult = {
  credited: boolean;
  replayed: boolean;
  entryId: string | null;
  balance: string | null;
};

type CreditPayment = {
  id: string;
  method: WalletPaymentMethod;
  status: WalletPaymentStatus;
  amount: string | { toFixed(digits: number): string };
  currency: Currency;
  ecocashReference: string | null;
  provider: string | null;
  providerTransactionId: string | null;
  payerMsisdn: string | null;
  clientCorrelator: string | null;
  referenceCode: string | null;
  lastProviderResponseCode: string | null;
  verifiedAt: Date | null;
  entry?: { id: string } | null;
  riderWallet?: {
    riderProfileId: string;
    balance: string | { toFixed(digits: number): string };
  };
};

export type EcocashCreditClient = {
  $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  walletPayment: Prisma.TransactionClient['walletPayment'];
};

const EMPTY: EcocashCreditResult = { credited: false, replayed: false, entryId: null, balance: null };

// The provider transaction is the only amount and currency evidence. A missing
// field is not filled from the amount the rider requested.
export function ecocashCreditAllowed(payment: CreditPayment, transaction: EcocashTransaction): boolean {
  if (payment.method !== WalletPaymentMethod.GATEWAY || payment.provider !== ECOCASH_PROVIDER) return false;
  if (payment.status !== WalletPaymentStatus.VERIFIED || payment.verifiedAt === null) return false;
  if (payment.currency !== Currency.USD || payment.lastProviderResponseCode !== '00') return false;
  if (!payment.clientCorrelator || !payment.referenceCode || !payment.payerMsisdn) return false;
  if (!payment.providerTransactionId || payment.providerTransactionId !== payment.ecocashReference) return false;
  if (transaction.transactionOperationStatus !== 'Charged' || transaction.responseCode !== '00') return false;
  if (transaction.clientCorrelator !== payment.clientCorrelator) return false;
  if (transaction.referenceCode !== payment.referenceCode) return false;
  if (transaction.endUserId !== payment.payerMsisdn) return false;
  if (!transaction.ecocashReference || transaction.ecocashReference !== payment.providerTransactionId) return false;
  if (transaction.amountCents === null || transaction.currency === null) return false;
  if (transaction.currency !== Currency.USD) return false;
  if (!Number.isSafeInteger(transaction.amountCents) || transaction.amountCents <= 0) return false;
  return transaction.amountCents === signedCentsFromDecimal(payment.amount);
}

export async function postEcocashCredit(
  prisma: EcocashCreditClient,
  paymentId: string,
  transaction: EcocashTransaction,
  now = new Date(),
): Promise<EcocashCreditResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "wallet_payments" WHERE "id" = CAST(${paymentId} AS uuid) FOR UPDATE`;
      const payment = await tx.walletPayment.findUnique({
        where: { id: paymentId },
        include: { entry: true, riderWallet: true },
      });
      if (!payment) return EMPTY;
      if (payment.status === WalletPaymentStatus.REFUNDED || payment.status === WalletPaymentStatus.REVERSED) {
        return EMPTY;
      }
      if (payment.entry?.entryType === WalletEntryType.TOP_UP) {
        return {
          credited: true,
          replayed: true,
          entryId: payment.entry.id,
          balance: formatSignedCents(signedCentsFromDecimal(payment.riderWallet.balance)),
        };
      }
      const amountCents = transaction.amountCents;
      if (amountCents === null || !ecocashCreditAllowed(payment, transaction)) return EMPTY;
      const posting = await creditWallet(tx, {
        riderProfileId: payment.riderWallet.riderProfileId,
        entryType: WalletEntryType.TOP_UP,
        amountCents,
        idempotencyKey: `ecocash-credit:${payment.id}`,
        reason: null,
        walletPaymentId: payment.id,
        actorType: WalletActorType.SYSTEM,
        actorId: null,
        now,
      });
      return { credited: true, replayed: posting.replayed, entryId: posting.entryId, balance: posting.balance };
    });
  } catch (error) {
    if (isUniqueViolation(error) || alreadyCredited(error)) {
      return readExistingCredit(prisma, paymentId);
    }
    creditLogger.warn(paymentFailureLog(paymentId, error));
    const existing = await readExistingCredit(prisma, paymentId);
    return existing.credited ? existing : EMPTY;
  }
}

export async function reconcileUncreditedEcocashCredits(
  prisma: EcocashCreditClient,
  provider: { lookup(request: { clientCorrelator: string; endUserId: string }): Promise<{ kind: string; transaction?: EcocashTransaction }> },
  now = new Date(),
  limit = CREDIT_BATCH,
  enabled = ecocashAutoCreditEnabled(),
): Promise<number> {
  if (enabled !== true) return 0;
  const due = await prisma.walletPayment.findMany({
    where: {
      provider: ECOCASH_PROVIDER,
      method: WalletPaymentMethod.GATEWAY,
      status: WalletPaymentStatus.VERIFIED,
      entry: { is: null },
      OR: [{ nextLookupAt: null }, { nextLookupAt: { lte: now } }],
    },
    orderBy: { verifiedAt: 'asc' },
    take: Math.min(Math.max(limit, 1), CREDIT_BATCH),
  });
  let credited = 0;
  for (const payment of due) {
    const claimed = await prisma.walletPayment.updateMany({
      where: { id: payment.id, status: WalletPaymentStatus.VERIFIED, nextLookupAt: payment.nextLookupAt },
      data: { nextLookupAt: new Date(now.getTime() + LOOKUP_DELAY_MS) },
    });
    if (claimed.count !== 1) continue;
    try {
      const result = await provider.lookup({
        clientCorrelator: payment.clientCorrelator ?? '',
        endUserId: payment.payerMsisdn ?? '',
      });
      if (result.kind !== 'transaction' || !result.transaction) continue;
      const posted = await postEcocashCredit(prisma, payment.id, result.transaction, now);
      if (posted.credited && !posted.replayed) credited += 1;
    } catch (error) {
      creditLogger.warn(paymentFailureLog(payment.id, error));
    }
  }
  return credited;
}

async function readExistingCredit(prisma: EcocashCreditClient, paymentId: string): Promise<EcocashCreditResult> {
  const payment = await prisma.walletPayment.findUnique({
    where: { id: paymentId },
    include: { entry: true, riderWallet: true },
  });
  if (!payment?.entry) return EMPTY;
  return {
    credited: true,
    replayed: true,
    entryId: payment.entry.id,
    balance: formatSignedCents(signedCentsFromDecimal(payment.riderWallet.balance)),
  };
}

function alreadyCredited(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'message' in error && error.message === 'This payment has already been credited';
}

function paymentFailureLog(paymentId: string, error: unknown): string {
  let code = 'payment_error';
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    code = error.code;
  } else if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code)) {
    code = error.code;
  }
  return JSON.stringify({ event: 'ecocash.payment_error', paymentId, code });
}
