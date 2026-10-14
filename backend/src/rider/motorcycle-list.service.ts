import { BadRequestException, Injectable } from '@nestjs/common';
import { MotorcycleVerificationStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MotorcycleListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>) {
    const page = readInteger(query.page, 1, 1, 100000);
    const limit = readInteger(query.limit, 20, 1, 100);

    const status = query.verificationStatus;
    if (
      status !== undefined &&
      (
        typeof status !== 'string' ||
        !Object.values(MotorcycleVerificationStatus).includes(
          status as MotorcycleVerificationStatus,
        )
      )
    ) {
      throw new BadRequestException('Invalid verification status');
    }

    const registrationNumber = query.registrationNumber;
    if (
      registrationNumber !== undefined &&
      (
        typeof registrationNumber !== 'string' ||
        registrationNumber.length < 1 ||
        registrationNumber.length > 20
      )
    ) {
      throw new BadRequestException('Invalid registration number');
    }

    const where = {
      ...(status
        ? { verificationStatus: status as MotorcycleVerificationStatus }
        : {}),
      ...(registrationNumber ? { registrationNumber } : {}),
    };

    const [total, motorcycles] = await this.prisma.$transaction([
      this.prisma.motorcycle.count({ where }),
      this.prisma.motorcycle.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          riderProfileId: true,
          registrationNumber: true,
          make: true,
          model: true,
          colour: true,
          verificationStatus: true,
          isActive: true,
          createdAt: true,
          riderProfile: {
            select: {
              user: {
                select: {
                  fullName: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      data: motorcycles.map((motorcycle) => ({
        id: motorcycle.id,
        riderProfileId: motorcycle.riderProfileId,
        registrationNumber: motorcycle.registrationNumber,
        make: motorcycle.make,
        model: motorcycle.model,
        colour: motorcycle.colour,
        verificationStatus: motorcycle.verificationStatus,
        isActive: motorcycle.isActive,
        createdAt: motorcycle.createdAt,
        rider: {
          fullName: motorcycle.riderProfile.user.fullName,
          phone: motorcycle.riderProfile.user.phone,
        },
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
