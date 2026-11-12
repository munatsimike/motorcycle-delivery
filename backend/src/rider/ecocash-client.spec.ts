import { describe, expect, it } from 'vitest';
import type { EcocashSandboxConfig } from './ecocash-config.js';
import {
  buildChargeBody,
  HttpEcocashPaymentProvider,
  lookupPath,
  type EcocashLogEvent,
} from './ecocash-client.js';

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

describe('EcoCash sandbox client', () => {
  it('builds the documented merchant charge and lookup path', () => {
    expect(buildChargeBody(CONFIG, CHARGE)).toEqual({
      clientCorrelator: CHARGE.clientCorrelator,
      referenceCode: CHARGE.referenceCode,
      tranType: 'MER',
      endUserId: '771234567',
      paymentAmount: {
        charginginformation: {
          amount: 2.5,
          currency: 'USD',
          description: 'Riders wallet top-up',
        },
        chargeMetaData: {
          channel: 'WEB',
          purchaseCategoryCode: 'Online Payment',
          onBeHalfOf: 'Riders',
        },
      },
      merchantCode: 'ABC123',
      merchantPin: '2468',
      merchantNumber: '771234567',
      countryCode: 'ZW',
      terminalID: 'TERM01',
      location: 'Harare',
      superMerchantName: 'Riders',
      merchantName: 'Riders',
    });
    expect(lookupPath(CHARGE)).toBe('/sandbox/payment/v1/771234567/transactions/amount/1234567890123456');
    expect(buildChargeBody(CONFIG, CHARGE)).not.toHaveProperty('notifyUrl');
  });

  it('sends Basic auth to the sandbox charge endpoint and redacts logs', async () => {
    const logs: EcocashLogEvent[] = [];
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new HttpEcocashPaymentProvider(async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        clientCorrelator: CHARGE.clientCorrelator,
        referenceCode: CHARGE.referenceCode,
        endUserId: CHARGE.endUserId,
        ecocashReference: 'MP260508.1439.T0782584',
        transactionOperationStatus: 'Charged',
        responseCode: '00',
      });
    }, { log: (event) => logs.push(event) }, CONFIG);

    const result = await provider.charge(CHARGE);
    expect(result.kind).toBe('transaction');
    expect(calls[0]?.url).toBe('https://developers.ecocash.co.zw/sandbox/payment/v1/transactions/amount/');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('sandbox-user:sandbox-pass').toString('base64')}`);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain('2468');
    expect(logged).not.toContain('sandbox-pass');
    expect(logged).not.toContain('sandbox-user');
    expect(logged).not.toContain('771234567');
  });

  it('classifies a decline, a timeout, and a lookup miss', async () => {
    const declined = await client(async () => jsonResponse({ responseCode: '05' }, 422)).charge(CHARGE);
    expect(declined).toEqual({ kind: 'declined', httpStatus: 422, responseCode: '05' });

    const timedOut = await client(async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }).charge(CHARGE);
    expect(timedOut).toEqual({ kind: 'uncertain', reason: 'timeout' });

    const missing = await client(async (_url, init) => {
      expect(init.method).toBe('GET');
      return jsonResponse({}, 404);
    }).lookup(CHARGE);
    expect(missing).toEqual({ kind: 'not_found' });
  });

  it('does not call a non-sandbox host', async () => {
    let called = false;
    const provider = new HttpEcocashPaymentProvider(async () => {
      called = true;
      return jsonResponse({});
    }, { log: () => undefined }, { ...CONFIG, baseUrl: 'https://pay.example.com' });
    await expect(provider.charge(CHARGE)).rejects.toThrow('EcoCash sandbox origin is required');
    expect(called).toBe(false);
  });
});

function client(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): HttpEcocashPaymentProvider {
  return new HttpEcocashPaymentProvider(fetchImpl, { log: () => undefined }, CONFIG);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
