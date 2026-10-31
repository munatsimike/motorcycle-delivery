import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
import { rateLimitAddress } from '../http/client-address.js';
import { OtpVerifyBody, PendingResponse, PhoneBody, RiderRegistrationCompleteBody, RiderWhatsAppRegistrationBody, SessionResponse, WhatsAppRecoveryBody } from '../openapi/schemas.js';
import { WhatsAppAuthService } from './whatsapp-auth.service.js';

@ApiTags('Rider authentication')
@Controller('auth/rider')
export class RiderAuthController {
  constructor(private readonly whatsapp: WhatsAppAuthService) {}

  @Post('login/whatsapp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a rider sign-in code on WhatsApp without revealing whether the number has an account' })
  @ApiBody({ type: WhatsAppRecoveryBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  startWhatsAppLogin(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.startLogin(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('login/whatsapp/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend the rider WhatsApp sign-in code' })
  @ApiBody({ type: PhoneBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  resendWhatsAppLogin(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.resendLogin(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('login/whatsapp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the rider WhatsApp sign-in code. An existing rider profile receives a session. A verified number without a rider profile receives a registration proof.' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ description: 'A session for an existing rider profile, or a short-lived rider registration proof.' })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  verifyWhatsAppLogin(@Body() body: unknown) {
    return this.whatsapp.verifyLogin(AuthSubjectRole.RIDER, body);
  }

  @Post('register/whatsapp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a rider registration code on WhatsApp without revealing whether the number has an account' })
  @ApiBody({ type: RiderWhatsAppRegistrationBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiBadRequestResponse({ description: 'The phone or WhatsApp consent is invalid.' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  startWhatsAppRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.startRegistration(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('register/whatsapp/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend the rider WhatsApp registration code' })
  @ApiBody({ type: PhoneBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  resendWhatsAppRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.resendRegistration(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('register/whatsapp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the rider registration code. An existing rider profile receives a session. A new or customer number receives a registration proof.' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ description: 'A session for an existing rider profile, or a short-lived rider registration proof.' })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  verifyWhatsAppRegistration(@Body() body: unknown) {
    return this.whatsapp.verifyRegistration(AuthSubjectRole.RIDER, body);
  }

  @Post('register/whatsapp/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create the pending rider profile for a verified phone and create the session' })
  @ApiBody({ type: RiderRegistrationCompleteBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'The name or address is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  completeWhatsAppRegistration(@Body() body: unknown) {
    return this.whatsapp.completeRiderRegistration(body);
  }

}

function clientAddress(request: Request): string {
  return rateLimitAddress(
    request,
    process.env.TRUSTED_PROXY_CIDRS,
    process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
  );
}
