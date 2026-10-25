import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
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
  VerificationChannel,
} from '../generated/prisma/client.js';
import { readCustomerProfile } from '../customer/customer-profile.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createEmptyWallet } from '../rider/wallet-ledger.js';
import {
  DEV_OTP_TTL_MS,
  OTP_CHALLENGE_TTL_MS,
  OTP_COOLDOWN_MS,
  OTP_IP_HOURLY_LIMIT,
  OTP_LOCK_MS,
  OTP_MAX_CHECK_ATTEMPTS,
  OTP_PHONE_HOURLY_LIMIT,
} from './auth.constants.js';
import { devOtpAllowed, rejectDevOtpUnlessLocal } from './dev-otp.js';
import { Clock } from './clock.js';
import { InvalidPersonNameError, normalizePersonName } from './person-name.js';
import { InvalidPhoneNumberError, normalizeAuthPhone } from './phone-number.js';
import { PhoneVerificationProvider } from './phone-verification.provider.js';
import { readAddress } from '../customer/customer-profile.js';
import { SessionService, type AuthTokens } from './session.service.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { hashSecret } from './token-hash.js';
import { readWhatsAppVerificationConfig } from './whatsapp-verification.js';

const HOUR_MS = 60 * 60 * 1000;
const ALREADY_REGISTERED = 'Phone number is already registered';
const GENERIC_FAILURE = 'Authentication failed';

const accountInclude = {
  riderProfile: { select: { id: true, approvalStatus: true } },
  customerAccount: { select: { id: true } },
} satisfies Prisma.UserInclude;

type AccountRecord = Prisma.UserGetPayload<{ include: typeof accountInclude }>;

@Injectable()
export class WhatsAppAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly verification: PhoneVerificationProvider,
    private readonly clock: Clock,
  ) {}

  async startRegistration(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<{ status: 'pending' }> {
    const phone = readPhone(body);
    assertConsent(body);
    const profile = role === AuthSubjectRole.CUSTOMER ? readCustomerProfile(body) : null;
    const rider = role === AuthSubjectRole.RIDER ? readRiderAccount(body) : null;
    this.assertConfigured();
    const now = this.clock.now();
    await this.assertRegistrationSendAllowed(phone, role, hashSecret(remoteAddress), now);
    const user = await this.savePendingAccount(role, phone, profile, rider, now);
    await this.sendChallenge({
      phone,
      role,
      purpose: AuthPurpose.WHATSAPP_REGISTRATION,
      remoteAddress,
      now,
      concealFailure: false,
    });
    if (!user.whatsappConsentAt) {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    return { status: 'pending' };
  }

  async resendRegistration(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<{ status: 'pending' }> {
    const phone = readPhone(body);
    this.assertConfigured();
    const now = this.clock.now();
    await this.assertRegistrationSendAllowed(phone, role, hashSecret(remoteAddress), now);
    const user = await this.prisma.user.findUnique({ where: { phone }, include: accountInclude });
    if (!user || !isPendingRegistration(user, role)) {
      await this.recordConcealed(phone, role, AuthPurpose.WHATSAPP_REGISTRATION, hashSecret(remoteAddress), now);
      return { status: 'pending' };
    }
    await this.sendChallenge({
      phone,
      role,
      purpose: AuthPurpose.WHATSAPP_REGISTRATION,
      remoteAddress,
      now,
      concealFailure: false,
    });
    return { status: 'pending' };
  }

  async verifyRegistration(role: AuthSubjectRole, body: unknown): Promise<AuthTokens> {
    const phone = readPhone(body);
    const code = readCode(body, 'Verification code is invalid');
    this.assertConfigured();
    const now = this.clock.now();
    if (await this.locked(phone, role, now)) {
      throw new TooManyRequestsException();
    }
    const challenge = await this.pendingChallenge(phone, role, AuthPurpose.WHATSAPP_REGISTRATION, now);
    if (!challenge) {
      throw new UnauthorizedException('Verification code is invalid');
    }
    const approved = await this.verification.check(phone, code);
    if (!approved) {
      await this.recordCheckFailure(challenge.id, challenge.checkAttempts, now);
      throw new UnauthorizedException('Verification code is invalid');
    }
    return this.activateRegistration(challenge.id, phone, role, now);
  }

  async startLogin(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<LoginStart> {
    const phone = readPhone(body);
    assertConsent(body);
    this.assertConfigured();
    const now = this.clock.now();
    if (await this.loginSendBlocked(phone, role, hashSecret(remoteAddress), now)) {
      throw new TooManyRequestsException();
    }
    const user = await this.prisma.user.findUnique({ where: { phone }, include: accountInclude });
    if (!canSignIn(user, role)) {
      return { status: 'unavailable' };
    }
    if (!user.whatsappConsentAt) {
      await this.prisma.user.update({ where: { id: user.id }, data: { whatsappConsentAt: now } });
    }
    await this.sendChallenge({
      phone,
      role,
      purpose: AuthPurpose.LOGIN,
      remoteAddress,
      now,
      concealFailure: false,
    });
    return { status: 'pending' };
  }

  async resendLogin(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<LoginStart> {
    const phone = readPhone(body);
    this.assertConfigured();
    const now = this.clock.now();
    if (await this.loginSendBlocked(phone, role, hashSecret(remoteAddress), now)) {
      throw new TooManyRequestsException();
    }
    const user = await this.prisma.user.findUnique({ where: { phone }, include: accountInclude });
    if (!canSignIn(user, role)) {
      return { status: 'unavailable' };
    }
    await this.sendChallenge({
      phone,
      role,
      purpose: AuthPurpose.LOGIN,
      remoteAddress,
      now,
      concealFailure: false,
    });
    return { status: 'pending' };
  }

  async verifyLogin(role: AuthSubjectRole, body: unknown): Promise<AuthTokens> {
    const phone = readPhone(body);
    const code = readCode(body, 'Verification code is invalid');
    this.assertConfigured();
    const now = this.clock.now();
    if (await this.locked(phone, role, now)) {
      throw new TooManyRequestsException();
    }
    const challenge = await this.pendingChallenge(phone, role, AuthPurpose.LOGIN, now);
    if (!challenge) {
      throw new UnauthorizedException('Verification code is invalid');
    }
    const approved = await this.verification.check(phone, code);
    if (!approved) {
      await this.recordCheckFailure(challenge.id, challenge.checkAttempts, now);
      throw new UnauthorizedException('Verification code is invalid');
    }
    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authChallenge.updateMany({
        where: { id: challenge.id, status: AuthChallengeStatus.PENDING },
        data: { status: AuthChallengeStatus.VERIFIED },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException('Verification code is invalid');
      }
      const user = await tx.user.findUnique({ where: { phone }, include: accountInclude });
      if (!canSignIn(user, role)) {
        throw new UnauthorizedException('Verification code is invalid');
      }
      return this.sessions.issue(tx, user.id, user.role, now);
    });
  }

  private assertConfigured(): void {
    if (process.env.DEV_OTP_ENABLED === 'true') {
      try {
        rejectDevOtpUnlessLocal();
      } catch {
        throw new ServiceUnavailableException('WhatsApp verification is unavailable');
      }
      if (devOtpAllowed()) {
        return;
      }
      throw new ServiceUnavailableException('WhatsApp verification is unavailable');
    }
    readWhatsAppVerificationConfig();
  }

  private async assertRegistrationSendAllowed(phone: string, role: AuthSubjectRole, ipHash: string, now: Date): Promise<void> {
    if (await this.ipLimited(ipHash, now) || await this.phoneLimited(phone, role, now) || await this.coolingDown(phone, role, AuthPurpose.WHATSAPP_REGISTRATION, now) || await this.locked(phone, role, now)) {
      throw new TooManyRequestsException();
    }
  }

  private async loginSendBlocked(phone: string, role: AuthSubjectRole, ipHash: string, now: Date): Promise<boolean> {
    return await this.ipLimited(ipHash, now)
      || await this.phoneLimited(phone, role, now)
      || await this.coolingDown(phone, role, AuthPurpose.LOGIN, now)
      || await this.locked(phone, role, now);
  }

  private async savePendingAccount(
    role: AuthSubjectRole,
    phone: string,
    profile: ReturnType<typeof readCustomerProfile> | null,
    rider: { fullName: string } | null,
    now: Date,
  ) {
    const existing = await this.prisma.user.findUnique({ where: { phone }, include: accountInclude });
    if (existing) {
      if (!isPendingRegistration(existing, role)) {
        throw new ConflictException(ALREADY_REGISTERED);
      }
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName: profile?.personName ?? rider?.fullName ?? existing.fullName,
          whatsappConsentAt: now,
          customerAccount: profile && existing.customerAccount ? {
            update: {
              kind: profile.kind,
              name: profile.name,
              contactName: profile.contactName,
              address: profile.address,
              updatedAt: now,
            },
          } : undefined,
        },
        include: accountInclude,
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            fullName: profile?.personName ?? rider?.fullName ?? '',
            phone,
            role: role === AuthSubjectRole.RIDER ? UserRole.RIDER : UserRole.CUSTOMER,
            accountStatus: AccountStatus.PENDING,
            phoneVerifiedAt: null,
            whatsappConsentAt: now,
          },
        });
        if (role === AuthSubjectRole.RIDER) {
          const riderProfile = await tx.riderProfile.create({
            data: {
              userId: user.id,
              verificationStatus: RiderVerificationStatus.PENDING,
              approvalStatus: RiderApprovalStatus.PENDING,
              availability: RiderAvailability.OFFLINE,
            },
          });
          await createEmptyWallet(tx, riderProfile.id, now);
        } else if (profile) {
          await tx.customerAccount.create({
            data: {
              userId: user.id,
              kind: profile.kind,
              name: profile.name,
              contactName: profile.contactName,
              address: profile.address,
              updatedAt: now,
            },
          });
        }
        return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: accountInclude });
      });
    } catch (error) {
      if (!isUniquePhone(error)) {
        throw error;
      }
      const raced = await this.prisma.user.findUnique({ where: { phone }, include: accountInclude });
      if (!raced || !isPendingRegistration(raced, role)) {
        throw new ConflictException(ALREADY_REGISTERED);
      }
      return raced;
    }
  }

  private async activateRegistration(challengeId: string, phone: string, role: AuthSubjectRole, now: Date): Promise<AuthTokens> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.authChallenge.updateMany({
          where: { id: challengeId, status: AuthChallengeStatus.PENDING },
          data: { status: AuthChallengeStatus.VERIFIED },
        });
        if (consumed.count !== 1) {
          throw new UnauthorizedException('Verification code is invalid');
        }
        const user = await tx.user.findUnique({ where: { phone }, include: accountInclude });
        if (!user || !isPendingRegistration(user, role) || !user.whatsappConsentAt) {
          throw new UnauthorizedException('Verification code is invalid');
        }
        await tx.user.update({
          where: { id: user.id },
          data: {
            accountStatus: AccountStatus.ACTIVE,
            phoneVerifiedAt: now,
          },
        });
        return this.sessions.issue(tx, user.id, user.role, now);
      });
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ConflictException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new UnauthorizedException('Verification code is invalid');
    }
  }

  private async sendChallenge(input: {
    phone: string;
    role: AuthSubjectRole;
    purpose: AuthPurpose;
    remoteAddress: string;
    now: Date;
    concealFailure: boolean;
  }): Promise<void> {
    const created = await this.prisma.authChallenge.create({
      data: {
        phone: input.phone,
        subjectRole: input.role,
        purpose: input.purpose,
        channel: VerificationChannel.WHATSAPP,
        status: AuthChallengeStatus.PENDING,
        sendCount: 1,
        expiresAt: new Date(input.now.getTime() + (devOtpAllowed() ? DEV_OTP_TTL_MS : OTP_CHALLENGE_TTL_MS)),
        ipHash: hashSecret(input.remoteAddress),
        createdAt: input.now,
      },
    });
    await this.prisma.authChallenge.updateMany({
      where: {
        phone: input.phone,
        subjectRole: input.role,
        purpose: input.purpose,
        channel: VerificationChannel.WHATSAPP,
        status: AuthChallengeStatus.PENDING,
        id: { not: created.id },
      },
      data: { status: AuthChallengeStatus.SUPERSEDED },
    });
    try {
      const verification = await this.verification.send(input.phone);
      await this.prisma.authChallenge.update({
        where: { id: created.id },
        data: { twilioSid: verification.sid },
      });
    } catch (error) {
      await this.prisma.authChallenge.update({
        where: { id: created.id },
        data: { status: AuthChallengeStatus.SUPERSEDED },
      });
      if (input.concealFailure) {
        return;
      }
      throw error;
    }
  }

  private async pendingChallenge(phone: string, role: AuthSubjectRole, purpose: AuthPurpose, now: Date) {
    const challenge = await this.prisma.authChallenge.findFirst({
      where: {
        phone,
        subjectRole: role,
        purpose,
        channel: VerificationChannel.WHATSAPP,
        status: AuthChallengeStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) {
      return null;
    }
    if (challenge.expiresAt <= now) {
      await this.prisma.authChallenge.update({
        where: { id: challenge.id },
        data: { status: AuthChallengeStatus.EXPIRED },
      });
      return null;
    }
    return challenge;
  }

  private async recordCheckFailure(challengeId: string, previousAttempts: number, now: Date): Promise<void> {
    const attempts = previousAttempts + 1;
    const locked = attempts >= OTP_MAX_CHECK_ATTEMPTS;
    await this.prisma.authChallenge.update({
      where: { id: challengeId },
      data: {
        checkAttempts: attempts,
        status: locked ? AuthChallengeStatus.LOCKED : AuthChallengeStatus.PENDING,
        lockedUntil: locked ? new Date(now.getTime() + OTP_LOCK_MS) : null,
      },
    });
  }

  private async recordConcealed(phone: string, role: AuthSubjectRole, purpose: AuthPurpose, ipHash: string, now: Date): Promise<void> {
    await this.prisma.authChallenge.create({
      data: {
        phone,
        subjectRole: role,
        purpose,
        channel: VerificationChannel.WHATSAPP,
        status: AuthChallengeStatus.SUPERSEDED,
        sendCount: 0,
        expiresAt: now,
        ipHash,
        createdAt: now,
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

  private async coolingDown(phone: string, role: AuthSubjectRole, purpose: AuthPurpose, now: Date): Promise<boolean> {
    const latest = await this.prisma.authChallenge.findFirst({
      where: {
        phone,
        subjectRole: role,
        purpose,
        channel: VerificationChannel.WHATSAPP,
        sendCount: { gt: 0 },
      },
      orderBy: { createdAt: 'desc' },
    });
    return !!latest && now.getTime() - latest.createdAt.getTime() < OTP_COOLDOWN_MS;
  }

  private async locked(phone: string, role: AuthSubjectRole, now: Date): Promise<boolean> {
    const challenge = await this.prisma.authChallenge.findFirst({
      where: {
        phone,
        subjectRole: role,
        status: AuthChallengeStatus.LOCKED,
        lockedUntil: { gt: now },
      },
    });
    return challenge !== null;
  }
}

type LoginStart = { status: 'pending' } | { status: 'unavailable' };

function canSignIn(user: AccountRecord | null, role: AuthSubjectRole): user is AccountRecord {
  if (!user || user.phoneVerifiedAt === null || user.accountStatus !== AccountStatus.ACTIVE) {
    return false;
  }
  if (role === AuthSubjectRole.RIDER) {
    return user.role === UserRole.RIDER && user.riderProfile !== null;
  }
  return user.role === UserRole.CUSTOMER && user.customerAccount !== null;
}

function isPendingRegistration(user: AccountRecord, role: AuthSubjectRole): boolean {
  const sameRole = role === AuthSubjectRole.RIDER ? user.role === UserRole.RIDER : user.role === UserRole.CUSTOMER;
  return sameRole
    && user.accountStatus === AccountStatus.PENDING
    && user.phoneVerifiedAt === null
    && user.whatsappConsentAt !== null;
}

function assertConsent(body: unknown): void {
  if (!isRecord(body) || body.whatsappConsent !== true) {
    throw new BadRequestException('Consent to WhatsApp authentication messages is required');
  }
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

function readRiderAccount(body: unknown): { fullName: string } {
  if (!isRecord(body) || typeof body.fullName !== 'string') {
    throw new BadRequestException('Full name is required');
  }
  if (body.accountKind === 'BUSINESS' || body.businessName !== undefined) {
    throw new BadRequestException('Rider accounts are individual');
  }
  readAddress(body.address);
  try {
    return { fullName: normalizePersonName(body.fullName) };
  } catch (error) {
    if (error instanceof InvalidPersonNameError) {
      throw new BadRequestException('Full name is required');
    }
    throw error;
  }
}

function readCode(body: unknown, invalidMessage: string): string {
  if (!isRecord(body) || !Object.prototype.hasOwnProperty.call(body, 'code')) {
    throw new UnauthorizedException(invalidMessage);
  }
  const code = body.code;
  delete body.code;
  if (typeof code !== 'string' || !/^\d{4,10}$/.test(code)) {
    throw new UnauthorizedException(invalidMessage);
  }
  return code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniquePhone(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
