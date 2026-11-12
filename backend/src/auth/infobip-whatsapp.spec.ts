import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { InfobipWhatsAppClient, InfobipWhatsAppVerificationProvider, authenticationSendButtons, type InfobipTemplateRecord } from './infobip-whatsapp.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { assertSelectedWhatsAppProvider, readInfobipWhatsAppConfig } from './whatsapp-verification.js';

const SECRET = 's'.repeat(40);
const API_KEY = 'k'.repeat(40);
const CODE = '654321';
const APPROVED: InfobipTemplateRecord = {
  name: 'authentication',
  language: 'en',
  status: 'APPROVED',
  category: 'AUTHENTICATION',
  structure: {
    buttons: [
      {
        type: 'URL',
        text: 'Copy code',
        url: 'https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code_expiration_minutes=5&code=otp{{1}}',
      },
      { type: 'QUICK_REPLY', text: "I didn't request a code" },
    ],
  },
};

describe('Infobip WhatsApp delivery', () => {
  afterEach(() => {
    delete process.env.WHATSAPP_VERIFICATION_ENABLED;
    delete process.env.WHATSAPP_VERIFICATION_PROVIDER;
    delete process.env.INFOBIP_BASE_URL;
    delete process.env.INFOBIP_API_KEY;
    delete process.env.INFOBIP_WHATSAPP_SENDER;
    delete process.env.INFOBIP_WHATSAPP_TEMPLATE;
    delete process.env.INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE;
    delete process.env.INFOBIP_OTP_HMAC_SECRET;
  });

  it('sends the same code in the body and the URL button, plus the registered static reply', () => {
    expect(authenticationSendButtons(APPROVED, CODE)).toEqual([
      { type: 'URL', parameter: CODE },
      { type: 'QUICK_REPLY', parameter: "I didn't request a code" },
    ]);
    expect(() => authenticationSendButtons({
      ...APPROVED,
      structure: { buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }] },
    }, CODE)).toThrow(ServiceUnavailableException);
  });

  it('treats an accepted response as submission and a rejection as delivery failure', async () => {
    const warnings: string[] = [];
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new InfobipWhatsAppClient();
    client.warn = (message) => warnings.push(message);
    client.fetchImpl = async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/templates')) {
        return json({ templates: [APPROVED] });
      }
      return json({
        messages: [{ messageId: 'message-1', status: { groupName: 'PENDING', name: 'PENDING_ENROUTE' } }],
      });
    };
    const id = await client.submit(config(), '+263771234567', CODE, 'challenge-1');
    expect(id).toBe('message-1');
    const sent = requests[1];
    const body = JSON.parse(String(sent?.init?.body));
    expect(body.messages[0]).toMatchObject({
      from: '447860088970',
      to: '263771234567',
      messageId: 'challenge-1',
      content: {
        templateName: 'authentication',
        language: 'en',
        templateData: {
          body: { placeholders: [CODE] },
          buttons: [
            { type: 'URL', parameter: CODE },
            { type: 'QUICK_REPLY', parameter: "I didn't request a code" },
          ],
        },
      },
    });
    expect(body.messages[0].smsFailover).toBeUndefined();
    expect(JSON.stringify(warnings)).not.toContain(CODE);
    expect(JSON.stringify(warnings)).not.toContain(API_KEY);

    const rejected = new InfobipWhatsAppClient();
    rejected.fetchImpl = async (url) => {
      if (url.endsWith('/templates')) {
        return json({ templates: [APPROVED] });
      }
      return json({
        messages: [{ messageId: 'message-2', status: { groupName: 'REJECTED', name: 'REJECTED_DESTINATION' } }],
      });
    };
    await expect(rejected.submit(config(), '+263771234567', CODE, 'challenge-2')).rejects.toThrow(
      'only the number verified with Infobip',
    );
  });

  it('stores only the HMAC and does not treat submission as verification', async () => {
    let sentCode = '';
    const client = new InfobipWhatsAppClient();
    client.fetchImpl = async (url, init) => {
      if (url.endsWith('/templates')) {
        return json({ templates: [APPROVED] });
      }
      sentCode = JSON.parse(String(init?.body)).messages[0].content.templateData.body.placeholders[0];
      return json({
        messages: [{ messageId: 'challenge-1', status: { groupName: 'PENDING', name: 'PENDING_ACCEPTED' } }],
      });
    };
    const provider = new InfobipWhatsAppVerificationProvider(client);
    useInfobipEnv();
    const sent = await provider.send('+263771234567', {
      challengeId: 'challenge-1',
      phone: '+263771234567',
      purpose: 'LOGIN',
      codeHash: null,
    });
    expect(sent.sid).toBe('challenge-1');
    expect(sent.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sent.codeHash).not.toContain(sentCode);
    const context = {
      challengeId: 'challenge-1',
      phone: '+263771234567',
      purpose: 'LOGIN',
      codeHash: sent.codeHash ?? null,
    };
    expect(await provider.check('+263771234567', sentCode, context)).toBe(true);
    expect(await provider.check('+263771234567', sentCode, { ...context, purpose: 'WHATSAPP_REGISTRATION' })).toBe(false);
    expect(await provider.check('+263771234567', '000000', context)).toBe(false);
  });

  it('hides API failures and rate limits without returning the code', async () => {
    const client = new InfobipWhatsAppClient();
    client.fetchImpl = async (url) => {
      if (url.endsWith('/templates')) {
        return json({ templates: [APPROVED] });
      }
      return new Response(JSON.stringify({ requestError: { text: CODE } }), { status: 503 });
    };
    const failure = await expectFailure(client.submit(config(), '+263771234567', CODE, 'challenge-1'));
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.message).toBe('WhatsApp verification is unavailable');
    expect(failure.message).not.toContain(CODE);

    const limited = new InfobipWhatsAppClient();
    limited.fetchImpl = async (url) => {
      if (url.endsWith('/templates')) {
        return json({ templates: [APPROVED] });
      }
      return new Response('', { status: 429 });
    };
    await expect(limited.submit(config(), '+263771234567', CODE, 'challenge-1')).rejects.toBeInstanceOf(TooManyRequestsException);
  });

  it('requires Infobip configuration only when that provider is selected', () => {
    expect(() => assertSelectedWhatsAppProvider({ WHATSAPP_VERIFICATION_PROVIDER: 'twilio' })).not.toThrow();
    useInfobipEnv();
    delete process.env.INFOBIP_OTP_HMAC_SECRET;
    expect(() => assertSelectedWhatsAppProvider(process.env)).toThrow('WhatsApp verification is not configured');
    process.env.INFOBIP_OTP_HMAC_SECRET = API_KEY;
    expect(() => readInfobipWhatsAppConfig()).toThrow('WhatsApp verification is not configured');
  });
});

function config() {
  return {
    baseUrl: 'https://example.test',
    apiKey: API_KEY,
    sender: '447860088970',
    templateName: 'authentication',
    language: 'en',
    hmacSecret: SECRET,
  };
}

function useInfobipEnv(): void {
  process.env.WHATSAPP_VERIFICATION_ENABLED = 'true';
  process.env.WHATSAPP_VERIFICATION_PROVIDER = 'infobip';
  process.env.INFOBIP_BASE_URL = 'https://example.test';
  process.env.INFOBIP_API_KEY = API_KEY;
  process.env.INFOBIP_WHATSAPP_SENDER = '447860088970';
  process.env.INFOBIP_WHATSAPP_TEMPLATE = 'authentication';
  process.env.INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE = 'en';
  process.env.INFOBIP_OTP_HMAC_SECRET = SECRET;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function expectFailure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error('expected a failure');
}
