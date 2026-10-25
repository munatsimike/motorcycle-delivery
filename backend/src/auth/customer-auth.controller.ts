import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
import { rateLimitAddress } from '../http/client-address.js';
import { CustomerWhatsAppRegistrationBody, OtpVerifyBody, PendingResponse, PhoneBody, SessionResponse, WhatsAppRecoveryBody } from '../openapi/schemas.js';
import { WhatsAppAuthService } from './whatsapp-auth.service.js';

@ApiTags('Customer authentication')
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private readonly whatsapp: WhatsAppAuthService) {}

  @Post('login/whatsapp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a customer sign-in code on WhatsApp when the number can sign in' })
  @ApiBody({ type: WhatsAppRecoveryBody })
  @ApiOkResponse({
    description: 'Pending when a WhatsApp code is sent. Unavailable when this number has no customer account. Unavailable contains no profile details.',
    schema: { oneOf: [{ $ref: '#/components/schemas/PendingResponse' }, { $ref: '#/components/schemas/LoginUnavailableResponse' }] },
  })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  startWhatsAppLogin(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.startLogin(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('login/whatsapp/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend the customer WhatsApp sign-in code' })
  @ApiBody({ type: PhoneBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  resendWhatsAppLogin(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.resendLogin(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('login/whatsapp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the customer WhatsApp sign-in code and create the session' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  verifyWhatsAppLogin(@Body() body: unknown) {
    return this.whatsapp.verifyLogin(AuthSubjectRole.CUSTOMER, body);
  }

  @Post('register/whatsapp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start customer registration and send a WhatsApp verification code' })
  @ApiBody({ type: CustomerWhatsAppRegistrationBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiBadRequestResponse({ description: 'The phone, password, profile, or WhatsApp consent is invalid.' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  startWhatsAppRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.startRegistration(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('register/whatsapp/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend the customer WhatsApp registration code' })
  @ApiBody({ type: PhoneBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  resendWhatsAppRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.resendRegistration(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('register/whatsapp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify the customer WhatsApp code and create the session' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  verifyWhatsAppRegistration(@Body() body: unknown) {
    return this.whatsapp.verifyRegistration(AuthSubjectRole.CUSTOMER, body);
  }

}

function clientAddress(request: Request): string {
  return rateLimitAddress(
    request,
    process.env.TRUSTED_PROXY_CIDRS,
    process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
  );
}
