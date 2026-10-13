import { Module } from '@nestjs/common';
import { AccessTokenService } from './access-token.service.js';
import { AdminAccessGuard } from './admin-access.guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { Clock } from './clock.js';
import { OtpAuthService } from './otp-auth.service.js';
import { RiderAccessGuard } from './rider-access.guard.js';
import { RiderAccessService } from './rider-access.service.js';
import { CustomerAccessGuard, CustomerSessionGuard } from './customer-access.guard.js';
import { CustomerAccessService } from './customer-access.service.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { RiderAuthController } from './rider-auth.controller.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { HttpTwilioVerifyClient, TwilioVerifyClient } from './twilio-verify.client.js';

@Module({
  controllers: [RiderAuthController, CustomerAuthController, SessionController],
  providers: [
    Clock,
    AccessTokenService,
    SessionService,
    OtpAuthService,
    RiderAccessService,
    RiderAccessGuard,
    CustomerAccessService,
    CustomerSessionGuard,
    CustomerAccessGuard,
    AdminAccessService,
    AdminAccessGuard,
    HttpTwilioVerifyClient,
    { provide: TwilioVerifyClient, useExisting: HttpTwilioVerifyClient },
  ],
  exports: [
    AccessTokenService,
    RiderAccessGuard,
    RiderAccessService,
    CustomerAccessGuard,
    CustomerSessionGuard,
    CustomerAccessService,
    AdminAccessGuard,
    AdminAccessService,
  ],
})
export class AuthModule {}
