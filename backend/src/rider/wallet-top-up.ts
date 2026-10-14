import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Currency,
  Prisma,
  WalletActorType,
  WalletEntryType,
  WalletPaymentMethod,
  WalletPaymentStatus,
} from '../generated/prisma/client.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { readMoneyCents } from '../delivery/money.js';
import { creditWallet, ensureRiderWallet, IDEMPOTENCY_CONFLICT } from './wallet-ledger.js';
import { formatSignedCents, signedCentsFromDecimal } from './wallet-money.js';

const ECOCASH_REFERENCE_USED = 'This EcoCash reference has already been used';

export type ManualTopUpResult = {
  paymentId: string;
  riderProfileId: string;
  method: 'CASH' | 'ECOCASH';
  amount: string;
  currency: 'USD';
  internalReceiptId: string | null;
  externalReceiptNumber: string | null;
  ecocashReference: string | null;
  balance: string;
  entryId: string;
  replayed: boolean;
};

type TopUpInput = {
  method: typeof WalletPaymentMethod.CASH | typeof WalletPaymentMethod.ECOCASH;
  amountCents: number;
  externalReceiptNumber: string | null;
  ecocashReference: string | null;
  idempotencyKey: string;
};

type TopUpCommand = TopUpInput & {
  admin: AdminContext;
  riderProfileId: string;
  now: Date;
};

// Manual cash and EcoCash confirmation. A later gateway inserts its own
// verified wallet_payments row, with provider fields set, then calls the
// same creditWallet path. Provider fields stay empty for these payments.
export async function recordManualTopUp(tx: Prisma.TransactionClient, command: TopUpCommand): Promise<ManualTopUpResult> {
  const hash = topUpPayloadHash(command);
  const wallet = await ensureRiderWallet(tx, command.riderProfileId, command.now);
  const existing = await tx.walletPayment.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) {
    return replayTopUp(tx, existing, wallet.id, command.riderProfileId, hash);
  }
  if (command.ecocashReference) {
    const used = await tx.walletPayment.findUnique({ where: { ecocashReference: command.ecocashReference } });
    if (used) {
      throw new ConflictException(ECOCASH_REFERENCE_USED);
    }
  }
  if (command.externalReceiptNumber) {
    const used = await tx.walletPayment.findUnique({ where: { externalReceiptNumber: command.externalReceiptNumber } });
    if (used) {
      throw new ConflictException('This cash receipt has already been used');
    }
  }
  const payment = await tx.walletPayment.create({
    data: {
      riderWalletId: wallet.id,
      method: command.method,
      status: WalletPaymentStatus.VERIFIED,
      amount: formatSignedCents(command.amountCents),
      currency: Currency.USD,
      internalReceiptId: command.method === WalletPaymentMethod.CASH ? newInternalReceiptId() : null,
      externalReceiptNumber: command.externalReceiptNumber,
      ecocashReference: command.ecocashReference,
      provider: null,
      providerTransactionId: null,
      idempotencyKey: command.idempotencyKey,
      payloadHash: hash,
      topUpRequestId: null,
      confirmedById: command.admin.userId,
      createdAt: command.now,
      verifiedAt: command.now,
    },
  });
  const posting = await creditWallet(tx, {
    riderProfileId: command.riderProfileId,
    entryType: WalletEntryType.TOP_UP,
    amountCents: command.amountCents,
    idempotencyKey: command.idempotencyKey,
    reason: null,
    walletPaymentId: payment.id,
    actorType: WalletActorType.ADMIN,
    actorId: command.admin.userId,
    now: command.now,
  });
  return toTopUpResult(payment, command.riderProfileId, posting.entryId, posting.balance, false);
}

export function readManualTopUp(body: unknown, idempotencyKey: string): TopUpInput {
  const key = idempotencyKey.trim();
  if (!key || key.length > 200) {
    throw new BadRequestException('Enter an idempotency key');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Enter the top-up');
  }
  const record = body as Record<string, unknown>;
  if (record.currency !== undefined && record.currency !== Currency.USD) {
    throw new BadRequestException('USD is the only supported currency');
  }
  if (record.paymentReceived !== true) {
    throw new BadRequestException('Confirm that payment was received');
  }
  const method = readMethod(record.method);
  const externalReceiptNumber = readOptionalReference(record.externalReceiptNumber, 'Enter the cash receipt');
  const ecocashReference = readOptionalReference(record.ecocashReference, 'Enter the EcoCash reference');
  if (method === WalletPaymentMethod.CASH && ecocashReference) {
    throw new BadRequestException('A cash top-up cannot include an EcoCash reference');
  }
  if (method === WalletPaymentMethod.ECOCASH) {
    if (!ecocashReference) {
      throw new BadRequestException('Enter the EcoCash reference');
    }
    if (externalReceiptNumber) {
      throw new BadRequestException('An EcoCash top-up cannot include a cash receipt');
    }
  }
  return {
    method,
    amountCents: readMoneyCents(record.amount, false, 'Enter a top-up amount'),
    externalReceiptNumber,
    ecocashReference,
    idempotencyKey: key,
  };
}

function readMethod(value: unknown): TopUpInput['method'] {
  if (value === WalletPaymentMethod.CASH || value === WalletPaymentMethod.ECOCASH) {
    return value;
  }
  throw new BadRequestException('Choose cash or EcoCash');
}

function readOptionalReference(value: unknown, message: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(message);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 64) {
    throw new BadRequestException(message);
  }
  return trimmed;
}

function topUpPayloadHash(input: TopUpInput & { riderProfileId: string }): string {
  const canonical = JSON.stringify({
    amountCents: input.amountCents,
    ecocashReference: input.ecocashReference,
    externalReceiptNumber: input.externalReceiptNumber,
    idempotencyKey: input.idempotencyKey,
    method: input.method,
    paymentReceived: true,
    riderProfileId: input.riderProfileId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function newInternalReceiptId(): string {
  return `CR${randomBytes(16).toString('hex').toUpperCase()}`;
}

async function replayTopUp(
  tx: Prisma.TransactionClient,
  payment: {
    id: string;
    riderWalletId: string;
    method: WalletPaymentMethod;
    amount: string | { toFixed(digits: number): string };
    internalReceiptId: string | null;
    externalReceiptNumber: string | null;
    ecocashReference: string | null;
    idempotencyKey: string;
    payloadHash: string;
  },
  riderWalletId: string,
  riderProfileId: string,
  hash: string,
): Promise<ManualTopUpResult> {
  if (payment.payloadHash !== hash || payment.riderWalletId !== riderWalletId) {
    throw new ConflictException(IDEMPOTENCY_CONFLICT);
  }
  const entry = await tx.riderWalletEntry.findUnique({ where: { idempotencyKey: payment.idempotencyKey } });
  if (!entry || entry.walletPaymentId !== payment.id) {
    throw new ConflictException('This payment has not been credited');
  }
  return toTopUpResult(
    payment,
    riderProfileId,
    entry.id,
    formatSignedCents(signedCentsFromDecimal(entry.balanceAfter)),
    true,
  );
}

function toTopUpResult(
  payment: {
    id: string;
    method: WalletPaymentMethod;
    amount: string | { toFixed(digits: number): string };
    internalReceiptId: string | null;
    externalReceiptNumber: string | null;
    ecocashReference: string | null;
  },
  riderProfileId: string,
  entryId: string,
  balance: string,
  replayed: boolean,
): ManualTopUpResult {
  return {
    paymentId: payment.id,
    riderProfileId,
    method: payment.method === WalletPaymentMethod.ECOCASH ? 'ECOCASH' : 'CASH',
    amount: formatSignedCents(signedCentsFromDecimal(payment.amount)),
    currency: Currency.USD,
    internalReceiptId: payment.internalReceiptId,
    externalReceiptNumber: payment.externalReceiptNumber,
    ecocashReference: payment.ecocashReference,
    balance,
    entryId,
    replayed,
  };
}
