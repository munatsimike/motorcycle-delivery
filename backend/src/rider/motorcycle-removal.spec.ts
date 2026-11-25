import { describe, expect, it } from 'vitest';
import { MotorcycleVerificationStatus } from '../generated/prisma/client.js';
import { activeMotorbikeSuccessor } from './motorcycle-removal.js';

const VERIFIED = MotorcycleVerificationStatus.VERIFIED;
const PENDING = MotorcycleVerificationStatus.PENDING;
const REJECTED = MotorcycleVerificationStatus.REJECTED;
const REVOKED = MotorcycleVerificationStatus.REVOKED;

describe('activeMotorbikeSuccessor', () => {
  it('leaves the active motorbike unchanged when an inactive one is removed', () => {
    expect(activeMotorbikeSuccessor(false, [
      { id: 'active', verificationStatus: VERIFIED, isActive: true },
      { id: 'other', verificationStatus: VERIFIED, isActive: false },
    ])).toEqual({ action: 'keep' });
  });

  it('takes the rider offline when an inactive removal leaves no active approved motorbike', () => {
    expect(activeMotorbikeSuccessor(false, [
      { id: 'approved', verificationStatus: VERIFIED, isActive: false },
    ])).toEqual({ action: 'offline' });
  });

  it('takes the rider offline when no motorbike remains', () => {
    expect(activeMotorbikeSuccessor(true, [])).toEqual({ action: 'offline' });
  });

  it('activates the only remaining approved motorbike', () => {
    expect(activeMotorbikeSuccessor(true, [
      { id: 'pending', verificationStatus: PENDING, isActive: false },
      { id: 'approved', verificationStatus: VERIFIED, isActive: false },
      { id: 'rejected', verificationStatus: REJECTED, isActive: false },
    ])).toEqual({ action: 'activate', motorcycleId: 'approved' });
  });

  it('asks the rider to choose when several approved motorbikes remain', () => {
    expect(activeMotorbikeSuccessor(true, [
      { id: 'one', verificationStatus: VERIFIED, isActive: false },
      { id: 'two', verificationStatus: VERIFIED, isActive: false },
    ])).toEqual({ action: 'offline' });
  });

  it('does not activate a pending, rejected, or revoked motorbike', () => {
    expect(activeMotorbikeSuccessor(true, [
      { id: 'pending', verificationStatus: PENDING, isActive: false },
      { id: 'rejected', verificationStatus: REJECTED, isActive: false },
      { id: 'revoked', verificationStatus: REVOKED, isActive: false },
    ])).toEqual({ action: 'offline' });
  });
});
