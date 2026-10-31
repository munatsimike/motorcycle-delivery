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
  INFOBIP_OTP_TTL_MS,
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
import { readRegistrationProof, signRegistrationProof } from './registration-proof.js';
import { hashSecret } from './token-hash.js';
import { readInfobipWhatsAppConfig, readWhatsAppVerificationConfig } from './whatsapp-verification.js';

const HOUR_MS = 60 * 60 * 1000;
const ALREADY_REGISTERED = 'Phone number is already registered';
const GENERIC_FAILURE = 'Authentication failed';

const accountInclude = {
  riderProfile: { select: { id: true, approvalStatus: true } },
  customerAccount: { select: { id: true } },
} satisfies Prisma.UserInclude;

type AccountRecord = Prisma.UserGetPayload<{ include: typeof accountInclude }>;

export type RiderRegistrationProof = {
  status: 'verified';
  registrationToken: string;
  fullName?: string;
  readOnly?: Array<'fullName'>;
};

export type RiderVerificationResult = AuthTokens | RiderRegistrationProof;

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
    if (role === AuthSubjectRole.RIDER) {
      await this.sendRiderCode(phone, AuthPurpose.WHATSAPP_REGISTRATION, remoteAddress);
      return { status: 'pending' };
    }
    const profile = readCustomerProfile(body);
    this.assertConfigured();
    const now = this.clock.now();
    await this.assertRegistrationSendAllowed(phone, role, hashSecret(remoteAddress), now);
    const user = await this.savePendingAccount(role, phone, profile, null, now);
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
    if (role === AuthSubjectRole.RIDER) {
      await this.resendRiderCode(phone, AuthPurpose.WHATSAPP_REGISTRATION, remoteAddress);
      return { status: 'pending' };
    }
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

  async verifyRegistration(role: AuthSubjectRole, body: unknown): Promise<RiderVerificationResult> {
    if (role === AuthSubjectRole.RIDER) {
      return this.finishRiderVerification(AuthPurpose.WHATSAPP_REGISTRATION, body);
    }
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
    const approved = await this.verification.check(phone, code, verificationContext(challenge));
    if (!approved) {
      await this.recordCheckFailure(challenge.id, challenge.checkAttempts, now);
      throw new UnauthorizedException('Verification code is invalid');
    }
    return this.activateRegistration(challenge.id, phone, role, now);
  }

  async startLogin(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<LoginStart> {
    const phone = readPhone(body);
    assertConsent(body);
    if (role === AuthSubjectRole.RIDER) {
      await this.sendRiderCode(phone, AuthPurpose.LOGIN, remoteAddress);
      return { status: 'pending' };
    }
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
    if (role === AuthSubjectRole.RIDER) {
      await this.resendRiderCode(phone, AuthPurpose.LOGIN, remoteAddress);
      return { status: 'pending' };
    }
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

  async verifyLogin(role: AuthSubjectRole, body: unknown): Promise<RiderVerificationResult> {
    if (role === AuthSubjectRole.RIDER) {
      return this.finishRiderVerification(AuthPurpose.LOGIN, body);
    }
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
    const approved = await this.verification.check(phone, code, verificationContext(challenge));
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

  async completeRiderRegistration(body: unknown): Promise<AuthTokens> {
    const details = readRiderAccount(body);
    const token = readRegistrationToken(body);
    this.assertConfigured();
    const now = this.clock.now();
    const claims = readRiderProof(token, now);
    const challenge = await this.prisma.authChallenge.findFirst({ where: { id: claims.challengeId } });
    if (!usableRiderProof(challenge, claims.phone)) {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    const consumed = await this.prisma.authChallenge.updateMany({
      where: { id: challenge.id, status: AuthChallengeStatus.VERIFIED },
      data: { status: AuthChallengeStatus.SUPERSEDED },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    try {
      return await this.prisma.$transaction((tx) => this.attachRiderProfile(tx, claims.phone, details, now));
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
  }

  private async sendRiderCode(phone: string, purpose: AuthPurpose, remoteAddress: string): Promise<void> {
    this.assertConfigured();
    const now = this.clock.now();
    if (purpose === AuthPurpose.LOGIN) {
      if (await this.loginSendBlocked(phone, AuthSubjectRole.RIDER, hashSecret(remoteAddress), now)) {
        throw new TooManyRequestsException();
      }
    } else {
      await this.assertRegistrationSendAllowed(phone, AuthSubjectRole.RIDER, hashSecret(remoteAddress), now);
    }
    await this.sendChallenge({
      phone,
      role: AuthSubjectRole.RIDER,
      purpose,
      remoteAddress,
      now,
      concealFailure: false,
    });
  }

  private async resendRiderCode(phone: string, purpose: AuthPurpose, remoteAddress: string): Promise<void> {
    this.assertConfigured();
    const now = this.clock.now();
    if (purpose === AuthPurpose.LOGIN) {
      if (await this.loginSendBlocked(phone, AuthSubjectRole.RIDER, hashSecret(remoteAddress), now)) {
        throw new TooManyRequestsException();
      }
    } else {
      await this.assertRegistrationSendAllowed(phone, AuthSubjectRole.RIDER, hashSecret(remoteAddress), now);
    }
    const prior = await this.prisma.authChallenge.findFirst({
      where: {
        phone,
        subjectRole: AuthSubjectRole.RIDER,
        purpose,
        channel: VerificationChannel.WHATSAPP,
        sendCount: { gt: 0 },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!prior) {
      await this.recordConcealed(phone, AuthSubjectRole.RIDER, purpose, hashSecret(remoteAddress), now);
      return;
    }
    await this.sendChallenge({
      phone,
      role: AuthSubjectRole.RIDER,
      purpose,
      remoteAddress,
      now,
      concealFailure: false,
    });
  }

  private async finishRiderVerification(purpose: AuthPurpose, body: unknown): Promise<RiderVerificationResult> {
    const phone = readPhone(body);
    const code = readCode(body, 'Verification code is invalid');
    this.assertConfigured();
    const now = this.clock.now();
    if (await this.locked(phone, AuthSubjectRole.RIDER, now)) {
      throw new TooManyRequestsException();
    }
    const challenge = await this.pendingChallenge(phone, AuthSubjectRole.RIDER, purpose, now);
    if (!challenge) {
      throw new UnauthorizedException('Verification code is invalid');
    }
    const approved = await this.verification.check(phone, code, verificationContext(challenge));
    if (!approved) {
      await this.recordCheckFailure(challenge.id, challenge.checkAttempts, now);
      throw new UnauthorizedException('Verification code is invalid');
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.authChallenge.updateMany({
        where: { id: challenge.id, status: AuthChallengeStatus.PENDING },
        data: { status: AuthChallengeStatus.VERIFIED },
      });
      if (consumed.count !== 1) {
        return { kind: 'invalid' as const };
      }
      const user = await tx.user.findUnique({ where: { phone }, include: accountInclude });
      if (riderAccessClosed(user)) {
        await tx.authChallenge.updateMany({
          where: { id: challenge.id, status: AuthChallengeStatus.VERIFIED },
          data: { status: AuthChallengeStatus.SUPERSEDED },
        });
        return { kind: 'denied' as const };
      }
      if (user?.riderProfile) {
        if (user.accountStatus !== AccountStatus.ACTIVE || user.phoneVerifiedAt === null || !user.whatsappConsentAt) {
          await tx.user.update({
            where: { id: user.id },
            data: {
              accountStatus: AccountStatus.ACTIVE,
              phoneVerifiedAt: user.phoneVerifiedAt ?? now,
              whatsappConsentAt: user.whatsappConsentAt ?? now,
            },
          });
        }
        const tokens = await this.sessions.issue(tx, user.id, user.role, now, { riderMembership: true });
        return { kind: 'session' as const, tokens };
      }
      return {
        kind: 'proof' as const,
        fullName: user && user.fullName.trim() !== '' ? user.fullName : undefined,
      };
    });
    if (outcome.kind === 'invalid') {
      throw new UnauthorizedException('Verification code is invalid');
    }
    if (outcome.kind === 'denied') {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    if (outcome.kind === 'session') {
      return outcome.tokens;
    }
    const proof: RiderRegistrationProof = {
      status: 'verified',
      registrationToken: signRegistrationProof(challenge.id, phone, now, 'rider-registration'),
    };
    if (outcome.fullName) {
      proof.fullName = outcome.fullName;
      proof.readOnly = ['fullName'];
    }
    return proof;
  }

  private async attachRiderProfile(
    tx: Prisma.TransactionClient,
    phone: string,
    details: { fullName: string; address: string },
    now: Date,
  ): Promise<AuthTokens> {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "phone" = ${phone} FOR UPDATE`;
    const existing = await tx.user.findUnique({ where: { phone }, include: accountInclude });
    if (riderAccessClosed(existing) || existing?.riderProfile) {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    let userId: string;
    let role: UserRole;
    if (!existing) {
      const created = await tx.user.create({
        data: {
          fullName: details.fullName,
          phone,
          role: UserRole.RIDER,
          accountStatus: AccountStatus.ACTIVE,
          phoneVerifiedAt: now,
          whatsappConsentAt: now,
        },
      });
      userId = created.id;
      role = UserRole.RIDER;
    } else {
      const data: Prisma.UserUpdateInput = {};
      if (!existing.phoneVerifiedAt) {
        data.phoneVerifiedAt = now;
      }
      if (existing.accountStatus === AccountStatus.PENDING) {
        data.accountStatus = AccountStatus.ACTIVE;
      }
      if (!existing.whatsappConsentAt) {
        data.whatsappConsentAt = now;
      }
      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: existing.id }, data });
      }
      userId = existing.id;
      role = existing.role;
    }
    const riderProfile = await tx.riderProfile.create({
      data: {
        userId,
        address: details.address,
        verificationStatus: RiderVerificationStatus.PENDING,
        approvalStatus: RiderApprovalStatus.PENDING,
        availability: RiderAvailability.OFFLINE,
      },
    });
    await createEmptyWallet(tx, riderProfile.id, now);
    return this.sessions.issue(tx, userId, role, now, { riderMembership: true });
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
    if (process.env.WHATSAPP_VERIFICATION_PROVIDER === 'infobip') {
      readInfobipWhatsAppConfig();
      return;
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
    rider: { fullName: string; address: string } | null,
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
          riderProfile: rider && existing.riderProfile ? {
            update: { address: rider.address },
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
              address: rider?.address,
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
        expiresAt: new Date(input.now.getTime() + challengeTtlMs()),
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
      const verification = await this.verification.send(input.phone, {
        challengeId: created.id,
        phone: input.phone,
        purpose: input.purpose,
        codeHash: null,
      });
      await this.prisma.authChallenge.update({
        where: { id: created.id },
        data: {
          twilioSid: verification.sid,
          codeHash: verification.codeHash ?? null,
        },
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

function challengeTtlMs(): number {
  if (devOtpAllowed()) {
    return DEV_OTP_TTL_MS;
  }
  if (process.env.WHATSAPP_VERIFICATION_PROVIDER === 'infobip') {
    return INFOBIP_OTP_TTL_MS;
  }
  return OTP_CHALLENGE_TTL_MS;
}

function verificationContext(challenge: { id: string; phone: string; purpose: string; codeHash?: string | null }) {
  return {
    challengeId: challenge.id,
    phone: challenge.phone,
    purpose: challenge.purpose,
    codeHash: challenge.codeHash ?? null,
  };
}

function canSignIn(user: AccountRecord | null, role: AuthSubjectRole): user is AccountRecord {
  if (!user || user.phoneVerifiedAt === null || user.accountStatus !== AccountStatus.ACTIVE) {
    return false;
  }
  if (role === AuthSubjectRole.RIDER) {
    return (user.role === UserRole.RIDER || user.role === UserRole.CUSTOMER) && user.riderProfile !== null;
  }
  return (user.role === UserRole.CUSTOMER || user.role === UserRole.RIDER) && user.customerAccount !== null;
}

function isPendingRegistration(user: AccountRecord, role: AuthSubjectRole): boolean {
  const sameRole = role === AuthSubjectRole.RIDER ? user.role === UserRole.RIDER : user.role === UserRole.CUSTOMER;
  return sameRole
    && user.accountStatus === AccountStatus.PENDING
    && user.phoneVerifiedAt === null
    && user.whatsappConsentAt !== null;
}

function readRiderProof(token: string, now: Date) {
  try {
    return readRegistrationProof(token, now, 'rider-registration');
  } catch (error) {
    if (error instanceof UnauthorizedException) {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    throw error;
  }
}

function readRegistrationToken(body: unknown): string {
  if (!isRecord(body) || typeof body.registrationToken !== 'string' || body.registrationToken.length < 20) {
    throw new UnauthorizedException(GENERIC_FAILURE);
  }
  return body.registrationToken;
}

function usableRiderProof(
  challenge: { id: string; phone: string; subjectRole: AuthSubjectRole; purpose: AuthPurpose; status: AuthChallengeStatus } | null,
  phone: string,
): challenge is { id: string; phone: string; subjectRole: AuthSubjectRole; purpose: AuthPurpose; status: AuthChallengeStatus } {
  return !!challenge
    && challenge.phone === phone
    && challenge.subjectRole === AuthSubjectRole.RIDER
    && challenge.status === AuthChallengeStatus.VERIFIED
    && (challenge.purpose === AuthPurpose.LOGIN || challenge.purpose === AuthPurpose.WHATSAPP_REGISTRATION);
}

function riderAccessClosed(user: AccountRecord | null): boolean {
  if (!user) {
    return false;
  }
  return user.role === UserRole.ADMIN
    || user.accountStatus === AccountStatus.SUSPENDED
    || user.accountStatus === AccountStatus.DEACTIVATED;
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

function readRiderAccount(body: unknown): { fullName: string; address: string } {
  if (!isRecord(body) || typeof body.fullName !== 'string') {
    throw new BadRequestException('Full name is required');
  }
  if (body.accountKind === 'BUSINESS' || body.businessName !== undefined) {
    throw new BadRequestException('Rider accounts are individual');
  }
  const address = readAddress(body.address);
  try {
    return { fullName: normalizePersonName(body.fullName), address };
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
