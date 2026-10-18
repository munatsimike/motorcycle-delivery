import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
import { rateLimitAddress } from '../http/client-address.js';
import { OtpAuthService } from './otp-auth.service.js';

@Controller('auth/rider')
export class RiderAuthController {
  constructor(private readonly otp: OtpAuthService) {}

  @Post('register/otp')
  @HttpCode(200)
  startRegistration(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startRegistration(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('register/verify')
  @HttpCode(200)
  verifyRegistration(@Body() body: unknown) {
    return this.otp.verifyRegistration(AuthSubjectRole.RIDER, body);
  }

  @Post('login/otp')
  @HttpCode(200)
  startLogin(@Body() body: unknown, @Req() request: Request) {
    return this.otp.startLogin(AuthSubjectRole.RIDER, body, clientAddress(request));
  }

  @Post('login/verify')
  @HttpCode(200)
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
