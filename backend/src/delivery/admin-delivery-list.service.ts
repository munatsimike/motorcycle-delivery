import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminDeliveryListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>) {
    const page = readInteger(query.page, 1, 1, 100000);
    const limit = readInteger(query.limit, 20, 1, 100);

    const status = query.status;

    if (
      status !== undefined &&
      (
        typeof status !== 'string' ||
        !Object.values(DeliveryStatus).includes(status as DeliveryStatus)
      )
    ) {
      throw new BadRequestException('Invalid delivery status');
    }

    const where = status
      ? { status: status as DeliveryStatus }
      : {};

    const [total, deliveries] = await this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          deliveryType: true,
          status: true,
          pickupAddress: true,
          dropoffAddress: true,
          price: true,
          currency: true,
          paymentMethod: true,
          assignments: {
            where: { status: 'ACCEPTED' },
            take: 1,
            select: {
              id: true,
              riderProfileId: true,
              motorcycleId: true,
              status: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      data: deliveries.map((delivery) => ({
        deliveryId: delivery.id,
        deliveryType: delivery.deliveryType,
        status: delivery.status,
        pickupAddress: delivery.pickupAddress,
        dropoffAddress: delivery.dropoffAddress,
        price: delivery.price,
        currency: delivery.currency,
        paymentMethod: delivery.paymentMethod,
        activeAssignment: delivery.assignments[0] ?? null,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  async getById(deliveryId: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deliveryId)
    ) {
      throw new BadRequestException('Invalid delivery ID');
    }

    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        deliveryType: true,
        status: true,
        pickupAddress: true,
        dropoffAddress: true,
        parcelSize: true,
        price: true,
        suggestedPrice: true,
        distanceMeters: true,
        pricingVersion: true,
        payer: true,
        currency: true,
        paymentMethod: true,
        createdAt: true,
        updatedAt: true,
        assignments: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            riderProfileId: true,
            motorcycleId: true,
            status: true,
            offerExpiresAt: true,
            respondedAt: true,
            releaseReason: true,
            releasedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    return {
      deliveryId: delivery.id,
      deliveryType: delivery.deliveryType,
      status: delivery.status,
      pickupAddress: delivery.pickupAddress,
      dropoffAddress: delivery.dropoffAddress,
      parcelSize: delivery.parcelSize,
      price: delivery.price,
      suggestedPrice: delivery.suggestedPrice,
      distanceMeters: delivery.distanceMeters,
      pricingVersion: delivery.pricingVersion,
      payer: delivery.payer,
      currency: delivery.currency,
      paymentMethod: delivery.paymentMethod,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      activeAssignment:
        delivery.assignments.find((assignment) => assignment.status === 'ACCEPTED') ?? null,
      assignments: delivery.assignments,
    };
  }
}

function readInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;

  if (
    typeof value !== 'string' ||
    !/^[0-9]+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new BadRequestException('Invalid pagination parameter');
  }

  return Number(value);
}
