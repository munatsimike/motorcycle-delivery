import { Module } from '@nestjs/common';
import { AccessTokenService } from './access-token.service.js';
import { Clock } from './clock.js';
import { OtpAuthService } from './otp-auth.service.js';
import { RiderAccessGuard } from './rider-access.guard.js';
import { RiderAccessService } from './rider-access.service.js';
import { RiderAuthController } from './rider-auth.controller.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { HttpTwilioVerifyClient, TwilioVerifyClient } from './twilio-verify.client.js';

@Module({
  controllers: [RiderAuthController, SessionController],
  providers: [
    Clock,
    AccessTokenService,
    SessionService,
    OtpAuthService,
    RiderAccessService,
    RiderAccessGuard,
    HttpTwilioVerifyClient,
    { provide: TwilioVerifyClient, useExisting: HttpTwilioVerifyClient },
  ],
  exports: [AccessTokenService, RiderAccessGuard, RiderAccessService],
})
export class AuthModule {}
