import { readFileSync } from 'node:fs';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountStatus, AuthChallengeStatus, AuthPurpose, AuthSubjectRole, RiderApprovalStatus, UserRole, VerificationChannel } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Clock } from './clock.js';
import type { PhoneVerificationProvider } from './phone-verification.provider.js';
import type { SessionService } from './session.service.js';
import { DEV_OTP_TTL_MS, INFOBIP_OTP_TTL_MS, OTP_CHALLENGE_TTL_MS, OTP_MAX_CHECK_ATTEMPTS } from './auth.constants.js';
import { hashInfobipOtp, verifyInfobipOtp } from './infobip-otp.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';
import { WhatsAppAuthService, type RiderVerificationResult } from './whatsapp-auth.service.js';
import type { AuthTokens } from './session.service.js';

const PHONE = '+263771234567';
const CODE = '123456';
const NOW = new Date('2026-10-23T12:00:00.000Z');

describe('WhatsApp verification', () => {
  afterEach(() => {
    delete process.env.WHATSAPP_VERIFICATION_ENABLED;
    delete process.env.WHATSAPP_VERIFICATION_PROVIDER;
    delete process.env.WHATSAPP_VERIFICATION_SERVICE_SID;
    delete process.env.WHATSAPP_VERIFICATION_SENDER;
  });

  it('does not create an account or call the provider when the rollout flag is off', async () => {
    const ctx = harness();
    delete process.env.WHATSAPP_VERIFICATION_ENABLED;
    await expect(ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.8'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.sent).toEqual([]);
    expect(ctx.issued).toEqual([]);
  });

  it('requires WhatsApp consent before creating a pending registration', async () => {
    const ctx = harness();
    await expect(ctx.service.startRegistration(AuthSubjectRole.RIDER, { ...riderBody(), whatsappConsent: false }, '203.0.113.8'))
      .rejects.toThrow('Consent to WhatsApp authentication messages is required');
    expect(ctx.users).toHaveLength(0);
    expect(ctx.sent).toEqual([]);
  });

  it('keeps a new rider unsigned until the code is approved and the profile form is completed', async () => {
    const ctx = harness();
    await expect(ctx.service.startRegistration(AuthSubjectRole.RIDER, { phone: '0771234567', whatsappConsent: true }, '203.0.113.8'))
      .resolves.toEqual({ status: 'pending' });

    expect(ctx.sent).toEqual([PHONE]);
    expect(ctx.issued).toEqual([]);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.wallets).toHaveLength(0);
    expect(ctx.challenges[0]).not.toHaveProperty('code');
    expect(Object.values(ctx.challenges[0] ?? {})).not.toContain(CODE);
    expect(JSON.stringify(ctx.challenges[0])).not.toContain('Tatenda');
    expect(ctx.challenges[0]).toMatchObject({
      purpose: AuthPurpose.WHATSAPP_REGISTRATION,
      channel: VerificationChannel.WHATSAPP,
      status: AuthChallengeStatus.PENDING,
    });

    const body = { phone: PHONE, code: CODE };
    const proof = await ctx.service.verifyRegistration(AuthSubjectRole.RIDER, body);
    expect(proof).toMatchObject({ status: 'verified' });
    expect(proof).not.toHaveProperty('accessToken');
    expect(body.code).toBeUndefined();
    expect(ctx.users).toHaveLength(0);
    expect(ctx.issued).toEqual([]);

    const tokens = await ctx.service.completeRiderRegistration({
      registrationToken: registrationToken(proof),
      fullName: 'Tatenda Moyo',
      address: '12 Samora Machel Avenue',
    });
    expect(tokens).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ctx.users[0]).toMatchObject({
      phone: PHONE,
      fullName: 'Tatenda Moyo',
      accountStatus: AccountStatus.ACTIVE,
      phoneVerifiedAt: NOW,
      role: UserRole.RIDER,
    });
    expect(ctx.users[0]?.riderProfile).toMatchObject({
      approvalStatus: RiderApprovalStatus.PENDING,
      address: '12 Samora Machel Avenue',
    });
    expect(ctx.wallets).toHaveLength(1);
    expect(ctx.issued).toEqual([ctx.users[0]?.id]);
  });

  it('signs in an existing account with a WhatsApp code and issues a session', async () => {
    const ctx = harness();
    ctx.users.push(user({ phoneVerifiedAt: NOW, accountStatus: AccountStatus.ACTIVE, whatsappConsentAt: NOW }));
    await expect(ctx.service.startLogin(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.20'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.challenges[0]?.purpose).toBe(AuthPurpose.LOGIN);
    const tokens = await ctx.service.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE });
    expect(tokens).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ctx.issued).toEqual([ctx.users[0]?.id]);
  });

  it('signs a rider who also has a customer profile into the customer app', async () => {
    const ctx = harness();
    ctx.users.push(user({
      phoneVerifiedAt: NOW,
      accountStatus: AccountStatus.ACTIVE,
      whatsappConsentAt: NOW,
      customerAccount: { id: 'customer-1' },
    }));
    await expect(ctx.service.startLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE, whatsappConsent: true }, '203.0.113.22'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.sent).toEqual([PHONE]);
  });

  it('does not revoke the current rider session when a sign-in code is rejected', async () => {
    const ctx = harness();
    const account = user({ phoneVerifiedAt: NOW, accountStatus: AccountStatus.ACTIVE, whatsappConsentAt: NOW });
    ctx.users.push(account);
    ctx.sessions.push({ userId: account.id, revokedAt: null });
    await ctx.service.startLogin(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.23');
    await expect(ctx.service.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: '000000' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.issued).toEqual([]);
    expect(ctx.sessions[0]?.revokedAt).toBeNull();
  });

  it('sends a sign-in code without revealing that the number has no account', async () => {
    const ctx = harness();
    const started = await ctx.service.startLogin(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.21');
    expect(started).toEqual({ status: 'pending' });
    expect(JSON.stringify(started)).not.toContain('unavailable');
    expect(ctx.sent).toEqual([PHONE]);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.issued).toEqual([]);
  });

  it('rejects a wrong, expired, or repeated code without activating the account', async () => {
    const ctx = harness();
    await ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.9');
    const wrong = { phone: PHONE, code: '000000' };
    const failure = await expectFailure(ctx.service.verifyRegistration(AuthSubjectRole.RIDER, wrong));
    expect(failure).toBeInstanceOf(UnauthorizedException);
    expect(failure.message).toBe('Verification code is invalid');
    expect(failure.message).not.toContain('000000');
    expect(wrong.code).toBeUndefined();
    expect(ctx.users).toHaveLength(0);
    expect(ctx.checks).toEqual(['000000']);

    ctx.challenges[0]!.expiresAt = new Date('2020-01-01T00:00:00.000Z');
    ctx.checks.length = 0;
    await expect(ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.checks).toEqual([]);
    expect(ctx.users).toHaveLength(0);
    expect(ctx.issued).toEqual([]);
  });

  it('signs in an existing rider who selects sign up without creating another profile', async () => {
    const ctx = harness();
    const verifiedAt = new Date('2026-10-01T00:00:00.000Z');
    const account = user({
      phoneVerifiedAt: verifiedAt,
      passwordHash: null,
      accountStatus: AccountStatus.ACTIVE,
      whatsappConsentAt: null,
      fullName: 'Tatenda Moyo',
    });
    ctx.users.push(account);
    const profileId = account.riderProfile?.id;

    await expect(ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.10'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.sent).toEqual([PHONE]);
    const tokens = await ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE });
    expect(tokens).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ctx.users).toHaveLength(1);
    expect(ctx.users[0]?.riderProfile?.id).toBe(profileId);
    expect(ctx.users[0]?.riderProfile?.approvalStatus).toBe(RiderApprovalStatus.PENDING);
    expect(ctx.users[0]?.fullName).toBe('Tatenda Moyo');
    expect(ctx.users[0]?.phoneVerifiedAt).toEqual(verifiedAt);
    expect(ctx.users[0]?.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(ctx.wallets).toHaveLength(0);
    expect(ctx.issued).toEqual([account.id]);
  });

  it('rate limits resend and still lets a later resend through', async () => {
    const ctx = harness();
    await ctx.service.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.11');
    await expect(ctx.service.resendRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.11'))
      .rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.sent).toHaveLength(1);

    ctx.now.setTime(NOW.getTime() + 61_000);
    await expect(ctx.service.resendRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.11'))
      .resolves.toEqual({ status: 'pending' });
    expect(ctx.sent).toEqual([PHONE, PHONE]);
    expect(ctx.challenges.filter((challenge) => challenge.status === AuthChallengeStatus.PENDING)).toHaveLength(1);
  });

  it('uses a five-minute challenge for the local mock and keeps the code out of the response', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    process.env.DEV_OTP_ENABLED = 'true';
    try {
      const ctx = harness();
      delete process.env.WHATSAPP_VERIFICATION_ENABLED;
      delete process.env.WHATSAPP_VERIFICATION_PROVIDER;
      delete process.env.WHATSAPP_VERIFICATION_SERVICE_SID;
      delete process.env.WHATSAPP_VERIFICATION_SENDER;
      const started = await ctx.service.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.41');
      expect(started).toEqual({ status: 'pending' });
      expect(JSON.stringify(started)).not.toContain(CODE);
      expect(ctx.challenges[0]?.expiresAt.getTime()).toBe(NOW.getTime() + DEV_OTP_TTL_MS);
      expect(ctx.challenges[0]).not.toHaveProperty('code');
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      delete process.env.DEV_OTP_ENABLED;
    }
  });

  it('keeps a ten-minute Twilio challenge and stores no code hash', async () => {
    const ctx = harness();
    await ctx.service.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.50');
    expect(ctx.challenges[0]?.expiresAt.getTime()).toBe(NOW.getTime() + OTP_CHALLENGE_TTL_MS);
    expect(ctx.challenges[0]?.codeHash).toBeNull();
  });

  it('registers and signs in through Infobip with a five-minute hashed code', async () => {
    const previous = infobipEnv();
    try {
      const ctx = infobipHarness();
      const registered = await ctx.service.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.51');
      expect(registered).toEqual({ status: 'pending' });
      expect(JSON.stringify(registered)).not.toContain(ctx.plainCode);
      expect(ctx.challenges[0]?.expiresAt.getTime()).toBe(NOW.getTime() + INFOBIP_OTP_TTL_MS);
      expect(ctx.challenges[0]?.codeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(ctx.challenges[0]?.codeHash).not.toBe(ctx.plainCode);
      ctx.now.setTime(NOW.getTime() + 61_000);
      await ctx.service.resendRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE }, '203.0.113.51');
      const pending = ctx.challenges.filter((challenge) => challenge.status === AuthChallengeStatus.PENDING);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.expiresAt.getTime()).toBe(ctx.now.getTime() + INFOBIP_OTP_TTL_MS);
      const tokens = asSession(await ctx.service.verifyRegistration(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: ctx.plainCode }));
      expect(tokens.accessToken).toBe('access');
      expect(ctx.issued).toHaveLength(1);
      expect(ctx.users[0]?.phoneVerifiedAt).toEqual(ctx.now);
      expect(ctx.users[0]?.accountStatus).toBe(AccountStatus.ACTIVE);

      ctx.now.setTime(NOW.getTime() + 61_000);
      const login = await ctx.service.startLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE, whatsappConsent: true }, '203.0.113.52');
      expect(login).toEqual({ status: 'pending' });
      const signedIn = asSession(await ctx.service.verifyLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE, code: ctx.plainCode }));
      expect(signedIn.refreshToken).toBe('refresh');
      expect(ctx.issued).toHaveLength(2);
    } finally {
      restoreEnv(previous);
    }
  });

  it('rejects a reused, wrong, expired, or cross-flow Infobip code and then locks', async () => {
    const previous = infobipEnv();
    try {
      const ctx = infobipHarness();
      await ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.53');
      const registrationHash = ctx.challenges[0]?.codeHash ?? '';
      expect(verifyInfobipOtp(INFOBIP_SECRET, {
        challengeId: ctx.challenges[0]!.id,
        phone: PHONE,
        purpose: AuthPurpose.LOGIN,
        code: ctx.plainCode,
      }, registrationHash)).toBe(false);
      for (let attempt = 0; attempt < OTP_MAX_CHECK_ATTEMPTS; attempt += 1) {
        await expect(ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: '000000' }))
          .rejects.toBeInstanceOf(UnauthorizedException);
      }
      await expect(ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: ctx.plainCode }))
        .rejects.toBeInstanceOf(TooManyRequestsException);
      expect(ctx.users).toHaveLength(0);
      expect(ctx.issued).toEqual([]);

      ctx.challenges[0]!.status = AuthChallengeStatus.PENDING;
      ctx.challenges[0]!.lockedUntil = null;
      ctx.challenges[0]!.checkAttempts = 0;
      ctx.challenges[0]!.expiresAt = new Date(NOW.getTime() - 1_000);
      await expect(ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: ctx.plainCode }))
        .rejects.toBeInstanceOf(UnauthorizedException);
      expect(ctx.challenges[0]?.status).toBe(AuthChallengeStatus.EXPIRED);
    } finally {
      restoreEnv(previous);
    }
  });

  it('lets only one of two simultaneous Infobip verifications create a session', async () => {
    const previous = infobipEnv();
    try {
      const ctx = infobipHarness();
      await ctx.service.startRegistration(AuthSubjectRole.RIDER, riderBody(), '203.0.113.54');
      const results = await Promise.allSettled([
        ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: ctx.plainCode }),
        ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: ctx.plainCode }),
      ]);
      const accepted = results.filter((result) => result.status === 'fulfilled');
      expect(accepted).toHaveLength(1);
      expect(ctx.issued).toHaveLength(0);
      expect(ctx.users).toHaveLength(0);
      expect(ctx.challenges.filter((challenge) => challenge.status === AuthChallengeStatus.VERIFIED)).toHaveLength(1);
      const proof = accepted[0]?.status === 'fulfilled' ? accepted[0].value : null;
      const completed = await ctx.service.completeRiderRegistration({
        registrationToken: registrationToken(proof),
        fullName: 'Tatenda Moyo',
        address: '12 Samora Machel Avenue',
      });
      expect(completed.accessToken).toBe('access');
      expect(ctx.users).toHaveLength(1);
      expect(ctx.users[0]?.riderProfile?.approvalStatus).toBe(RiderApprovalStatus.PENDING);
      expect(ctx.issued).toHaveLength(1);
      await expect(ctx.service.completeRiderRegistration({
        registrationToken: registrationToken(proof),
        fullName: 'Tatenda Moyo',
        address: '12 Samora Machel Avenue',
      })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(ctx.users).toHaveLength(1);
      expect(ctx.issued).toHaveLength(1);
    } finally {
      restoreEnv(previous);
    }
  });

  it('does not verify the phone when Infobip rejects the message', async () => {
    const previous = infobipEnv();
    try {
      const ctx = infobipHarness(true);
      const failure = await expectFailure(ctx.service.startRegistration(AuthSubjectRole.CUSTOMER, customerBody(), '203.0.113.55'));
      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      expect(failure.message).not.toMatch(/\d{6}/);
      expect(failure.message).not.toContain(INFOBIP_SECRET);
      expect(ctx.challenges[0]?.status).toBe(AuthChallengeStatus.SUPERSEDED);
      expect(ctx.challenges[0]?.codeHash).toBeNull();
      expect(ctx.users[0]?.phoneVerifiedAt).toBeNull();
    } finally {
      restoreEnv(previous);
    }
  });

  it('stops an address after the hourly verification limit', async () => {
    const ctx = harness();
    for (let index = 0; index < 20; index += 1) {
      const phone = `+26377${String(index).padStart(7, '0')}`;
      await ctx.service.startRegistration(AuthSubjectRole.RIDER, { ...riderBody(), phone }, '203.0.113.40');
    }
    await expect(ctx.service.startRegistration(
      AuthSubjectRole.RIDER,
      { ...riderBody(), phone: '+263770000020' },
      '203.0.113.40',
    )).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(ctx.sent).toHaveLength(20);
  });

  it('lets a customer become a rider without changing the customer identity', async () => {
    const ctx = harness();
    const account = user({
      role: UserRole.CUSTOMER,
      fullName: 'Rudo Ncube',
      accountStatus: AccountStatus.ACTIVE,
      phoneVerifiedAt: NOW,
      whatsappConsentAt: NOW,
      riderProfile: null,
      customerAccount: { id: 'customer-1' },
    });
    ctx.users.push(account);
    await ctx.service.startLogin(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.60');
    const proof = await ctx.service.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE });
    expect(proof).toMatchObject({
      status: 'verified',
      fullName: 'Rudo Ncube',
      readOnly: ['fullName'],
    });
    expect(proof).not.toHaveProperty('accessToken');
    expect(ctx.issued).toEqual([]);

    const tokens = await ctx.service.completeRiderRegistration({
      registrationToken: registrationToken(proof),
      fullName: 'Different Name',
      address: '9 Rezende Street',
    });
    expect(tokens).toMatchObject({ accessToken: 'access' });
    expect(ctx.users).toHaveLength(1);
    expect(ctx.users[0]).toMatchObject({
      role: UserRole.CUSTOMER,
      fullName: 'Rudo Ncube',
      accountStatus: AccountStatus.ACTIVE,
      phoneVerifiedAt: NOW,
      customerAccount: { id: 'customer-1' },
    });
    expect(ctx.users[0]?.riderProfile).toMatchObject({
      approvalStatus: RiderApprovalStatus.PENDING,
      address: '9 Rezende Street',
    });
    expect(ctx.wallets).toHaveLength(1);

    ctx.now.setTime(NOW.getTime() + 61_000);
    await expect(ctx.service.startLogin(AuthSubjectRole.CUSTOMER, { phone: PHONE, whatsappConsent: true }, '203.0.113.61'))
      .resolves.toEqual({ status: 'pending' });
  });

  it('signs in a customer-role user who already has a rider profile', async () => {
    const ctx = harness();
    const account = user({
      role: UserRole.CUSTOMER,
      accountStatus: AccountStatus.ACTIVE,
      phoneVerifiedAt: NOW,
      whatsappConsentAt: NOW,
      customerAccount: { id: 'customer-1' },
    });
    ctx.users.push(account);
    const profileId = account.riderProfile?.id;
    await ctx.service.startLogin(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.62');
    const tokens = await ctx.service.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE });
    expect(tokens).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ctx.users).toHaveLength(1);
    expect(ctx.users[0]?.role).toBe(UserRole.CUSTOMER);
    expect(ctx.users[0]?.riderProfile?.id).toBe(profileId);
    expect(ctx.users[0]?.riderProfile?.approvalStatus).toBe(RiderApprovalStatus.PENDING);
    expect(ctx.issued).toEqual([account.id]);
  });

  it('refuses a suspended account after the code without a session or profile details', async () => {
    const ctx = harness();
    ctx.users.push(user({
      fullName: 'Private Name',
      accountStatus: AccountStatus.SUSPENDED,
      phoneVerifiedAt: NOW,
      whatsappConsentAt: NOW,
    }));
    await ctx.service.startLogin(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.63');
    const failure = await expectFailure(ctx.service.verifyLogin(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE }));
    expect(failure).toBeInstanceOf(UnauthorizedException);
    expect(failure.message).toBe('Authentication failed');
    expect(failure.message).not.toContain('Private');
    expect(failure.message).not.toContain('SUSPENDED');
    expect(ctx.issued).toEqual([]);
    expect(ctx.wallets).toHaveLength(0);
    await expect(ctx.service.completeRiderRegistration({
      registrationToken: 'not-a-registration-proof-token',
      fullName: 'Private Name',
      address: '1 First Street',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid, customer, expired, or replayed rider registration proof', async () => {
    const ctx = harness();
    await ctx.service.startRegistration(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.64');
    const proof = await ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE });
    const token = registrationToken(proof);
    const { signRegistrationProof } = await import('./registration-proof.js');
    const customerProof = signRegistrationProof(ctx.challenges[0]!.id, PHONE, NOW);
    await expect(ctx.service.completeRiderRegistration({
      registrationToken: customerProof,
      fullName: 'Tatenda Moyo',
      address: '12 Samora Machel Avenue',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctx.service.completeRiderRegistration({
      registrationToken: 'not-a-registration-proof',
      fullName: 'Tatenda Moyo',
      address: '12 Samora Machel Avenue',
    })).rejects.toBeInstanceOf(UnauthorizedException);

    const expired = signRegistrationProof(ctx.challenges[0]!.id, PHONE, new Date(NOW.getTime() - 16 * 60_000), 'rider-registration');
    await expect(ctx.service.completeRiderRegistration({
      registrationToken: expired,
      fullName: 'Tatenda Moyo',
      address: '12 Samora Machel Avenue',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users).toHaveLength(0);

    await ctx.service.completeRiderRegistration({
      registrationToken: token,
      fullName: 'Tatenda Moyo',
      address: '12 Samora Machel Avenue',
    });
    await expect(ctx.service.completeRiderRegistration({
      registrationToken: token,
      fullName: 'Tatenda Moyo',
      address: '12 Samora Machel Avenue',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.users).toHaveLength(1);
    expect(ctx.wallets).toHaveLength(1);
    expect(ctx.issued).toHaveLength(1);
  });

  it('lets only one of two simultaneous profile completions create a rider', async () => {
    const ctx = harness();
    await ctx.service.startRegistration(AuthSubjectRole.RIDER, { phone: PHONE, whatsappConsent: true }, '203.0.113.65');
    const proof = await ctx.service.verifyRegistration(AuthSubjectRole.RIDER, { phone: PHONE, code: CODE });
    const body = {
      registrationToken: registrationToken(proof),
      fullName: 'Tatenda Moyo',
      address: '12 Samora Machel Avenue',
    };
    const results = await Promise.allSettled([
      ctx.service.completeRiderRegistration(body),
      ctx.service.completeRiderRegistration({ ...body }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(ctx.users).toHaveLength(1);
    expect(ctx.wallets).toHaveLength(1);
    expect(ctx.issued).toHaveLength(1);
    expect(ctx.users[0]?.riderProfile?.approvalStatus).toBe(RiderApprovalStatus.PENDING);
  });

  it('leaves the one-accepted rider index and historical checksums untouched', () => {
    const sql = readFileSync('prisma/migrations/20261023200000_whatsapp_verification/migration.sql', 'utf8');
    expect(sql).toContain('WHATSAPP_REGISTRATION');
    expect(sql).toContain('PASSWORD_RECOVERY');
    expect(sql).toContain('whatsapp_consent_at');
    expect(sql).not.toMatch(/DROP\s+(INDEX|CONSTRAINT)/);
    expect(sql).not.toContain('delivery_assignments_one_accepted_per_rider_idx');
  });
});

function riderBody() {
  return {
    phone: '0771234567',
    fullName: 'Tatenda Moyo',
    address: '12 Samora Machel Avenue',
    whatsappConsent: true,
  };
}

function customerBody() {
  return {
    phone: PHONE,
    accountKind: 'INDIVIDUAL',
    fullName: 'Rudo Ncube',
    address: '4 Jason Moyo',
    whatsappConsent: true,
  };
}

const INFOBIP_SECRET = 'h'.repeat(48);
const INFOBIP_ENV_KEYS = [
  'WHATSAPP_VERIFICATION_ENABLED',
  'WHATSAPP_VERIFICATION_PROVIDER',
  'INFOBIP_BASE_URL',
  'INFOBIP_API_KEY',
  'INFOBIP_WHATSAPP_SENDER',
  'INFOBIP_WHATSAPP_TEMPLATE',
  'INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE',
  'INFOBIP_OTP_HMAC_SECRET',
] as const;

function infobipEnv(): NodeJS.ProcessEnv {
  const previous: NodeJS.ProcessEnv = {};
  for (const key of INFOBIP_ENV_KEYS) {
    previous[key] = process.env[key];
  }
  process.env.WHATSAPP_VERIFICATION_ENABLED = 'true';
  process.env.WHATSAPP_VERIFICATION_PROVIDER = 'infobip';
  process.env.INFOBIP_BASE_URL = 'https://example.test';
  process.env.INFOBIP_API_KEY = 'k'.repeat(40);
  process.env.INFOBIP_WHATSAPP_SENDER = '447860088970';
  process.env.INFOBIP_WHATSAPP_TEMPLATE = 'authentication';
  process.env.INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE = 'en';
  process.env.INFOBIP_OTP_HMAC_SECRET = INFOBIP_SECRET;
  return previous;
}

function restoreEnv(previous: NodeJS.ProcessEnv): void {
  for (const key of INFOBIP_ENV_KEYS) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }
}

function infobipHarness(fail = false) {
  let plainCode = '';
  const ctx = harness({
    async send(_phone, context) {
      if (!context) {
        throw new ServiceUnavailableException('WhatsApp verification is unavailable');
      }
      if (fail) {
        throw new ServiceUnavailableException('WhatsApp could not deliver the verification code to this number. On a trial account, only the number verified with Infobip can receive it.');
      }
      plainCode = '654321';
      return {
        sid: context.challengeId,
        codeHash: hashInfobipOtp(INFOBIP_SECRET, {
          challengeId: context.challengeId,
          phone: context.phone,
          purpose: context.purpose,
          code: plainCode,
        }),
      };
    },
    async check(phone, code, context) {
      if (!context?.codeHash) {
        return false;
      }
      return verifyInfobipOtp(INFOBIP_SECRET, {
        challengeId: context.challengeId,
        phone,
        purpose: context.purpose,
        code,
      }, context.codeHash);
    },
  });
  infobipEnv();
  return {
    ...ctx,
    get plainCode() {
      return plainCode;
    },
  };
}

function asSession(result: RiderVerificationResult): AuthTokens {
  if (!('accessToken' in result)) {
    throw new Error('expected a session');
  }
  return result;
}

function registrationToken(value: unknown): string {
  if (!value || typeof value !== 'object' || !('registrationToken' in value) || typeof value.registrationToken !== 'string') {
    throw new Error('expected a registration proof');
  }
  return value.registrationToken;
}

function harness(verificationOverride?: PhoneVerificationProvider) {
  if (!process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET.length < 32) {
    process.env.JWT_ACCESS_SECRET = '0123456789abcdef0123456789abcdef';
  }
  process.env.WHATSAPP_VERIFICATION_ENABLED = 'true';
  process.env.WHATSAPP_VERIFICATION_PROVIDER = 'twilio';
  process.env.WHATSAPP_VERIFICATION_SERVICE_SID = `VA${'c'.repeat(32)}`;
  process.env.WHATSAPP_VERIFICATION_SENDER = '+263771000000';
  const users: UserRow[] = [];
  const challenges: ChallengeRow[] = [];
  const sessions: SessionRow[] = [];
  const wallets: string[] = [];
  const sent: string[] = [];
  const checks: string[] = [];
  const issued: string[] = [];
  const now = new Date(NOW);
  const db = memory(users, challenges, sessions, wallets);
  const verification: PhoneVerificationProvider = verificationOverride ?? {
    async send(phone: string) {
      sent.push(phone);
      return { sid: `VE${sent.length}` };
    },
    async check(_phone: string, code: string) {
      checks.push(code);
      return code === CODE;
    },
  };
  const sessionService = {
    async issue(_writer: unknown, userId: string) {
      issued.push(userId);
      sessions.push({ userId, revokedAt: null });
      return {
        accessToken: 'access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: 'soon',
        refreshTokenExpiresAt: 'later',
      };
    },
    async revokeAll(userId: string, writer: typeof db) {
      await writer.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
  const clock: Clock = {
    concealmentMs: 0,
    now: () => new Date(now.getTime()),
    pause: () => Promise.resolve(),
  };
  return {
    users,
    challenges,
    sessions,
    wallets,
    sent,
    checks,
    issued,
    now,
    service: new WhatsAppAuthService(
      db as unknown as PrismaService,
      sessionService as unknown as SessionService,
      verification,
      clock,
    ),
  };
}

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: randomUUID(),
    fullName: 'Tatenda Moyo',
    phone: PHONE,
    role: UserRole.RIDER,
    accountStatus: AccountStatus.PENDING,
    phoneVerifiedAt: null,
    passwordHash: 'stored-hash',
    whatsappConsentAt: NOW,
    riderProfile: { id: randomUUID(), approvalStatus: RiderApprovalStatus.PENDING, address: null },
    customerAccount: null,
    ...overrides,
  };
}

type UserRow = {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  passwordHash: string | null;
  whatsappConsentAt: Date | null;
  riderProfile: { id: string; approvalStatus: RiderApprovalStatus; address: string | null } | null;
  customerAccount: { id: string } | null;
};

type ChallengeRow = {
  id: string;
  phone: string;
  subjectRole: AuthSubjectRole;
  purpose: AuthPurpose;
  channel: VerificationChannel;
  status: AuthChallengeStatus;
  sendCount: number;
  checkAttempts: number;
  lockedUntil: Date | null;
  expiresAt: Date;
  ipHash: string | null;
  twilioSid: string | null;
  codeHash: string | null;
  createdAt: Date;
};

type SessionRow = { userId: string; revokedAt: Date | null };

function memory(users: UserRow[], challenges: ChallengeRow[], sessions: SessionRow[], wallets: string[]) {
  const db = {
    user: {
      async create({ data }: { data: Partial<UserRow> & { phone: string } }) {
        const created: UserRow = {
          id: randomUUID(),
          fullName: data.fullName ?? '',
          phone: data.phone,
          role: data.role ?? UserRole.RIDER,
          accountStatus: data.accountStatus ?? AccountStatus.PENDING,
          phoneVerifiedAt: data.phoneVerifiedAt ?? null,
          passwordHash: data.passwordHash ?? null,
          whatsappConsentAt: data.whatsappConsentAt ?? null,
          riderProfile: null,
          customerAccount: null,
        };
        users.push(created);
        return created;
      },
      async findUnique({ where }: { where: { phone?: string; id?: string } }) {
        const found = users.find((row) => (where.id ? row.id === where.id : row.phone === where.phone));
        return found ? { ...found, riderProfile: found.riderProfile, customerAccount: found.customerAccount } : null;
      },
      async findUniqueOrThrow(input: { where: { id?: string; phone?: string } }): Promise<UserRow> {
        const found = await db.user.findUnique(input);
        if (!found) {
          throw new Error('missing user');
        }
        return found;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const found = users.find((row) => row.id === where.id);
        if (!found) {
          throw new Error('missing user');
        }
        const { customerAccount, riderProfile, ...rest } = data;
        Object.assign(found, rest);
        if (customerAccount && typeof customerAccount === 'object' && 'update' in customerAccount && found.customerAccount) {
          Object.assign(found.customerAccount, (customerAccount as { update: object }).update);
        }
        if (riderProfile && typeof riderProfile === 'object' && 'update' in riderProfile && found.riderProfile) {
          Object.assign(found.riderProfile, (riderProfile as { update: object }).update);
        }
        return found;
      },
    },
    riderProfile: {
      async create({ data }: { data: { userId: string; approvalStatus: RiderApprovalStatus; address?: string | null } }) {
        const profile = { id: randomUUID(), approvalStatus: data.approvalStatus, address: data.address ?? null };
        const owner = users.find((row) => row.id === data.userId);
        if (owner) {
          owner.riderProfile = profile;
        }
        return profile;
      },
    },
    customerAccount: {
      async create({ data }: { data: { userId: string } }) {
        const account = { id: randomUUID() };
        const owner = users.find((row) => row.id === data.userId);
        if (owner) {
          owner.customerAccount = account;
        }
        return account;
      },
    },
    riderWallet: {
      async create({ data }: { data: { riderProfileId: string } }) {
        wallets.push(data.riderProfileId);
        return data;
      },
    },
    authChallenge: {
      async create({ data }: { data: Partial<ChallengeRow> & { phone: string } }) {
        const created: ChallengeRow = {
          id: randomUUID(),
          phone: data.phone,
          subjectRole: data.subjectRole ?? AuthSubjectRole.RIDER,
          purpose: data.purpose ?? AuthPurpose.WHATSAPP_REGISTRATION,
          channel: data.channel ?? VerificationChannel.WHATSAPP,
          status: data.status ?? AuthChallengeStatus.PENDING,
          sendCount: data.sendCount ?? 1,
          checkAttempts: data.checkAttempts ?? 0,
          lockedUntil: data.lockedUntil ?? null,
          expiresAt: data.expiresAt ?? NOW,
          ipHash: data.ipHash ?? null,
          twilioSid: data.twilioSid ?? null,
          codeHash: data.codeHash ?? null,
          createdAt: data.createdAt ?? NOW,
        };
        challenges.push(created);
        return created;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<ChallengeRow> }) {
        const found = challenges.find((row) => row.id === where.id);
        if (!found) {
          throw new Error('missing challenge');
        }
        Object.assign(found, data);
        return found;
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<ChallengeRow> }) {
        const matches = challenges.filter((row) => matchesWhere(row, where));
        matches.forEach((row) => Object.assign(row, data));
        return { count: matches.length };
      },
      async findFirst({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: 'desc' } }) {
        const matches = challenges.filter((row) => matchesWhere(row, where));
        if (orderBy?.createdAt === 'desc') {
          matches.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return matches[0] ?? null;
      },
      async count({ where }: { where: Record<string, unknown> }) {
        return challenges.filter((row) => matchesWhere(row, where)).length;
      },
    },
    async $queryRaw() {
      return [];
    },
    refreshSession: {
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<SessionRow> }) {
        const matches = sessions.filter((row) => matchesWhere(row, where));
        matches.forEach((row) => Object.assign(row, data));
        return { count: matches.length };
      },
    },
    async $transaction<T>(callback: (writer: object) => Promise<T>) {
      return callback(db);
    },
  };
  return db;
}

function matchesWhere(row: object, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const filter = expected as { gte?: Date; gt?: Date | number; not?: unknown };
      if (filter.gte instanceof Date) {
        return actual instanceof Date && actual.getTime() >= filter.gte.getTime();
      }
      if (filter.gt instanceof Date) {
        return actual instanceof Date && actual.getTime() > filter.gt.getTime();
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

async function expectFailure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error('expected a failure');
}
