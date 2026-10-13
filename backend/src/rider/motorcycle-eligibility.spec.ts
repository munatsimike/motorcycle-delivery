import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  AccountStatus,
  MotorcycleVerificationStatus,
  RiderApprovalStatus,
  RiderVerificationStatus,
} from '../generated/prisma/client.js';
import { motorcycleForAcceptance } from './motorcycle-eligibility.js';

describe('motorcycleForAcceptance', () => {
  const bike = {
    id: 'bike-1',
    verificationStatus: MotorcycleVerificationStatus.VERIFIED,
    isActive: true,
  };

  const ready = {
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: new Date('2026-10-13T12:00:00.000Z'),
    approvalStatus: RiderApprovalStatus.APPROVED,
    licenceVerificationStatus: RiderVerificationStatus.VERIFIED,
  };

  it('returns the single active verified motorcycle for an approved rider', () => {
    const motorcycles = [bike, { id: 'bike-2', verificationStatus: MotorcycleVerificationStatus.PENDING, isActive: false }];
    expect(motorcycleForAcceptance({ ...ready, motorcycles })).toBe('bike-1');
    expect(motorcycles[1].isActive).toBe(false);
  });

  it('rejects a rider who is missing any operational requirement', () => {
    expect(() => motorcycleForAcceptance({
      ...ready,
      approvalStatus: RiderApprovalStatus.PENDING,
      motorcycles: [bike],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      ...ready,
      accountStatus: AccountStatus.SUSPENDED,
      motorcycles: [bike],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      ...ready,
      phoneVerifiedAt: null,
      motorcycles: [bike],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      ...ready,
      licenceVerificationStatus: RiderVerificationStatus.PENDING,
      motorcycles: [bike],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      ...ready,
      motorcycles: [],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      ...ready,
      motorcycles: [bike, { ...bike, id: 'bike-2' }],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      ...ready,
      motorcycles: [{ ...bike, verificationStatus: MotorcycleVerificationStatus.REVOKED, isActive: false }],
    })).toThrow(ConflictException);
  });
});
