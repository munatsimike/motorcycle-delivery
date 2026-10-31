import { Module } from '@nestjs/common';
import { AccessTokenService } from './access-token.service.js';
import { AdminAccessGuard } from './admin-access.guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { Clock } from './clock.js';
import { RiderAccessGuard } from './rider-access.guard.js';
import { RiderAccessService } from './rider-access.service.js';
import { CustomerAccessGuard, CustomerSessionGuard } from './customer-access.guard.js';
import { RegistrationProofGuard } from './registration-proof.guard.js';
import { CustomerAccessService } from './customer-access.service.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { RiderAuthController } from './rider-auth.controller.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { DevOtpVerificationProvider, selectPhoneVerificationProvider } from './dev-otp.js';
import { InfobipWhatsAppClient, InfobipWhatsAppVerificationProvider } from './infobip-whatsapp.js';
import { PhoneVerificationProvider, TwilioWhatsAppVerificationProvider } from './phone-verification.provider.js';
import { HttpTwilioVerifyClient, TwilioVerifyClient } from './twilio-verify.client.js';
import { WhatsAppAuthService } from './whatsapp-auth.service.js';
import { assertSelectedWhatsAppProvider } from './whatsapp-verification.js';

import { AdminOtpEmailService } from './admin-otp-email.service.js';

import { AdminLoginRateLimitService } from './admin-login-rate-limit.service.js';

import { AdminOtpChallengeService } from './admin-otp-challenge.service.js';

import { AdminLoginService } from './admin-login.service.js';

import { AdminAuthController } from './admin-auth.controller.js';

@Module({
  controllers: [RiderAuthController, CustomerAuthController, SessionController, AdminAuthController],
  providers: [
    Clock,
    AccessTokenService,
    SessionService,
    RiderAccessService,
    RiderAccessGuard,
    CustomerAccessService,
    CustomerSessionGuard,
    CustomerAccessGuard,
    RegistrationProofGuard,
    AdminAccessService,
    AdminOtpEmailService,
    AdminLoginRateLimitService,
    AdminOtpChallengeService,
    AdminLoginService,
    AdminAccessGuard,
    HttpTwilioVerifyClient,
    { provide: TwilioVerifyClient, useExisting: HttpTwilioVerifyClient },
    TwilioWhatsAppVerificationProvider,
    InfobipWhatsAppClient,
    InfobipWhatsAppVerificationProvider,
    DevOtpVerificationProvider,
    {
      provide: PhoneVerificationProvider,
      useFactory: (
        twilio: TwilioWhatsAppVerificationProvider,
        devOtp: DevOtpVerificationProvider,
        infobip: InfobipWhatsAppVerificationProvider,
      ) => {
        assertSelectedWhatsAppProvider(process.env);
        return selectPhoneVerificationProvider(process.env, twilio, devOtp, infobip);
      },
      inject: [TwilioWhatsAppVerificationProvider, DevOtpVerificationProvider, InfobipWhatsAppVerificationProvider],
    },
    WhatsAppAuthService,
  ],
  exports: [
    AccessTokenService,
    RiderAccessGuard,
    RiderAccessService,
    CustomerAccessGuard,
    CustomerSessionGuard,
    RegistrationProofGuard,
    CustomerAccessService,
    AdminAccessGuard,
    AdminAccessService,
    AdminOtpEmailService,
    AdminLoginRateLimitService,
    AdminOtpChallengeService,
  ],
})
export class AuthModule {}





