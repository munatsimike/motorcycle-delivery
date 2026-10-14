import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionService } from './session.service.js';
import { AdminOtpEmailService } from './admin-otp-email.service.js';
import { AdminLoginRateLimitService } from './admin-login-rate-limit.service.js';
import { AdminOtpChallengeService } from './admin-otp-challenge.service.js';
import { parseAdminVerifyRequest } from './admin-login.validation.js';
import { verifyAdminOtp } from './admin-otp-code.js';
import { ADMIN_OTP_MAX_ATTEMPTS } from './admin-login.constants.js';
import { parseAdminLoginRequest } from './admin-login.validation.js';
import { verifyAdminPassword } from './admin-password.js';
import { AccountStatus, UserRole } from '../generated/prisma/client.js';

const DUMMY_ADMIN_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$r6lPP6svlzXwR/O2eN92Zg$ZAAXJm/5tPG9ttpWD2BODDyYijIm+I4pzdEc4Jkab3Q';

@Injectable()
export class AdminLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly emailSender: AdminOtpEmailService,
    private readonly rateLimiter: AdminLoginRateLimitService,
    private readonly challenges: AdminOtpChallengeService,
  ) {}

  async startLogin(body: unknown, ipAddress: string) {
    await this.rateLimiter.checkAndRecord(ipAddress);

    const { email, password } = parseAdminLoginRequest(body);

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    const validAdmin =
      user !== null &&
      user.role === UserRole.ADMIN &&
      user.accountStatus === AccountStatus.ACTIVE &&
      typeof user.passwordHash === 'string';

    const passwordHash = validAdmin
      ? user.passwordHash!
      : DUMMY_ADMIN_PASSWORD_HASH;

    const passwordValid = await verifyAdminPassword(passwordHash, password);

    if (!validAdmin || !passwordValid) {
      throw new UnauthorizedException('Authentication failed');
    }

    const challenge = await this.challenges.create(user!.id);

    if (!challenge) {
      throw new UnauthorizedException('Authentication failed');
    }

    try {
      await this.emailSender.sendCode(user!.email!, challenge.code);
    } catch (error) {
      await this.prisma.adminLoginChallenge.updateMany({
        where: {
          id: challenge.challengeId,
          consumedAt: null,
        },
        data: {
          consumedAt: new Date(),
        },
      });
      throw error;
    }

    return {
      status: 'pending' as const,
      challengeId: challenge.challengeId,
    };
  }

  async verifyLogin(body: unknown, ipAddress: string) {
    await this.rateLimiter.checkAndRecord(ipAddress);

    const { challengeId, code } = parseAdminVerifyRequest(body);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`admin-otp-verify:${challengeId}`}, 0)
        )::text AS lock_result
      `;

      const now = new Date();

      const challenge = await tx.adminLoginChallenge.findUnique({
        where: { id: challengeId },
      });

      if (
        !challenge ||
        challenge.consumedAt !== null ||
        challenge.expiresAt <= now ||
        challenge.checkAttempts >= ADMIN_OTP_MAX_ATTEMPTS
      ) {
        return null;
      }

      if (!verifyAdminOtp(challenge.id, code, challenge.codeHash)) {
        await tx.adminLoginChallenge.update({
          where: { id: challenge.id },
          data: {
            checkAttempts: { increment: 1 },
          },
        });

        return null;
      }

      const user = await tx.user.findUnique({
        where: { id: challenge.adminUserId },
      });

      if (
        !user ||
        user.role !== UserRole.ADMIN ||
        user.accountStatus !== AccountStatus.ACTIVE ||
        !user.passwordHash ||
        !user.email
      ) {
        return null;
      }

      await tx.adminLoginChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });

      return this.sessions.issue(tx, user.id, UserRole.ADMIN, now);
    });

    if (!result) {
      throw new UnauthorizedException('Verification code is invalid');
    }

    return result;
  }
}







