import { describe, expect, it } from 'vitest';
import { Currency, WalletPaymentMethod, WalletPaymentStatus } from '../generated/prisma/client.js';
import type { EcocashTransaction } from './ecocash-client.js';
import { ecocashCreditAllowed, reconcileUncreditedEcocashCredits } from './ecocash-credit.js';

const payment = {
  id: '01936b6a-7c8d-7000-8000-000000000001',
  method: WalletPaymentMethod.GATEWAY,
  status: WalletPaymentStatus.VERIFIED,
  amount: '2.50',
  currency: Currency.USD,
  ecocashReference: 'MP00000001',
  provider: 'ECOCASH',
  providerTransactionId: 'MP00000001',
  payerMsisdn: '771234567',
  clientCorrelator: '1234567890123456',
  referenceCode: 'RDR1234567890123456',
  lastProviderResponseCode: '00',
  verifiedAt: new Date('2026-11-06T12:00:00.000Z'),
};

function transaction(overrides: Partial<EcocashTransaction> = {}): EcocashTransaction {
  return {
    clientCorrelator: payment.clientCorrelator,
    referenceCode: payment.referenceCode,
    endUserId: payment.payerMsisdn,
    ecocashReference: payment.providerTransactionId,
    transactionOperationStatus: 'Charged',
    responseCode: '00',
    amountCents: 250,
    currency: 'USD',
    ...overrides,
  };
}

describe('EcoCash credit evidence', () => {
  it('accepts a charged lookup that reports the same amount and currency', () => {
    expect(ecocashCreditAllowed(payment, transaction())).toBe(true);
  });

  it('rejects missing amount or currency instead of copying the requested amount', () => {
    expect(ecocashCreditAllowed(payment, transaction({ amountCents: null }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ currency: null }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ amountCents: null, currency: null }))).toBe(false);
  });

  it('rejects contradictory provider evidence', () => {
    expect(ecocashCreditAllowed(payment, transaction({ amountCents: 251 }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ currency: 'ZWL' }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ clientCorrelator: '0000000000000000' }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ referenceCode: 'RDR0000000000000000' }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ endUserId: '771111111' }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ ecocashReference: 'MP99999999' }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ transactionOperationStatus: 'Pending' }))).toBe(false);
    expect(ecocashCreditAllowed(payment, transaction({ responseCode: '05' }))).toBe(false);
    expect(ecocashCreditAllowed({ ...payment, status: WalletPaymentStatus.UNRESOLVED, verifiedAt: null }, transaction())).toBe(false);
    expect(ecocashCreditAllowed({ ...payment, status: WalletPaymentStatus.REVERSED }, transaction())).toBe(false);
    expect(ecocashCreditAllowed({ ...payment, status: WalletPaymentStatus.REFUNDED }, transaction())).toBe(false);
    expect(ecocashCreditAllowed({ ...payment, lastProviderResponseCode: 'AMOUNT_CURRENCY_UNVERIFIED' }, transaction())).toBe(false);
    expect(ecocashCreditAllowed({ ...payment, providerTransactionId: 'MP00000002' }, transaction())).toBe(false);
  });

  it('does not look for credits while automatic crediting is disabled', async () => {
    let called = false;
    const provider = {
      async charge() {
        called = true;
        return { kind: 'transaction' };
      },
      async lookup() {
        called = true;
        return { kind: 'transaction' };
      },
    };
    const prisma = {
      walletPayment: {
        findMany() {
          called = true;
          return [];
        },
      },
    };
    await expect(reconcileUncreditedEcocashCredits(prisma as never, provider, new Date(), 20, false)).resolves.toBe(0);
    await expect(reconcileUncreditedEcocashCredits(prisma as never, provider)).resolves.toBe(0);
    expect(called).toBe(false);
  });
});
