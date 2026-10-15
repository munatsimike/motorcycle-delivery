import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommissionModel } from '../generated/prisma/client.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CommissionPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async current() {
    const active = await this.prisma.commissionPolicy.findFirst({
      where: { isActive: true },
    });

    if (!active) {
      throw new NotFoundException('Active commission policy not found');
    }

    return {
      model: active.model,
      policyVersion: active.policyVersion,
    };
  }

  async replace(admin: AdminContext, body: unknown, now = new Date()) {
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body)
    ) {
      throw new BadRequestException('Enter a valid commission model');
    }

    const record = body as Record<string, unknown>;
    const model = record.model;

    if (
      model !== CommissionModel.ON_COMPLETION &&
      model !== CommissionModel.ON_ACCEPTANCE
    ) {
      throw new BadRequestException('Invalid commission model');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(724310, 1)
      `;

      const active = await tx.commissionPolicy.findFirst({
        where: { isActive: true },
      });

      if (!active) {
        throw new ConflictException('Active commission policy not found');
      }

      if (active.model === model) {
        return {
          model: active.model,
          policyVersion: active.policyVersion,
        };
      }

      await tx.commissionPolicy.update({
        where: { id: active.id },
        data: { isActive: false },
      });

      const created = await tx.commissionPolicy.create({
        data: {
          policyVersion: active.policyVersion + 1,
          model,
          isActive: true,
          createdById: admin.userId,
          createdAt: now,
        },
      });

      return {
        model: created.model,
        policyVersion: created.policyVersion,
      };
    });
  }
}