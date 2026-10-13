import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService, readBearerToken } from './access-token.service.js';

export type AdminContext = {
  userId: string;
};

@Injectable()
export class AdminAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async authenticate(authorization: string | undefined, now = new Date()): Promise<AdminContext> {
    const claims = this.accessTokens.verify(readBearerToken(authorization), now);
    if (claims.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access is required');
    }

    const session = await this.prisma.refreshSession.findUnique({ where: { id: claims.sid } });
    if (
      !session
      || session.userId !== claims.sub
      || session.revokedAt
      || session.replacedBySessionId
      || session.expiresAt <= now
    ) {
      throw new UnauthorizedException('Authentication failed');
    }

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.role !== UserRole.ADMIN || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Admin access is required');
    }

    return { userId: user.id };
  }
}
