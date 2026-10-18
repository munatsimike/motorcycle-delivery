import { ExecutionContext, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistrationProofGuard } from '../auth/registration-proof.guard.js';
import { signRegistrationProof } from '../auth/registration-proof.js';
import { RegistrationPlacesController } from './registration-places.controller.js';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('registration place search', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('requires a registration proof on the customer place search', () => {
    expect(Reflect.getMetadata(PATH_METADATA, RegistrationPlacesController)).toBe('auth/customer/places');
    expect(Reflect.getMetadata(GUARDS_METADATA, RegistrationPlacesController)).toEqual([RegistrationProofGuard]);
    expect(Reflect.getMetadata(METHOD_METADATA, RegistrationPlacesController.prototype.search)).toBe(RequestMethod.GET);
  });

  it('accepts a current registration proof and rejects other tokens', () => {
    const guard = new RegistrationProofGuard();
    const proof = signRegistrationProof('01a13703-edbd-7686-af17-9fcbd5342e09', '+263771234567', new Date());

    expect(guard.canActivate(http(`Bearer ${proof}`))).toBe(true);
    expect(() => guard.canActivate(http(undefined))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(http('Bearer not-a-registration-proof'))).toThrow(UnauthorizedException);
  });
});

function http(authorization: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as ExecutionContext;
}
