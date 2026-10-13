import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MotorcycleVerificationStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { readMotorcycleIdentity } from './motorcycle-identity.js';
import { assertCanChangeMotorcycle, hasAcceptedAssignment, lockRiderMotorcycles, lockRiderProfile } from './motorcycle-lock.js';

export type MotorcycleResponse = {
  id: string;
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
  verificationStatus: MotorcycleVerificationStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type MotorcycleRow = {
  id: string;
  riderProfileId: string;
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
  verificationStatus: MotorcycleVerificationStatus;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class MotorcycleService {
  constructor(private readonly prisma: PrismaService) {}

  async register(rider: RiderContext, body: unknown, now = new Date()): Promise<MotorcycleResponse> {
    const identity = readMotorcycleIdentity(body);
    try {
      const created = await this.prisma.motorcycle.create({
        data: {
          id: randomUUID(),
          riderProfileId: rider.riderProfileId,
          registrationNumber: identity.registrationNumber,
          make: identity.make,
          model: identity.model,
          colour: identity.colour,
          verificationStatus: MotorcycleVerificationStatus.PENDING,
          isActive: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      return toResponse(created);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException('That registration number is already registered');
      }
      throw error;
    }
  }

  async list(rider: RiderContext): Promise<MotorcycleResponse[]> {
    const rows = await this.prisma.motorcycle.findMany({
      where: { riderProfileId: rider.riderProfileId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toResponse);
  }

  async get(rider: RiderContext, motorcycleId: string): Promise<MotorcycleResponse> {
    return toResponse(await this.owned(rider, motorcycleId));
  }

  async update(rider: RiderContext, motorcycleId: string, body: unknown, now = new Date()): Promise<MotorcycleResponse> {
    const identity = readMotorcycleIdentity(body);
    return this.prisma.$transaction(async (tx) => {
      await lockRiderProfile(tx, rider.riderProfileId);
      await lockRiderMotorcycles(tx, rider.riderProfileId);
      const current = await ownedIn(tx, rider.riderProfileId, motorcycleId);
      if (
        current.verificationStatus !== MotorcycleVerificationStatus.PENDING
        && current.verificationStatus !== MotorcycleVerificationStatus.REJECTED
      ) {
        throw new ConflictException('This motorcycle can no longer be edited');
      }
      try {
        const updated = await tx.motorcycle.update({
          where: { id: current.id },
          data: {
            registrationNumber: identity.registrationNumber,
            make: identity.make,
            model: identity.model,
            colour: identity.colour,
            verificationStatus: MotorcycleVerificationStatus.PENDING,
            rejectedAt: null,
            rejectedById: null,
            updatedAt: now,
          },
        });
        return toResponse(updated);
      } catch (error) {
        if (isUniqueConstraint(error)) {
          throw new ConflictException('That registration number is already registered');
        }
        throw error;
      }
    });
  }

  async remove(rider: RiderContext, motorcycleId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockRiderProfile(tx, rider.riderProfileId);
      await lockRiderMotorcycles(tx, rider.riderProfileId);
      const current = await ownedIn(tx, rider.riderProfileId, motorcycleId);
      if (current.verificationStatus !== MotorcycleVerificationStatus.PENDING) {
        throw new ConflictException('Only a pending motorcycle can be deleted');
      }
      const referenced = await tx.deliveryAssignment.findFirst({
        where: { motorcycleId: current.id },
        select: { id: true },
      });
      if (referenced) {
        throw new ConflictException('This motorcycle is used by a delivery');
      }
      await tx.motorcycle.delete({ where: { id: current.id } });
    });
  }

  async selectActive(rider: RiderContext, motorcycleId: string, now = new Date()): Promise<MotorcycleResponse> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await lockRiderProfile(tx, rider.riderProfileId);
      await lockRiderMotorcycles(tx, rider.riderProfileId);
      assertCanChangeMotorcycle(profile.availability, await hasAcceptedAssignment(tx, rider.riderProfileId));
      const current = await ownedIn(tx, rider.riderProfileId, motorcycleId);
      if (current.verificationStatus !== MotorcycleVerificationStatus.VERIFIED) {
        throw new ConflictException('Only a verified motorcycle can be selected');
      }
      await tx.motorcycle.updateMany({
        where: { riderProfileId: rider.riderProfileId, isActive: true },
        data: { isActive: false, updatedAt: now },
      });
      const updated = await tx.motorcycle.update({
        where: { id: current.id },
        data: { isActive: true, updatedAt: now },
      });
      return toResponse(updated);
    });
  }

  async clearActive(rider: RiderContext, motorcycleId: string, now = new Date()): Promise<MotorcycleResponse> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await lockRiderProfile(tx, rider.riderProfileId);
      await lockRiderMotorcycles(tx, rider.riderProfileId);
      assertCanChangeMotorcycle(profile.availability, await hasAcceptedAssignment(tx, rider.riderProfileId));
      const current = await ownedIn(tx, rider.riderProfileId, motorcycleId);
      const updated = await tx.motorcycle.update({
        where: { id: current.id },
        data: { isActive: false, updatedAt: now },
      });
      return toResponse(updated);
    });
  }

  private async owned(rider: RiderContext, motorcycleId: string): Promise<MotorcycleRow> {
    return ownedIn(this.prisma, rider.riderProfileId, motorcycleId);
  }
}

async function ownedIn(
  db: Pick<Prisma.TransactionClient, 'motorcycle'>,
  riderProfileId: string,
  motorcycleId: string,
): Promise<MotorcycleRow> {
  const row = await db.motorcycle.findFirst({
    where: { id: motorcycleId, riderProfileId },
  });
  if (!row) {
    throw new NotFoundException('Motorcycle not found');
  }
  return row;
}

function toResponse(row: MotorcycleRow): MotorcycleResponse {
  return {
    id: row.id,
    registrationNumber: row.registrationNumber,
    make: row.make,
    model: row.model,
    colour: row.colour,
    verificationStatus: row.verificationStatus,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
