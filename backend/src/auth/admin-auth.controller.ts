import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AdminLoginService } from './admin-login.service.js';

@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminLogin: AdminLoginService) {}

  @Post('login')
  @HttpCode(200)
  startLogin(@Body() body: unknown, @Req() request: Request) {
    return this.adminLogin.startLogin(
      body,
      request.ip || request.socket?.remoteAddress || 'unknown',
    );
  }

  @Post('login/verify')
  @HttpCode(200)
  verifyLogin(@Body() body: unknown, @Req() request: Request) {
    return this.adminLogin.verifyLogin(
      body,
      request.ip || request.socket?.remoteAddress || 'unknown',
    );
  }
}
