import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { generateInfobipOtp, hashInfobipOtp, verifyInfobipOtp } from './infobip-otp.js';
import {
  PhoneVerificationContext,
  PhoneVerificationProvider,
  PhoneVerificationSendResult,
} from './phone-verification.provider.js';
import { readInfobipWhatsAppConfig, type InfobipWhatsAppConfig } from './whatsapp-verification.js';

const ACCEPTED_GROUPS = new Set(['PENDING']);
const TRIAL_STATUS = /DESTINATION|RECIPIENT|NOT_ALLOWED|REJECTED_NETWORK|REJECTED_PREFIX/i;

export type InfobipTemplateButton = {
  type?: string;
  text?: string;
  url?: string;
};

export type InfobipTemplateRecord = {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  structure?: { buttons?: InfobipTemplateButton[] };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Warn = (message: string) => void;

export function authenticationSendButtons(
  template: InfobipTemplateRecord,
  code: string,
): Array<{ type: 'URL' | 'QUICK_REPLY'; parameter: string }> {
  const buttons = template.structure?.buttons ?? [];
  const [copyCode, ...rest] = buttons;
  const copyUrl = copyCode?.type === 'URL' && typeof copyCode.url === 'string' && copyCode.url.includes('{{1}}');
  const staticReplies = rest.every((button) => button.type === 'QUICK_REPLY' && typeof button.text === 'string' && !button.text.includes('{{') && !button.url);
  if (template.status !== 'APPROVED' || template.category !== 'AUTHENTICATION' || !copyUrl || !staticReplies) {
    throw new ServiceUnavailableException('WhatsApp verification is not configured');
  }
  return [
    { type: 'URL', parameter: code },
    ...rest.map((button) => ({ type: 'QUICK_REPLY' as const, parameter: button.text ?? '' })),
  ];
}

@Injectable()
export class InfobipWhatsAppClient {
  private template: InfobipTemplateRecord | null = null;
  fetchImpl: FetchLike = fetch;
  warn: Warn = () => undefined;

  async submit(config: InfobipWhatsAppConfig, phone: string, code: string, messageId: string): Promise<string> {
    const template = await this.approvedTemplate(config);
    const response = await this.request(config, '/whatsapp/1/message/template', {
      messages: [{
        from: config.sender,
        to: digits(phone),
        messageId,
        content: {
          templateName: config.templateName,
          language: config.language,
          templateData: {
            body: { placeholders: [code] },
            buttons: authenticationSendButtons(template, code),
          },
        },
      }],
    });
    if (response.status === 429) {
      throw new TooManyRequestsException('Too many verification attempts. Try again later.');
    }
    if (!response.ok) {
      this.warn(`Infobip template submit failed httpStatus=${response.status}`);
      throw new ServiceUnavailableException(response.status === 401 || response.status === 403
        ? 'WhatsApp verification is not configured'
        : 'WhatsApp verification is unavailable');
    }
    const body = await readJson(response);
    const message = Array.isArray(body.messages) ? body.messages[0] : null;
    const status = message && typeof message === 'object' ? message.status : null;
    const groupName = status && typeof status === 'object' && typeof status.groupName === 'string' ? status.groupName : '';
    const statusName = status && typeof status === 'object' && typeof status.name === 'string' ? status.name : '';
    const returnedId = message && typeof message === 'object' && typeof message.messageId === 'string' ? message.messageId : '';
    if (!ACCEPTED_GROUPS.has(groupName) || returnedId.length === 0 || returnedId.length > 128) {
      this.warn(`Infobip template rejected group=${groupName || 'none'} status=${statusName || 'none'}`);
      throw new ServiceUnavailableException(deliveryMessage(groupName, statusName));
    }
    return returnedId;
  }

  private async approvedTemplate(config: InfobipWhatsAppConfig): Promise<InfobipTemplateRecord> {
    if (this.template?.name === config.templateName && this.template.language === config.language) {
      authenticationSendButtons(this.template, '000000');
      return this.template;
    }
    const response = await this.request(config, `/whatsapp/2/senders/${config.sender}/templates`);
    if (!response.ok) {
      this.warn(`Infobip template lookup failed httpStatus=${response.status}`);
      throw new ServiceUnavailableException('WhatsApp verification is not configured');
    }
    const body = await readJson(response);
    const templates = Array.isArray(body.templates) ? body.templates as InfobipTemplateRecord[] : [];
    const match = templates.find((item) => item.name === config.templateName && item.language === config.language);
    if (!match) {
      throw new ServiceUnavailableException('WhatsApp verification is not configured');
    }
    authenticationSendButtons(match, '000000');
    this.template = match;
    return match;
  }

  private async request(config: InfobipWhatsAppConfig, path: string, payload?: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(`${config.baseUrl}${path}`, {
        method: payload ? 'POST' : 'GET',
        headers: {
          Authorization: `App ${config.apiKey}`,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      this.warn('Infobip request failed');
      throw new ServiceUnavailableException('WhatsApp verification is unavailable');
    }
  }
}

@Injectable()
export class InfobipWhatsAppVerificationProvider extends PhoneVerificationProvider {
  constructor(private readonly infobip: InfobipWhatsAppClient) {
    super();
  }

  async send(phone: string, context?: PhoneVerificationContext): Promise<PhoneVerificationSendResult> {
    if (!context) {
      throw new ServiceUnavailableException('WhatsApp verification is unavailable');
    }
    const config = readInfobipWhatsAppConfig();
    const code = generateInfobipOtp();
    const codeHash = hashInfobipOtp(config.hmacSecret, {
      challengeId: context.challengeId,
      phone: context.phone,
      purpose: context.purpose,
      code,
    });
    const sid = await this.infobip.submit(config, context.phone, code, context.challengeId);
    return { sid, codeHash };
  }

  async check(phone: string, code: string, context?: PhoneVerificationContext): Promise<boolean> {
    if (!context?.codeHash) {
      return false;
    }
    const config = readInfobipWhatsAppConfig();
    return verifyInfobipOtp(config.hmacSecret, {
      challengeId: context.challengeId,
      phone,
      purpose: context.purpose,
      code,
    }, context.codeHash);
  }
}

function digits(phone: string): string {
  return phone.replace(/^\+/, '');
}

function deliveryMessage(groupName: string, statusName: string): string {
  if (TRIAL_STATUS.test(statusName)) {
    return 'WhatsApp could not deliver the verification code to this number. On a trial account, only the number verified with Infobip can receive it.';
  }
  if (groupName === 'REJECTED' || groupName === 'UNDELIVERABLE') {
    return 'WhatsApp could not deliver the verification code to this number.';
  }
  return 'WhatsApp verification is unavailable';
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
