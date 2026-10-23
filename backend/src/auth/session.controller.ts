import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RefreshBody, SessionResponse } from '../openapi/schemas.js';
import { AccessTokenService, readBearerToken } from './access-token.service.js';
import { PasswordAuthService, takeRefreshProof } from './password-auth.service.js';
import { SessionService } from './session.service.js';

@ApiTags('Sessions')
@Controller('auth/session')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
    private readonly passwords: PasswordAuthService,
  ) {}

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new session' })
  @ApiBody({ type: RefreshBody })
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  refresh(@Body() body: unknown) {
    if (!isRecord(body) || typeof body.refreshToken !== 'string') {
      throw new UnauthorizedException('Authentication failed');
    }
    return this.sessions.refresh(body.refreshToken);
  }

  @Post('password')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Set a password on the signed-in rider or customer account' })
  @ApiNoContentResponse({ description: 'The password was saved. Existing sessions stay signed in.' })
  @ApiBadRequestResponse({ description: 'Password must contain 12 to 128 characters' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  @ApiTooManyRequestsResponse({ description: 'Too many login attempts. Try again later.' })
  async setPassword(
    @Headers('authorization') authorization: string | string[] | undefined,
    @Body() body: unknown,
  ) {
    const refreshProof = takeRefreshProof(body);
    const claims = this.accessTokens.verify(readBearerToken(singleHeader(authorization)), new Date());
    await this.passwords.setPassword(claims.sub, claims.sid, claims.role, body, refreshProof);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiNoContentResponse({ description: 'The presented session was revoked. An expired access token is still accepted.' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  async logout(@Headers('authorization') authorization?: string | string[]) {
    const claims = this.accessTokens.verify(readBearerToken(singleHeader(authorization)), new Date(), {
      ignoreExpiration: true,
    });
    await this.sessions.revoke(claims.sid, claims.sub);
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke every active session for the signed-in user' })
  @ApiNoContentResponse({ description: 'Every active session for the user was revoked.' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  async logoutAll(@Headers('authorization') authorization?: string | string[]) {
    const claims = this.accessTokens.verify(readBearerToken(singleHeader(authorization)), new Date(), {
      ignoreExpiration: true,
    });
    await this.sessions.revokeAll(claims.sub);
  }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
