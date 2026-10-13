import { describe, expect, it } from 'vitest';
import { AssignmentStatus } from '../generated/prisma/client.js';
import { assignmentMotorcycleConstraintHolds, motorcycleOwnerConstraintHolds } from './assignment-motorcycle.js';

describe('assignment motorcycle constraints', () => {
  const unbound = [AssignmentStatus.OFFERED, AssignmentStatus.REJECTED, AssignmentStatus.EXPIRED, AssignmentStatus.CANCELLED];
  const bound = [AssignmentStatus.ACCEPTED, AssignmentStatus.RELEASED, AssignmentStatus.COMPLETED, AssignmentStatus.FAILED];

  it('allows a null motorcycle only before acceptance', () => {
    for (const status of unbound) {
      expect(assignmentMotorcycleConstraintHolds(status, null)).toBe(true);
      expect(assignmentMotorcycleConstraintHolds(status, 'bike-1')).toBe(false);
    }
    for (const status of bound) {
      expect(assignmentMotorcycleConstraintHolds(status, null)).toBe(false);
      expect(assignmentMotorcycleConstraintHolds(status, 'bike-1')).toBe(true);
    }
  });

  it('requires the motorcycle to belong to the assignment rider', () => {
    const owned = { id: 'bike-1', riderProfileId: 'profile-1' };
    expect(motorcycleOwnerConstraintHolds({ riderProfileId: 'profile-1', motorcycleId: null }, null)).toBe(true);
    expect(motorcycleOwnerConstraintHolds({ riderProfileId: 'profile-1', motorcycleId: 'bike-1' }, owned)).toBe(true);
    expect(motorcycleOwnerConstraintHolds({ riderProfileId: 'profile-2', motorcycleId: 'bike-1' }, owned)).toBe(false);
    expect(motorcycleOwnerConstraintHolds({ riderProfileId: 'profile-1', motorcycleId: 'bike-2' }, owned)).toBe(false);
  });
});
