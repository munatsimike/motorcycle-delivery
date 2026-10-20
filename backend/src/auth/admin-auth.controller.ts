import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { rateLimitAddress } from '../http/client-address.js';
import { AdminLoginBody, AdminPendingResponse, AdminVerifyBody, SessionResponse } from '../openapi/schemas.js';
import { AdminLoginService } from './admin-login.service.js';

@ApiTags('Admin authentication')
@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminLogin: AdminLoginService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start admin sign-in and email a verification code' })
  @ApiBody({ type: AdminLoginBody })
  @ApiOkResponse({ type: AdminPendingResponse })
  @ApiBadRequestResponse({ description: 'Invalid login request' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
  @ApiServiceUnavailableResponse({ description: 'The verification email could not be sent.' })
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
  @ApiOperation({ summary: 'Verify the admin code and create the session' })
  @ApiBody({ type: AdminVerifyBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ description: 'Invalid verification request' })
  @ApiUnauthorizedResponse({ description: 'Verification code is invalid' })
  @ApiTooManyRequestsResponse({ description: 'Too many verification attempts. Try again later.' })
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
