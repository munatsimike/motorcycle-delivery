import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
import { rateLimitAddress } from '../http/client-address.js';
import { OtpVerifyBody, PendingResponse, PhoneBody, RiderRegistrationBody, SessionResponse } from '../openapi/schemas.js';
import { OtpAuthService } from './otp-auth.service.js';

@ApiTags('Rider authentication')
@Controller('auth/rider')
export class RiderAuthController {
  constructor(private readonly otp: OtpAuthService) {}

  @Post('register/otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a rider registration code' })
  @ApiBody({ type: RiderRegistrationBody })
  @ApiOkResponse({ type: PendingResponse })
  @ApiBadRequestResponse({ description: 'Enter a valid Zimbabwe mobile number, or full name is required.' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'SMS verification is unavailable.' })
  startRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startRegistration(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('register/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a rider registration code and create the session' })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'Verification code is invalid, or the phone number is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiConflictResponse({ description: 'Phone number is already registered' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  verifyRegistration(@Body() body: unknown) {
    return this.otp.verifyRegistration(AuthSubjectRole.RIDER, body);
  }

  @Post('login/otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a rider sign-in code' })
  @ApiBody({ type: PhoneBody })
  @ApiOkResponse({ type: PendingResponse, description: 'The same pending response is returned when the number cannot sign in.' })
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
}

function clientAddress(request: Request): string {
  return rateLimitAddress(
    request,
    process.env.TRUSTED_PROXY_CIDRS,
    process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
  );
}
