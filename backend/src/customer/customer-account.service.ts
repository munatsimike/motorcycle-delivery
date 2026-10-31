import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { CustomerAccountKind, Prisma, ProfilePhotoStatus, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CustomerSession } from '../auth/customer-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { readCustomerProfile } from './customer-profile.js';
import { readCustomerProfileUpdate } from './customer-profile-update.js';

export type CustomerAccountResponse = {
  id: string;
  kind: CustomerAccountKind;
  name: string;
  contactName: string | null;
  address: string;
  phone: string;
  email: string | null;
  hasProfilePhoto: boolean;
  marketplaceEnabled: boolean;
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
    return toResponse(user.customerAccount, user.phone, user.email, await this.hasProfilePhoto(user.customerAccount.id));
  }

  async update(customer: { userId: string }, body: unknown): Promise<CustomerAccountResponse> {
    const user = await this.ownedUser(customer.userId);
    if (!user.customerAccount) {
      throw new ForbiddenException('Customer access is required');
    }
    const profile = readCustomerProfileUpdate(body);
    const accountId = user.customerAccount.id;
    const kind = user.customerAccount.kind;
    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            fullName: profile.fullName,
            email: profile.email,
          },
        });
        const account = await tx.customerAccount.update({
          where: { id: accountId },
          data: {
            ...(kind === CustomerAccountKind.BUSINESS
              ? { contactName: profile.fullName }
              : { name: profile.fullName }),
            address: profile.address,
          },
        });
        return { account, phone: updatedUser.phone, email: updatedUser.email };
      });
      return toResponse(saved.account, saved.phone, saved.email, await this.hasProfilePhoto(saved.account.id));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email address is already in use.');
      }
      throw error;
    }
  }

  async activate(session: CustomerSession, body: unknown, now = new Date()): Promise<CustomerAccountResponse> {
    const user = await this.ownedUser(session.userId);
    if (user.customerAccount) {
      return toResponse(user.customerAccount, user.phone, user.email, await this.hasProfilePhoto(user.customerAccount.id));
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
      return toResponse(created, user.phone, user.email, false);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.customerAccount.findUnique({ where: { userId: user.id } });
        if (existing) {
          return toResponse(existing, user.phone, user.email, await this.hasProfilePhoto(existing.id));
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

  private async hasProfilePhoto(customerAccountId: string): Promise<boolean> {
    const photo = await this.prisma.customerProfilePhoto.findFirst({
      where: { customerAccountId, status: ProfilePhotoStatus.STORED },
      select: { id: true },
    });
    return photo !== null;
  }
}

function toResponse(
  account: AccountRow,
  phone: string,
  email: string | null,
  hasProfilePhoto: boolean,
): CustomerAccountResponse {
  return {
    id: account.id,
    kind: account.kind,
    name: account.name,
    contactName: account.contactName,
    address: account.address,
    phone,
    email,
    hasProfilePhoto,
    marketplaceEnabled: v2MarketplaceEnabled(),
  };
}
