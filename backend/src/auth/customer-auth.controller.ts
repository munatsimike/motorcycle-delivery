import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiExtraModels, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
import { rateLimitAddress } from '../http/client-address.js';
import { BusinessCustomerRegistrationBody, CustomerRegistrationCompleteBody, CustomerWhatsAppRegistrationBody, IndividualCustomerRegistrationBody, LoginUnavailableResponse, OtpVerifyBody, PasswordResetBody, PendingResponse, PhoneBody, RegistrationProofResponse, SessionResponse, WhatsAppRecoveryBody } from '../openapi/schemas.js';
import { OtpAuthService } from './otp-auth.service.js';
import { PASSWORD_REGISTRATION_CLOSED, PasswordAuthService } from './password-auth.service.js';
import { WhatsAppAuthService } from './whatsapp-auth.service.js';

@ApiTags('Customer authentication')
@ApiExtraModels(IndividualCustomerRegistrationBody, BusinessCustomerRegistrationBody, RegistrationProofResponse, SessionResponse, LoginUnavailableResponse)
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(
    private readonly otp: OtpAuthService,
    private readonly passwords: PasswordAuthService,
    private readonly whatsapp: WhatsAppAuthService,
  ) {}

  @Post('register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a customer registration code' })
  @ApiBody({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(IndividualCustomerRegistrationBody) },
        { $ref: getSchemaPath(BusinessCustomerRegistrationBody) },
      ],
    },
  })
  @ApiOkResponse({ type: PendingResponse })
  @ApiBadRequestResponse({ description: 'The phone, account kind, name, or address is invalid.' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'SMS verification is unavailable.' })
  startRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startRegistration(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('register/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a customer registration code' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({
    description: 'A registration proof when the account still has to be completed. A session when the profile was included for a new phone, or when this phone already has a customer account.',
    schema: { oneOf: [{ $ref: getSchemaPath(SessionResponse) }, { $ref: getSchemaPath(RegistrationProofResponse) }] },
  })
  @ApiBadRequestResponse({ description: 'Verification code is invalid, or the phone number is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  verifyRegistration(@Body() body: unknown) {
    return this.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, body);
  }

  @Post('register/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish customer registration with a registration proof' })
  @ApiBody({ type: CustomerRegistrationCompleteBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'The account profile is incomplete.' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  completeRegistration(@Body() body: unknown) {
    return this.otp.completeCustomerRegistration(body);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a customer sign-in code' })
  @ApiBody({ type: PhoneBody })
  @ApiOkResponse({
    description: 'Pending when a sign-in code is sent, or when an existing customer account cannot sign in. Unavailable when this number has no customer account. Unavailable contains no profile details.',
    schema: { oneOf: [{ $ref: getSchemaPath(PendingResponse) }, { $ref: getSchemaPath(LoginUnavailableResponse) }] },
  })
  @ApiBadRequestResponse({ description: 'Enter a valid Zimbabwe mobile number' })
  @ApiServiceUnavailableResponse({ description: 'SMS verification is unavailable.' })
  startLogin(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startLogin(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('login/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a customer sign-in code' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'Verification code is invalid, or the phone number is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid or authentication failed' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  verifyLogin(@Body() body: unknown) {
    return this.otp.verifyLogin(AuthSubjectRole.CUSTOMER, body);
  }

  @Post('register/password')
  @ApiOperation({ summary: 'Password registration is closed. New customer accounts verify on WhatsApp.' })
  @ApiForbiddenResponse({ description: PASSWORD_REGISTRATION_CLOSED })
  registerWithPassword(@Body() body: unknown) {
    return this.passwords.registerCustomer(body);
  }

  @Post('login/password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in a customer with a phone number and password' })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'Enter a valid Zimbabwe mobile number' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiTooManyRequestsResponse({ description: 'Too many login attempts. Try again later.' })
  loginWithPassword(@Body() body: unknown, @Req() request: Request) {
    return this.passwords.login(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
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

  @Post('password/forgot')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a customer password recovery code on WhatsApp when the number can be recovered' })
  @ApiBody({ type: WhatsAppRecoveryBody })
  @ApiOkResponse({ type: PendingResponse, description: 'The same response is returned whether or not an account exists.' })
  @ApiBadRequestResponse({ description: 'Enter a valid Zimbabwe mobile number and consent to WhatsApp authentication messages.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  forgotPassword(@Body() body: unknown, @Req() request: Request) {
    return this.whatsapp.requestRecovery(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('password/reset')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reset a customer password after WhatsApp verification. Existing sessions are revoked.' })
  @ApiBody({ type: PasswordResetBody })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'WhatsApp verification is unavailable.' })
  resetPassword(@Body() body: unknown) {
    return this.whatsapp.resetPassword(AuthSubjectRole.CUSTOMER, body);
  }
}

function clientAddress(request: Request): string {
  return rateLimitAddress(
    request,
    process.env.TRUSTED_PROXY_CIDRS,
    process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
  );
}
