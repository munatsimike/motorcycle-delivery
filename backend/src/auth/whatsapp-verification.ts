import { ServiceUnavailableException } from '@nestjs/common';

const SERVICE_SID = /^VA[0-9a-f]{32}$/i;
const SENDER = /^\+[1-9]\d{7,14}$/;

export type WhatsAppVerificationProviderName = 'twilio' | 'meta';

export type WhatsAppVerificationConfig = {
  provider: WhatsAppVerificationProviderName;
  serviceSid: string;
  sender: string;
};

export function whatsappVerificationEnabled(): boolean {
  return process.env.WHATSAPP_VERIFICATION_ENABLED === 'true';
}

export function readWhatsAppVerificationConfig(): WhatsAppVerificationConfig {
  if (!whatsappVerificationEnabled()) {
    throw new ServiceUnavailableException('WhatsApp verification is unavailable');
  }
  const provider = process.env.WHATSAPP_VERIFICATION_PROVIDER ?? 'twilio';
  if (provider !== 'twilio' && provider !== 'meta') {
    throw new ServiceUnavailableException('WhatsApp verification is unavailable');
  }
  const serviceSid = process.env.WHATSAPP_VERIFICATION_SERVICE_SID ?? '';
  const sender = process.env.WHATSAPP_VERIFICATION_SENDER ?? '';
  if (!SENDER.test(sender) || (provider === 'twilio' && !SERVICE_SID.test(serviceSid))) {
    throw new ServiceUnavailableException('WhatsApp verification is not configured');
  }
  if (provider === 'meta') {
    throw new ServiceUnavailableException('WhatsApp verification is unavailable');
  }
  return { provider, serviceSid, sender };
}
