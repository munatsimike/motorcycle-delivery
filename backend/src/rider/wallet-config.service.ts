import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Currency, WalletActorType } from '../generated/prisma/client.js';
import type { AdminContext } from '../auth/admin-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { centsFromDecimal, formatCents, readMoneyCents } from '../delivery/money.js';
import { WALLET_CONFIG_MISSING } from './wallet-ledger.js';

export const WALLET_CONFIG_INVALID = 'Enter the wallet configuration';

type ConfigRow = {
  id: string;
  configVersion: number;
  welcomeBonus: string | { toFixed(digits: number): string };
  defaultBorrowingLimit: string | { toFixed(digits: number): string };
  platformFee: string | { toFixed(digits: number): string };
};

type ConfigInput = {
  welcomeBonusCents: number;
  defaultBorrowingLimitCents: number;
  platformFeeCents: number;
};

@Injectable()
export class WalletConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async current() {
    const active = await this.prisma.walletConfig.findFirst({ where: { isActive: true } });
    if (!active) {
      throw new NotFoundException(WALLET_CONFIG_MISSING);
    }
    return toConfigResponse(active);
  }

  async replace(admin: AdminContext, body: unknown, now = new Date()) {
    const input = readWalletConfig(body);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "wallet_configs" WHERE "is_active" = true FOR UPDATE
      `;
      const active = await tx.walletConfig.findFirst({ where: { isActive: true } });
      if (active && sameConfig(active, input)) {
        return toConfigResponse(active);
      }
      if (active) {
        await tx.walletConfig.update({
          where: { id: active.id },
          data: { isActive: false },
        });
      }
      const created = await tx.walletConfig.create({
        data: {
          configVersion: active ? active.configVersion + 1 : 1,
          currency: Currency.USD,
          welcomeBonus: formatCents(input.welcomeBonusCents),
          defaultBorrowingLimit: formatCents(input.defaultBorrowingLimitCents),
          platformFee: formatCents(input.platformFeeCents),
          isActive: true,
          createdById: admin.userId,
          createdAt: now,
        },
      });
      await tx.walletConfigAudit.create({
        data: {
          configVersion: created.configVersion,
          actorType: WalletActorType.ADMIN,
          actorId: admin.userId,
          previousWelcomeBonus: active ? formatCents(centsFromDecimal(active.welcomeBonus)) : null,
          previousDefaultBorrowingLimit: active ? formatCents(centsFromDecimal(active.defaultBorrowingLimit)) : null,
          previousPlatformFee: active ? formatCents(centsFromDecimal(active.platformFee)) : null,
          newWelcomeBonus: formatCents(input.welcomeBonusCents),
          newDefaultBorrowingLimit: formatCents(input.defaultBorrowingLimitCents),
          newPlatformFee: formatCents(input.platformFeeCents),
          createdAt: now,
        },
      });
      return toConfigResponse(created);
    });
  }
}

export function readWalletConfig(body: unknown): ConfigInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException(WALLET_CONFIG_INVALID);
  }
  const record = body as Record<string, unknown>;
  if (record.currency !== undefined && record.currency !== Currency.USD) {
    throw new BadRequestException('USD is the only supported currency');
  }
  return {
    welcomeBonusCents: readMoneyCents(record.welcomeBonus, true, 'Enter the welcome bonus'),
    defaultBorrowingLimitCents: readMoneyCents(record.defaultBorrowingLimit, true, 'Enter the default negative wallet limit'),
    platformFeeCents: readMoneyCents(record.platformFee, true, 'Enter the platform fee'),
  };
}

export function toConfigResponse(row: ConfigRow) {
  return {
    configVersion: row.configVersion,
    currency: Currency.USD,
    welcomeBonus: formatCents(centsFromDecimal(row.welcomeBonus)),
    defaultBorrowingLimit: formatCents(centsFromDecimal(row.defaultBorrowingLimit)),
    platformFee: formatCents(centsFromDecimal(row.platformFee)),
  };
}

function sameConfig(row: ConfigRow, input: ConfigInput): boolean {
  return centsFromDecimal(row.welcomeBonus) === input.welcomeBonusCents
    && centsFromDecimal(row.defaultBorrowingLimit) === input.defaultBorrowingLimitCents
    && centsFromDecimal(row.platformFee) === input.platformFeeCents;
}
