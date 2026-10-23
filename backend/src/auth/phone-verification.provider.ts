import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { TwilioVerifyClient } from './twilio-verify.client.js';
import { readWhatsAppVerificationConfig } from './whatsapp-verification.js';

export abstract class PhoneVerificationProvider {
  abstract send(phone: string): Promise<{ sid: string }>;
  abstract check(phone: string, code: string): Promise<boolean>;
}

@Injectable()
export class TwilioWhatsAppVerificationProvider extends PhoneVerificationProvider {
  constructor(private readonly twilio: TwilioVerifyClient) {
    super();
  }

  send(phone: string): Promise<{ sid: string }> {
    const config = readWhatsAppVerificationConfig();
    return this.twilio.startVerification(phone, { channel: 'whatsapp', serviceSid: config.serviceSid });
  }

  check(phone: string, code: string): Promise<boolean> {
    const config = readWhatsAppVerificationConfig();
    return this.twilio.checkVerification(phone, code, { channel: 'whatsapp', serviceSid: config.serviceSid });
  }
}

@Injectable()
export class MetaWhatsAppVerificationProvider extends PhoneVerificationProvider {
  send(): Promise<{ sid: string }> {
    return Promise.reject(new ServiceUnavailableException('WhatsApp verification is unavailable'));
  }

  check(): Promise<boolean> {
    return Promise.reject(new ServiceUnavailableException('WhatsApp verification is unavailable'));
  }
}
