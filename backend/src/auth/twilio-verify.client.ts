import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TooManyRequestsException } from './too-many-requests.exception.js';

const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const SERVICE_SID = /^VA[0-9a-f]{32}$/i;
const logger = new Logger('TwilioVerify');

@Injectable()
export abstract class TwilioVerifyClient {
  abstract startVerification(phone: string): Promise<{ sid: string }>;
  abstract checkVerification(phone: string, code: string): Promise<boolean>;
}

@Injectable()
export class HttpTwilioVerifyClient extends TwilioVerifyClient {
  async startVerification(phone: string): Promise<{ sid: string }> {
    const response = await this.request('Verifications', { To: phone, Channel: 'sms' });
    if (response.status === 429) {
      throw new TooManyRequestsException('Too many verification attempts. Try again later.');
    }
    if (!response.ok) {
      await logHttpFailure('Verifications', response);
      throw new ServiceUnavailableException('SMS verification is unavailable');
    }
    const body = await readJson(response);
    if (typeof body.sid !== 'string' || body.sid.length === 0) {
      logTwilioFailure('Verifications', response.status, null, 'Verification response did not include a sid');
      throw new ServiceUnavailableException('SMS verification is unavailable');
    }
    return { sid: body.sid };
  }

  async checkVerification(phone: string, code: string): Promise<boolean> {
    const response = await this.request('VerificationCheck', { To: phone, Code: code });
    if (response.status === 429) {
      throw new TooManyRequestsException('Too many verification attempts. Try again later.');
    }
    if (response.status === 404) {
      return false;
    }
    if (response.status >= 500) {
      await logHttpFailure('VerificationCheck', response);
      throw new ServiceUnavailableException('SMS verification is unavailable');
    }
    if (!response.ok) {
      return false;
    }
    const body = await readJson(response);
    return body.status === 'approved' || body.valid === true;
  }

  private async request(action: 'Verifications' | 'VerificationCheck', fields: Record<string, string>): Promise<Response> {
    const { accountSid, authToken, serviceSid } = credentials();
    const authorization = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    try {
      return await fetch(`https://verify.twilio.com/v2/Services/${serviceSid}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorization}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      logTwilioFailure(action, null, null, networkFailureMessage(error));
      throw new ServiceUnavailableException('SMS verification is unavailable');
    }
  }
}

function credentials(): { accountSid: string; authToken: string; serviceSid: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID ?? '';
  if (!ACCOUNT_SID.test(accountSid) || !SERVICE_SID.test(serviceSid) || !isToken(authToken)) {
    throw new ServiceUnavailableException('SMS verification is not configured');
  }
  return { accountSid, authToken, serviceSid };
}

function isToken(value: string): boolean {
  return value.length >= 16 && !/[\r\n]/.test(value);
}

async function logHttpFailure(action: 'Verifications' | 'VerificationCheck', response: Response): Promise<void> {
  const body = await readJson(response);
  const message = typeof body.message === 'string' ? sanitizeMessage(body.message) : 'Twilio Verify request failed';
  logTwilioFailure(action, response.status, twilioCode(body), message);
}

function logTwilioFailure(
  action: 'Verifications' | 'VerificationCheck',
  httpStatus: number | null,
  twilioCode: number | null,
  message: string,
): void {
  logger.warn(
    `Twilio Verify ${action} failed httpStatus=${httpStatus ?? 'none'} twilioCode=${twilioCode ?? 'none'} message=${message}`,
  );
}

function twilioCode(body: Record<string, unknown>): number | null {
  const code = body.code;
  if (typeof code === 'number' && Number.isInteger(code) && code > 0 && code < 1_000_000) {
    return code;
  }
  if (typeof code === 'string' && /^\d{1,6}$/.test(code)) {
    return Number(code);
  }
  return null;
}

function networkFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Twilio request failed';
  }
  const cause = error.cause;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' && /^[A-Z0-9_]+$/.test(cause.code)
    ? cause.code
    : null;
  return sanitizeMessage([error.name, causeCode, error.message].filter((part) => part !== null && part.length > 0).join(' '));
}

function sanitizeMessage(value: string): string {
  const withoutSecrets = redactKnownSecrets(value)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\+[1-9][\d\s().-]{6,18}\d/g, '[phone]')
    .replace(/\b(?:00)?263\d{9}\b/g, '[phone]')
    .replace(/\b07\d{8}\b/g, '[phone]')
    .replace(/\b(?:AC|SK|VA)[0-9a-f]{32}\b/gi, '[redacted]')
    .replace(/\bBasic\s+\S+/gi, 'Basic [redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g, '[redacted]')
    .replace(/\b\d{4,10}\b/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return withoutSecrets.length > 0 ? withoutSecrets : 'Twilio Verify request failed';
}

function redactKnownSecrets(value: string): string {
  const secrets = [
    process.env.TWILIO_AUTH_TOKEN,
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_VERIFY_SERVICE_SID,
    process.env.JWT_ACCESS_SECRET,
    process.env.DATABASE_URL,
  ].filter((item): item is string => typeof item === 'string' && item.length > 0);
  return secrets.reduce((redacted, secret) => redacted.split(secret).join('[redacted]'), value);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}
