import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountStatus,
  AuthChallengeStatus,
  AuthPurpose,
  AuthSubjectRole,
  Prisma,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
  UserRole,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  OTP_CHALLENGE_TTL_MS,
  OTP_COOLDOWN_MS,
  OTP_IP_HOURLY_LIMIT,
  OTP_LOCK_MS,
  OTP_MAX_CHECK_ATTEMPTS,
  OTP_PHONE_HOURLY_LIMIT,
} from './auth.constants.js';
import { Clock } from './clock.js';
import { InvalidPersonNameError, normalizePersonName } from './person-name.js';
import { InvalidPhoneNumberError, normalizeAuthPhone } from './phone-number.js';
import { SessionService, type AuthTokens } from './session.service.js';
import { hashSecret } from './token-hash.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { TwilioVerifyClient } from './twilio-verify.client.js';

const HOUR_MS = 60 * 60 * 1000;

type ChallengeRecord = {
  id: string;
  phone: string;
  subjectRole: AuthSubjectRole;
  purpose: AuthPurpose;
  fullName: string | null;
  status: AuthChallengeStatus;
  checkAttempts: number;
  expiresAt: Date;
  createdAt: Date;
  lockedUntil: Date | null;
};

@Injectable()
export class OtpAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly twilio: TwilioVerifyClient,
    private readonly sessions: SessionService,
    private readonly clock: Clock,
  ) {}

  startRegistration(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<{ status: 'pending' }> {
    const phone = readPhone(body);
    const fullName = readFullName(body);
    return this.start({ role, purpose: AuthPurpose.REGISTRATION, phone, fullName, remoteAddress });
  }

  startLogin(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<{ status: 'pending' }> {
    const phone = readPhone(body);
    return this.start({ role, purpose: AuthPurpose.LOGIN, phone, fullName: null, remoteAddress });
  }

  verifyRegistration(role: AuthSubjectRole, body: unknown): Promise<AuthTokens> {
    return this.verify(role, AuthPurpose.REGISTRATION, body);
  }

  verifyLogin(role: AuthSubjectRole, body: unknown): Promise<AuthTokens> {
    return this.verify(role, AuthPurpose.LOGIN, body);
  }

  private async start(input: {
    role: AuthSubjectRole;
    purpose: AuthPurpose;
    phone: string;
    fullName: string | null;
    remoteAddress: string;
  }): Promise<{ status: 'pending' }> {
    const now = this.clock.now();
    const ipHash = hashSecret(input.remoteAddress);
    if (await this.ipLimited(ipHash, now)) {
      if (input.purpose === AuthPurpose.LOGIN) {
        return this.conceal();
      }
      throw new TooManyRequestsException('Too many verification attempts. Try again later.');
    }

    if (input.purpose === AuthPurpose.LOGIN) {
      const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
      if (!canLogin(user, input.role)) {
        await this.recordProbe(input, ipHash, now);
        return this.conceal();
      }
    }

    if (await this.phoneLimited(input.phone, input.role, now) || await this.coolingDown(input, now) || await this.locked(input.phone, input.role, now)) {
      if (input.purpose === AuthPurpose.LOGIN) {
        return this.conceal();
      }
      throw new TooManyRequestsException('Too many verification attempts. Try again later.');
    }

    if (input.purpose === AuthPurpose.REGISTRATION) {
      const existing = await this.prisma.user.findUnique({ where: { phone: input.phone } });
      if (existing) {
        throw new ConflictException('Phone number is already registered');
      }
    }

    await this.sendChallenge(input, ipHash, now);
    return { status: 'pending' };
  }

  private async verify(role: AuthSubjectRole, purpose: AuthPurpose, body: unknown): Promise<AuthTokens> {
    const phone = readPhone(body);
    const code = readCode(body);
    const now = this.clock.now();
    if (await this.locked(phone, role, now)) {
      throw new TooManyRequestsException('Too many verification attempts. Try again later.');
    }

    const challenge = await this.prisma.authChallenge.findFirst({
      where: { phone, subjectRole: role, purpose, status: AuthChallengeStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      throw new UnauthorizedException('Verification code is invalid');
    }
    if (challenge.expiresAt <= now) {
      await this.prisma.authChallenge.update({
        where: { id: challenge.id },
        data: { status: AuthChallengeStatus.EXPIRED },
      });
      throw new UnauthorizedException('Verification code is invalid');
    }

    const approved = await this.twilio.checkVerification(phone, code);
    if (!approved) {
      await this.recordFailure(challenge, now);
      throw new UnauthorizedException('Verification code is invalid');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.authChallenge.updateMany({
          where: { id: challenge.id, status: AuthChallengeStatus.PENDING },
          data: { status: AuthChallengeStatus.VERIFIED },
        });
        if (consumed.count !== 1) {
          throw new UnauthorizedException('Verification code is invalid');
        }

        const user = purpose === AuthPurpose.REGISTRATION
          ? await this.createRiderOrCustomer(tx, challenge, role, now)
          : await tx.user.findUnique({ where: { phone } });
        if (!user || !canLogin(user, role)) {
          throw new UnauthorizedException('Authentication failed');
        }
        return this.sessions.issue(tx, user.id, user.role, now);
      });
    } catch (error) {
      if (isUniquePhone(error)) {
        throw new ConflictException('Phone number is already registered');
      }
      throw error;
    }
  }

  private async createRiderOrCustomer(
    tx: Prisma.TransactionClient,
    challenge: ChallengeRecord,
    role: AuthSubjectRole,
    now: Date,
  ) {
    if (!challenge.fullName) {
      throw new UnauthorizedException('Verification code is invalid');
    }
    const user = await tx.user.create({
      data: {
        fullName: challenge.fullName,
        phone: challenge.phone,
        role: role === AuthSubjectRole.CUSTOMER ? UserRole.CUSTOMER : UserRole.RIDER,
        accountStatus: AccountStatus.ACTIVE,
        phoneVerifiedAt: now,
        passwordHash: null,
      },
    });
    if (role === AuthSubjectRole.RIDER) {
      await tx.riderProfile.create({
        data: {
          userId: user.id,
          verificationStatus: RiderVerificationStatus.PENDING,
          approvalStatus: RiderApprovalStatus.PENDING,
          availability: RiderAvailability.OFFLINE,
        },
      });
    }
    return user;
  }

  private async sendChallenge(
    input: { role: AuthSubjectRole; purpose: AuthPurpose; phone: string; fullName: string | null },
    ipHash: string,
    now: Date,
  ): Promise<void> {
    const created = await this.prisma.authChallenge.create({
      data: {
        phone: input.phone,
        subjectRole: input.role,
        purpose: input.purpose,
        fullName: input.fullName,
        status: AuthChallengeStatus.PENDING,
        sendCount: 1,
        expiresAt: new Date(now.getTime() + OTP_CHALLENGE_TTL_MS),
        ipHash,
        createdAt: now,
      },
    });
    await this.prisma.authChallenge.updateMany({
      where: {
        phone: input.phone,
        subjectRole: input.role,
        purpose: input.purpose,
        status: AuthChallengeStatus.PENDING,
        id: { not: created.id },
      },
      data: { status: AuthChallengeStatus.SUPERSEDED },
    });
    try {
      const verification = await this.twilio.startVerification(input.phone);
      await this.prisma.authChallenge.update({
        where: { id: created.id },
        data: { twilioSid: verification.sid },
      });
    } catch (error) {
      await this.prisma.authChallenge.update({
        where: { id: created.id },
        data: { status: AuthChallengeStatus.SUPERSEDED },
      });
      throw error;
    }
  }

  private async recordProbe(
    input: { role: AuthSubjectRole; phone: string },
    ipHash: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.authChallenge.create({
      data: {
        phone: input.phone,
        subjectRole: input.role,
        purpose: AuthPurpose.LOGIN,
        status: AuthChallengeStatus.SUPERSEDED,
        sendCount: 0,
        expiresAt: now,
        ipHash,
        createdAt: now,
      },
    });
  }

  private async recordFailure(challenge: ChallengeRecord, now: Date): Promise<void> {
    const attempts = challenge.checkAttempts + 1;
    const locked = attempts >= OTP_MAX_CHECK_ATTEMPTS;
    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: {
        checkAttempts: attempts,
        status: locked ? AuthChallengeStatus.LOCKED : AuthChallengeStatus.PENDING,
        lockedUntil: locked ? new Date(now.getTime() + OTP_LOCK_MS) : null,
      },
    });
  }

  private async ipLimited(ipHash: string, now: Date): Promise<boolean> {
    const attempts = await this.prisma.authChallenge.count({
      where: { ipHash, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    });
    return attempts >= OTP_IP_HOURLY_LIMIT;
  }

  private async phoneLimited(phone: string, role: AuthSubjectRole, now: Date): Promise<boolean> {
    const sends = await this.prisma.authChallenge.count({
      where: {
        phone,
        subjectRole: role,
        twilioSid: { not: null },
        createdAt: { gte: new Date(now.getTime() - HOUR_MS) },
      },
    });
    return sends >= OTP_PHONE_HOURLY_LIMIT;
  }

  private async coolingDown(
    input: { phone: string; role: AuthSubjectRole; purpose: AuthPurpose },
    now: Date,
  ): Promise<boolean> {
    const latest = await this.prisma.authChallenge.findFirst({
      where: { phone: input.phone, subjectRole: input.role, purpose: input.purpose, sendCount: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
    });
    return !!latest && now.getTime() - latest.createdAt.getTime() < OTP_COOLDOWN_MS;
  }

  private async locked(phone: string, role: AuthSubjectRole, now: Date): Promise<boolean> {
    const challenge = await this.prisma.authChallenge.findFirst({
      where: { phone, subjectRole: role, status: AuthChallengeStatus.LOCKED, lockedUntil: { gt: now } },
    });
    return challenge !== null;
  }

  private async conceal(): Promise<{ status: 'pending' }> {
    await this.clock.pause(this.clock.concealmentMs);
    return { status: 'pending' };
  }
}

function canLogin(
  user: { role: UserRole; accountStatus: AccountStatus; phoneVerifiedAt: Date | null } | null,
  role: AuthSubjectRole,
): boolean {
  return !!user
    && user.role === role
    && user.accountStatus === AccountStatus.ACTIVE
    && user.phoneVerifiedAt !== null;
}

function readPhone(body: unknown): string {
  if (!isRecord(body) || typeof body.phone !== 'string') {
    throw new BadRequestException('Enter a valid Zimbabwe mobile number');
  }
  try {
    return normalizeAuthPhone(body.phone);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

function readFullName(body: unknown): string {
  if (!isRecord(body) || typeof body.fullName !== 'string') {
    throw new BadRequestException('Full name is required');
  }
  try {
    return normalizePersonName(body.fullName);
  } catch (error) {
    if (error instanceof InvalidPersonNameError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

function readCode(body: unknown): string {
  if (!isRecord(body) || typeof body.code !== 'string' || !/^\d{4,10}$/.test(body.code)) {
    throw new BadRequestException('Verification code is invalid');
  }
  return body.code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniquePhone(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
