import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccountStatus,
  AuthSubjectRole,
  Prisma,
  UserRole,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hasAccountCredential } from './account-credential.js';
import { hashAdminPassword, verifyAdminPassword } from './admin-password.js';
import { normalizeAuthPhone, InvalidPhoneNumberError } from './phone-number.js';
import { SessionService, type AuthTokens } from './session.service.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { hashSecret } from './token-hash.js';

export const PASSWORD_REGISTRATION_CLOSED = 'Verify your phone number on WhatsApp to create an account';

const HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_HOUR = 10;
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$r6lPP6svlzXwR/O2eN92Zg$ZAAXJm/5tPG9ttpWD2BODDyYijIm+I4pzdEc4Jkab3Q';

@Injectable()
export class PasswordAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async registerRider(_body: unknown): Promise<AuthTokens> {
    this.rejectDirectPasswordRegistration();
  }

  async registerCustomer(_body: unknown): Promise<AuthTokens> {
    this.rejectDirectPasswordRegistration();
  }

  async login(role: AuthSubjectRole, body: unknown, remoteAddress: string): Promise<AuthTokens> {
    const phone = readPhone(body);
    const password = readPassword(body);
    const keys = loginKeys(remoteAddress, phone);
    await this.assertLoginAllowed(keys);
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { riderProfile: true, customerAccount: true },
    });
    const allowed = user
      && (role === AuthSubjectRole.RIDER ? user.role === UserRole.RIDER : user.role === UserRole.CUSTOMER)
      && user.accountStatus === AccountStatus.ACTIVE
      && (role === AuthSubjectRole.RIDER ? user.riderProfile !== null : user.customerAccount !== null)
      && typeof user.passwordHash === 'string';
    const passwordValid = await verifyAdminPassword(allowed ? user.passwordHash! : DUMMY_PASSWORD_HASH, password);
    if (!allowed || !passwordValid) {
      await this.recordFailure(keys);
      throw new UnauthorizedException('Authentication failed');
    }
    return this.prisma.$transaction((tx) => this.sessions.issue(tx, user.id, user.role, new Date()));
  }

  async setPassword(
    userId: string,
    sessionId: string,
    role: UserRole,
    body: unknown,
    suppliedProof?: string | null,
  ): Promise<void> {
    if (role !== UserRole.RIDER && role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('Authentication failed');
    }
    const refreshProof = suppliedProof === undefined ? takeRefreshProof(body) : suppliedProof;
    if (suppliedProof !== undefined && isRecord(body)) {
      delete body.refreshToken;
    }
    const now = new Date();
    const session = await this.prisma.refreshSession.findUnique({ where: { id: sessionId } });
    if (
      !session
      || session.userId !== userId
      || session.revokedAt
      || session.replacedBySessionId
      || session.expiresAt <= now
    ) {
      throw new UnauthorizedException('Authentication failed');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user
      || user.role !== role
      || user.accountStatus !== AccountStatus.ACTIVE
      || !hasAccountCredential(user)
    ) {
      throw new UnauthorizedException('Authentication failed');
    }
    if (typeof user.passwordHash === 'string') {
      await this.assertSetPasswordAllowed(user.id);
      const currentMatches = await verifyAdminPassword(user.passwordHash, readCurrentPassword(body));
      if (!currentMatches) {
        await this.recordSetPasswordFailure(user.id);
        throw new UnauthorizedException('Authentication failed');
      }
    } else {
      if (!refreshProof) {
        throw new UnauthorizedException('Authentication failed');
      }
      await this.sessions.confirmCurrentRefreshToken(refreshProof, sessionId, user.id, now);
    }
    const passwordHash = await readPasswordHash(body);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
  }

  private rejectDirectPasswordRegistration(): never {
    throw new ForbiddenException(PASSWORD_REGISTRATION_CLOSED);
  }

  private async assertLoginAllowed(keys: AttemptKeys): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await lockAttemptKeys(tx, keys);
      const windowStart = new Date(now.getTime() - HOUR_MS);
      const ipAttempts = await tx.passwordLoginAttempt.count({
        where: { ipHash: keys.ipHash, createdAt: { gte: windowStart } },
      });
      const phoneAttempts = await tx.passwordLoginAttempt.count({
        where: { phoneHash: keys.phoneHash, createdAt: { gte: windowStart } },
      });
      if (ipAttempts >= MAX_ATTEMPTS_PER_HOUR || phoneAttempts >= MAX_ATTEMPTS_PER_HOUR) {
        throw new TooManyRequestsException('Too many login attempts. Try again later.');
      }
    });
  }

  private async recordFailure(keys: AttemptKeys): Promise<void> {
    await this.prisma.passwordLoginAttempt.create({
      data: { id: randomUUID(), ipHash: keys.ipHash, phoneHash: keys.phoneHash, createdAt: new Date() },
    });
  }

  private async assertSetPasswordAllowed(userId: string): Promise<void> {
    const keys = setPasswordKeys(userId);
    const attempts = await this.prisma.passwordLoginAttempt.count({
      where: { ipHash: keys.ipHash, createdAt: { gte: new Date(Date.now() - HOUR_MS) } },
    });
    if (attempts >= MAX_ATTEMPTS_PER_HOUR) {
      throw new TooManyRequestsException('Too many login attempts. Try again later.');
    }
  }

  private async recordSetPasswordFailure(userId: string): Promise<void> {
    const keys = setPasswordKeys(userId);
    await this.recordFailure(keys);
  }
}

type AttemptKeys = { ipHash: string; phoneHash: string };

function loginKeys(remoteAddress: string, phone: string): AttemptKeys {
  return {
    ipHash: hashSecret(`password-login:ip:${remoteAddress}`),
    phoneHash: hashSecret(`password-login:phone:${phone}`),
  };
}

function setPasswordKeys(userId: string): AttemptKeys {
  const key = hashSecret(`password-set:${userId}`);
  return { ipHash: key, phoneHash: key };
}

async function lockAttemptKeys(tx: Prisma.TransactionClient, keys: AttemptKeys): Promise<void> {
  const ordered = [keys.ipHash, keys.phoneHash].sort();
  for (const key of ordered) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS lock_result
    `;
  }
}

async function readPasswordHash(body: unknown): Promise<string> {
  try {
    return await hashAdminPassword(readPassword(body));
  } catch (error) {
    if (error instanceof Error && error.message.includes('12 to 128')) {
      throw new BadRequestException('Password must contain 12 to 128 characters');
    }
    throw error;
  }
}

function readPassword(body: unknown): string {
  if (!isRecord(body) || typeof body.password !== 'string') {
    throw new BadRequestException('Password must contain 12 to 128 characters');
  }
  return body.password;
}

export function takeRefreshProof(body: unknown): string | null {
  if (!isRecord(body) || !Object.prototype.hasOwnProperty.call(body, 'refreshToken')) {
    return null;
  }
  const proof = body.refreshToken;
  delete body.refreshToken;
  if (typeof proof !== 'string') {
    throw new UnauthorizedException('Authentication failed');
  }
  return proof;
}

function readCurrentPassword(body: unknown): string {
  if (!isRecord(body) || body.currentPassword === undefined || body.currentPassword === null) {
    return '';
  }
  if (typeof body.currentPassword !== 'string') {
    throw new BadRequestException('Password must contain 12 to 128 characters');
  }
  return body.currentPassword;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
