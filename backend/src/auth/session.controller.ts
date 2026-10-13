import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { AccessTokenService, readBearerToken } from './access-token.service.js';
import { SessionService } from './session.service.js';

@Controller('auth/session')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    if (!isRecord(body) || typeof body.refreshToken !== 'string') {
      throw new UnauthorizedException('Authentication failed');
    }
    return this.sessions.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Headers('authorization') authorization?: string | string[]) {
    const claims = this.accessTokens.verify(readBearerToken(singleHeader(authorization)), new Date(), {
      ignoreExpiration: true,
    });
    await this.sessions.revoke(claims.sid, claims.sub);
  }

  @Post('logout-all')
  @HttpCode(204)
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
