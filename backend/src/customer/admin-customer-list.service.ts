import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminCustomerListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>) {
    const page = readInteger(query.page, 1, 1, 100000);
    const limit = readInteger(query.limit, 20, 1, 100);
    const [total, rows] = await Promise.all([
      this.prisma.customerAccount.count(),
      this.prisma.customerAccount.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          kind: true,
          name: true,
          contactName: true,
          address: true,
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
      data: rows.map((customer) => ({
        customerAccountId: customer.id,
        name: customer.name,
        fullName: customer.user.fullName,
        contactName: customer.contactName,
        phone: customer.user.phone,
        accountStatus: customer.user.accountStatus,
        kind: customer.kind,
        address: customer.address,
        createdAt: customer.createdAt,
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

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== 'string'
    || !/^[0-9]+$/.test(value)
    || !Number.isSafeInteger(Number(value))
    || Number(value) < min
    || Number(value) > max
  ) {
    throw new BadRequestException('Invalid pagination parameter');
  }
  return Number(value);
}
