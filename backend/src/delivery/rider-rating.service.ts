import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  DeliveryStatus,
  Prisma,
  RiderClass,
} from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockRiderProfile } from '../rider/motorcycle-lock.js';
import { recordRiderRating } from './rider-stats.js';

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomerRatingState = {
  eligible: boolean;
  submitted: boolean;
  stars: number | null;
};

@Injectable()
export class RiderRatingService {
  constructor(private readonly prisma: PrismaService) {}

  async stateForDelivery(
    customer: CustomerContext,
    deliveryId: string,
  ): Promise<CustomerRatingState> {
    if (!UUID_TEXT.test(deliveryId)) {
      return { eligible: false, submitted: false, stars: null };
    }
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, customerId: customer.customerAccountId },
      select: { id: true, status: true },
    });
    if (!delivery) {
      return { eligible: false, submitted: false, stars: null };
    }
    const rating = await this.prisma.riderRating.findUnique({
      where: { deliveryId },
      select: { stars: true },
    });
    if (rating) {
      return { eligible: false, submitted: true, stars: rating.stars };
    }
    if (delivery.status !== DeliveryStatus.DELIVERED) {
      return { eligible: false, submitted: false, stars: null };
    }
    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: {
        deliveryId,
        status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED] },
      },
      select: { id: true },
    });
    return {
      eligible: assignment != null,
      submitted: false,
      stars: null,
    };
  }

  async rate(
    customer: CustomerContext,
    deliveryId: string,
    body: unknown,
  ): Promise<{ deliveryId: string; stars: number; riderClass: RiderClass }> {
    const stars = readStars(body);
    if (!UUID_TEXT.test(deliveryId)) {
      throw new NotFoundException('Delivery not found');
    }
    try {
      return await this.prisma.$transaction((tx) => this.rateLocked(tx, customer, deliveryId, stars));
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.prisma.$transaction((tx) => this.replayRating(tx, customer, deliveryId, stars));
    }
  }

  private async rateLocked(
    tx: Prisma.TransactionClient,
    customer: CustomerContext,
    deliveryId: string,
    stars: number,
  ): Promise<{ deliveryId: string; stars: number; riderClass: RiderClass }> {
    await tx.$queryRaw`SELECT "id" FROM "deliveries" WHERE "id" = CAST(${deliveryId} AS uuid) FOR UPDATE`;
    const delivery = await tx.delivery.findFirst({
      where: { id: deliveryId, customerId: customer.customerAccountId },
    });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.status !== DeliveryStatus.DELIVERED) {
      throw new ConflictException('This delivery cannot be rated');
    }
    const assignment = await tx.deliveryAssignment.findFirst({
      where: {
        deliveryId,
        status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED] },
      },
      select: { riderProfileId: true },
    });
    if (!assignment) {
      throw new ConflictException('This delivery cannot be rated');
    }
    const profile = await lockRiderProfile(tx, assignment.riderProfileId, 'Delivery not found');
    const existing = await tx.riderRating.findUnique({ where: { deliveryId } });
    if (existing) {
      return replayExisting(existing, customer.customerAccountId, stars, profile.riderClass);
    }
    await tx.riderRating.create({
      data: {
        deliveryId,
        riderProfileId: assignment.riderProfileId,
        customerAccountId: customer.customerAccountId,
        stars,
      },
    });
    const updated = await recordRiderRating(tx, profile, stars);
    return { deliveryId, stars, riderClass: updated.riderClass };
  }

  private async replayRating(
    tx: Prisma.TransactionClient,
    customer: CustomerContext,
    deliveryId: string,
    stars: number,
  ): Promise<{ deliveryId: string; stars: number; riderClass: RiderClass }> {
    const existing = await tx.riderRating.findUnique({ where: { deliveryId } });
    if (!existing) {
      throw new ConflictException('This delivery cannot be rated');
    }
    const profile = await tx.riderProfile.findUnique({
      where: { id: existing.riderProfileId },
      select: { riderClass: true },
    });
    return replayExisting(existing, customer.customerAccountId, stars, profile?.riderClass ?? RiderClass.SILVER);
  }
}

export function customerRatingView(state: CustomerRatingState) {
  return {
    eligible: state.eligible,
    submitted: state.submitted,
    stars: state.stars,
  };
}

function readStars(body: unknown): number {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Choose a rating from 1 to 5 stars');
  }
  const stars = (body as { stars?: unknown }).stars;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new BadRequestException('Choose a rating from 1 to 5 stars');
  }
  return stars;
}

function replayExisting(
  existing: { customerAccountId: string; stars: number; deliveryId: string },
  customerAccountId: string,
  stars: number,
  riderClass: RiderClass,
): { deliveryId: string; stars: number; riderClass: RiderClass } {
  if (existing.customerAccountId !== customerAccountId || existing.stars !== stars) {
    throw new ConflictException('This delivery was already rated');
  }
  return { deliveryId: existing.deliveryId, stars: existing.stars, riderClass };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
