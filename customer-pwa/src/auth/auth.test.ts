import assert from 'node:assert/strict';
import test from 'node:test';
import { isVerificationCode } from './code.ts';
import {
  planSessionRestore,
  readCustomerAccount,
  readLoginStart,
  readSession,
  readVerification,
  type AuthSession,
} from './contracts.ts';
import { registrationDetailsIssue } from './name.ts';
import { localPhoneEntry, normalizePhone } from './phone.ts';
import { proofExpiryMs, proofStillValid, verifiedRegistrationPhone, type StoredProof } from './proof.ts';
import { clearReturnPath, readReturnPath, rememberReturnPath, safeReturnPath } from './returnPath.ts';

test('normalizes Zimbabwe mobile numbers the same way as the customer app', () => {
  assert.equal(normalizePhone('0771234567'), '+263771234567');
  assert.equal(normalizePhone('771234567'), '+263771234567');
  assert.equal(normalizePhone('+263771234567'), '+263771234567');
  assert.throws(() => normalizePhone('123'), /Zimbabwe mobile number/);
});

test('keeps a pasted Zimbabwe number beside the fixed +263 prefix', () => {
  assert.equal(localPhoneEntry('0771234567'), '0771234567');
  assert.equal(localPhoneEntry('771234567'), '771234567');
  assert.equal(localPhoneEntry('+263771234567'), '771234567');
  assert.equal(localPhoneEntry('+263 77 123 4567'), '771234567');
  assert.equal(localPhoneEntry('263771234567'), '771234567');
  assert.equal(localPhoneEntry('00263771234567'), '771234567');
  assert.equal(normalizePhone(localPhoneEntry('+263771234567')), '+263771234567');
  assert.equal(normalizePhone(localPhoneEntry('0771234567')), '+263771234567');
});

test('accepts a 4 to 10 digit verification code', () => {
  assert.equal(isVerificationCode('1234'), true);
  assert.equal(isVerificationCode('123456'), true);
  assert.equal(isVerificationCode('123'), false);
  assert.equal(isVerificationCode('12345678901'), false);
  assert.equal(isVerificationCode('12ab'), false);
});

test('reads login, session, and registration responses without keeping partial tokens', () => {
  assert.deepEqual(readLoginStart({ status: 'unavailable' }), { status: 'unavailable' });
  assert.throws(() => readSession({ accessToken: 'access', refreshToken: 'refresh' }), /Authentication failed/);
  assert.throws(() => readSession({ accessToken: 'access' }), /Authentication failed/);
  const session = readSession({
    accessToken: 'access',
    refreshToken: 'refresh',
    accessTokenExpiresAt: 'soon',
    refreshTokenExpiresAt: 'later',
  });
  assert.equal(session.refreshToken, 'refresh');
  assert.deepEqual(readVerification({
    status: 'verified',
    registrationToken: 'proof-token',
    fullName: 'Tariro Moyo',
  }), {
    status: 'verified',
    registrationToken: 'proof-token',
    fullName: 'Tariro Moyo',
    address: undefined,
  });
});

test('requires a name, surname, and address before registration can finish', () => {
  assert.equal(registrationDetailsIssue('Tariro', '12 Samora Machel'), 'Enter your name and surname.');
  assert.equal(registrationDetailsIssue('Tariro Moyo', ''), 'Enter your name and address.');
  assert.equal(registrationDetailsIssue('Tariro Moyo', '12 Samora Machel'), null);
});

test('restores a session only while the refresh token is still valid', () => {
  const now = Date.parse('2026-11-12T12:00:00.000Z');
  const session: AuthSession = {
    accessToken: 'access',
    refreshToken: 'refresh',
    accessTokenExpiresAt: '2026-11-12T12:20:00.000Z',
    refreshTokenExpiresAt: '2026-11-13T12:00:00.000Z',
  };
  assert.deepEqual(planSessionRestore(null, now), { action: 'signed-out' });
  assert.deepEqual(planSessionRestore(session, now), { action: 'use' });
  assert.deepEqual(planSessionRestore({
    ...session,
    accessTokenExpiresAt: '2026-11-12T12:00:10.000Z',
  }, now), { action: 'refresh' });
  assert.deepEqual(planSessionRestore({
    ...session,
    refreshTokenExpiresAt: '2026-11-12T11:00:00.000Z',
  }, now), { action: 'signed-out' });
});

test('return paths stay inside the customer site', () => {
  assert.equal(safeReturnPath('/home'), '/home');
  assert.equal(safeReturnPath('/book'), '/book');
  assert.equal(safeReturnPath('/deliveries/delivery-1'), '/deliveries/delivery-1');
  assert.equal(safeReturnPath('/profile?token=secret'), '/profile');
  assert.equal(safeReturnPath('https://example.invalid/book'), null);
  assert.equal(safeReturnPath('//example.invalid'), null);
  assert.equal(safeReturnPath('/sign-in'), null);
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  };
  rememberReturnPath('/deliveries/delivery-1', storage);
  assert.equal(readReturnPath(storage), '/deliveries/delivery-1');
  rememberReturnPath('https://example.invalid/book', storage);
  assert.equal(readReturnPath(storage), null);
  rememberReturnPath('/deliveries/delivery-1', storage);
  clearReturnPath(storage);
  assert.equal(readReturnPath(storage), null);
});

test('reads the phone and expiry from a registration proof without trusting the signature', () => {
  const exp = Math.floor(Date.parse('2026-11-12T12:10:00.000Z') / 1000);
  const token = proofToken({ phone: '+263771234567', exp });
  assert.equal(verifiedRegistrationPhone(token), '+263771234567');
  assert.equal(proofExpiryMs(token), exp * 1000);
  const proof: StoredProof = {
    registrationToken: token,
    expiresAt: new Date(exp * 1000).toISOString(),
    fullName: '',
    address: '',
  };
  assert.equal(proofStillValid(proof, exp * 1000 - 1000), true);
  assert.equal(proofStillValid(proof, exp * 1000 + 1000), false);
});

test('reads the customer profile fields the website displays', () => {
  const account = readCustomerAccount({
    id: 'customer-1',
    kind: 'INDIVIDUAL',
    name: 'Tariro Moyo',
    contactName: null,
    address: '12 Samora Machel',
    phone: '+263771234567',
    email: null,
    hasProfilePhoto: true,
    marketplaceEnabled: true,
  });
  assert.equal(account.name, 'Tariro Moyo');
  assert.equal(account.phone, '+263771234567');
  assert.equal(account.hasProfilePhoto, true);
  assert.equal(account.marketplaceEnabled, true);
  assert.throws(() => readCustomerAccount({ ...account, marketplaceEnabled: undefined }), /Account details are unavailable/);
});

function proofToken(payload: unknown): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `header.${body}.signature`;
}
