import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';

const HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_HOUR = 10;

@Injectable()
export class AdminLoginRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async checkAndRecord(ipAddress: string): Promise<void> {
    const secret = process.env.ADMIN_OTP_HMAC_SECRET;

    if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('Admin login rate limiting is not configured');
    }

    const ipHash = createHmac('sha256', secret)
      .update(`admin-login-ip:${ipAddress}`)
      .digest('hex');

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Serialize checks for the same IP across concurrent requests.
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${ipHash}, 0)
        )::text AS lock_result
      `;

      const attempts = await tx.adminLoginAttempt.count({
        where: {
          ipHash,
          createdAt: {
            gte: new Date(now.getTime() - HOUR_MS),
          },
        },
      });

      if (attempts >= MAX_ATTEMPTS_PER_HOUR) {
        throw new TooManyRequestsException(
          'Too many login attempts. Try again later.',
        );
      }

      await tx.adminLoginAttempt.create({
        data: {
          ipHash,
          createdAt: now,
        },
      });
    });
  }
}

