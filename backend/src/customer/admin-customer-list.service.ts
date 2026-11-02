import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CUSTOMER_SELECT = {
  id: true,
  kind: true,
  name: true,
  contactName: true,
  address: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      fullName: true,
      phone: true,
      accountStatus: true,
    },
  },
} as const;

@Injectable()
export class AdminCustomerListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>) {
    const page = readInteger(query.page, 1, 1, 100000);
    const limit = readInteger(query.limit, 20, 1, 100);
    const where = searchWhere(readSearch(query.q));
    const [total, rows] = await Promise.all([
      this.prisma.customerAccount.count({ where }),
      this.prisma.customerAccount.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: CUSTOMER_SELECT,
      }),
    ]);
    return {
      data: rows.map(toCustomer),
      pagination: pageOf(page, limit, total),
    };
  }

  async getById(customerAccountId: string) {
    const customer = await this.prisma.customerAccount.findUnique({
      where: { id: customerAccountId },
      select: CUSTOMER_SELECT,
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return toCustomer(customer);
  }

  async listDeliveries(customerAccountId: string, query: Record<string, unknown>) {
    const page = readInteger(query.page, 1, 1, 100000);
    const limit = readInteger(query.limit, 20, 1, 100);
    const customer = await this.prisma.customerAccount.findUnique({
      where: { id: customerAccountId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    const where = { customerId: customerAccountId };
    const [total, deliveries] = await Promise.all([
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
        price: delivery.price == null ? null : delivery.price.toString(),
        currency: delivery.currency,
        paymentMethod: delivery.paymentMethod,
        activeAssignment: delivery.assignments[0] ?? null,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
      })),
      pagination: pageOf(page, limit, total),
    };
  }
}

function toCustomer(customer: {
  id: string;
  kind: string;
  name: string;
  contactName: string | null;
  address: string;
  createdAt: Date;
  updatedAt: Date;
  user: { fullName: string; phone: string; accountStatus: string };
}) {
  return {
    customerAccountId: customer.id,
    name: customer.name,
    fullName: customer.user.fullName,
    contactName: customer.contactName,
    phone: customer.user.phone,
    accountStatus: customer.user.accountStatus,
    kind: customer.kind,
    address: customer.address,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function readSearch(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('Invalid search');
  }
  const term = value.trim();
  if (!term) {
    return undefined;
  }
  if (term.length > 80 || /[\u0000-\u001f]/.test(term)) {
    throw new BadRequestException('Invalid search');
  }
  return term;
}

function searchWhere(term: string | undefined): Prisma.CustomerAccountWhereInput {
  if (!term) {
    return {};
  }
  const filters: Prisma.CustomerAccountWhereInput[] = [
    { name: { contains: term, mode: 'insensitive' } },
    { contactName: { contains: term, mode: 'insensitive' } },
    { user: { is: { fullName: { contains: term, mode: 'insensitive' } } } },
    { user: { is: { phone: { contains: term } } } },
  ];
  const digits = term.replace(/\D/g, '');
  if (digits.length >= 3 && digits !== term) {
    filters.push({ user: { is: { phone: { contains: digits } } } });
  }
  return { OR: filters };
}

function pageOf(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
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
