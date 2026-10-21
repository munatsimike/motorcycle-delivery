import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountStatus,
  AuthPurpose,
  AuthSubjectRole,
  Prisma,
  UserRole,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import type { RegistrationProof } from './registration-proof.js';
import { Clock } from './clock.js';
import { OtpAuthService } from './otp-auth.service.js';
import { SessionService, type AuthTokens } from './session.service.js';
import { hashSecret } from './token-hash.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const PHONE = '0771234567';
const E164 = '+263771234567';

function issuedSession(result: AuthTokens | RegistrationProof): AuthTokens {
  if (!('accessToken' in result)) {
    throw new Error('expected a session');
  }
  return result;
}

describe('OtpAuthService', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('creates a passwordless rider and a hashed refresh session after the code is approved', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.10');
    const issued = requireSession(await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }));

    expect(ctx.twilio.startVerification).toHaveBeenCalledWith(E164);
    expect(ctx.users).toEqual([
      expect.objectContaining({
        phone: E164,
        role: UserRole.RIDER,
        accountStatus: AccountStatus.ACTIVE,
        passwordHash: null,
        fullName: 'Tendai Moyo',
      }),
    ]);
    expect(ctx.users[0].phoneVerifiedAt).toBeInstanceOf(Date);
    expect(ctx.profiles).toEqual([
      expect.objectContaining({
        userId: ctx.users[0].id,
        verificationStatus: 'PENDING',
        approvalStatus: 'PENDING',
        availability: 'OFFLINE',
        licenceNumber: null,
        licenceClass: null,
        verifiedAt: null,
        reviewerId: null,
      }),
    ]);
    expect(ctx.profiles[0]).not.toHaveProperty('licenceExpiresOn');
    expect(ctx.wallets).toEqual([
      expect.objectContaining({
        riderProfileId: ctx.profiles[0].id,
        currency: 'USD',
        balance: '0.00',
        borrowingLimitOverride: null,
        welcomeBonusAwardedAt: null,
      }),
    ]);
    expect(ctx.sessions[0].tokenHash).toBe(hashSecret(issued.refreshToken));
    expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).sub).toBe(ctx.users[0].id);
    expect(ctx.challenges[0].status).toBe('VERIFIED');
  });

  it('registers a business name, contact name, and address, then creates that account after the mocked code is approved', async () => {
    const ctx = context();
    await expect(ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.11'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(1);
    expect(ctx.twilio.startVerification).toHaveBeenCalledWith(E164);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.challenges[0]).toMatchObject({
      phone: E164,
      subjectRole: AuthSubjectRole.CUSTOMER,
      purpose: AuthPurpose.REGISTRATION,
      fullName: 'Tendai Moyo',
      accountKind: 'BUSINESS',
      businessName: 'Moyo Deliveries',
      address: '12 Samora Machel Avenue',
      status: 'PENDING',
    });

    const issued = requireSession(await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' }));
    expect(ctx.twilio.checkVerification).toHaveBeenCalledWith(E164, '123456');
    expect(ctx.users).toEqual([
      expect.objectContaining({
        phone: E164,
        role: UserRole.CUSTOMER,
        fullName: 'Tendai Moyo',
        passwordHash: null,
      }),
    ]);
    expect(ctx.profiles).toHaveLength(0);
    expect(ctx.wallets).toHaveLength(0);
    expect(ctx.accounts).toEqual([
      expect.objectContaining({
        userId: ctx.users[0].id,
        kind: 'BUSINESS',
        name: 'Moyo Deliveries',
        contactName: 'Tendai Moyo',
        address: '12 Samora Machel Avenue',
      }),
    ]);
    expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).role).toBe(UserRole.CUSTOMER);
  });

  it('rolls back the rider profile when wallet creation fails', async () => {
    const ctx = context();
    ctx.failNextWallet = true;
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.41');
    await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' })).rejects.toThrow('wallet creation failed');
    expect(ctx.users).toHaveLength(0);
    expect(ctx.profiles).toHaveLength(0);
    expect(ctx.wallets).toHaveLength(0);
    expect(ctx.sessions).toHaveLength(0);
  });

  it('signs an existing customer in after one registration code without creating another account', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.40');
    await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
    ctx.clock.current = new Date(ctx.clock.current.getTime() + 61_000);

    await expect(ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.40'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.sessions).toHaveLength(1);
    const result = await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('fullName');
    expect(ctx.accessTokens.verify(issuedSession(result).accessToken, ctx.clock.current).role).toBe(UserRole.CUSTOMER);
    expect(ctx.users).toHaveLength(1);
    expect(ctx.accounts).toHaveLength(1);
    expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(2);
    expect(ctx.twilio.checkVerification).toHaveBeenCalledTimes(2);
  });

  it('starts customer registration for a rider without revealing the saved name', async () => {
    const ctx = context();
    ctx.users.push(existingRider());
    ctx.profiles.push(riderProfile(ctx.users[0].id));
    await expect(ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.41'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(1);
    expect(ctx.challenges[0]).toMatchObject({ fullName: null, accountKind: null, businessName: null });
    expect(ctx.users).toHaveLength(1);
    expect(ctx.accounts).toHaveLength(0);
  });

  it('rejects an invalid customer verification code without creating an account', async () => {
    const ctx = context();
    ctx.twilio.checkVerification.mockResolvedValue(false);
    await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.46');
    await expect(ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '000000' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.twilio.checkVerification).toHaveBeenCalledWith(E164, '000000');
    expect(ctx.users).toHaveLength(0);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.sessions).toHaveLength(0);
    expect(ctx.challenges[0].status).toBe('PENDING');
  });

  it('rejects an expired customer verification code without asking Twilio', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.47');
    ctx.challenges[0].expiresAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
    expect(ctx.challenges[0].status).toBe('EXPIRED');
    expect(ctx.users).toHaveLength(0);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.sessions).toHaveLength(0);
  });

  it('verifies a phone before collecting customer profile details', async () => {
    const ctx = context();
    await expect(ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.48'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.users).toHaveLength(0);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.challenges[0]).toMatchObject({
      phone: E164,
      fullName: null,
      accountKind: null,
      address: null,
      businessName: null,
    });

    const proof = await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
    expect(proof).toMatchObject({ status: 'verified' });
    expect(ctx.users).toHaveLength(0);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.sessions).toHaveLength(0);
    if (!('registrationToken' in proof)) {
      throw new Error('expected a registration proof');
    }
    expect(() => ctx.accessTokens.verify(proof.registrationToken, ctx.clock.current)).toThrow(UnauthorizedException);

    const issued = await ctx.otp.completeCustomerRegistration({
      registrationToken: proof.registrationToken,
      accountKind: 'INDIVIDUAL',
      fullName: 'Rudo Ncube',
      address: '1 First Street',
      phone: '+263779999999',
    });
    expect(ctx.users).toEqual([
      expect.objectContaining({
        phone: E164,
        role: UserRole.CUSTOMER,
        fullName: 'Rudo Ncube',
        passwordHash: null,
      }),
    ]);
    expect(ctx.accounts).toEqual([
      expect.objectContaining({
        userId: ctx.users[0].id,
        kind: 'INDIVIDUAL',
        name: 'Rudo Ncube',
        contactName: null,
        address: '1 First Street',
      }),
    ]);
    expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).role).toBe(UserRole.CUSTOMER);
    expect(ctx.challenges[0].status).toBe('SUPERSEDED');

    await expect(ctx.otp.completeCustomerRegistration({
      registrationToken: proof.registrationToken,
      accountKind: 'BUSINESS',
      businessName: 'Second Try',
      contactName: 'Rudo Ncube',
      address: '1 First Street',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users).toHaveLength(1);
    expect(ctx.accounts).toHaveLength(1);
  });

  it('verifies a rider phone before collecting an individual name and address', async () => {
    const ctx = context();
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.53'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.users).toHaveLength(0);
    expect(ctx.profiles).toHaveLength(0);
    expect(ctx.wallets).toHaveLength(0);

    const proof = await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' });
    expect(proof).toMatchObject({ status: 'verified' });
    expect(ctx.users).toHaveLength(0);
    expect(ctx.sessions).toHaveLength(0);
    if (!('registrationToken' in proof)) {
      throw new Error('expected a registration proof');
    }

    await expect(ctx.otp.completeRiderRegistration({
      registrationToken: proof.registrationToken,
      accountKind: 'BUSINESS',
      businessName: 'Moyo Deliveries',
      contactName: 'Tendai Moyo',
      address: '12 Samora Machel Avenue',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.users).toHaveLength(0);

    const issued = await ctx.otp.completeRiderRegistration({
      registrationToken: proof.registrationToken,
      fullName: 'Tendai Moyo',
      address: '  12   Samora Machel Avenue  ',
      phone: '+31612345678',
    });
    expect(ctx.users).toEqual([
      expect.objectContaining({
        phone: E164,
        role: UserRole.RIDER,
        fullName: 'Tendai Moyo',
        passwordHash: null,
      }),
    ]);
    expect(ctx.profiles[0]).toMatchObject({
      userId: ctx.users[0].id,
      availability: 'OFFLINE',
    });
    expect(ctx.challenges[0].address).toBe('12 Samora Machel Avenue');
    expect(ctx.wallets).toHaveLength(1);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).role).toBe(UserRole.RIDER);
    expect(ctx.challenges[0].status).toBe('SUPERSEDED');

    await expect(ctx.otp.completeRiderRegistration({
      registrationToken: proof.registrationToken,
      fullName: 'Second Try',
      address: '1 First Street',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users).toHaveLength(1);
  });

  it('creates a business account from the verified phone rather than a phone in the body', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: '0771234567' }, '203.0.113.49');
    const proof = await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
    if (!('registrationToken' in proof)) {
      throw new Error('expected a registration proof');
    }
    await ctx.otp.completeCustomerRegistration({
      registrationToken: proof.registrationToken,
      accountKind: 'BUSINESS',
      businessName: 'Moyo Deliveries',
      contactName: 'Tendai Moyo',
      address: '12 Samora Machel Avenue',
      phone: '+31612345678',
    });
    expect(ctx.users[0].phone).toBe(E164);
    expect(ctx.users[0].fullName).toBe('Tendai Moyo');
    expect(ctx.accounts[0]).toMatchObject({
      kind: 'BUSINESS',
      name: 'Moyo Deliveries',
      contactName: 'Tendai Moyo',
    });
  });

  it('does not authenticate when a phone-only registration code is rejected', async () => {
    const ctx = context();
    ctx.twilio.checkVerification.mockResolvedValue(false);
    await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.50');
    await expect(ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '000000' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.sessions).toHaveLength(0);
    expect(ctx.challenges[0].status).toBe('PENDING');
  });

  it('rejects an expired registration proof without creating an account', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.51');
    const proof = await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
    if (!('registrationToken' in proof)) {
      throw new Error('expected a registration proof');
    }
    ctx.clock.current = new Date(ctx.clock.current.getTime() + 16 * 60_000);
    await expect(ctx.otp.completeCustomerRegistration({
      registrationToken: proof.registrationToken,
      accountKind: 'INDIVIDUAL',
      fullName: 'Rudo Ncube',
      address: '1 First Street',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.accounts).toHaveLength(0);
  });

  it('signs in an existing customer after one registration code', async () => {
    const ctx = context();
    const customer = existingCustomer();
    ctx.users.push(customer);
    ctx.accounts.push(customerAccount(customer.id));
    await expect(ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.52'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.sessions).toHaveLength(0);
    const result = await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
    expect(ctx.accessTokens.verify(issuedSession(result).accessToken, ctx.clock.current)).toMatchObject({
      sub: customer.id,
      role: UserRole.CUSTOMER,
    });
    expect(result).not.toHaveProperty('fullName');
    expect(ctx.accounts).toHaveLength(1);
    expect(ctx.users).toHaveLength(1);
    expect(ctx.sessions).toHaveLength(1);
    expect(ctx.twilio.checkVerification).toHaveBeenCalledTimes(1);
  });

  it('does not send a customer login code to an admin', async () => {
    const ctx = context();
    ctx.users.push({ ...existingRider(), role: UserRole.ADMIN });
    await expect(ctx.otp.startLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.48'))
      .resolves.toEqual({ status: 'pending' });
    await expect(ctx.otp.verifyLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.twilio.startVerification).not.toHaveBeenCalled();
    expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
    expect(ctx.sessions).toHaveLength(0);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.users[0].role).toBe(UserRole.ADMIN);
  });

  it('lets an existing rider log in through customer OTP without changing role', async () => {
    const ctx = context();
    const rider = existingRider();
    ctx.users.push(rider);
    await ctx.otp.startLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.42');
    const issued = await ctx.otp.verifyLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
    expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current)).toMatchObject({
      sub: rider.id,
      role: UserRole.RIDER,
    });
    expect(ctx.users).toHaveLength(1);
    expect(ctx.accounts).toHaveLength(0);
    expect(ctx.profiles).toHaveLength(0);
  });

  it('signs in an existing rider after one registration code without another profile', async () => {
    const ctx = context();
    const rider = existingRider();
    ctx.users.push(rider);
    ctx.profiles.push(riderProfile(rider.id));
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.12'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.sessions).toHaveLength(0);
    expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(1);
    expect(ctx.challenges[0].fullName).toBeNull();
    const result = await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' });
    expect(ctx.accessTokens.verify(issuedSession(result).accessToken, ctx.clock.current)).toMatchObject({
      sub: rider.id,
      role: UserRole.RIDER,
    });
    expect(JSON.stringify(result)).not.toContain('Tendai');
    expect(result).not.toHaveProperty('status');
    expect(ctx.users).toHaveLength(1);
    expect(ctx.profiles).toHaveLength(1);
    expect(ctx.wallets).toHaveLength(0);
    expect(ctx.sessions).toHaveLength(1);
    expect(ctx.twilio.checkVerification).toHaveBeenCalledTimes(1);
  });

  it('enforces the resend cooldown and the hourly send limit', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.13');
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.13'))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(1);

    for (let send = 1; send < 5; send += 1) {
      ctx.clock.current = new Date(ctx.clock.current.getTime() + 61_000);
      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.13');
    }
    ctx.clock.current = new Date(ctx.clock.current.getTime() + 61_000);
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.13'))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(5);
    expect(ctx.challenges.filter((challenge) => challenge.status === 'PENDING')).toHaveLength(1);
  });

  it('stops calling Twilio when one address exceeds the hourly attempt limit', async () => {
    const ctx = context();
    const address = '203.0.113.14';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      ctx.challenges.push(probe(hashSecret(address), ctx.clock.current, attempt));
    }
    await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), address))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.twilio.startVerification).not.toHaveBeenCalled();
  });

  it('returns the same pending response for an unknown or suspended login without sending SMS', async () => {
    const unknown = context();
    await expect(unknown.otp.startLogin(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.15'))
      .resolves.toEqual({ status: 'pending' });
    expect(unknown.twilio.startVerification).not.toHaveBeenCalled();

    const suspended = context();
    suspended.users.push({ ...existingRider(), accountStatus: AccountStatus.SUSPENDED });
    await expect(suspended.otp.startLogin(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.16'))
      .resolves.toEqual({ status: 'pending' });
    expect(suspended.twilio.startVerification).not.toHaveBeenCalled();
  });

  it('logs an active rider in without creating a second account', async () => {
    const ctx = context();
    const rider = existingRider();
    ctx.users.push(rider);
    ctx.profiles.push(riderProfile(rider.id));
    await ctx.otp.startLogin(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.17');
    const issued = await ctx.otp.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' });
    expect(ctx.users).toHaveLength(1);
    expect(ctx.profiles).toHaveLength(1);
    expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).role).toBe(UserRole.RIDER);
  });

  it('locks the challenge after five wrong codes', async () => {
    const ctx = context();
    ctx.twilio.checkVerification.mockResolvedValue(false);
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.18');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '000000' }))
        .rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '000000' }))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.twilio.checkVerification).toHaveBeenCalledTimes(5);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.challenges.some((challenge) => challenge.status === 'LOCKED')).toBe(true);
  });

  it('does not check an expired code with Twilio', async () => {
    const ctx = context();
    await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.19');
    ctx.challenges[0].expiresAt = new Date('2020-01-01T00:00:00.000Z');
    await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
    expect(ctx.challenges[0].status).toBe('EXPIRED');
  });

  it('drops a challenge when the SMS provider fails and reports a registration race as a conflict', async () => {
    const failed = context();
    failed.twilio.startVerification.mockRejectedValue(new ServiceUnavailableException('SMS verification is unavailable'));
    await expect(failed.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.20'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(failed.challenges[0].status).toBe('SUPERSEDED');
    expect(failed.challenges[0].twilioSid).toBeNull();

    const raced = context();
    await raced.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.21');
    raced.rejectNextUser = true;
    await expect(raced.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(raced.users).toHaveLength(0);
  });

  describe('one user with customer and rider access', () => {
    it('adds a rider profile to an existing customer without changing the user or customer account', async () => {
      const ctx = context();
      const customer = existingCustomer();
      const account = customerAccount(customer.id);
      ctx.users.push(customer);
      ctx.accounts.push(account);
      ctx.sessions.push(openSession(customer.id));
      await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, {
        phone: PHONE,
        fullName: 'Tonderai Moyo',
      }, '203.0.113.60')).resolves.toEqual({ status: 'pending' });
      expect(ctx.challenges.find((challenge) => challenge.sendCount > 0)?.fullName).toBeNull();

      const proof = await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' });
      expect(proof).toMatchObject({
        status: 'verified',
        fullName: 'Rudo Ncube',
        phone: E164,
        address: '1 First Street',
        readOnly: ['fullName', 'phone', 'address'],
        missing: [],
      });
      if (!('registrationToken' in proof)) {
        throw new Error('expected a registration proof');
      }

      const issued = await ctx.otp.completeRiderRegistration({
        registrationToken: proof.registrationToken,
        fullName: 'Tonderai Moyo',
        address: '99 Other Road',
      });
      expect(ctx.users).toEqual([expect.objectContaining({
        id: customer.id,
        fullName: 'Rudo Ncube',
        phone: E164,
        role: UserRole.CUSTOMER,
      })]);
      expect(ctx.accounts).toEqual([account]);
      expect(ctx.profiles).toEqual([expect.objectContaining({
        userId: customer.id,
        approvalStatus: 'PENDING',
        availability: 'OFFLINE',
      })]);
      expect(ctx.wallets).toHaveLength(1);
      expect(ctx.sessions.find((session) => session.id === 'existing-session')?.revokedAt).toBeNull();
      expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current)).toMatchObject({
        sub: customer.id,
        role: UserRole.CUSTOMER,
      });

      await ctx.otp.startLogin(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.61');
      const riderLogin = await ctx.otp.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' });
      expect(ctx.accessTokens.verify(riderLogin.accessToken, ctx.clock.current).role).toBe(UserRole.CUSTOMER);
      await ctx.otp.startLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.62');
      const customerLogin = await ctx.otp.verifyLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
      expect(ctx.accessTokens.verify(customerLogin.accessToken, ctx.clock.current).role).toBe(UserRole.CUSTOMER);
      expect(ctx.users).toHaveLength(1);
      expect(ctx.profiles).toHaveLength(1);
      expect(ctx.wallets).toHaveLength(1);
    });

    it('adds a customer account to an existing rider and keeps the rider profile and wallet', async () => {
      const ctx = context();
      const rider = existingRider();
      ctx.users.push(rider);
      ctx.profiles.push({ ...riderProfile(rider.id), approvalStatus: 'APPROVED', availability: 'AVAILABLE' });
      ctx.wallets.push({ id: 'wallet-1', riderProfileId: ctx.profiles[0].id, balance: '12.00' });
      ctx.challenges.push({
        ...probe(hashSecret('203.0.113.70'), new Date('2026-10-13T11:00:00.000Z'), 1),
        phone: E164,
        purpose: AuthPurpose.REGISTRATION,
        status: 'SUPERSEDED',
        address: '12 Samora Machel Avenue',
        fullName: 'Tendai Moyo',
      });
      await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.70');
      const proof = await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
      expect(proof).toMatchObject({
        status: 'verified',
        fullName: 'Tendai Moyo',
        phone: E164,
        address: '12 Samora Machel Avenue',
        readOnly: ['fullName', 'phone', 'address'],
        missing: ['accountKind'],
      });
      if (!('registrationToken' in proof)) {
        throw new Error('expected a registration proof');
      }
      const issued = await ctx.otp.completeCustomerRegistration({
        registrationToken: proof.registrationToken,
        accountKind: 'INDIVIDUAL',
        fullName: 'Tonderai Moyo',
        address: '99 Other Road',
      });
      expect(ctx.users[0]).toMatchObject({ id: rider.id, fullName: 'Tendai Moyo', role: UserRole.RIDER });
      expect(ctx.accounts[0]).toMatchObject({
        userId: rider.id,
        name: 'Tendai Moyo',
        address: '12 Samora Machel Avenue',
      });
      expect(ctx.profiles[0]).toMatchObject({ approvalStatus: 'APPROVED', availability: 'AVAILABLE' });
      expect(ctx.wallets).toEqual([expect.objectContaining({ balance: '12.00' })]);
      expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).role).toBe(UserRole.RIDER);
    });

    it('collects a customer address only when the rider has none', async () => {
      const ctx = context();
      const rider = existingRider();
      ctx.users.push(rider);
      ctx.profiles.push(riderProfile(rider.id));
      await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.71');
      const proof = await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' });
      expect(proof).toMatchObject({
        address: null,
        readOnly: ['fullName', 'phone'],
        missing: ['accountKind', 'address'],
      });
      if (!('registrationToken' in proof)) {
        throw new Error('expected a registration proof');
      }
      await ctx.otp.completeCustomerRegistration({
        registrationToken: proof.registrationToken,
        accountKind: 'BUSINESS',
        businessName: 'Moyo Deliveries',
        contactName: 'Tonderai Moyo',
        address: '  4   Jason Moyo Avenue  ',
      });
      expect(ctx.users[0].fullName).toBe('Tendai Moyo');
      expect(ctx.accounts[0]).toMatchObject({
        kind: 'BUSINESS',
        name: 'Moyo Deliveries',
        contactName: 'Tendai Moyo',
        address: '4 Jason Moyo Avenue',
      });
    });

    it('does not send a registration code to a suspended or deactivated account', async () => {
      for (const accountStatus of [AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED]) {
        const ctx = context();
        ctx.users.push({ ...existingCustomer(), accountStatus });
        await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.72'))
          .resolves.toEqual({ status: 'pending' });
        expect(ctx.twilio.startVerification).not.toHaveBeenCalled();
        await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }))
          .rejects.toBeInstanceOf(UnauthorizedException);
        expect(ctx.profiles).toHaveLength(0);
        expect(ctx.sessions).toHaveLength(0);
        expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
      }
    });

    it('signs in through either registration flow when the user already has both accounts', async () => {
      const ctx = context();
      const customer = existingCustomer();
      const profile = riderProfile(customer.id);
      ctx.users.push(customer);
      ctx.accounts.push(customerAccount(customer.id));
      ctx.profiles.push(profile);
      ctx.wallets.push({ id: 'wallet-1', riderProfileId: profile.id, balance: '4.00' });

      await ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.80');
      expect(ctx.sessions).toHaveLength(0);
      const customerSession = issuedSession(await ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' }));
      expect(ctx.accessTokens.verify(customerSession.accessToken, ctx.clock.current)).toMatchObject({
        sub: customer.id,
        role: UserRole.CUSTOMER,
      });

      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, { phone: PHONE, fullName: 'Tonderai Moyo' }, '203.0.113.81');
      const riderSession = issuedSession(await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }));
      expect(ctx.accessTokens.verify(riderSession.accessToken, ctx.clock.current)).toMatchObject({
        sub: customer.id,
        role: UserRole.CUSTOMER,
      });
      expect(JSON.stringify(riderSession)).not.toContain('Rudo');
      expect(JSON.stringify(riderSession)).not.toContain('Tonderai');
      expect(ctx.users).toHaveLength(1);
      expect(ctx.accounts).toHaveLength(1);
      expect(ctx.profiles).toHaveLength(1);
      expect(ctx.wallets).toEqual([expect.objectContaining({ balance: '4.00' })]);
      expect(ctx.sessions).toHaveLength(2);
    });

    it('does not issue a registration session for an unverified or admin phone', async () => {
      for (const user of [
        { ...existingCustomer(), phoneVerifiedAt: null },
        { ...existingCustomer(), role: UserRole.ADMIN },
      ]) {
        const ctx = context();
        ctx.users.push(user);
        ctx.accounts.push(customerAccount(user.id));
        await expect(ctx.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.82'))
          .resolves.toEqual({ status: 'pending' });
        await expect(ctx.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '123456' }))
          .rejects.toBeInstanceOf(UnauthorizedException);
        expect(ctx.twilio.startVerification).not.toHaveBeenCalled();
        expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
        expect(ctx.sessions).toHaveLength(0);
        expect(ctx.accounts).toHaveLength(1);
        expect(ctx.users).toHaveLength(1);
      }
    });

    it('does not issue a session when an existing account code is rejected or expired', async () => {
      const rejected = context();
      rejected.twilio.checkVerification.mockResolvedValue(false);
      const customer = existingCustomer();
      rejected.users.push(customer);
      rejected.accounts.push(customerAccount(customer.id));
      await rejected.otp.startRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.83');
      await expect(rejected.otp.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: '000000' }))
        .rejects.toBeInstanceOf(UnauthorizedException);
      expect(rejected.sessions).toHaveLength(0);
      expect(rejected.accounts).toHaveLength(1);

      const expired = context();
      expired.users.push(existingRider());
      expired.profiles.push(riderProfile(expired.users[0].id));
      await expired.otp.startRegistration(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.84');
      expired.challenges.find((challenge) => challenge.status === 'PENDING')!.expiresAt = new Date('2020-01-01T00:00:00.000Z');
      await expect(expired.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }))
        .rejects.toBeInstanceOf(UnauthorizedException);
      expect(expired.twilio.checkVerification).not.toHaveBeenCalled();
      expect(expired.sessions).toHaveLength(0);
      expect(expired.profiles).toHaveLength(1);
      expect(expired.wallets).toHaveLength(0);
    });

    it('rejects an expired upgrade code before Twilio and does not reveal the saved profile', async () => {
      const ctx = context();
      const customer = existingCustomer();
      ctx.users.push(customer);
      ctx.accounts.push(customerAccount(customer.id));
      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.73');
      ctx.challenges.find((challenge) => challenge.status === 'PENDING')!.expiresAt = new Date('2020-01-01T00:00:00.000Z');
      await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' }))
        .rejects.toBeInstanceOf(UnauthorizedException);
      expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
      expect(ctx.profiles).toHaveLength(0);
    });

    it('lets only one concurrent completion create the rider profile and wallet', async () => {
      const ctx = context();
      const customer = existingCustomer();
      ctx.users.push(customer);
      ctx.accounts.push(customerAccount(customer.id));
      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, { phone: PHONE }, '203.0.113.74');
      const proof = await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '123456' });
      if (!('registrationToken' in proof)) {
        throw new Error('expected a registration proof');
      }
      const results = await Promise.allSettled([
        ctx.otp.completeRiderRegistration({ registrationToken: proof.registrationToken, fullName: 'Rudo Ncube', address: '1 First Street' }),
        ctx.otp.completeRiderRegistration({ registrationToken: proof.registrationToken, fullName: 'Rudo Ncube', address: '1 First Street' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(ctx.users).toHaveLength(1);
      expect(ctx.profiles).toHaveLength(1);
      expect(ctx.wallets).toHaveLength(1);
      expect(ctx.accounts).toHaveLength(1);
    });
  });

  describe('Dutch test numbers', () => {
    const dutch = '+31612345678';
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      delete process.env.ALLOW_TEST_NL_PHONE_NUMBERS;
    });

    it('uses the same registration, verification, and login path for a Dutch mobile number', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
      const ctx = context();
      await ctx.otp.startRegistration(
        AuthSubjectRole.RIDER,
        { phone: '06 1234 5678', fullName: 'Test Rider' },
        '203.0.113.30',
      );
      expect(ctx.twilio.startVerification).toHaveBeenCalledWith(dutch);
      const issued = requireSession(await ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: dutch, code: '123456' }));
      expect(ctx.users[0].phone).toBe(dutch);

      await ctx.otp.startLogin(AuthSubjectRole.RIDER, { phone: '31612345678' }, '203.0.113.31');
      await ctx.otp.verifyLogin(AuthSubjectRole.RIDER, { phone: '+31 6 12345678', code: '123456' });
      expect(ctx.twilio.checkVerification).toHaveBeenLastCalledWith(dutch, '123456');
      expect(ctx.users).toHaveLength(1);
      expect(ctx.accessTokens.verify(issued.accessToken, ctx.clock.current).sub).toBe(ctx.users[0].id);
    });

    it('keeps the resend cooldown for a Dutch test number', async () => {
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
      const ctx = context();
      const body = { phone: dutch, fullName: 'Test Rider' };
      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, body, '203.0.113.33');
      await expect(ctx.otp.startRegistration(AuthSubjectRole.RIDER, body, '203.0.113.33'))
        .rejects.toBeInstanceOf(TooManyRequestsException);
      expect(ctx.twilio.startVerification).toHaveBeenCalledTimes(1);
    });

    it('rejects Dutch numbers in production even when the flag is enabled', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_NL_PHONE_NUMBERS = 'true';
      const ctx = context();
      const body = { phone: dutch, fullName: 'Test Rider' };
      expect(() => ctx.otp.startRegistration(AuthSubjectRole.RIDER, body, '203.0.113.32'))
        .toThrow(BadRequestException);
      expect(() => ctx.otp.startLogin(AuthSubjectRole.RIDER, { phone: dutch }, '203.0.113.32'))
        .toThrow(BadRequestException);
      await expect(ctx.otp.verifyRegistration(AuthSubjectRole.RIDER, { phone: dutch, code: '123456' }))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(ctx.otp.verifyLogin(AuthSubjectRole.RIDER, { phone: dutch, code: '123456' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.twilio.startVerification).not.toHaveBeenCalled();
      expect(ctx.twilio.checkVerification).not.toHaveBeenCalled();
      await ctx.otp.startRegistration(AuthSubjectRole.RIDER, registrationBody(), '203.0.113.32');
      expect(ctx.twilio.startVerification).toHaveBeenCalledWith(E164);
    });
  });
});

function requireSession(result: AuthTokens | RegistrationProof): AuthTokens {
  if (!('accessToken' in result)) {
    throw new Error('expected an authenticated session');
  }
  return result;
}

function registrationBody() {
  return { phone: PHONE, fullName: 'Tendai Moyo' };
}

function customerBody() {
  return {
    phone: PHONE,
    accountKind: 'BUSINESS',
    businessName: 'Moyo Deliveries',
    contactName: 'Tendai Moyo',
    address: '12 Samora Machel Avenue',
    role: 'ADMIN',
    userId: 'someone-else',
  };
}

function existingRider(): UserRow {
  return {
    id: randomUUID(),
    fullName: 'Tendai Moyo',
    phone: E164,
    role: UserRole.RIDER,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: new Date('2026-10-13T12:00:00.000Z'),
    passwordHash: null,
  };
}

function existingCustomer(): UserRow {
  return {
    ...existingRider(),
    id: randomUUID(),
    fullName: 'Rudo Ncube',
    role: UserRole.CUSTOMER,
  };
}

function riderProfile(userId: string): ProfileRow {
  return {
    id: randomUUID(),
    userId,
    verificationStatus: 'PENDING',
    approvalStatus: 'PENDING',
    availability: 'OFFLINE',
    licenceNumber: null,
    licenceClass: null,
    verifiedAt: null,
    reviewerId: null,
  };
}

function customerAccount(userId: string) {
  return {
    id: randomUUID(),
    userId,
    kind: 'INDIVIDUAL',
    name: 'Rudo Ncube',
    contactName: null,
    address: '1 First Street',
  };
}

function openSession(userId: string): SessionRow {
  return {
    id: 'existing-session',
    userId,
    familyId: 'existing-family',
    tokenHash: 'existing-hash',
    expiresAt: new Date('2026-10-14T12:00:00.000Z'),
    familyExpiresAt: new Date('2026-11-13T12:00:00.000Z'),
    revokedAt: null,
    replacedBySessionId: null,
  };
}

function probe(ipHash: string, createdAt: Date, index: number): ChallengeRow {
  return {
    id: randomUUID(),
    phone: `+26377${String(index).padStart(7, '0')}`,
    subjectRole: AuthSubjectRole.RIDER,
    purpose: AuthPurpose.LOGIN,
    fullName: null,
    accountKind: null,
    address: null,
    businessName: null,
    twilioSid: null,
    status: 'SUPERSEDED',
    sendCount: 0,
    checkAttempts: 0,
    lockedUntil: null,
    expiresAt: createdAt,
    ipHash,
    createdAt,
  };
}

type ProfileRow = {
  id: string;
  userId: string;
  verificationStatus: string;
  approvalStatus: string;
  availability: string;
  licenceNumber: string | null;
  licenceClass: string | null;
  address?: string | null;
  verifiedAt: Date | null;
  reviewerId: string | null;
};

type UserRow = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  passwordHash: string | null;
};

type ChallengeRow = {
  id: string;
  phone: string;
  subjectRole: AuthSubjectRole;
  purpose: AuthPurpose;
  fullName: string | null;
  accountKind: string | null;
  address: string | null;
  businessName: string | null;
  twilioSid: string | null;
  status: string;
  sendCount: number;
  checkAttempts: number;
  lockedUntil: Date | null;
  expiresAt: Date;
  ipHash: string | null;
  createdAt: Date;
};

type SessionRow = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  familyExpiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
};

class TestClock extends Clock {
  current = new Date('2026-10-13T12:00:00.000Z');

  constructor() {
    super();
    this.concealmentMs = 0;
  }

  override now(): Date {
    return this.current;
  }
}

function context() {
  const clock = new TestClock();
  const users: UserRow[] = [];
  const profiles: ProfileRow[] = [];
  const accounts: Array<{ id: string; userId: string; kind: string; name: string; contactName: string | null; address: string }> = [];
  const wallets: Array<Record<string, unknown>> = [];
  const challenges: ChallengeRow[] = [];
  const sessions: SessionRow[] = [];
  const state = { rejectNextUser: false, failNextWallet: false };
  let transactionQueue: Promise<unknown> = Promise.resolve();
  const db = {
    user: {
      async findUnique(args: { where: { id?: string; phone?: string }; include?: { riderProfile?: unknown; customerAccount?: unknown } }) {
        const user = users.find((item) => args.where.id ? item.id === args.where.id : item.phone === args.where.phone) ?? null;
        if (!user || !args.include) {
          return user;
        }
        return {
          ...user,
          riderProfile: args.include.riderProfile
            ? profiles.find((profile) => profile.userId === user.id) ?? null
            : undefined,
          customerAccount: args.include.customerAccount
            ? accounts.find((account) => account.userId === user.id) ?? null
            : undefined,
        };
      },
      async create({ data }: { data: Omit<UserRow, 'id'> }) {
        if (state.rejectNextUser || users.some((user) => user.phone === data.phone)) {
          state.rejectNextUser = false;
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '7.1.0',
          });
        }
        const user = { id: randomUUID(), ...data };
        users.push(user);
        return user;
      },
    },
    authChallenge: {
      async count({ where }: { where: Record<string, unknown> }) {
        return challenges.filter((row) => matches(row, where)).length;
      },
      async findFirst({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: 'desc' } }) {
        const found = challenges.filter((row) => matches(row, where));
        if (orderBy?.createdAt === 'desc') {
          found.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return found[0] ?? null;
      },
      async create({ data }: { data: Partial<ChallengeRow> & Pick<ChallengeRow, 'phone' | 'subjectRole' | 'purpose' | 'expiresAt'> }) {
        const row: ChallengeRow = {
          id: randomUUID(),
          fullName: null,
          accountKind: null,
          address: null,
          businessName: null,
          twilioSid: null,
          status: 'PENDING',
          sendCount: 1,
          checkAttempts: 0,
          lockedUntil: null,
          ipHash: null,
          createdAt: new Date(),
          ...data,
        };
        challenges.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<ChallengeRow> }) {
        const row = challenges.find((item) => item.id === where.id);
        if (!row) {
          throw new Error('challenge missing');
        }
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<ChallengeRow> }) {
        const matched = challenges.filter((row) => matches(row, where));
        for (const row of matched) {
          Object.assign(row, data);
        }
        return { count: matched.length };
      },
    },
    customerAccount: {
      async create({ data }: { data: { userId: string; kind: string; name: string; contactName: string | null; address: string } }) {
        if (accounts.some((account) => account.userId === data.userId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.1.0' });
        }
        const row = { id: randomUUID(), ...data };
        accounts.push(row);
        return row;
      },
    },
    riderProfile: {
      async create({ data }: { data: Partial<ProfileRow> & Pick<ProfileRow, 'userId'> }) {
        if (profiles.some((profile) => profile.userId === data.userId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.1.0' });
        }
        const row: ProfileRow = {
          id: randomUUID(),
          verificationStatus: 'PENDING',
          approvalStatus: 'PENDING',
          availability: 'OFFLINE',
          licenceNumber: null,
          licenceClass: null,
          verifiedAt: null,
          reviewerId: null,
          ...data,
        };
        profiles.push(row);
        return row;
      },
    },
    riderWallet: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (state.failNextWallet) {
          state.failNextWallet = false;
          throw new Error('wallet creation failed');
        }
        const row = { id: randomUUID(), ...data };
        wallets.push(row);
        return row;
      },
    },
    refreshSession: {
      async create({ data }: { data: Omit<SessionRow, 'id' | 'revokedAt' | 'replacedBySessionId'> }) {
        const row: SessionRow = { id: randomUUID(), revokedAt: null, replacedBySessionId: null, ...data };
        sessions.push(row);
        return row;
      },
    },
    async $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
      const run = transactionQueue.then(async () => {
        const snapshot = {
          users: structuredClone(users),
          profiles: structuredClone(profiles),
          accounts: structuredClone(accounts),
          wallets: structuredClone(wallets),
          challenges: structuredClone(challenges),
          sessions: structuredClone(sessions),
        };
        try {
          return await callback(db);
        } catch (error) {
          users.splice(0, users.length, ...snapshot.users);
          profiles.splice(0, profiles.length, ...snapshot.profiles);
          accounts.splice(0, accounts.length, ...snapshot.accounts);
          wallets.splice(0, wallets.length, ...snapshot.wallets);
          challenges.splice(0, challenges.length, ...snapshot.challenges);
          sessions.splice(0, sessions.length, ...snapshot.sessions);
          throw error;
        }
      });
      transactionQueue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  const twilio = {
    startVerification: vi.fn(async () => ({ sid: 'VE123' })),
    checkVerification: vi.fn(async () => true),
  };
  const accessTokens = new AccessTokenService();
  const sessionsService = new SessionService(db as unknown as PrismaService, accessTokens);
  const otp = new OtpAuthService(db as unknown as PrismaService, twilio, sessionsService, clock);
  return {
    clock,
    otp,
    twilio,
    users,
    profiles,
    accounts,
    wallets,
    challenges,
    sessions,
    accessTokens,
    get rejectNextUser() {
      return state.rejectNextUser;
    },
    set rejectNextUser(value: boolean) {
      state.rejectNextUser = value;
    },
    get failNextWallet() {
      return state.failNextWallet;
    },
    set failNextWallet(value: boolean) {
      state.failNextWallet = value;
    },
  };
}

function matches(row: object, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const filter = expected as { gte?: Date; gt?: Date | number; not?: unknown };
      if (filter.gte instanceof Date) {
        return actual instanceof Date && actual >= filter.gte;
      }
      if (filter.gt instanceof Date) {
        return actual instanceof Date && actual > filter.gt;
      }
      if (typeof filter.gt === 'number') {
        return typeof actual === 'number' && actual > filter.gt;
      }
      if ('not' in filter) {
        return actual !== filter.not;
      }
    }
    return actual === expected;
  });
}
