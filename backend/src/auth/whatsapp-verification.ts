import { ServiceUnavailableException } from '@nestjs/common';

const SERVICE_SID = /^VA[0-9a-f]{32}$/i;
const SENDER = /^\+[1-9]\d{7,14}$/;
const INFOBIP_SENDER = /^[1-9]\d{7,14}$/;
const TEMPLATE_NAME = /^[a-z0-9_]+$/;
const TEMPLATE_LANGUAGE = /^[a-z]{2}(?:_[A-Z]{2})?$/;

export type WhatsAppVerificationProviderName = 'twilio' | 'infobip';

export type WhatsAppVerificationConfig = {
  provider: WhatsAppVerificationProviderName;
  serviceSid: string;
  sender: string;
};

export function whatsappVerificationEnabled(): boolean {
  return process.env.WHATSAPP_VERIFICATION_ENABLED === 'true';
}

export function readWhatsAppVerificationConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppVerificationConfig {
  if (env.WHATSAPP_VERIFICATION_ENABLED !== 'true') {
    throw new ServiceUnavailableException('WhatsApp verification is unavailable');
  }
  const provider = env.WHATSAPP_VERIFICATION_PROVIDER ?? 'twilio';
  if (provider !== 'twilio' && provider !== 'infobip') {
    throw new ServiceUnavailableException('WhatsApp verification provider is not supported');
  }
  if (provider === 'infobip') {
    throw new ServiceUnavailableException('WhatsApp verification is unavailable');
  }
  const serviceSid = env.WHATSAPP_VERIFICATION_SERVICE_SID ?? '';
  const sender = env.WHATSAPP_VERIFICATION_SENDER ?? '';
  if (!SENDER.test(sender) || (provider === 'twilio' && !SERVICE_SID.test(serviceSid))) {
    throw new ServiceUnavailableException('WhatsApp verification is not configured');
  }
  return { provider, serviceSid, sender };
}

export type InfobipWhatsAppConfig = {
  baseUrl: string;
  apiKey: string;
  sender: string;
  templateName: string;
  language: string;
  hmacSecret: string;
};

export function readInfobipWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): InfobipWhatsAppConfig {
  if (env.WHATSAPP_VERIFICATION_ENABLED !== 'true' || env.WHATSAPP_VERIFICATION_PROVIDER !== 'infobip') {
    throw new ServiceUnavailableException('WhatsApp verification is unavailable');
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(env.INFOBIP_BASE_URL ?? '');
  } catch {
    throw new ServiceUnavailableException('WhatsApp verification is not configured');
  }
  const apiKey = env.INFOBIP_API_KEY ?? '';
  const sender = env.INFOBIP_WHATSAPP_SENDER ?? '';
  const templateName = env.INFOBIP_WHATSAPP_TEMPLATE ?? '';
  const language = env.INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE ?? '';
  const hmacSecret = env.INFOBIP_OTP_HMAC_SECRET ?? '';
  if (
    baseUrl.protocol !== 'https:'
    || baseUrl.username !== ''
    || baseUrl.password !== ''
    || baseUrl.pathname !== '/'
    || baseUrl.search !== ''
    || !isSecret(apiKey)
    || !INFOBIP_SENDER.test(sender)
    || !TEMPLATE_NAME.test(templateName)
    || !TEMPLATE_LANGUAGE.test(language)
    || !isSecret(hmacSecret)
    || hmacSecret === apiKey
  ) {
    throw new ServiceUnavailableException('WhatsApp verification is not configured');
  }
  return {
    baseUrl: baseUrl.origin,
    apiKey,
    sender,
    templateName,
    language,
    hmacSecret,
  };
}

export function assertSelectedWhatsAppProvider(env: NodeJS.ProcessEnv = process.env): void {
  if (env.WHATSAPP_VERIFICATION_ENABLED !== 'true' || env.WHATSAPP_VERIFICATION_PROVIDER !== 'infobip') {
    return;
  }
  readInfobipWhatsAppConfig(env);
}

function isSecret(value: string): boolean {
  return Buffer.byteLength(value, 'utf8') >= 32 && !/[\r\n]/.test(value);
}
