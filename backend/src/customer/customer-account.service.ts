import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { CustomerAccountKind, Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CustomerSession } from '../auth/customer-access.service.js';
import { readCustomerProfile } from './customer-profile.js';

export type CustomerAccountResponse = {
  id: string;
  kind: CustomerAccountKind;
  name: string;
  contactName: string | null;
  address: string;
  phone: string;
};

type AccountRow = {
  id: string;
  kind: CustomerAccountKind;
  name: string;
  contactName: string | null;
  address: string;
};

@Injectable()
export class CustomerAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async current(customer: { userId: string }): Promise<CustomerAccountResponse> {
    const user = await this.ownedUser(customer.userId);
    if (!user.customerAccount) {
      throw new ForbiddenException('Customer access is required');
    }
    return toResponse(user.customerAccount, user.phone);
  }

  async activate(session: CustomerSession, body: unknown, now = new Date()): Promise<CustomerAccountResponse> {
    const user = await this.ownedUser(session.userId);
    if (user.customerAccount) {
      return toResponse(user.customerAccount, user.phone);
    }
    const profile = readCustomerProfile(body);
    try {
      const created = await this.prisma.customerAccount.create({
        data: {
          userId: user.id,
          kind: profile.kind,
          name: profile.name,
          contactName: profile.contactName,
          address: profile.address,
          updatedAt: now,
        },
      });
      return toResponse(created, user.phone);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.customerAccount.findUnique({ where: { userId: user.id } });
        if (existing) {
          return toResponse(existing, user.phone);
        }
        throw new ConflictException('Phone number is already registered');
      }
      throw error;
    }
  }

  private async ownedUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { customerAccount: true },
    });
    if (!user || (user.role !== UserRole.RIDER && user.role !== UserRole.CUSTOMER)) {
      throw new ForbiddenException('Customer access is required');
    }
    return user;
  }
}

function toResponse(account: AccountRow, phone: string): CustomerAccountResponse {
  return {
    id: account.id,
    kind: account.kind,
    name: account.name,
    contactName: account.contactName,
    address: account.address,
    phone,
  };
}
