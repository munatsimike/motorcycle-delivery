import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiExtraModels, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
import { rateLimitAddress } from '../http/client-address.js';
import { LoginUnavailableResponse, OtpVerifyBody, PasswordResetBody, PendingResponse, PhoneBody, RegistrationProofResponse, RiderRegistrationBody, RiderRegistrationCompleteBody, RiderWhatsAppRegistrationBody, SessionResponse, WhatsAppRecoveryBody } from '../openapi/schemas.js';
import { OtpAuthService } from './otp-auth.service.js';
import { PASSWORD_REGISTRATION_CLOSED, PasswordAuthService } from './password-auth.service.js';
import { WhatsAppAuthService } from './whatsapp-auth.service.js';

@ApiTags('Rider authentication')
@ApiExtraModels(RegistrationProofResponse, SessionResponse, LoginUnavailableResponse)
@Controller('auth/rider')
export class RiderAuthController {
  constructor(
    private readonly otp: OtpAuthService,
    private readonly passwords: PasswordAuthService,
    private readonly whatsapp: WhatsAppAuthService,
  ) {}

  @Post('register/otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a rider registration code' })
  @ApiBody({ type: RiderRegistrationBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiBadRequestResponse({ description: 'Enter a valid Zimbabwe mobile number.' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'SMS verification is unavailable.' })
  startRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startRegistration(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('register/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a rider registration code' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({
    description: 'A registration proof when the account still has to be completed, including saved details when this phone already belongs to a customer. A session when the name was included for a new rider, or when this phone already has a rider profile.',
    schema: { oneOf: [{ $ref: getSchemaPath(RegistrationProofResponse) }, { $ref: getSchemaPath(SessionResponse) }] },
  })
  @ApiBadRequestResponse({ description: 'Verification code is invalid, or the phone number is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  verifyRegistration(@Body() body: unknown) {
    return this.otp.verifyRegistration(AuthSubjectRole.RIDER, body);
  }

  @Post('register/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish an individual rider account after the phone is verified' })
  @ApiBody({ type: RiderRegistrationCompleteBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'Full name and address are required. Rider accounts are individual.' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  completeRegistration(@Body() body: unknown) {
    return this.otp.completeRiderRegistration(body);
  }

  @Post('login/otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a rider sign-in code' })
  @ApiBody({ type: PhoneBody })
  @ApiOkResponse({
    description: 'Pending when a sign-in code is sent, or when an existing rider account cannot sign in. Unavailable when this number has no rider account. Unavailable contains no profile details.',
    schema: { oneOf: [{ $ref: getSchemaPath(PendingResponse) }, { $ref: getSchemaPath(LoginUnavailableResponse) }] },
  })
  @ApiBadRequestResponse({ description: 'Enter a valid Zimbabwe mobile number' })
  @ApiServiceUnavailableResponse({ description: 'SMS verification is unavailable.' })
  startLogin(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startLogin(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('login/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a rider sign-in code and create the session' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'Verification code is invalid, or the phone number is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid or authentication failed' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  verifyLogin(@Body() body: unknown) {
    return this.otp.verifyLogin(AuthSubjectRole.RIDER, body);
  }

  @Post('register/password')
  @ApiOperation({ summary: 'Password registration is closed. New rider accounts verify on WhatsApp.' })
  @ApiForbiddenResponse({ description: PASSWORD_REGISTRATION_CLOSED })
  registerWithPassword(@Body() body: unknown) {
    return this.passwords.registerRider(body);
  }

  @Post('login/password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in a rider with a phone number and password' })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'Enter a valid Zimbabwe mobile number' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiTooManyRequestsResponse({ description: 'Too many login attempts. Try again later.' })
  loginWithPassword(@Body() body: unknown, @Req() request: Request) {
    return this.passwords.login(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('register/whatsapp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start rider registration and send a WhatsApp verification code' })
  @ApiBody({ type: RiderWhatsAppRegistrationBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiBadRequestResponse({ description: 'The phone, password, name, address, or WhatsApp consent is invalid.' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
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
  @ApiOperation({ summary: 'Verify the rider WhatsApp code and create the session' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  verifyWhatsAppRegistration(@Body() body: unknown) {
    return this.whatsapp.verifyRegistration(AuthSubjectRole.RIDER, body);
  }

  @Post('password/forgot')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a rider password recovery code on WhatsApp when the number can be recovered' })
  @ApiBody({ type: WhatsAppRecoveryBody })
  @ApiOkResponse({ type: PendingResponse, description: 'The same response is returned whether or not an account exists.' })
  @ApiBadRequestResponse({ description: 'Enter a valid Zimbabwe mobile number and consent to WhatsApp authentication messages.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  forgotPassword(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.requestRecovery(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('password/reset')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reset a rider password after WhatsApp verification. Existing sessions are revoked.' })
  @ApiBody({ type: PasswordResetBody })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  resetPassword(@Body() body: unknown) {
    return this.whatsapp.resetPassword(AuthSubjectRole.RIDER, body);
  }
}

function clientAddress(request: Request): string {
  return rateLimitAddress(
    request,
    process.env.TRUSTED_PROXY_CIDRS,
    process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
  );
}
