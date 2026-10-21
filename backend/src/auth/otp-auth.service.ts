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
  CustomerAccountKind,
  Prisma,
  RiderApprovalStatus,
  RiderAvailability,
  RiderVerificationStatus,
  UserRole,
} from '../generated/prisma/client.js';
import { readAddress, readCustomerProfile, type CustomerProfileInput } from '../customer/customer-profile.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  OTP_CHALLENGE_TTL_MS,
  OTP_COOLDOWN_MS,
  OTP_IP_HOURLY_LIMIT,
  OTP_LOCK_MS,
  OTP_MAX_CHECK_ATTEMPTS,
  OTP_PHONE_HOURLY_LIMIT,
} from './auth.constants.js';
import { createEmptyWallet } from '../rider/wallet-ledger.js';
import { Clock } from './clock.js';
import { InvalidPersonNameError, normalizePersonName } from './person-name.js';
import { InvalidPhoneNumberError, normalizeAuthPhone } from './phone-number.js';
import { readRegistrationProof, signRegistrationProof, type RegistrationProof } from './registration-proof.js';
import { SessionService, type AuthTokens } from './session.service.js';
import { hashSecret } from './token-hash.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { TwilioVerifyClient } from './twilio-verify.client.js';

const HOUR_MS = 60 * 60 * 1000;
const SIGN_IN_INSTEAD = 'Sign in to your existing account';
const identityInclude = {
  riderProfile: { select: { id: true } },
  customerAccount: { select: { id: true, address: true } },
} satisfies Prisma.UserInclude;

type AccountIdentity = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  riderProfile: { id: string } | null;
  customerAccount: { id: string; address: string } | null;
};

type ChallengeRecord = {
  id: string;
  phone: string;
  subjectRole: AuthSubjectRole;
  purpose: AuthPurpose;
  fullName: string | null;
  accountKind: CustomerAccountKind | null;
  address: string | null;
  businessName: string | null;
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

  async startRegistration(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<{ status: 'pending' }> {
    const phone = readPhone(body);
    const phoneOnly = (role === AuthSubjectRole.CUSTOMER || role === AuthSubjectRole.RIDER) && isPhoneOnlyRegistration(body);
    const profile = phoneOnly || role !== AuthSubjectRole.CUSTOMER ? null : readCustomerProfile(body);
    const fullName = phoneOnly ? null : profile ? profile.personName : readFullName(body);
    const result = await this.start({ role, purpose: AuthPurpose.REGISTRATION, phone, fullName, profile, remoteAddress });
    if (result.status !== 'pending') {
      throw new UnauthorizedException('Authentication failed');
    }
    return result;
  }

  startLogin(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<LoginStart> {
    const phone = readPhone(body);
    return this.start({ role, purpose: AuthPurpose.LOGIN, phone, fullName: null, profile: null, remoteAddress });
  }

  verifyRegistration(role: AuthSubjectRole, body: unknown): Promise<AuthTokens | RegistrationProof> {
    return this.verify(role, AuthPurpose.REGISTRATION, body);
  }

  async verifyLogin(role: AuthSubjectRole, body: unknown): Promise<AuthTokens> {
    const result = await this.verify(role, AuthPurpose.LOGIN, body);
    if (!('accessToken' in result)) {
      throw new UnauthorizedException('Authentication failed');
    }
    return result;
  }

  async completeCustomerRegistration(body: unknown): Promise<AuthTokens> {
    const token = readRegistrationToken(body);
    const claims = readRegistrationProof(token, this.clock.now());
    const now = this.clock.now();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const challenge = await tx.authChallenge.findFirst({ where: { id: claims.challengeId } });
        if (
          !challenge
          || challenge.status !== AuthChallengeStatus.VERIFIED
          || challenge.purpose !== AuthPurpose.REGISTRATION
          || challenge.subjectRole !== AuthSubjectRole.CUSTOMER
          || challenge.phone !== claims.phone
          || challenge.accountKind !== null
        ) {
          throw new UnauthorizedException('Authentication failed');
        }
        const existing = await tx.user.findUnique({ where: { phone: challenge.phone }, include: identityInclude });
        if (existing) {
          return this.attachCustomerAccount(tx, challenge, existing, body, now);
        }
        const profile = readCustomerProfile(body);
        const claimed = await tx.authChallenge.updateMany({
          where: {
            id: challenge.id,
            status: AuthChallengeStatus.VERIFIED,
            accountKind: null,
          },
          data: {
            status: AuthChallengeStatus.SUPERSEDED,
            accountKind: profile.kind,
            address: profile.address,
            fullName: profile.personName,
            businessName: profile.kind === CustomerAccountKind.BUSINESS ? profile.name : null,
          },
        });
        if (claimed.count !== 1) {
          throw new UnauthorizedException('Authentication failed');
        }
        const user = await tx.user.create({
          data: {
            fullName: profile.personName,
            phone: challenge.phone,
            role: UserRole.CUSTOMER,
            accountStatus: AccountStatus.ACTIVE,
            phoneVerifiedAt: now,
            passwordHash: null,
          },
        });
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
        return this.sessions.issue(tx, user.id, user.role, now);
      });
    } catch (error) {
      if (isUniquePhone(error)) {
        throw new ConflictException('Phone number is already registered');
      }
      throw error;
    }
  }

  async completeRiderRegistration(body: unknown): Promise<AuthTokens> {
    const token = readRegistrationToken(body);
    const claims = readRegistrationProof(token, this.clock.now());
    const now = this.clock.now();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const challenge = await tx.authChallenge.findFirst({ where: { id: claims.challengeId } });
        if (
          !challenge
          || challenge.status !== AuthChallengeStatus.VERIFIED
          || challenge.purpose !== AuthPurpose.REGISTRATION
          || challenge.subjectRole !== AuthSubjectRole.RIDER
          || challenge.phone !== claims.phone
          || challenge.fullName !== null
        ) {
          throw new UnauthorizedException('Authentication failed');
        }
        const existing = await tx.user.findUnique({ where: { phone: challenge.phone }, include: identityInclude });
        if (existing) {
          return this.attachRiderProfile(tx, challenge, existing, now);
        }
        const profile = readRiderAccount(body);
        const claimed = await tx.authChallenge.updateMany({
          where: {
            id: challenge.id,
            status: AuthChallengeStatus.VERIFIED,
            fullName: null,
          },
          data: {
            status: AuthChallengeStatus.SUPERSEDED,
            fullName: profile.fullName,
            address: profile.address,
          },
        });
        if (claimed.count !== 1) {
          throw new UnauthorizedException('Authentication failed');
        }
        const user = await tx.user.create({
          data: {
            fullName: profile.fullName,
            phone: challenge.phone,
            role: UserRole.RIDER,
            accountStatus: AccountStatus.ACTIVE,
            phoneVerifiedAt: now,
            passwordHash: null,
          },
        });
        const rider = await tx.riderProfile.create({
          data: {
            userId: user.id,
            verificationStatus: RiderVerificationStatus.PENDING,
            approvalStatus: RiderApprovalStatus.PENDING,
            availability: RiderAvailability.OFFLINE,
          },
        });
        await createEmptyWallet(tx, rider.id, now);
        return this.sessions.issue(tx, user.id, user.role, now);
      });
    } catch (error) {
      if (isUniquePhone(error)) {
        throw new ConflictException('Phone number is already registered');
      }
      throw error;
    }
  }

  private async start(input: {
    role: AuthSubjectRole;
    purpose: AuthPurpose;
    phone: string;
    fullName: string | null;
    profile: CustomerProfileInput | null;
    remoteAddress: string;
  }): Promise<LoginStart> {
    const now = this.clock.now();
    const ipHash = hashSecret(input.remoteAddress);
    if (await this.ipLimited(ipHash, now)) {
      if (input.purpose === AuthPurpose.LOGIN) {
        return this.conceal();
      }
      throw new TooManyRequestsException('Too many verification attempts. Try again later.');
    }

    if (input.purpose === AuthPurpose.LOGIN) {
      const user = await this.prisma.user.findUnique({ where: { phone: input.phone }, include: identityInclude });
      if (!canLogin(user, input.role)) {
        await this.recordProbe(input, ipHash, now);
        if (hasLoginCapability(user, input.role)) {
          return this.conceal();
        }
        return this.unavailable();
      }
    }

    if (await this.phoneLimited(input.phone, input.role, now) || await this.coolingDown(input, now) || await this.locked(input.phone, input.role, now)) {
      if (input.purpose === AuthPurpose.LOGIN) {
        return this.conceal();
      }
      throw new TooManyRequestsException('Too many verification attempts. Try again later.');
    }

    let challengeInput = input;
    if (input.purpose === AuthPurpose.REGISTRATION) {
      const existing = await this.prisma.user.findUnique({ where: { phone: input.phone }, include: identityInclude });
      if (existing && !eligibleAccount(existing)) {
        await this.recordConcealedRegistration(input, ipHash, now);
        return this.conceal();
      }
      if (existing) {
        // An existing name must never be replaced by a client-supplied name, including the debug rider name.
        challengeInput = { ...input, fullName: null, profile: null };
      }
    }

    await this.sendChallenge(challengeInput, ipHash, now);
    return { status: 'pending' };
  }

  private async verify(role: AuthSubjectRole, purpose: AuthPurpose, body: unknown): Promise<AuthTokens | RegistrationProof> {
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

        if (
          purpose === AuthPurpose.REGISTRATION
          && (role === AuthSubjectRole.CUSTOMER || role === AuthSubjectRole.RIDER)
          && challenge.accountKind === null
          && challenge.fullName === null
        ) {
          return this.finishPhoneOnlyVerification(tx, challenge, role, now);
        }

        const user = purpose === AuthPurpose.REGISTRATION
          ? await this.createRiderOrCustomer(tx, challenge, role, now)
          : await tx.user.findUnique({ where: { phone }, include: identityInclude });
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

  private async finishPhoneOnlyVerification(
    tx: Prisma.TransactionClient,
    challenge: ChallengeRecord,
    role: AuthSubjectRole,
    now: Date,
  ): Promise<RegistrationProof | AuthTokens> {
    const existing = await tx.user.findUnique({ where: { phone: challenge.phone }, include: identityInclude });
    if (!existing) {
      return {
        status: 'verified',
        registrationToken: signRegistrationProof(challenge.id, challenge.phone, now),
      };
    }
    if (!eligibleAccount(existing)) {
      await this.closeVerifiedChallenge(tx, challenge.id);
      throw new UnauthorizedException('Authentication failed');
    }
    if (hasAccess(existing, role)) {
      await this.closeVerifiedChallenge(tx, challenge.id);
      return this.sessions.issue(tx, existing.id, existing.role, now);
    }
    const address = await this.knownAddress(tx, existing);
    const readOnly: RegistrationProof['readOnly'] = address
      ? ['fullName', 'phone', 'address']
      : ['fullName', 'phone'];
    const missing: RegistrationProof['missing'] = role === AuthSubjectRole.CUSTOMER
      ? (address ? ['accountKind'] : ['accountKind', 'address'])
      : [];
    return {
      status: 'verified',
      registrationToken: signRegistrationProof(challenge.id, challenge.phone, now),
      fullName: existing.fullName,
      phone: existing.phone,
      address,
      readOnly,
      missing,
    };
  }

  private async attachCustomerAccount(
    tx: Prisma.TransactionClient,
    challenge: ChallengeRecord,
    existing: AccountIdentity,
    body: unknown,
    now: Date,
  ): Promise<AuthTokens> {
    if (!eligibleAccount(existing) || existing.customerAccount) {
      throw new ConflictException(SIGN_IN_INSTEAD);
    }
    const storedAddress = await this.knownAddress(tx, existing);
    const profile = readExistingCustomerProfile(body, existing.fullName, storedAddress);
    const claimed = await tx.authChallenge.updateMany({
      where: {
        id: challenge.id,
        status: AuthChallengeStatus.VERIFIED,
        accountKind: null,
      },
      data: {
        status: AuthChallengeStatus.SUPERSEDED,
        accountKind: profile.kind,
        address: profile.address,
        fullName: existing.fullName,
        businessName: profile.kind === CustomerAccountKind.BUSINESS ? profile.name : null,
      },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Authentication failed');
    }
    try {
      await tx.customerAccount.create({
        data: {
          userId: existing.id,
          kind: profile.kind,
          name: profile.name,
          contactName: profile.contactName,
          address: profile.address,
          updatedAt: now,
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException(SIGN_IN_INSTEAD);
      }
      throw error;
    }
    return this.sessions.issue(tx, existing.id, existing.role, now);
  }

  private async attachRiderProfile(
    tx: Prisma.TransactionClient,
    challenge: ChallengeRecord,
    existing: AccountIdentity,
    now: Date,
  ): Promise<AuthTokens> {
    if (!eligibleAccount(existing) || existing.riderProfile) {
      throw new ConflictException(SIGN_IN_INSTEAD);
    }
    const address = existing.customerAccount?.address ?? null;
    const claimed = await tx.authChallenge.updateMany({
      where: {
        id: challenge.id,
        status: AuthChallengeStatus.VERIFIED,
        fullName: null,
      },
      data: {
        status: AuthChallengeStatus.SUPERSEDED,
        fullName: existing.fullName,
        address,
      },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Authentication failed');
    }
    let rider: { id: string };
    try {
      rider = await tx.riderProfile.create({
        data: {
          userId: existing.id,
          verificationStatus: RiderVerificationStatus.PENDING,
          approvalStatus: RiderApprovalStatus.PENDING,
          availability: RiderAvailability.OFFLINE,
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException(SIGN_IN_INSTEAD);
      }
      throw error;
    }
    await createEmptyWallet(tx, rider.id, now);
    return this.sessions.issue(tx, existing.id, existing.role, now);
  }

  private async knownAddress(tx: Prisma.TransactionClient, user: AccountIdentity): Promise<string | null> {
    if (user.customerAccount?.address) {
      return user.customerAccount.address;
    }
    const prior = await tx.authChallenge.findFirst({
      where: {
        phone: user.phone,
        subjectRole: AuthSubjectRole.RIDER,
        purpose: AuthPurpose.REGISTRATION,
        status: AuthChallengeStatus.SUPERSEDED,
        address: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { address: true },
    });
    return prior?.address ?? null;
  }

  private async closeVerifiedChallenge(tx: Prisma.TransactionClient, challengeId: string): Promise<void> {
    const closed = await tx.authChallenge.updateMany({
      where: { id: challengeId, status: AuthChallengeStatus.VERIFIED },
      data: { status: AuthChallengeStatus.SUPERSEDED },
    });
    if (closed.count !== 1) {
      throw new UnauthorizedException('Authentication failed');
    }
  }

  private async recordConcealedRegistration(
    input: { role: AuthSubjectRole; phone: string },
    ipHash: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.authChallenge.create({
      data: {
        phone: input.phone,
        subjectRole: input.role,
        purpose: AuthPurpose.REGISTRATION,
        status: AuthChallengeStatus.SUPERSEDED,
        sendCount: 0,
        expiresAt: now,
        ipHash,
        createdAt: now,
      },
    });
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
    let riderProfileId: string | null = null;
    let customerAccount: { id: string; address: string } | null = null;
    if (role === AuthSubjectRole.RIDER) {
      const profile = await tx.riderProfile.create({
        data: {
          userId: user.id,
          verificationStatus: RiderVerificationStatus.PENDING,
          approvalStatus: RiderApprovalStatus.PENDING,
          availability: RiderAvailability.OFFLINE,
        },
      });
      riderProfileId = profile.id;
      await createEmptyWallet(tx, profile.id, now);
    }
    if (role === AuthSubjectRole.CUSTOMER) {
      if (!challenge.accountKind || !challenge.address || (challenge.accountKind === CustomerAccountKind.BUSINESS && !challenge.businessName)) {
        throw new UnauthorizedException('Verification code is invalid');
      }
      const account = await tx.customerAccount.create({
        data: {
          userId: user.id,
          kind: challenge.accountKind,
          name: challenge.accountKind === CustomerAccountKind.BUSINESS ? challenge.businessName! : challenge.fullName,
          contactName: challenge.accountKind === CustomerAccountKind.BUSINESS ? challenge.fullName : null,
          address: challenge.address,
          updatedAt: now,
        },
      });
      customerAccount = { id: account.id, address: challenge.address };
    }
    return { ...user, riderProfile: riderProfileId === null ? null : { id: riderProfileId }, customerAccount };
  }

  private async sendChallenge(
    input: {
      role: AuthSubjectRole;
      purpose: AuthPurpose;
      phone: string;
      fullName: string | null;
      profile: CustomerProfileInput | null;
    },
    ipHash: string,
    now: Date,
  ): Promise<void> {
    const created = await this.prisma.authChallenge.create({
      data: {
        phone: input.phone,
        subjectRole: input.role,
        purpose: input.purpose,
        fullName: input.fullName,
        accountKind: input.profile?.kind ?? null,
        address: input.profile?.address ?? null,
        businessName: input.profile?.kind === CustomerAccountKind.BUSINESS ? input.profile.name : null,
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

  private async unavailable(): Promise<{ status: 'unavailable' }> {
    await this.clock.pause(this.clock.concealmentMs);
    return { status: 'unavailable' };
  }
}

type LoginStart = { status: 'pending' } | { status: 'unavailable' };

function canLogin(
  user: {
    role: UserRole;
    accountStatus: AccountStatus;
    phoneVerifiedAt: Date | null;
    riderProfile?: { id: string } | null;
    customerAccount?: { id: string } | null;
  } | null,
  role: AuthSubjectRole,
): boolean {
  if (!eligibleAccount(user) || !hasLoginCapability(user, role)) {
    return false;
  }
  return true;
}

function hasLoginCapability(
  user: { riderProfile?: { id: string } | null; customerAccount?: { id: string } | null } | null,
  role: AuthSubjectRole,
): boolean {
  if (!user) {
    return false;
  }
  return role === AuthSubjectRole.RIDER ? user.riderProfile != null : user.customerAccount != null;
}

function eligibleAccount<T extends {
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
}>(user: T | null): user is T & { phoneVerifiedAt: Date } {
  return !!user
    && (user.role === UserRole.CUSTOMER || user.role === UserRole.RIDER)
    && user.accountStatus === AccountStatus.ACTIVE
    && user.phoneVerifiedAt !== null;
}

function hasAccess(user: AccountIdentity, role: AuthSubjectRole): boolean {
  return role === AuthSubjectRole.RIDER ? user.riderProfile !== null : user.customerAccount !== null;
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

function readRiderAccount(body: unknown): { fullName: string; address: string } {
  if (!isRecord(body)) {
    throw new BadRequestException('Full name is required');
  }
  if (body.accountKind === 'BUSINESS' || body.businessName !== undefined || body.contactName !== undefined) {
    throw new BadRequestException('Rider accounts are individual');
  }
  if (typeof body.fullName !== 'string') {
    throw new BadRequestException('Full name is required');
  }
  let fullName: string;
  try {
    fullName = normalizePersonName(body.fullName);
  } catch (error) {
    if (error instanceof InvalidPersonNameError) {
      throw new BadRequestException('Full name is required');
    }
    throw error;
  }
  return { fullName, address: readAddress(body.address) };
}

function isPhoneOnlyRegistration(body: unknown): boolean {
  if (!isRecord(body)) {
    return false;
  }
  return body.accountKind === undefined
    && body.fullName === undefined
    && body.businessName === undefined
    && body.contactName === undefined
    && body.address === undefined;
}

function readRegistrationToken(body: unknown): string {
  if (!isRecord(body) || typeof body.registrationToken !== 'string') {
    throw new UnauthorizedException('Authentication failed');
  }
  return body.registrationToken;
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

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isUniquePhone(error: unknown): boolean {
  return isUniqueConstraint(error);
}

function readExistingCustomerProfile(body: unknown, fullName: string, storedAddress: string | null): CustomerProfileInput {
  if (!isRecord(body)) {
    throw new BadRequestException('Choose an individual or business account');
  }
  const address = storedAddress ?? readAddress(body.address);
  if (body.accountKind === 'BUSINESS') {
    if (typeof body.businessName !== 'string') {
      throw new BadRequestException('Enter the business name');
    }
    let businessName: string;
    try {
      businessName = normalizePersonName(body.businessName);
    } catch (error) {
      if (error instanceof InvalidPersonNameError) {
        throw new BadRequestException('Enter the business name');
      }
      throw error;
    }
    return {
      kind: CustomerAccountKind.BUSINESS,
      name: businessName,
      contactName: fullName,
      address,
      personName: fullName,
    };
  }
  if (body.accountKind !== 'INDIVIDUAL') {
    throw new BadRequestException('Choose an individual or business account');
  }
  return {
    kind: CustomerAccountKind.INDIVIDUAL,
    name: fullName,
    contactName: null,
    address,
    personName: fullName,
  };
}
