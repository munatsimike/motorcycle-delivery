import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService, readBearerToken } from './access-token.service.js';

export type CustomerSession = {
  userId: string;
  role: typeof UserRole.RIDER | typeof UserRole.CUSTOMER;
};

export type CustomerContext = CustomerSession & {
  customerAccountId: string;
};

@Injectable()
export class CustomerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async authenticate(authorization: string | undefined, now = new Date()): Promise<CustomerSession> {
    const user = await this.verifiedUser(authorization, now);
    return { userId: user.id, role: this.customerRole(user.role) };
  }

  async authenticateAccount(authorization: string | undefined, now = new Date()): Promise<CustomerContext> {
    const user = await this.verifiedUser(authorization, now);
    if (!user.customerAccount) {
      throw new ForbiddenException('Customer access is required');
    }
    return { userId: user.id, role: this.customerRole(user.role), customerAccountId: user.customerAccount.id };
  }

  private customerRole(role: UserRole): CustomerSession['role'] {
    if (role === UserRole.RIDER || role === UserRole.CUSTOMER) return role;
    throw new ForbiddenException('Customer access is required');
  }

  private async verifiedUser(authorization: string | undefined, now: Date) {
    const claims = this.accessTokens.verify(readBearerToken(authorization), now);
    if (claims.role !== UserRole.RIDER && claims.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('Customer access is required');
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
      include: { customerAccount: true },
    });
    if (!user || user.role !== claims.role) {
      throw new UnauthorizedException('Authentication failed');
    }
    if (
      (user.role !== UserRole.RIDER && user.role !== UserRole.CUSTOMER)
      || user.accountStatus !== AccountStatus.ACTIVE
      || user.phoneVerifiedAt === null
    ) {
      throw new ForbiddenException('Customer access is required');
    }
    return user;
  }
}
