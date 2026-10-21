import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiExtraModels, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
import { rateLimitAddress } from '../http/client-address.js';
import { BusinessCustomerRegistrationBody, CustomerRegistrationCompleteBody, IndividualCustomerRegistrationBody, OtpVerifyBody, PendingResponse, PhoneBody, RegistrationProofResponse, SessionResponse } from '../openapi/schemas.js';
import { OtpAuthService } from './otp-auth.service.js';

@ApiTags('Customer authentication')
@ApiExtraModels(IndividualCustomerRegistrationBody, BusinessCustomerRegistrationBody, RegistrationProofResponse, SessionResponse)
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private readonly otp: OtpAuthService) {}

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
  @ApiOkResponse({ type: PendingResponse, description: 'The same pending response is returned when the number cannot sign in.' })
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
}

function clientAddress(request: Request): string {
  return rateLimitAddress(
    request,
    process.env.TRUSTED_PROXY_CIDRS,
    process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
  );
}
