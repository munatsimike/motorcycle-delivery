import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderApprovalStatus } from '../generated/prisma/client.js';

@Injectable()
export class RiderListService {
  constructor(private readonly prisma: PrismaService) {}

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

    const where = approvalStatus
      ? { approvalStatus: approvalStatus as RiderApprovalStatus }
      : {};

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
