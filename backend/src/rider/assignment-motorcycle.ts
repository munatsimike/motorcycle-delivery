import { AssignmentStatus } from '../generated/prisma/client.js';

const UNBOUND: ReadonlySet<AssignmentStatus> = new Set([
  AssignmentStatus.OFFERED,
  AssignmentStatus.REJECTED,
  AssignmentStatus.EXPIRED,
  AssignmentStatus.CANCELLED,
]);

const BOUND: ReadonlySet<AssignmentStatus> = new Set([
  AssignmentStatus.ACCEPTED,
  AssignmentStatus.RELEASED,
  AssignmentStatus.COMPLETED,
  AssignmentStatus.FAILED,
]);

export function assignmentMotorcycleConstraintHolds(status: AssignmentStatus, motorcycleId: string | null): boolean {
  if (UNBOUND.has(status)) {
    return motorcycleId === null;
  }
  if (BOUND.has(status)) {
    return motorcycleId !== null;
  }
  return false;
}

export function motorcycleOwnerConstraintHolds(
  assignment: { riderProfileId: string; motorcycleId: string | null },
  motorcycle: { id: string; riderProfileId: string } | null,
): boolean {
  if (assignment.motorcycleId === null) {
    return true;
  }
  return motorcycle !== null
    && motorcycle.id === assignment.motorcycleId
    && motorcycle.riderProfileId === assignment.riderProfileId;
}
