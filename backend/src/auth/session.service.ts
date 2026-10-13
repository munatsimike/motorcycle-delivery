import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountStatus, Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import { REFRESH_ABSOLUTE_MS, REFRESH_IDLE_MS } from './auth.constants.js';
import { hashSecret, newRefreshToken } from './token-hash.js';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

type SessionWriter = Prisma.TransactionClient;

type AllowedUser = {
  id: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
};

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async issue(writer: SessionWriter, userId: string, role: UserRole, now = new Date()): Promise<AuthTokens> {
    const created = await this.insertSession(writer, {
      userId,
      familyId: randomUUID(),
      familyExpiresAt: new Date(now.getTime() + REFRESH_ABSOLUTE_MS),
      now,
    });
    return this.tokens(userId, role, created, now);
  }

  async refresh(rawToken: string): Promise<AuthTokens> {
    if (rawToken.length < 20 || rawToken.length > 200) {
      throw new UnauthorizedException('Authentication failed');
    }
    const tokenHash = hashSecret(rawToken);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.refreshSession.findUnique({ where: { tokenHash } });
      if (!current) {
        throw new UnauthorizedException('Authentication failed');
      }
      const now = new Date();
      if (current.revokedAt || current.replacedBySessionId) {
        await tx.refreshSession.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        throw new UnauthorizedException('Authentication failed');
      }

      const user = await tx.user.findUnique({ where: { id: current.userId } });
      const expired = current.expiresAt <= now || current.familyExpiresAt <= now;
      if (!user || !sessionAllowed(user) || expired) {
        await tx.refreshSession.updateMany({
          where: { userId: current.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        throw new UnauthorizedException('Authentication failed');
      }

      const claimed = await tx.refreshSession.updateMany({
        where: { id: current.id, revokedAt: null, replacedBySessionId: null },
        data: { revokedAt: now },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException('Authentication failed');
      }

      const created = await this.insertSession(tx, {
        userId: current.userId,
        familyId: current.familyId,
        familyExpiresAt: current.familyExpiresAt,
        now,
      });
      await tx.refreshSession.update({
        where: { id: current.id },
        data: { replacedBySessionId: created.id },
      });
      return this.tokens(user.id, user.role, created, now);
    });
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async insertSession(
    writer: SessionWriter,
    input: { userId: string; familyId: string; familyExpiresAt: Date; now: Date },
  ): Promise<{ id: string; rawToken: string; expiresAt: Date }> {
    const rawToken = newRefreshToken();
    const idleExpiry = new Date(input.now.getTime() + REFRESH_IDLE_MS);
    const expiresAt = idleExpiry < input.familyExpiresAt ? idleExpiry : input.familyExpiresAt;
    const session = await writer.refreshSession.create({
      data: {
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: hashSecret(rawToken),
        expiresAt,
        familyExpiresAt: input.familyExpiresAt,
      },
    });
    return { id: session.id, rawToken, expiresAt };
  }

  private tokens(
    userId: string,
    role: UserRole,
    created: { id: string; rawToken: string; expiresAt: Date },
    now: Date,
  ): AuthTokens {
    const access = this.accessTokens.sign({ sub: userId, role, sid: created.id }, now);
    return {
      accessToken: access.token,
      refreshToken: created.rawToken,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshTokenExpiresAt: created.expiresAt.toISOString(),
    };
  }
}

function sessionAllowed(user: AllowedUser): boolean {
  if (user.accountStatus !== AccountStatus.ACTIVE) {
    return false;
  }
  if (user.role === UserRole.RIDER || user.role === UserRole.CUSTOMER) {
    return user.phoneVerifiedAt !== null;
  }
  return true;
}
