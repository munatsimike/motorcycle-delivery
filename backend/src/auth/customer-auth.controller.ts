import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
import { rateLimitAddress } from '../http/client-address.js';
import { OtpAuthService } from './otp-auth.service.js';

@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private readonly otp: OtpAuthService) {}

  @Post('register')
  @HttpCode(200)
  startRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startRegistration(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('register/verify')
  @HttpCode(200)
  verifyRegistration(@Body() body: unknown) {
    return this.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, body);
  }

  @Post('register/complete')
  @HttpCode(200)
  completeRegistration(@Body() body: unknown) {
    return this.otp.completeCustomerRegistration(body);
  }

  @Post('login')
  @HttpCode(200)
  startLogin(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startLogin(AuthSubjectRole.CUSTOMER, body, clientAddress(request));
  }

  @Post('login/verify')
  @HttpCode(200)
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
