import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ECOCASH_SANDBOX_ORIGIN,
  EcocashConfigurationError,
  type EcocashSandboxConfig,
  readEcocashSandboxConfig,
} from './ecocash-config.js';

const CHARGE_PATH = '/sandbox/payment/v1/transactions/amount/';
const TIMEOUT_MS = 20_000;
const logger = new Logger('Ecocash');

export type EcocashFetch = (input: string, init: RequestInit) => Promise<Response>;

export type EcocashLogEvent = {
  event: 'ecocash.charge' | 'ecocash.lookup';
  outcome: string;
  httpStatus: number | null;
  responseCode: string | null;
  clientCorrelator: string;
};

export type EcocashLogger = {
  log(event: EcocashLogEvent): void;
};

export type EcocashChargeRequest = {
  clientCorrelator: string;
  referenceCode: string;
  endUserId: string;
  amountCents: number;
};

export type EcocashLookupRequest = {
  clientCorrelator: string;
  endUserId: string;
};

export type EcocashTransaction = {
  clientCorrelator: string;
  referenceCode: string;
  endUserId: string;
  ecocashReference: string | null;
  transactionOperationStatus: string;
  responseCode: string;
  amountCents: number | null;
  currency: string | null;
};

export type EcocashProviderResult =
  | { kind: 'transaction'; httpStatus: number; transaction: EcocashTransaction }
  | { kind: 'not_found' }
  | { kind: 'declined'; httpStatus: number; responseCode: string | null }
  | { kind: 'rejected'; reason: 'unauthorized' | 'bad_request'; httpStatus: number }
  | { kind: 'uncertain'; reason: 'timeout' | 'network' | 'unavailable' | 'invalid_response' };

export abstract class EcocashPaymentProvider {
  abstract charge(request: EcocashChargeRequest): Promise<EcocashProviderResult>;
  abstract lookup(request: EcocashLookupRequest): Promise<EcocashProviderResult>;
}

const defaultLogger: EcocashLogger = {
  log(event) {
    logger.log(JSON.stringify(event));
  },
};

export class HttpEcocashPaymentProvider extends EcocashPaymentProvider {
  constructor(
    private readonly fetchImpl: EcocashFetch = fetch,
    private readonly log: EcocashLogger = defaultLogger,
    private readonly configOverride: EcocashSandboxConfig | null = null,
  ) {
    super();
  }

  charge(request: EcocashChargeRequest): Promise<EcocashProviderResult> {
    const config = this.config();
    return this.send('ecocash.charge', request.clientCorrelator, config, CHARGE_PATH, {
      method: 'POST',
      body: JSON.stringify(buildChargeBody(config, request)),
    });
  }

  lookup(request: EcocashLookupRequest): Promise<EcocashProviderResult> {
    const config = this.config();
    return this.send('ecocash.lookup', request.clientCorrelator, config, lookupPath(request), {
      method: 'GET',
    });
  }

  private config(): EcocashSandboxConfig {
    if (this.configOverride) {
      return this.configOverride;
    }
    try {
      return readEcocashSandboxConfig();
    } catch (error) {
      if (error instanceof EcocashConfigurationError) {
        throw new ServiceUnavailableException('EcoCash top-up is unavailable');
      }
      throw error;
    }
  }

  private async send(
    event: EcocashLogEvent['event'],
    clientCorrelator: string,
    config: EcocashSandboxConfig,
    path: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<EcocashProviderResult> {
    assertSandboxTarget(config.baseUrl, path);
    let response: Response;
    try {
      response = await this.fetchImpl(`${config.baseUrl}${path}`, {
        method: init.method,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: 'application/json',
          authorization: basicAuthorization(config.username, config.password),
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body,
      });
    } catch (error) {
      const reason = classifyTransportError(error);
      this.log.log({ event, outcome: reason, httpStatus: null, responseCode: null, clientCorrelator });
      return { kind: 'uncertain', reason };
    }
    const result = await classifyResponse(response);
    this.log.log({
      event,
      outcome: result.kind === 'uncertain' ? result.reason : result.kind,
      httpStatus: response.status,
      responseCode: responseCode(result),
      clientCorrelator,
    });
    return result;
  }
}

export function buildChargeBody(config: EcocashSandboxConfig, request: EcocashChargeRequest): Record<string, unknown> {
  if (!/^[A-Za-z0-9]{8,40}$/.test(request.clientCorrelator)) {
    throw new Error('EcoCash client correlator is invalid');
  }
  if (!/^[A-Za-z0-9]{8,64}$/.test(request.referenceCode)) {
    throw new Error('EcoCash reference code is invalid');
  }
  if (!/^7[0-9]{8}$/.test(request.endUserId)) {
    throw new Error('EcoCash payer number is invalid');
  }
  if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) {
    throw new Error('EcoCash amount is invalid');
  }
  return {
    clientCorrelator: request.clientCorrelator,
    referenceCode: request.referenceCode,
    tranType: 'MER',
    endUserId: request.endUserId,
    paymentAmount: {
      charginginformation: {
        amount: providerAmount(request.amountCents),
        currency: 'USD',
        description: config.chargeDescription,
      },
      chargeMetaData: {
        channel: 'WEB',
        purchaseCategoryCode: config.purchaseCategoryCode,
        onBeHalfOf: config.superMerchantName,
      },
    },
    merchantCode: config.merchantCode,
    merchantPin: config.merchantPin,
    merchantNumber: config.merchantNumber,
    countryCode: 'ZW',
    terminalID: config.terminalId,
    location: config.location,
    superMerchantName: config.superMerchantName,
    merchantName: config.merchantName,
  };
}

export function lookupPath(request: EcocashLookupRequest): string {
  if (!/^7[0-9]{8}$/.test(request.endUserId) || !/^[A-Za-z0-9]{8,40}$/.test(request.clientCorrelator)) {
    throw new Error('EcoCash lookup reference is invalid');
  }
  return `/sandbox/payment/v1/${request.endUserId}/transactions/amount/${request.clientCorrelator}`;
}

export function providerAmount(cents: number): number {
  const whole = Math.trunc(cents / 100);
  const fraction = Math.abs(cents % 100);
  if (fraction === 0) {
    return whole;
  }
  return Number(`${whole}.${String(fraction).padStart(2, '0')}`);
}

function assertSandboxTarget(baseUrl: string, path: string): void {
  if (baseUrl !== ECOCASH_SANDBOX_ORIGIN || !path.startsWith('/sandbox/payment/v1/')) {
    throw new Error('EcoCash sandbox origin is required');
  }
  const url = new URL(path, baseUrl);
  if (url.origin !== ECOCASH_SANDBOX_ORIGIN) {
    throw new Error('EcoCash sandbox origin is required');
  }
}

function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function classifyTransportError(error: unknown): 'timeout' | 'network' {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  return 'network';
}

async function classifyResponse(response: Response): Promise<EcocashProviderResult> {
  if (response.status === 401) {
    await discard(response);
    return { kind: 'rejected', reason: 'unauthorized', httpStatus: 401 };
  }
  if (response.status === 400) {
    await discard(response);
    return { kind: 'rejected', reason: 'bad_request', httpStatus: 400 };
  }
  if (response.status === 404) {
    await discard(response);
    return { kind: 'not_found' };
  }
  if (response.status >= 500) {
    await discard(response);
    return { kind: 'uncertain', reason: 'unavailable' };
  }
  const body = await readJson(response);
  if (response.status === 422) {
    return { kind: 'declined', httpStatus: 422, responseCode: codeFrom(body) };
  }
  if (response.status !== 200 || !body) {
    return { kind: 'uncertain', reason: 'invalid_response' };
  }
  const transaction = readTransaction(body);
  if (!transaction) {
    return { kind: 'uncertain', reason: 'invalid_response' };
  }
  return { kind: 'transaction', httpStatus: 200, transaction };
}

function readTransaction(body: Record<string, unknown>): EcocashTransaction | null {
  const clientCorrelator = text(body.clientCorrelator);
  const referenceCode = text(body.referenceCode);
  const endUserId = text(body.endUserId);
  const status = text(body.transactionOperationStatus);
  const responseCode = text(body.responseCode);
  if (!clientCorrelator || !referenceCode || !endUserId || !status || !responseCode) {
    return null;
  }
  const reference = text(body.ecocashReference);
  return {
    clientCorrelator,
    referenceCode,
    endUserId,
    ecocashReference: reference,
    transactionOperationStatus: status,
    responseCode,
    amountCents: centsFrom(body.amount ?? nestedAmount(body)),
    currency: text(body.currency) ?? nestedCurrency(body),
  };
}

function nestedAmount(body: Record<string, unknown>): unknown {
  const payment = record(body.paymentAmount);
  const charging = record(payment?.charginginformation);
  return charging?.amount;
}

function nestedCurrency(body: Record<string, unknown>): string | null {
  const payment = record(body.paymentAmount);
  const charging = record(payment?.charginginformation);
  return text(charging?.currency);
}

function centsFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return centsFromText(value.toFixed(2));
  }
  if (typeof value === 'string') {
    return centsFromText(value.trim());
  }
  return null;
}

function centsFromText(value: string): number | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    return null;
  }
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const cents = Number(match[1]) * 100 + Number(fraction);
  return Number.isSafeInteger(cents) ? cents : null;
}

function codeFrom(body: Record<string, unknown> | null): string | null {
  return body ? text(body.responseCode) : null;
}

function responseCode(result: EcocashProviderResult): string | null {
  if (result.kind === 'transaction') {
    return result.transaction.responseCode;
  }
  if (result.kind === 'declined') {
    return result.responseCode;
  }
  return null;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const textBody = await response.text();
  if (!textBody) {
    return null;
  }
  try {
    return record(JSON.parse(textBody));
  } catch {
    return null;
  }
}

async function discard(response: Response): Promise<void> {
  await response.text().catch(() => undefined);
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 120 ? trimmed : null;
}
