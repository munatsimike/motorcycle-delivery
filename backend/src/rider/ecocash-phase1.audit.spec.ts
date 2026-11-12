import { describe, expect, it } from 'vitest';
import { Currency, WalletPaymentMethod, WalletPaymentStatus } from '../generated/prisma/client.js';
import { HttpEcocashPaymentProvider, type EcocashLogEvent } from './ecocash-client.js';
import { chargeUpdate, lookupUpdate, paymentFailureLog } from './ecocash-top-up.js';
import type { EcocashSandboxConfig } from './ecocash-config.js';
import type { EcocashProviderResult, EcocashTransaction } from './ecocash-client.js';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const LATER = new Date('2026-11-06T12:20:00.000Z');

describe('EcoCash Phase 1 state machine', () => {
  it('keeps a timeout and an HTTP 500 pending', () => {
    expect(chargeUpdate(row(), { kind: 'uncertain', reason: 'timeout' }, NOW)).not.toMatchObject({ status: WalletPaymentStatus.FAILED });
    expect(chargeUpdate(row(), { kind: 'uncertain', reason: 'unavailable' }, NOW)).not.toMatchObject({ status: WalletPaymentStatus.FAILED });
  });

  it('marks a documented business decline failed and does not verify it', () => {
    expect(chargeUpdate(row(), { kind: 'declined', httpStatus: 422, responseCode: null }, NOW)).toMatchObject({
      status: WalletPaymentStatus.FAILED,
    });
    expect(lookupUpdate(row(), { kind: 'declined', httpStatus: 422, responseCode: '05' }, NOW).status).toBe(WalletPaymentStatus.FAILED);
  });

  it('does not verify a lookup that omits amount and currency', () => {
    const update = lookupUpdate(row(), transaction(chargedBody({ amountCents: null, currency: null })), NOW);
    expect(update).toMatchObject({ status: WalletPaymentStatus.UNRESOLVED, lastProviderResponseCode: 'AMOUNT_CURRENCY_UNVERIFIED' });
    expect(update).not.toMatchObject({ verifiedAt: expect.anything() });
  });

  it('does not verify a lookup that omits only the amount or only the currency', () => {
    expect(lookupUpdate(row(), transaction(chargedBody({ amountCents: null })), NOW).status).toBe(WalletPaymentStatus.UNRESOLVED);
    expect(lookupUpdate(row(), transaction(chargedBody({ currency: null })), NOW).status).toBe(WalletPaymentStatus.UNRESOLVED);
  });

  it('does not verify a lookup whose amount or currency disagrees', () => {
    expect(lookupUpdate(row(), transaction(chargedBody({ amountCents: 999 })), NOW).status).toBe(WalletPaymentStatus.UNRESOLVED);
    expect(lookupUpdate(row(), transaction(chargedBody({ currency: 'ZWG' })), NOW).status).toBe(WalletPaymentStatus.UNRESOLVED);
  });

  it('does not verify mismatched identity fields', () => {
    expect(lookupUpdate(row(), transaction(chargedBody({ clientCorrelator: '9999999999999999' })), NOW).status).toBe(WalletPaymentStatus.UNRESOLVED);
    expect(lookupUpdate(row(), transaction(chargedBody({ referenceCode: 'RDR9999999999999999' })), NOW).status).toBe(WalletPaymentStatus.UNRESOLVED);
    expect(lookupUpdate(row(), transaction(chargedBody({ endUserId: '771111111' })), NOW).status).toBe(WalletPaymentStatus.UNRESOLVED);
    const stored = row();
    stored.providerTransactionId = 'MP-ORIGINAL';
    expect(lookupUpdate(stored, transaction(chargedBody({ ecocashReference: 'MP-OTHER' })), NOW).status).toBe(WalletPaymentStatus.UNRESOLVED);
  });

  it('expires only a confirmed miss after the deadline', () => {
    expect(lookupUpdate(row(), { kind: 'not_found' }, NOW)).not.toMatchObject({ status: WalletPaymentStatus.EXPIRED });
    expect(lookupUpdate(row(), { kind: 'not_found' }, LATER).status).toBe(WalletPaymentStatus.EXPIRED);
    expect(lookupUpdate(row(), { kind: 'uncertain', reason: 'timeout' }, LATER).status).toBe(WalletPaymentStatus.UNRESOLVED);
  });

  it('can verify an unresolved payment from a later matching lookup', () => {
    const unresolved = row();
    unresolved.status = WalletPaymentStatus.UNRESOLVED;
    expect(lookupUpdate(unresolved, transaction(chargedBody()), NOW).status).toBe(WalletPaymentStatus.VERIFIED);
  });

  it('does not let a stale decline replace a verified payment', () => {
    const verified = row();
    verified.status = WalletPaymentStatus.VERIFIED;
    verified.verifiedAt = NOW;
    const update = lookupUpdate(verified, { kind: 'declined', httpStatus: 422, responseCode: '05' }, LATER);
    expect(update.status).not.toBe(WalletPaymentStatus.FAILED);
    expect(update).toEqual({});
  });
});

describe('EcoCash payment failure logs', () => {
  it('records an error code without the payer number or provider secrets', () => {
    const error = Object.assign(new Error('payer 771234567 pin 2468 password sandbox-pass Authorization Basic abc'), { code: 'P2002' });
    const line = paymentFailureLog('payment-1', error);
    expect(line).toContain('payment-1');
    expect(line).toContain('P2002');
    expect(line).not.toContain('771234567');
    expect(line).not.toContain('2468');
    expect(line).not.toContain('sandbox-pass');
    expect(line).not.toContain('Basic');
    expect(line).not.toContain('Authorization');
  });
});

describe('EcoCash HTTP client safety', () => {
  it('does not retry a 500, a timeout, or malformed JSON', async () => {
    let calls = 0;
    const logs: EcocashLogEvent[] = [];
    const unavailable = await provider(async () => {
      calls += 1;
      return new Response('upstream', { status: 500 });
    }, logs).charge(CHARGE);
    expect(unavailable).toEqual({ kind: 'uncertain', reason: 'unavailable' });
    expect(calls).toBe(1);

    calls = 0;
    const timedOut = await provider(async () => {
      calls += 1;
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }, logs).charge(CHARGE);
    expect(timedOut).toEqual({ kind: 'uncertain', reason: 'timeout' });
    expect(calls).toBe(1);

    calls = 0;
    const malformed = await provider(async () => {
      calls += 1;
      return new Response('{', { status: 200, headers: { 'content-type': 'application/json' } });
    }, logs).lookup(CHARGE);
    expect(malformed).toEqual({ kind: 'uncertain', reason: 'invalid_response' });
    expect(calls).toBe(1);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(CONFIG.merchantPin);
    expect(logged).not.toContain(CONFIG.password);
    expect(logged).not.toContain(CHARGE.endUserId);
  });

  it('bounds the sandbox request with HTTPS and a timeout', async () => {
    let init: RequestInit | undefined;
    await provider(async (_url, options) => {
      init = options;
      return new Response(JSON.stringify({
        clientCorrelator: CHARGE.clientCorrelator,
        referenceCode: CHARGE.referenceCode,
        endUserId: CHARGE.endUserId,
        transactionOperationStatus: 'Charged',
        responseCode: '00',
        ecocashReference: 'MP1',
      }), { status: 200 });
    }, []).charge(CHARGE);
    expect(String(init?.signal)).toBeTruthy();
    expect(init?.redirect).toBe('error');
  });
});

const CONFIG: EcocashSandboxConfig = {
  enabled: true,
  environment: 'sandbox',
  baseUrl: 'https://developers.ecocash.co.zw',
  username: 'sandbox-user',
  password: 'sandbox-pass',
  merchantCode: 'ABC123',
  merchantNumber: '771234567',
  merchantPin: '2468',
  terminalId: 'TERM01',
  location: 'Harare',
  superMerchantName: 'Riders',
  merchantName: 'Riders',
  purchaseCategoryCode: 'Online Payment',
  chargeDescription: 'Riders wallet top-up',
};

const CHARGE = {
  clientCorrelator: '1234567890123456',
  referenceCode: 'RDR1234567890123456',
  endUserId: '771234567',
  amountCents: 250,
};

function provider(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  logs: EcocashLogEvent[],
): HttpEcocashPaymentProvider {
  return new HttpEcocashPaymentProvider(fetchImpl, { log: (event) => logs.push(event) }, CONFIG);
}

function row() {
  const payment: {
    id: string;
    riderWalletId: string;
    method: WalletPaymentMethod;
    status: WalletPaymentStatus;
    amount: string;
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
  } = {
    id: '01936b6a-7c8d-7000-8000-000000000001',
    riderWalletId: 'wallet-1',
    method: WalletPaymentMethod.GATEWAY,
    status: WalletPaymentStatus.PENDING,
    amount: '2.50',
    currency: Currency.USD,
    ecocashReference: null,
    provider: 'ECOCASH',
    providerTransactionId: null,
    idempotencyKey: 'top-up-1',
    payloadHash: 'a'.repeat(64),
    payerMsisdn: '771234567',
    clientCorrelator: '1234567890123456',
    referenceCode: 'RDR1234567890123456',
    nextLookupAt: NOW,
    expiresAt: new Date('2026-11-06T12:15:00.000Z'),
    lastProviderResponseCode: null,
    chargeAttemptedAt: NOW,
    verifiedAt: null,
  };
  return payment;
}

function chargedBody(overrides: Partial<EcocashTransaction> = {}): EcocashTransaction {
  return {
    clientCorrelator: '1234567890123456',
    referenceCode: 'RDR1234567890123456',
    endUserId: '771234567',
    ecocashReference: 'MP1',
    transactionOperationStatus: 'Charged',
    responseCode: '00',
    amountCents: 250,
    currency: 'USD',
    ...overrides,
  };
}

function transaction(body: EcocashTransaction): EcocashProviderResult {
  return { kind: 'transaction', httpStatus: 200, transaction: body };
}
