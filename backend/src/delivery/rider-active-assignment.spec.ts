import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import {
  AssignmentStatus,
  CoordinateSource,
  Currency,
  DeliveryStatus,
} from '../generated/prisma/client.js';
import { RiderAccessGuard } from '../auth/rider-access.guard.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DispatchService, type ActiveAssignment } from './dispatch.service.js';
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
});

function serialized(assignment: ActiveAssignment | null): Record<string, unknown> {
  return JSON.parse(JSON.stringify(assignment)) as Record<string, unknown>;
}

function rider(riderProfileId: string) {
  return { userId: 'user-1', riderProfileId };
}

function serviceFor(rows: ReturnType<typeof row>[]) {
  const prisma = {
    deliveryAssignment: {
      async findMany() {
        return rows;
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
) {
  return {
    id,
    riderProfileId,
    status,
    idempotencyKey: `key-${id}`,
    acceptedPlatformFee: '0.50',
    delivery: {
      id: `delivery-${id}`,
      customerId: 'customer-1',
      status: deliveryStatus,
      price: '3.00',
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
