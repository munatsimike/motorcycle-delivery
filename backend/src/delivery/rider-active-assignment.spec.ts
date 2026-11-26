import { mockExactPage } from '../common/exact-page.test-support.js';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { encodeListCursor } from '../common/list-cursor.js';
import {
  AssignmentStatus,
  CoordinateSource,
  Currency,
  DeliveryStatus,
} from '../generated/prisma/client.js';
import { RiderAccessGuard } from '../auth/rider-access.guard.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DispatchService, type ActiveAssignment } from './dispatch.service.js';
import { PlacesService } from './places.service.js';
import { RiderAssignmentController } from './rider-assignment.controller.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const FRESH = new Date('2026-10-18T12:00:00.000Z');
const EXPIRED = new Date('2026-09-01T12:00:00.000Z');

describe('active rider assignment', () => {
  it('requires the rider guard and ignores any other rider id', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, RiderAssignmentController)).toBe('riders/me/assignments');
    expect(Reflect.getMetadata(GUARDS_METADATA, RiderAssignmentController)).toEqual([RiderAccessGuard]);
    expect(Reflect.getMetadata(METHOD_METADATA, RiderAssignmentController.prototype.active)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, RiderAssignmentController.prototype.active)).toBe('active');

    const seen: string[] = [];
    const controller = new RiderAssignmentController({
      async activeAssignment(actor: { riderProfileId: string }) {
        seen.push(actor.riderProfileId);
        return { assignment: null };
      },
    } as unknown as DispatchService);

    expect(() => controller.active({})).toThrow(ForbiddenException);
    const request = { rider: { userId: 'user-1', riderProfileId: 'profile-1' } };
    await controller.active(request);
    expect(seen).toEqual(['profile-1']);
  });

  it('returns only this rider accepted in-progress delivery', async () => {
    const service = serviceFor([
      row('other-assignment', 'other-profile', AssignmentStatus.ACCEPTED, DeliveryStatus.ASSIGNED, 'Other rider road'),
      row('offered', 'profile-1', AssignmentStatus.OFFERED, DeliveryStatus.SEARCHING, 'Open offer road'),
      row('released', 'profile-1', AssignmentStatus.RELEASED, DeliveryStatus.SEARCHING, 'Released road'),
      row('delivered', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.DELIVERED, 'Finished road'),
      row('cancelled', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.CANCELLED, 'Cancelled road'),
      row('failed', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.FAILED, 'Failed road'),
      row('active', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.PICKED_UP, '12 Samora Machel Avenue'),
    ]);

    const result = await service.activeAssignment(rider('profile-1'), NOW);

    expect(result.assignment?.assignmentId).toBe('active');
    expect(result.assignment?.deliveryId).toBe('delivery-active');
    expect(result.assignment?.status).toBe(DeliveryStatus.PICKED_UP);
    expect(result.assignment?.parcel).toEqual({
      description: 'Documents',
      size: 'SMALL',
      instructions: 'Keep dry',
    });
    expect(result.assignment?.pickup.address).toBe('12 Samora Machel Avenue');
    expect(result.assignment?.pickup.contactName).toBe('Pickup Person');
    expect(result.assignment?.pickup.contactPhone).toBe('+263771111111');
    expect(result.assignment?.dropoff.address).toBe('9 Nelson Mandela Avenue');
    expect(result.assignment?.dropoff.contactPhone).toBe('+263772222222');
    expect(result.assignment?.pickup.latitude).toBe('-17.8252000');
    expect(serialized(result.assignment)).not.toHaveProperty('customerId');
    expect(serialized(result.assignment)).not.toHaveProperty('idempotencyKey');
    expect(serialized(result.assignment)).not.toHaveProperty('acceptedPlatformFee');
    expect(JSON.stringify(result)).not.toContain('other-profile');
    expect(JSON.stringify(result)).not.toContain('customer-1');
  });

  it('returns the stored V2 status for a live assignment', async () => {
    const service = serviceFor([
      row('v2', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.RIDER_ASSIGNED, '12 Samora Machel Avenue'),
      row('collecting', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.COLLECTING, 'Collecting road'),
    ]);

    const result = await service.activeAssignment(rider('profile-1'), NOW);

    expect(result.assignment?.status).toBe(DeliveryStatus.RIDER_ASSIGNED);
    const listed = await service.liveAssignments(rider('profile-1'), NOW);
    expect(listed.assignments.map((assignment) => assignment.status)).toEqual([
      DeliveryStatus.RIDER_ASSIGNED,
      DeliveryStatus.COLLECTING,
    ]);
  });

  it('selects the earliest live assignment using the list order', async () => {
    const service = serviceFor([
      row('later', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.COLLECTING, 'Later road', FRESH, {}, new Date('2026-10-20T12:00:00.000Z')),
      row('earlier', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.RIDER_ASSIGNED, 'Earlier road', FRESH, {}, new Date('2026-10-18T12:00:00.000Z')),
    ]);

    const active = await service.activeAssignment(rider('profile-1'), NOW);
    const listed = await service.liveAssignments(rider('profile-1'), NOW);

    expect(active.assignment?.assignmentId).toBe('earlier');
    expect(listed.assignments.map((assignment) => assignment.assignmentId)).toEqual(['earlier', 'later']);
  });

  it('returns assignment null when nothing is resumable', async () => {
    const service = serviceFor([
      row('delivered', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.DELIVERED, 'Finished road'),
      row('released', 'profile-1', AssignmentStatus.RELEASED, DeliveryStatus.SEARCHING, 'Released road'),
    ]);

    await expect(service.activeAssignment(rider('profile-1'), NOW)).resolves.toEqual({ assignment: null });
    await expect(service.activeAssignment(rider('nobody'), NOW)).resolves.toEqual({ assignment: null });
  });

  it('withholds coordinates that are already due for deletion', async () => {
    const service = serviceFor([
      row('active', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.ASSIGNED, '12 Samora Machel Avenue', EXPIRED),
    ]);

    const result = await service.activeAssignment(rider('profile-1'), NOW);

    expect(result.assignment?.pickup.address).toBe('12 Samora Machel Avenue');
    expect(result.assignment?.pickup.latitude).toBeNull();
    expect(result.assignment?.pickup.longitude).toBeNull();
    expect(result.assignment?.dropoff.latitude).toBeNull();
    expect(result.assignment?.dropoff.longitude).toBeNull();
    expect(JSON.stringify(result)).not.toContain('-17.8252000');
    expect(JSON.stringify(result)).not.toContain('31.0335000');
  });

  it('returns the accepted bid, service class, and deadline without the suggested price', async () => {
    const deliverBy = new Date('2026-10-25T16:00:00.000Z');
    const service = serviceFor([
      row('flexible', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.RIDER_ASSIGNED, 'Flexible road', FRESH, {
        serviceClass: 'FLEXIBLE',
        deliverBy,
        acceptedBidAmount: '12.50',
        price: '9.99',
      }),
      row('express', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.COLLECTING, 'Express road', FRESH, {
        serviceClass: 'EXPRESS',
        deliverBy,
        acceptedBidAmount: { toFixed: () => '8.00' },
        price: '20.00',
      }),
      row('legacy', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.ASSIGNED, 'Legacy road'),
    ]);

    const listed = await service.liveAssignments(rider('profile-1'), NOW);

    expect(listed.assignments.map((assignment) => assignment.serviceClass)).toEqual(['FLEXIBLE', 'EXPRESS', null]);
    expect(listed.assignments[0]).toMatchObject({
      deliverBy: '2026-10-25T16:00:00.000Z',
      agreedPrice: '12.50',
      distanceMeters: 1_500,
      createdAt: FRESH.toISOString(),
    });
    expect(listed.assignments[1]?.agreedPrice).toBe('8.00');
    expect(listed.assignments[2]).toMatchObject({ deliverBy: null, agreedPrice: null, serviceClass: null });
    const encoded = JSON.stringify(listed);
    expect(encoded).not.toContain('9.99');
    expect(encoded).not.toContain('20.00');
    expect(encoded).not.toContain('suggestedPrice');
  });

  it('returns this rider completed marketplace and V1 deliveries newest first', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, RiderAssignmentController.prototype.completed)).toBe('completed');
    expect(Reflect.getMetadata(METHOD_METADATA, RiderAssignmentController.prototype.completed)).toBe(RequestMethod.GET);
    const service = serviceFor([
      row('older-market', 'profile-1', AssignmentStatus.COMPLETED, DeliveryStatus.DELIVERED, 'Older market road', FRESH, {
        serviceClass: 'FLEXIBLE',
        acceptedBidAmount: '10.00',
        completedAt: new Date('2026-10-18T08:00:00.000Z'),
      }),
      row('newer-v1', 'profile-1', AssignmentStatus.COMPLETED, DeliveryStatus.DELIVERED, 'Newer legacy road', FRESH, {
        completedAt: new Date('2026-10-20T08:00:00.000Z'),
      }),
      row('active', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.PICKED_UP, 'Active road'),
      row('pending', 'profile-1', AssignmentStatus.OFFERED, DeliveryStatus.SEARCHING, 'Pending road'),
      row('accepted-delivered', 'profile-1', AssignmentStatus.ACCEPTED, DeliveryStatus.DELIVERED, 'Unclosed road'),
      row('cancelled', 'profile-1', AssignmentStatus.COMPLETED, DeliveryStatus.CANCELLED, 'Cancelled road'),
      row('failed', 'profile-1', AssignmentStatus.COMPLETED, DeliveryStatus.FAILED, 'Failed road'),
      row('released', 'profile-1', AssignmentStatus.RELEASED, DeliveryStatus.DELIVERED, 'Released road'),
      row('other', 'other-profile', AssignmentStatus.COMPLETED, DeliveryStatus.DELIVERED, 'Other rider road', FRESH, {
        completedAt: new Date('2026-10-21T08:00:00.000Z'),
      }),
    ]);

    const listed = await service.completedAssignments(rider('profile-1'), NOW);

    expect(listed.assignments.map((assignment) => assignment.assignmentId)).toEqual(['newer-v1', 'older-market']);
    expect(listed.assignments[0]).toMatchObject({
      status: DeliveryStatus.DELIVERED,
      serviceClass: null,
      completedAt: '2026-10-20T08:00:00.000Z',
      pickup: { address: 'Newer legacy road' },
    });
    expect(listed.assignments[1]).toMatchObject({
      serviceClass: 'FLEXIBLE',
      agreedPrice: '10.00',
      completedAt: '2026-10-18T08:00:00.000Z',
    });
    const encoded = JSON.stringify(listed);
    expect(encoded).not.toContain('other-profile');
    expect(encoded).not.toContain('Active road');
    expect(encoded).not.toContain('Cancelled road');
    expect(encoded).not.toContain('Failed road');
    expect(encoded).not.toContain('Pending road');
    expect((await service.liveAssignments(rider('profile-1'), NOW)).assignments.map((assignment) => assignment.assignmentId)).toEqual(['active']);
  });

  it('pages completed deliveries by completed time and id without sharing another rider cursor', async () => {
    const sameTime = new Date('2026-10-19T08:00:00.000Z');
    const newer = '018f5b4a-7c3a-7c3a-8c3a-0000000000b2';
    const tied = '018f5b4a-7c3a-7c3a-8c3a-0000000000a1';
    const older = '018f5b4a-7c3a-7c3a-8c3a-000000000018';
    const other = '018f5b4a-7c3a-7c3a-8c3a-000000000099';
    const missing = '018f5b4a-7c3a-7c3a-8c3a-000000000098';
    const service = serviceFor([
      row(newer, 'profile-1', AssignmentStatus.COMPLETED, DeliveryStatus.DELIVERED, 'B road', FRESH, { completedAt: sameTime }),
      row(tied, 'profile-1', AssignmentStatus.COMPLETED, DeliveryStatus.DELIVERED, 'A road', FRESH, { completedAt: sameTime }),
      row(older, 'profile-1', AssignmentStatus.COMPLETED, DeliveryStatus.DELIVERED, 'Older road', FRESH, {
        completedAt: new Date('2026-10-18T08:00:00.000Z'),
      }),
      row(other, 'other-profile', AssignmentStatus.COMPLETED, DeliveryStatus.DELIVERED, 'Other road', FRESH, {
        completedAt: new Date('2026-10-21T08:00:00.000Z'),
      }),
    ]);

    const first = await service.completedAssignmentsPage(rider('profile-1'), '1', undefined, NOW);
    expect(first.assignments.map((assignment) => assignment.assignmentId)).toEqual([newer]);
    expect(first.assignments[0]?.completedAt).toBe(sameTime.toISOString());
    expect(first.nextCursor).toBe(encodeListCursor(sameTime, newer));
    const second = await service.completedAssignmentsPage(rider('profile-1'), '1', first.nextCursor, NOW);
    expect(second.assignments.map((assignment) => assignment.assignmentId)).toEqual([tied]);
    const deleted = encodeListCursor(sameTime, missing);
    const afterDeleted = await service.completedAssignmentsPage(rider('profile-1'), '20', deleted, NOW);
    expect(afterDeleted.assignments.map((assignment) => assignment.assignmentId)).toEqual([older]);
    const last = await service.completedAssignmentsPage(rider('profile-1'), '20', second.nextCursor, NOW);
    expect(last.assignments.map((assignment) => assignment.assignmentId)).toEqual([older]);
    expect(last.nextCursor).toBeNull();
    const empty = await service.completedAssignmentsPage(rider('nobody'), undefined, undefined, NOW);
    expect(empty).toEqual({ assignments: [], nextCursor: null });
    const otherCursor = encodeListCursor(new Date('2026-10-21T08:00:00.000Z'), other);
    const isolated = await service.completedAssignmentsPage(rider('profile-1'), '20', otherCursor, NOW);
    expect(isolated.assignments.map((assignment) => assignment.assignmentId)).toEqual([newer, tied, older]);
    await expect(service.completedAssignmentsPage(rider('profile-1'), '1', other, NOW)).rejects.toThrow('Invalid cursor');
    await expect(service.completedAssignmentsPage(rider('profile-1'), '0', undefined, NOW)).rejects.toThrow('Invalid page limit');
  });
});

describe('pickup route', () => {
  const request = { rider: { userId: 'user-1', riderProfileId: 'profile-1' } };

  it('returns the stored pickup driving geometry and does not invent a line when routing fails', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, RiderAssignmentController.prototype.pickupRoute)).toBe(':assignmentId/pickup-route');
    expect(Reflect.getMetadata(METHOD_METADATA, RiderAssignmentController.prototype.pickupRoute)).toBe(RequestMethod.GET);
    const queries: Array<{ pickupLatitude: number; riderLatitude: number }> = [];
    const controller = new RiderAssignmentController({
      async liveAssignments() {
        return {
          assignments: [{
            assignmentId: 'assignment-1',
            status: 'RIDER_ASSIGNED',
            pickup: { latitude: '-17.8252000', longitude: '31.0335000' },
          }],
        };
      },
    } as unknown as DispatchService, {
      async lookup(query: { pickupLatitude: number; riderLatitude: number }) {
        queries.push(query);
        return {
          metres: 1200,
          seconds: 180,
          line: [
            { latitude: -17.83, longitude: 31.04 },
            { latitude: -17.8252, longitude: 31.0335 },
          ],
        };
      },
    });

    const route = await controller.pickupRoute(request, 'assignment-1', '-17.83', '31.04');

    expect(queries[0]).toMatchObject({ pickupLatitude: -17.8252, riderLatitude: -17.83 });
    expect(route.line).toHaveLength(2);
    expect(route.geometry.length).toBeGreaterThan(0);
    expect(route).toMatchObject({ metres: 1200, seconds: 180 });

    const failed = new RiderAssignmentController({
      async liveAssignments() {
        return { assignments: [{ assignmentId: 'assignment-1', status: 'RIDER_ASSIGNED', pickup: { latitude: '-17.82', longitude: '31.05' } }] };
      },
    } as unknown as DispatchService, {
      async lookup() {
        return null;
      },
    });
    expect(await failed.pickupRoute(request, 'assignment-1', '-17.83', '31.04')).toEqual({ geometry: '', line: [] });
  });
});

describe('delivery route', () => {
  const request = { rider: { userId: 'user-1', riderProfileId: 'profile-1' } };

  it('injects PlacesService and returns its road between pickup and drop-off', async () => {
    const declared = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, RiderAssignmentController) as Array<{ index: number; param: unknown }>;
    expect(declared).toContainEqual({ index: 2, param: PlacesService });
    const origins: number[][] = [];
    let status = 'COLLECTED';
    const controller = new RiderAssignmentController({
      async liveAssignments() {
        return {
          assignments: [{
            assignmentId: 'assignment-1',
            status,
            pickup: { latitude: '-17.8252000', longitude: '31.0335000' },
            dropoff: { latitude: '-17.8200000', longitude: '31.0400000' },
          }],
        };
      },
    } as unknown as DispatchService, null, {
      async deliveryRoute(originLatitude: number, originLongitude: number, dropoffLatitude: number, dropoffLongitude: number) {
        origins.push([originLatitude, originLongitude, dropoffLatitude, dropoffLongitude]);
        return {
          line: [
            { latitude: originLatitude, longitude: originLongitude },
            { latitude: -17.823, longitude: 31.036 },
            { latitude: dropoffLatitude, longitude: dropoffLongitude },
          ],
        };
      },
    } as unknown as PlacesService);

    const route = await controller.deliveryRoute(request, 'assignment-1');

    expect(route.line.length).toBeGreaterThan(2);
    expect(route.geometry.length).toBeGreaterThan(0);
    expect(origins[0]).toEqual([-17.8252, 31.0335, -17.82, 31.04]);
    await controller.deliveryRoute(request, 'assignment-1', '-17.8300', '31.0500');
    expect(origins[1]).toEqual([-17.83, 31.05, -17.82, 31.04]);
    status = 'OUT_FOR_DELIVERY';
    await controller.deliveryRoute(request, 'assignment-1', '-17.8300', '31.0500');
    expect(origins[2]).toEqual([-17.8252, 31.0335, -17.82, 31.04]);
    const missing = new RiderAssignmentController({
      async liveAssignments() {
        return {
          assignments: [{
            assignmentId: 'assignment-1',
            status: 'COLLECTED',
            pickup: { latitude: '-17.8252000', longitude: '31.0335000' },
            dropoff: { latitude: '-17.8200000', longitude: '31.0400000' },
          }],
        };
      },
    } as unknown as DispatchService);
    expect(await missing.deliveryRoute(request, 'assignment-1')).toEqual({ geometry: '', line: [] });
  });
});

function serialized(assignment: ActiveAssignment | null): Record<string, unknown> {
  return JSON.parse(JSON.stringify(assignment)) as Record<string, unknown>;
}

function rider(riderProfileId: string) {
  return { userId: 'user-1', riderProfileId };
}

type AssignmentQuery = {
  id?: string | { in: string[] };
  riderProfileId?: string;
  status?: AssignmentStatus;
  completedAt?: { not: null };
  delivery?: { status?: DeliveryStatus | { in?: DeliveryStatus[] } };
  AND?: Array<{ OR?: Array<{ completedAt?: Date | { lt?: Date }; id?: { lt?: string } }> }>;
};

function matchesAssignment(entry: ReturnType<typeof row>, where?: AssignmentQuery) {
  if (!where) return true;
  const statuses = where.delivery?.status;
  const deliveryStatus = statuses && typeof statuses === 'object' && 'in' in statuses ? statuses.in : undefined;
  const keyset = where.AND?.every((clause) => !clause.OR || clause.OR.some((branch) => {
    const time = entry.completedAt?.getTime();
    const timeOk = branch.completedAt instanceof Date
      ? time === branch.completedAt.getTime()
      : branch.completedAt?.lt !== undefined && time !== undefined && time < branch.completedAt.lt.getTime();
    const idOk = branch.id?.lt === undefined || entry.id < branch.id.lt;
    return timeOk && idOk;
  })) ?? true;
  return (where.id === undefined || (typeof where.id === 'string' ? entry.id === where.id : where.id.in.includes(entry.id)))
    && (where.riderProfileId === undefined || entry.riderProfileId === where.riderProfileId)
    && (where.status === undefined || entry.status === where.status)
    && (where.completedAt?.not !== null || entry.completedAt != null)
    && keyset
    && (deliveryStatus ? deliveryStatus.includes(entry.delivery.status) : statuses === undefined || entry.delivery.status === statuses);
}

function serviceFor(rows: ReturnType<typeof row>[]) {
  const indexed = rows.map((entry, index) => ({
    ...entry,
    createdAt: entry.createdAt ?? new Date(index),
  }));
  const prisma = {
    async $queryRaw(query: { values: unknown[] }) { return mockExactPage(query, indexed.filter(row => row.status === AssignmentStatus.COMPLETED && row.delivery.status === DeliveryStatus.DELIVERED), row => row.riderProfileId, row => row.completedAt); },
    deliveryAssignment: {
      async findFirst(args?: { where?: AssignmentQuery }) {
        return indexed.find((entry) => matchesAssignment(entry, args?.where)) ?? null;
      },
      async findMany(args?: { where?: AssignmentQuery; orderBy?: unknown; take?: number }) {
        let rows = indexed.filter((entry) => matchesAssignment(entry, args?.where));
        if (args?.orderBy) {
          const byCompletion = Array.isArray(args.orderBy)
            && args.orderBy.some((item) => item && typeof item === 'object' && 'completedAt' in item);
          rows = [...rows].sort((left, right) => {
            const leftTime = (byCompletion ? left.completedAt ?? left.createdAt : left.createdAt).getTime();
            const rightTime = (byCompletion ? right.completedAt ?? right.createdAt : right.createdAt).getTime();
            const byTime = byCompletion ? rightTime - leftTime : leftTime - rightTime;
            if (byTime !== 0) return byTime;
            return byCompletion
              ? (left.id < right.id ? 1 : left.id > right.id ? -1 : 0)
              : (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
          });
        }
        return args?.take == null ? rows : rows.slice(0, args.take);
      },
    },
  };
  return new DispatchService(prisma as unknown as PrismaService);
}

function row(
  id: string,
  riderProfileId: string,
  status: AssignmentStatus,
  deliveryStatus: DeliveryStatus,
  pickupAddress: string,
  retrievedAt = FRESH,
  read: {
    serviceClass?: 'FLEXIBLE' | 'EXPRESS' | null;
    deliverBy?: Date | null;
    acceptedBidAmount?: string | { toFixed(digits: number): string } | null;
    price?: string;
    completedAt?: Date;
  } = {},
  assignmentCreatedAt?: Date,
) {
  return {
    id,
    riderProfileId,
    status,
    completedAt: read.completedAt ?? null,
    createdAt: assignmentCreatedAt,
    idempotencyKey: `key-${id}`,
    acceptedPlatformFee: '0.50',
    acceptedBidAmount: read.acceptedBidAmount ?? null,
    delivery: {
      id: `delivery-${id}`,
      customerId: 'customer-1',
      status: deliveryStatus,
      currency: Currency.USD,
      payer: 'SENDER',
      paymentMethod: 'CASH',
      parcelDescription: 'Documents',
      parcelSize: 'SMALL',
      parcelInstructions: 'Keep dry',
      pickupAddress,
      pickupLatitude: '-17.8252000',
      pickupLongitude: '31.0335000',
      pickupLandmark: 'Blue gate',
      pickupInstructions: 'Call on arrival',
      pickupContactName: 'Pickup Person',
      pickupContactPhone: '+263771111111',
      dropoffAddress: '9 Nelson Mandela Avenue',
      dropoffLatitude: '-17.8300000',
      dropoffLongitude: '31.0400000',
      dropoffLandmark: null,
      dropoffInstructions: null,
      recipientName: 'Recipient Person',
      recipientPhone: '+263772222222',
      createdAt: retrievedAt,
      updatedAt: read.completedAt,
      statusEvents: read.completedAt
        ? [{ newStatus: DeliveryStatus.DELIVERED, occurredAt: read.completedAt }]
        : [],
      distanceMeters: 1_500,
      price: read.price ?? '3.00',
      serviceClass: read.serviceClass ?? null,
      deliverBy: read.deliverBy ?? null,
      pickupCoordinateSource: CoordinateSource.GOOGLE_PLACES,
      pickupPlaceId: 'ChIJpickup',
      pickupCoordinateRetrievedAt: retrievedAt,
      pickupCoordinateRefreshAttemptedAt: null,
      dropoffCoordinateSource: CoordinateSource.GOOGLE_PLACES,
      dropoffPlaceId: 'ChIJdropoff',
      dropoffCoordinateRetrievedAt: retrievedAt,
      dropoffCoordinateRefreshAttemptedAt: null,
    },
  };
}
