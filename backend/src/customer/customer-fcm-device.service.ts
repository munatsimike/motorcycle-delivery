import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { v2MarketplaceEnabled } from '../auth/v2-flags.js';
import { PrismaService } from '../prisma/prisma.service.js';

const TOKEN_MAX_LENGTH = 512;

export function readCustomerPushToken(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('FCM token is required');
  }
  const token = value.trim();
  if (token.length < 1 || token.length > TOKEN_MAX_LENGTH) {
    throw new BadRequestException('FCM token is required');
  }
  return token;
}

@Injectable()
export class CustomerFcmDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async register(customer: CustomerContext, fcmToken: unknown): Promise<{ registered: true }> {
    this.assertCustomer(customer);
    const token = readCustomerPushToken(fcmToken);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "customer_fcm_devices" (
         "id", "customer_account_id", "fcm_token", "created_at", "updated_at"
       )
       VALUES ($1::uuid, $2::uuid, $3, now(), now())
       ON CONFLICT ("fcm_token") DO UPDATE
       SET "customer_account_id" = EXCLUDED."customer_account_id",
           "invalidated_at" = NULL,
           "updated_at" = now()`,
      randomUUID(),
      customer.customerAccountId,
      token,
    );
    return { registered: true };
  }

  async remove(customer: CustomerContext, fcmToken: unknown): Promise<void> {
    this.assertCustomer(customer);
    const token = readCustomerPushToken(fcmToken);
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "customer_fcm_devices"
       WHERE "fcm_token" = $1
         AND "customer_account_id" = $2::uuid`,
      token,
      customer.customerAccountId,
    );
  }

  private assertCustomer(customer: CustomerContext): void {
    if (!v2MarketplaceEnabled()) {
      throw new NotFoundException('Bidding is not available');
    }
    if (customer.role !== UserRole.CUSTOMER) {
      throw new ForbiddenException('Customer access is required');
    }
  }
}
