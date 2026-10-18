import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { rateLimitAddress } from '../http/client-address.js';
import { AdminLoginService } from './admin-login.service.js';

@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminLogin: AdminLoginService) {}

  @Post('login')
  @HttpCode(200)
  startLogin(@Body() body: unknown, @Req() request: Request) {
    return this.adminLogin.startLogin(
      body,
      rateLimitAddress(
        request,
        process.env.TRUSTED_PROXY_CIDRS,
        process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
      ),
    );
  }

  @Post('login/verify')
  @HttpCode(200)
  verifyLogin(@Body() body: unknown, @Req() request: Request) {
    return this.adminLogin.verifyLogin(
      body,
      rateLimitAddress(
        request,
        process.env.TRUSTED_PROXY_CIDRS,
        process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
      ),
    );
  }
}
