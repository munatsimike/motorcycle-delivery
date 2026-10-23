import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hasAccountCredential } from './account-credential.js';
import { AccessTokenService, readBearerToken } from './access-token.service.js';

export type RiderContext = {
  userId: string;
  riderProfileId: string;
};

@Injectable()
export class RiderAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async authenticate(authorization: string | undefined, now = new Date()): Promise<RiderContext> {
    const claims = this.accessTokens.verify(readBearerToken(authorization), now);
    if (claims.role !== UserRole.RIDER && claims.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('Rider access is required');
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

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      include: { riderProfile: true },
    });
    if (
      !user
      || user.role !== claims.role
      || (user.role !== UserRole.RIDER && user.role !== UserRole.CUSTOMER)
      || user.accountStatus !== AccountStatus.ACTIVE
      || !hasAccountCredential(user)
      || !user.riderProfile
    ) {
      throw new ForbiddenException('Rider access is required');
    }

    return { userId: user.id, riderProfileId: user.riderProfile.id };
  }
}
