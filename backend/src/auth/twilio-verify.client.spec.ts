import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { HttpTwilioVerifyClient } from './twilio-verify.client.js';

const whatsapp = {
  channel: 'whatsapp' as const,
  serviceSid: `VA${'c'.repeat(32)}`,
};

describe('HttpTwilioVerifyClient', () => {
  const client = new HttpTwilioVerifyClient();
  const fetchMock = vi.fn();
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC' + 'a'.repeat(32);
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token-value';
    process.env.JWT_ACCESS_SECRET = '0123456789abcdef0123456789abcdef';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.WHATSAPP_VERIFICATION_SERVICE_SID;
    delete process.env.WHATSAPP_VERIFICATION_SENDER;
    delete process.env.JWT_ACCESS_SECRET;
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it('starts a WhatsApp verification on the configured service without logging the code or sender', async () => {
    process.env.WHATSAPP_VERIFICATION_SERVICE_SID = `VA${'c'.repeat(32)}`;
    process.env.WHATSAPP_VERIFICATION_SENDER = '+263771000000';
    fetchMock.mockResolvedValue(jsonResponse(201, { sid: 'VE456', to: '+263771234567' }));
    await expect(client.startVerification('+263771234567', {
      channel: 'whatsapp',
      serviceSid: process.env.WHATSAPP_VERIFICATION_SERVICE_SID,
    })).resolves.toEqual({ sid: 'VE456' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(process.env.WHATSAPP_VERIFICATION_SERVICE_SID);
    expect(String(init.body)).toContain('Channel=whatsapp');
    expect(String(init.body)).not.toContain(process.env.WHATSAPP_VERIFICATION_SENDER);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not send SMS when the WhatsApp channel is omitted', async () => {
    await expect(client.startVerification('+263771234567')).rejects.toMatchObject({
      message: 'WhatsApp verification is unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats an approved check as success and any other code as failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'approved', valid: true }));
    await expect(client.checkVerification('+263771234567', '123456', whatsapp)).resolves.toBe(true);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'pending', valid: false }));
    await expect(client.checkVerification('+263771234567', '000000', whatsapp)).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { status: 404 }));
    await expect(client.checkVerification('+263771234567', '000000', whatsapp)).resolves.toBe(false);
  });

  it('does not call Twilio when credentials are missing', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    await expect(client.startVerification('+263771234567', whatsapp)).rejects.toMatchObject({
      message: 'WhatsApp verification is not configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces Twilio rate limits without the response body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { message: 'secret upstream detail' }));
    await expect(client.checkVerification('+263771234567', '123456', whatsapp)).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs Twilio status and code when WhatsApp verification is unavailable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {
      code: 20003,
      message: 'Authenticate failed for +263771234567',
      more_info: 'https://www.twilio.com/docs/errors/20003',
    }));

    await expect(client.startVerification('+263771234567', whatsapp)).rejects.toMatchObject({
      message: 'WhatsApp verification is unavailable',
    });

    const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
    expect(logged).toContain('httpStatus=401');
    expect(logged).toContain('twilioCode=20003');
    expect(logged).toContain('accountSidSuffix=aaaa');
    expect(logged).toContain('serviceSidSuffix=cccc');
    expect(logged).toContain('destinationCountry=+263');
    expect(logged).toContain('message=Authenticate failed for [phone]');
    expect(logged).not.toContain('+263771234567');
    expect(logged).not.toContain('771234567');
    expect(logged).not.toContain(process.env.TWILIO_ACCOUNT_SID);
    expect(logged).not.toContain(whatsapp.serviceSid);
    expect(logged).not.toContain(process.env.TWILIO_AUTH_TOKEN);
    expect(logged).not.toContain('Authorization');
  });

  it('logs a Dutch destination as +31 without the rest of the number', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { code: 21608, message: 'The number +31612345678 is unverified' }));

    await expect(client.startVerification('+31612345678', whatsapp)).rejects.toMatchObject({
      message: 'WhatsApp verification is unavailable',
    });

    const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
    expect(logged).toContain('httpStatus=403');
    expect(logged).toContain('twilioCode=21608');
    expect(logged).toContain('destinationCountry=+31');
    expect(logged).not.toContain('+31612345678');
    expect(logged).not.toContain('612345678');
    expect(logged).not.toContain(process.env.TWILIO_AUTH_TOKEN);
  });

  it('redacts secrets from Twilio and network failure logs', async () => {
    const serviceSid = whatsapp.serviceSid;
    fetchMock.mockRejectedValueOnce(new TypeError(
      `connect failed https://verify.twilio.com/v2/Services/${serviceSid}/Verifications for +263771234567 Basic ${process.env.TWILIO_AUTH_TOKEN} Bearer ${process.env.JWT_ACCESS_SECRET}`,
    ));

    await expect(client.startVerification('+263771234567', whatsapp)).rejects.toBeInstanceOf(ServiceUnavailableException);

    const logged = warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
    expect(logged).toContain('httpStatus=none');
    expect(logged).toContain('twilioCode=none');
    expect(logged).toContain('accountSidSuffix=aaaa');
    expect(logged).toContain('serviceSidSuffix=cccc');
    expect(logged).toContain('destinationCountry=+263');
    expect(logged).toContain('[url]');
    expect(logged).toContain('[phone]');
    expect(logged).toContain('Basic [redacted]');
    expect(logged).toContain('Bearer [redacted]');
    expect(logged).not.toContain('+263771234567');
    expect(logged).not.toContain(serviceSid);
    expect(logged).not.toContain(process.env.TWILIO_AUTH_TOKEN);
    expect(logged).not.toContain(process.env.JWT_ACCESS_SECRET);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
