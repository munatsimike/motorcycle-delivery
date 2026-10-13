import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSubjectRole } from '../generated/prisma/client.js';
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
  return request.ip || request.socket?.remoteAddress || 'unknown';
}
