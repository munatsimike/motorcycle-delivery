import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderApprovalStatus } from '../generated/prisma/client.js';

@Injectable()
export class RiderListService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(riderProfileId: string) {
    const rider = await this.prisma.riderProfile.findUnique({
      where: { id: riderProfileId },
      select: {
        id: true,
        verificationStatus: true,
        approvalStatus: true,
        availability: true,
        licenceNumber: true,
        licenceClass: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            fullName: true,
            phone: true,
            email: true,
            accountStatus: true,
          },
        },
        motorcycles: {
          select: {
            id: true,
            registrationNumber: true,
            make: true,
            model: true,
            colour: true,
            verificationStatus: true,
            isActive: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!rider) {
      throw new NotFoundException('Rider not found');
    }

    return {
      riderProfileId: rider.id,
      ...rider.user,
      verificationStatus: rider.verificationStatus,
      approvalStatus: rider.approvalStatus,
      availability: rider.availability,
      licenceNumber: rider.licenceNumber,
      licenceClass: rider.licenceClass,
      verifiedAt: rider.verifiedAt,
      motorcycles: rider.motorcycles,
      createdAt: rider.createdAt,
      updatedAt: rider.updatedAt,
    };
  }
  async list(query: Record<string, unknown>) {
    const page = readInteger(query.page, 1, 1, 100000);
    const limit = readInteger(query.limit, 20, 1, 100);

    const approvalStatus = query.approvalStatus;

    if (
      approvalStatus !== undefined &&
      (
        typeof approvalStatus !== 'string' ||
        !Object.values(RiderApprovalStatus).includes(
          approvalStatus as RiderApprovalStatus,
        )
      )
    ) {
      throw new BadRequestException('Invalid approval status');
    }

    const phone = query.phone;

    if (
      phone !== undefined &&
      (typeof phone !== 'string' || !/^\+?[0-9]{7,15}$/.test(phone))
    ) {
      throw new BadRequestException('Invalid phone number');
    }

    const where = {
      ...(approvalStatus
        ? { approvalStatus: approvalStatus as RiderApprovalStatus }
        : {}),
      ...(phone ? { user: { phone } } : {}),
    };

    const [total, riders] = await this.prisma.$transaction([
      this.prisma.riderProfile.count({ where }),
      this.prisma.riderProfile.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          verificationStatus: true,
          approvalStatus: true,
          availability: true,
          createdAt: true,
          user: {
            select: {
              fullName: true,
              phone: true,
              accountStatus: true,
            },
          },
        },
      }),
    ]);

    return {
      data: riders.map((rider) => ({
        riderProfileId: rider.id,
        fullName: rider.user.fullName,
        phone: rider.user.phone,
        accountStatus: rider.user.accountStatus,
        verificationStatus: rider.verificationStatus,
        approvalStatus: rider.approvalStatus,
        availability: rider.availability,
        createdAt: rider.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
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


