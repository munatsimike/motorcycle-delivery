import { Injectable } from '@nestjs/common';
import { TwilioVerifyClient } from './twilio-verify.client.js';
import { readWhatsAppVerificationConfig } from './whatsapp-verification.js';

export type PhoneVerificationContext = {
  challengeId: string;
  phone: string;
  purpose: string;
  codeHash: string | null;
};

export type PhoneVerificationSendResult = {
  sid: string;
  codeHash?: string;
};

export abstract class PhoneVerificationProvider {
  abstract send(phone: string, context?: PhoneVerificationContext): Promise<PhoneVerificationSendResult>;
  abstract check(phone: string, code: string, context?: PhoneVerificationContext): Promise<boolean>;
}

@Injectable()
// The WhatsApp provider must not print verification codes. Local codes are logged
// only by DevOtpVerificationProvider, and only after the local-development checks.
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
