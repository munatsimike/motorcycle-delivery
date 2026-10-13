import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccountStatus, MotorcycleVerificationStatus, RiderApprovalStatus } from '../generated/prisma/client.js';
import { motorcycleForAcceptance } from './motorcycle-eligibility.js';

describe('motorcycleForAcceptance', () => {
  const bike = {
    id: 'bike-1',
    verificationStatus: MotorcycleVerificationStatus.VERIFIED,
    isActive: true,
  };

  it('returns the single active verified motorcycle for an approved rider', () => {
    const motorcycles = [bike, { id: 'bike-2', verificationStatus: MotorcycleVerificationStatus.PENDING, isActive: false }];
    expect(motorcycleForAcceptance({
      accountStatus: AccountStatus.ACTIVE,
      approvalStatus: RiderApprovalStatus.APPROVED,
      motorcycles,
    })).toBe('bike-1');
    expect(motorcycles[1].isActive).toBe(false);
  });

  it('rejects an unapproved rider or a rider without one active verified motorcycle', () => {
    expect(() => motorcycleForAcceptance({
      accountStatus: AccountStatus.ACTIVE,
      approvalStatus: RiderApprovalStatus.PENDING,
      motorcycles: [bike],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      accountStatus: AccountStatus.SUSPENDED,
      approvalStatus: RiderApprovalStatus.APPROVED,
      motorcycles: [bike],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      accountStatus: AccountStatus.ACTIVE,
      approvalStatus: RiderApprovalStatus.APPROVED,
      motorcycles: [],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      accountStatus: AccountStatus.ACTIVE,
      approvalStatus: RiderApprovalStatus.APPROVED,
      motorcycles: [bike, { ...bike, id: 'bike-2' }],
    })).toThrow(ConflictException);
    expect(() => motorcycleForAcceptance({
      accountStatus: AccountStatus.ACTIVE,
      approvalStatus: RiderApprovalStatus.APPROVED,
      motorcycles: [{ ...bike, verificationStatus: MotorcycleVerificationStatus.REVOKED, isActive: false }],
    })).toThrow(ConflictException);
  });
});
