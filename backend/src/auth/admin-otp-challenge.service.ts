import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { adminOtpRequestAllowed } from './admin-login-limits.js';
import { generateAdminOtp, hashAdminOtp } from './admin-otp-code.js';
import { ADMIN_OTP_TTL_MS } from './admin-login.constants.js';

@Injectable()
export class AdminOtpChallengeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminUserId: string): Promise<{
    challengeId: string;
    code: string;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize OTP creation for this administrator.
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`admin-otp:${adminUserId}`}, 0)
        )::text AS lock_result
      `;

      const now = new Date();

      const recent = await tx.adminLoginChallenge.findMany({
        where: {
          adminUserId,
          createdAt: {
            gte: new Date(now.getTime() - 60 * 60 * 1000),
          },
        },
        select: { createdAt: true },
      });

      if (!adminOtpRequestAllowed(recent, now)) {
        return null;
      }

      const challengeId = randomUUID();
      const code = generateAdminOtp();

      await tx.adminLoginChallenge.create({
        data: {
          id: challengeId,
          adminUserId,
          codeHash: hashAdminOtp(challengeId, code),
          expiresAt: new Date(now.getTime() + ADMIN_OTP_TTL_MS),
          createdAt: now,
        },
      });

      return { challengeId, code };
    });
  }
}

