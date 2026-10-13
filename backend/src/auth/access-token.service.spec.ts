import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessTokenService } from './access-token.service.js';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('AccessTokenService', () => {
  const service = new AccessTokenService();
  const issuedAt = new Date('2026-10-13T12:00:00.000Z');

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    delete process.env.JWT_ACCESS_TTL_SECONDS;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_ACCESS_TTL_SECONDS;
  });

  it('signs a 15-minute token and verifies its claims', () => {
    const signed = service.sign({ sub: 'user-1', role: 'RIDER', sid: 'session-1' }, issuedAt);
    expect(signed.expiresAt.toISOString()).toBe('2026-10-13T12:15:00.000Z');
    expect(service.verify(signed.token, new Date('2026-10-13T12:14:00.000Z'))).toEqual({
      sub: 'user-1',
      role: 'RIDER',
      sid: 'session-1',
    });
  });

  it('rejects a tampered payload', () => {
    const signed = service.sign({ sub: 'user-1', role: 'RIDER', sid: 'session-1' }, issuedAt);
    const [, payload, signature] = signed.token.split('.');
    const tampered = Buffer.from(JSON.stringify({ sub: 'user-2', role: 'ADMIN', sid: 'session-1', exp: 9999999999 })).toString('base64url');
    expect(() => service.verify(`${signed.token.split('.')[0]}.${tampered}.${signature}`)).toThrow(UnauthorizedException);
    expect(payload).toBeTruthy();
  });

  it('rejects an expired token unless logout ignores expiry', () => {
    const signed = service.sign({ sub: 'user-1', role: 'RIDER', sid: 'session-1' }, issuedAt);
    const later = new Date('2026-10-13T12:16:00.000Z');
    expect(() => service.verify(signed.token, later)).toThrow(UnauthorizedException);
    expect(service.verify(signed.token, later, { ignoreExpiration: true }).sid).toBe('session-1');
  });

  it('rejects a token signed with a different secret', () => {
    const signed = service.sign({ sub: 'user-1', role: 'RIDER', sid: 'session-1' }, issuedAt);
    process.env.JWT_ACCESS_SECRET = 'fedcba9876543210fedcba9876543210';
    expect(() => service.verify(signed.token, issuedAt)).toThrow(UnauthorizedException);
  });
});
